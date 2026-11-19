"""Static SI four-pole model and dimensioned prototype layouts. Run from any cwd."""
import csv
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle
from reproduce_three_rotor import L, t, diameter, magnetization, delta, radial, energy

OUT = Path(__file__).resolve().parents[1] / "results"
Z = np.array([0., 0., 1.])


def write_table(name, columns, rows):
    with (OUT / name).open("w", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(columns.split())
        writer.writerows(rows)


def potential(centers, axes, length=L, thickness=t, width=diameter):
    i, j = np.triu_indices(len(axes), 1)
    s = np.array([-length/2, -length/2+thickness, length/2-thickness, length/2])
    charge = magnetization*np.pi*(width/2)**2 * np.array([-1, 1, -1, 1])
    coeff = 1e-7 * np.outer(charge, charge)

    def evaluate(theta):
        co, si = np.cos(theta)[:, None], np.sin(theta)[:, None]
        positions = centers[:, None] + (axes*co + Z*si)[:, None]*s[:, None]
        tangent = (-axes*si + Z*co)[:, None]*s[:, None]
        diff = positions[i, :, None] - positions[j, None, :]
        radius = np.linalg.norm(diff, axis=-1)
        force = diff * (coeff / radius**3)[..., None]
        grad = np.zeros(len(theta))
        np.add.at(grad, i, -np.sum(force*tangent[i, :, None], axis=(1, 2, 3)))
        np.add.at(grad, j, np.sum(force*tangent[j, None, :], axis=(1, 2, 3)))
        return np.sum(coeff / radius), grad
    return evaluate


def relax(fn, start):
    # Work in mJ to make optimizer stopping tolerances suitable for these torques.
    def scaled(x):
        value, gradient = fn(x)
        return 1000*value, 1000*gradient
    result = minimize(scaled, start, jac=True, method="BFGS", options={"gtol": 2e-8})
    x = result.x
    h = 1e-5*np.eye(len(x))
    hessian = np.array([(fn(x+a)[1]-fn(x-a)[1])/(2e-5) for a in h])
    assert np.max(np.abs(fn(x)[1])) < 1e-9
    return x, result.fun, np.linalg.eigvalsh(hessian)[0]


def triads():
    rows = []
    releases = []
    fig, ax = plt.subplots(figsize=(7, 4), layout="constrained")
    for gap in (.008, delta, .015, .025):
        fn = potential((L/2+gap)*radial, -radial)
        x, value, curvature = relax(fn, np.deg2rad([4., -7., 179.]))
        for preparation in ([85., 90., 95.], [5., 0., 0.]):
            torque = -fn(np.deg2rad(preparation))[1]
            releases.append([1000*gap, *preparation, *(1e6*torque)])
        theta = np.deg2rad([85., 90., 95.])
        u, du = fn(theta)
        eps = np.eye(3)*1e-6
        numerical = [(fn(theta+a)[0]-fn(theta-a)[0])/2e-6 for a in eps]
        np.testing.assert_allclose(du, numerical, atol=1e-10)
        np.testing.assert_allclose(fn(theta+np.pi)[0], u, atol=1e-14)
        if gap == delta:
            np.testing.assert_allclose(u, energy(theta), atol=1e-14)
        rows.append([gap*1000, *np.rad2deg(x), value, curvature, *(-du*1e6)])
        angles = np.linspace(-18, 18, 161)
        ax.plot(angles, [1000*fn(np.deg2rad([a,-a,180]))[0] for a in angles],
                label=f"{1000*gap:g} mm")
    ax.set(xlabel="Cant angle (deg)", ylabel="Energy (mJ)", title="Ideal four-pole triad   |   angles (+a, -a, 180°)")
    ax.legend(title="Tip to vertex")
    fig.savefig(OUT/"triad.png", dpi=170)
    write_table("release.csv", "delta_mm a_deg b_deg c_deg torque_A_uNm torque_B_uNm torque_C_uNm", releases)
    write_table("triads.csv", "delta_mm a_deg b_deg c_deg U_mJ min_curvature_J_rad2 release_A_uNm release_B_uNm release_C_uNm", rows)


def patch():
    # Three hexagons around one common vertex. Deduplicate their shared edges.
    side = L+2*delta
    angle = np.arange(6)*np.pi/3
    corners = np.c_[np.cos(angle), np.sin(angle)]*side
    points, edges = [], set()
    for center in corners[::2]:
        ids = []
        for xy in center+corners:
            key = tuple(np.round(xy, 9))
            if key not in points:
                points.append(key)
            ids.append(points.index(key))
        edges.update(tuple(sorted(pair)) for pair in zip(ids, ids[1:]+ids[:1]))
    xy = np.array(points)
    start, end = np.array(sorted(edges)).T
    incidence = np.eye(len(xy))[end].T-np.eye(len(xy))[start].T
    degree = np.sum(abs(incidence), axis=1).astype(int)
    assert len(start) == 15 and np.all(incidence.sum(axis=0) == 0)
    centers = np.c_[(xy[end]+xy[start])/2, np.full(len(start), .06)]
    axes = np.c_[(xy[end]-xy[start])/side, np.zeros(len(start))]
    np.testing.assert_allclose(np.linalg.norm(axes, axis=1), 1.)
    write_table("vertices.csv","id x_m y_m degree",([k,*p,degree[k]] for k,p in enumerate(xy)))
    write_table("rotors.csv","id from to x_m y_m z_m ex ey ez",([k,start[k],end[k],*p,*axes[k]] for k,p in enumerate(centers)))
    fn = potential(centers, axes)
    rows = []
    for seed in [1,2,3,4,5]:
        initial = np.pi/2+np.random.default_rng(seed).normal(0,np.deg2rad(3),len(start))
        x,value,curv = relax(fn,initial)
        assert curv > 0
        spins = np.sign(np.cos(x))
        interior = degree == 3
        charge = incidence@spins
        resolved = abs(incidence)@(abs(np.cos(x)) < .5) == 0
        ice = np.count_nonzero(interior & resolved & (abs(charge)==1))
        rows.append([seed,value,curv,interior.sum(),ice,(interior & ~resolved).sum(),*np.rad2deg(x)])
    write_table("patch_minima.csv","seed U_mJ min_curvature_J_rad2 n3 ice unknown "+" ".join(f"theta{k}_deg" for k in range(15)),rows)
    fig, ax = plt.subplots(figsize=(6,5),layout="constrained")
    for k,(a,b) in enumerate(zip(start,end)):
        ax.plot(*xy[[a,b]].T*1000,color="0.75")
        p=centers[k,:2]*1000
        tips=p+np.array([[-50],[50]])*axes[k,:2]
        ax.plot(*tips.T,color="#176d79",lw=4)
        ax.annotate(str(k),p,xytext=(4,4),textcoords="offset points")
    ax.scatter(*xy[degree==3].T*1000,color="#de8138",label="3-fold vertex")
    ax.legend(); ax.set(aspect="equal",xlabel="x (mm)",ylabel="y (mm)",title="15 rotors   |   design dimensions")
    fig.savefig(OUT/"patch.png",dpi=160)


def drawings():
    fig, (side,plan) = plt.subplots(1,2,figsize=(11,5),layout="constrained")
    side.add_patch(Circle((0,60),51.2,fill=False,ls="--",color="0.6"))
    side.add_patch(Rectangle((-45,58.5),90,3,color="#996633"))
    for sign in [-1,1]:
        side.add_patch(Rectangle((45 if sign==1 else -50,57.5),5,5,color="#286b7f"))
        side.add_patch(Rectangle((39 if sign==1 else -51,56),12,8,fill=False))
    side.add_patch(Rectangle((-5,55),10,10,fill=False))
    side.plot(0,60,"ko"); side.axhline(0); side.axhline(120)
    side.text(-56,112,"lid underside 120"); side.text(-56,4,"base 0")
    side.set(xlim=(-60,60),ylim=(-5,126),title="One rotor   |   side, pivot at z = 60")
    for direction in radial[:,:2]:
        center=60*direction
        rod=center+np.array([[-51],[51]])*direction
        axis=np.array([-direction[1],direction[0]])
        pin=center+np.array([[-11],[11]])*axis
        plan.plot(*rod.T,lw=4,color="#996633")
        plan.plot(*pin.T,lw=3,color="#286b7f")
        for radius in (58,60,65,75):
            plan.plot(*(radius*direction),marker="+",color="black",ms=5)
    plan.set(xlim=(-135,135),ylim=(-135,135),title="Three rotors   |   270 × 270 board, top")
    for ax in (side,plan):
        ax.set_aspect("equal"); ax.set_xlabel("x (mm)"); ax.grid(alpha=.18)
    side.set_ylabel("z (mm)"); plan.set_ylabel("y (mm)")
    fig.savefig(OUT/"assembly.png",dpi=160)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    triads()
    patch()
    drawings()
