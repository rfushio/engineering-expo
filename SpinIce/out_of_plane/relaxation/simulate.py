"""Release 100 coupled, out-of-plane rotors on an open honeycomb patch."""
import argparse
from contextlib import nullcontext
import ctypes
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

import numpy as np
from scipy.integrate import solve_ivp

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "physics"))
from prototype import potential
from reproduce_three_rotor import L, delta, diameter, magnetization, t


def honeycomb(side):
    # Integer coordinates in units (sqrt(3)*side/2, side/2) share vertices exactly.
    corners = [(0, 2), (1, 1), (1, -1), (0, -2), (-1, -1), (-1, 1)]
    edges = set()
    for row, count in enumerate([5, 6, 5, 6, 5]):
        for col in range(count):
            x, y = 2*col - (count-1), 3*(row-2)
            ring = [(x+dx, y+dy) for dx, dy in corners]
            for a, b in zip(ring, ring[1:] + ring[:1]):
                edges.add(tuple(sorted((a, b))))
    points = sorted({p for edge in edges for p in edge})
    index = {p: i for i, p in enumerate(points)}
    xy = np.array(points) * np.array([np.sqrt(3), 1]) * side/2
    ends = np.array([(index[a], index[b]) for a, b in sorted(edges)])
    a, b = ends.T
    axes = np.column_stack(((xy[b]-xy[a])/side, np.zeros(len(a))))
    centers = np.column_stack(((xy[a]+xy[b])/2, np.full(len(a), .060)))
    assert len(ends) == 100 and np.count_nonzero(np.bincount(ends.ravel()) == 3) == 52
    np.testing.assert_allclose(np.linalg.norm(axes, axis=1), 1.)
    return xy, ends, centers, axes


def vertex_states(theta, edges, vertex_count, threshold):
    """Rows are times, columns are vertices. 0 = undetermined, ±1/±3 = charge."""
    a, b = edges.T
    incidence = np.zeros((vertex_count, len(edges)), dtype=np.int8)
    incidence[a, np.arange(len(edges))] = -1
    incidence[b, np.arange(len(edges))] = 1
    adjacent = np.abs(incidence)
    project = np.cos(theta)
    charge = np.sign(project).astype(np.int8) @ incidence.T
    usable = (np.abs(project) < threshold).astype(np.int8) @ adjacent.T == 0
    degree = adjacent.sum(axis=1)
    return np.where(usable & (degree == 3), charge, 0), degree


def compiled_potential(directory, centers, axes):
    path = Path(directory) / "poles.so"
    subprocess.run(["cc", "-std=c99", "-O3", "-ffp-contract=off", "-fno-math-errno",
                    "-shared", "-fPIC", str(HERE / "poles.c"), "-o", str(path)], check=True)
    poles = ctypes.CDLL(str(path)).poles
    array = np.ctypeslib.ndpointer(dtype=np.float64, flags="C_CONTIGUOUS")
    poles.argtypes = [ctypes.c_int, array, array, array, array, ctypes.c_double, array]
    poles.restype = ctypes.c_double
    centers, axes = np.ascontiguousarray(centers), np.ascontiguousarray(axes)
    offsets = np.array([-L/2, -L/2+t, L/2-t, L/2])
    strength = 1e-7 * (magnetization*np.pi*(diameter/2)**2)**2

    def evaluate(theta):
        gradient = np.empty(len(centers))
        energy = poles(len(centers), np.ascontiguousarray(theta), centers, axes, offsets,
                       strength, gradient)
        return energy, gradient
    return evaluate


def integrate(evaluate, theta, omega, times, inertia, gamma, rtol):
    """Evolve free rotors, returning angles, angular velocities and viscous heat in SI."""
    n = len(theta)

    def derivative(_, state):
        _, grad = evaluate(state[:n])
        velocity = state[n:2*n]
        # Integrating heat in mJ keeps its error scale comparable to the angular variables.
        return np.r_[velocity, -grad/inertia-gamma*velocity, 1e3*inertia*gamma*(velocity @ velocity)]

    solution = solve_ivp(derivative, (times[0], times[-1]), np.r_[theta, omega, 0.],
                         t_eval=times, method="DOP853", rtol=rtol, atol=rtol*.01)
    if not solution.success:
        raise RuntimeError(solution.message)
    return solution.y[:n].T, solution.y[n:2*n].T, solution.y[-1]*.001


def simulate(seconds, rtol, output, *, inertia=5e-6, gamma=1.6, seed=7, compiled_dir=None):
    fps = 30
    tilt_sd, threshold = 3., .5
    xy, edges, centers, axes = honeycomb(L + 2*delta)
    evaluate = potential(centers, axes)
    rng = np.random.default_rng(seed)
    theta = np.pi/2 + np.deg2rad(tilt_sd)*rng.standard_normal(len(edges))
    if compiled_dir is not None:
        reference = evaluate
        evaluate = compiled_potential(compiled_dir, centers, axes)
        for angles in (theta, theta/2):
            u, g = reference(angles)
            v, h = evaluate(angles)
            np.testing.assert_allclose(u, v, rtol=1e-11, atol=1e-15)
            np.testing.assert_allclose(g, h, rtol=1e-10, atol=2e-16)
    times = np.arange(fps*seconds + 1)/fps
    angles, speeds, loss_j = integrate(evaluate, theta, np.zeros_like(theta), times, inertia, gamma, rtol)
    potential_j = np.array([evaluate(a)[0] for a in angles])
    kinetic_j = .5*inertia*np.sum(speeds**2, axis=1)

    charge, degree = vertex_states(angles, edges, len(xy), threshold)
    residual = np.max(np.abs(potential_j + kinetic_j + loss_j - potential_j[0]))
    energy_scale = loss_j[-1] if gamma > 0 else max(abs(potential_j[0]), kinetic_j.max())
    if not np.all(np.isfinite(angles)) or energy_scale <= 0 or residual/energy_scale > 1e-7:
        raise RuntimeError(f"Energy balance failed: residual={residual:g} J, dissipated={loss_j[-1]:g} J")
    output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(output, time_s=times, theta_rad=angles, omega_rad_s=speeds,
                        vertices_m=xy, edges=edges, centers_m=centers, axes=axes,
                        charge=charge, degree=degree, potential_j=potential_j,
                        kinetic_j=kinetic_j, dissipated_j=loss_j, length_m=L, gap_m=delta,
                        magnet_length_m=t, magnet_diameter_m=diameter, magnetization_A_m=magnetization,
                        inertia_kg_m2=inertia, gamma_s_inv=gamma, initial_tilt_sd_deg=tilt_sd,
                        projection_threshold=threshold, seed=seed, rtol=rtol, atol=rtol*.01,
                        pole_sum="compiled" if compiled_dir is not None else "numpy")
    interior = np.abs(charge[-1, degree == 3])
    print(f"{len(edges)} rotors, {len(interior)} threefold vertices; "
          f"final ice={sum(interior == 1)}, defect={sum(interior == 3)}, unresolved={sum(interior == 0)}")
    print(f"Relative energy-balance residual: {residual/energy_scale:.3g}; "
          f"final max angular speed: {np.max(np.abs(speeds[-1])):.4g} rad/s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=int, default=40)
    parser.add_argument("--rtol", type=float, default=2e-13, help="relative tolerance for DOP853")
    parser.add_argument("--gamma", type=float, default=1.6, help="viscous damping rate in inverse model seconds")
    parser.add_argument("--inertia", type=float, default=5e-6, help="common rotor inertia in kg m^2")
    parser.add_argument("--seed", type=int, default=7, help="initial tilt seed")
    parser.add_argument("--compiled", action="store_true", help="use a C compiler to accelerate the same pole sum")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if (args.seconds < 1 or not 0 < args.rtol < 1 or not np.isfinite(args.gamma)
            or args.gamma < 0 or not np.isfinite(args.inertia) or args.inertia <= 0 or args.seed < 0):
        parser.error("seconds and inertia must be positive, damping and seed non-negative, and 0 < rtol < 1")
    name = "trajectory.npz"
    if (args.gamma, args.inertia, args.seed) != (1.6, 5e-6, 7) or args.compiled:
        name = f"trajectory-gamma-{args.gamma:g}-I-{args.inertia:g}-seed-{args.seed}.npz"
    with TemporaryDirectory() if args.compiled else nullcontext() as directory:
        simulate(args.seconds, args.rtol, args.output or HERE / name, gamma=args.gamma,
                 inertia=args.inertia, seed=args.seed, compiled_dir=directory)
