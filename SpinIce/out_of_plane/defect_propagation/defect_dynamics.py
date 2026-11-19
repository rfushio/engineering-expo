"""Seed one defect pair in the 100-rotor ice state, then release every rotor."""
import argparse
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import numpy as np
from scipy.optimize import minimize

HERE = Path(__file__).resolve().parent
RELAX = HERE.parent / "relaxation"
sys.path.insert(0, str(RELAX))
from simulate import compiled_potential, integrate, vertex_states
from reproduce_three_rotor import q as pole_strength, t as magnet_length

SEED_EDGE = 35
SOURCE, DESTINATION = 24, 18
FIELD_ANGLE = -30.
SAMPLE_RATE = 240


def in_plane_field(magnetic, axes, field):
    # Two identical end magnets per rotor. In a uniform in-plane field,
    # the Zeeman contribution is -mu*(B dot edge_axis)*cos(theta).
    coupling = (2*pole_strength*magnet_length) * (axes @ field)

    def evaluate(theta):
        energy, grad = magnetic(theta)
        return energy - coupling @ np.cos(theta), grad + coupling*np.sin(theta)
    return evaluate


def minimize_local(evaluate, initial):
    def scaled(theta):
        energy, grad = evaluate(theta)
        return energy*1e6, grad*1e6
    return minimize(scaled, initial, jac=True, method="BFGS",
                    options={"gtol": 1e-7, "maxiter": 1000}).x


def check_minimum(evaluate, initial):
    def hessian(theta):
        h = 1e-5
        columns = [(evaluate(theta+d)[1]-evaluate(theta-d)[1])/(2*h)
                   for d in h*np.eye(len(theta))]
        matrix = np.column_stack(columns)
        return (matrix+matrix.T)/2

    theta = minimize_local(evaluate, initial)
    theta -= np.linalg.solve(hessian(theta), evaluate(theta)[1])
    curvature = float(np.linalg.eigvalsh(hessian(theta))[0])
    energy, grad = evaluate(theta)
    torque = float(np.max(np.abs(grad)))
    if curvature <= 0 or torque > 1e-12:
        raise RuntimeError("The starting configuration is not a verified local minimum.")
    return theta, {"energy_J": float(energy), "max_torque_Nm": torque,
                   "min_curvature_J_rad2": curvature}


def charge_transfers(theta, times, edges, degree, reference_charge, threshold):
    """Bracket a hop by two fully legible measurements of its five local rods."""
    projection = np.cos(theta)
    signs = np.sign(projection).astype(np.int8)
    resolved = np.abs(projection) >= threshold
    charge, _ = vertex_states(theta, edges, len(degree), threshold)
    events = []
    for k, (a, b) in enumerate(edges):
        if degree[a] != 3 or degree[b] != 3 or np.all(signs[:,k] == signs[0,k]):
            continue
        local = np.flatnonzero(np.any((edges == a) | (edges == b), axis=1))
        others = local[local != k]
        readable = np.flatnonzero(resolved[:,local].all(axis=1))
        for j in np.flatnonzero(np.diff(signs[readable,k])):
            left, right = readable[j:j+2]
            window = signs[left:right+1]
            # During the intervening upright passage only the shared edge may reverse.
            if np.any(window[:,others] != window[0,others]) or np.count_nonzero(np.diff(window[:,k])) != 1:
                continue
            for source, target in [(a,b), (b,a)]:
                before = charge[left,[source,target]].astype(int)
                after = charge[right,[source,target]].astype(int)
                ref = reference_charge[[source,target]].astype(int)
                high, low = before
                hop = abs(high) == 3 and low == high//3 and np.array_equal(after, [low, high])
                excess = before-ref
                moved = abs(excess[0]) == 2 and excess[1] == 0 and np.array_equal(after-ref, excess[::-1])
                if hop or moved:
                    events.append(dict(edge=k, source=int(source), target=int(target),
                                       last_before_s=float(times[left]), first_after_s=float(times[right]),
                                       Q_before=before.tolist(), Q_after=after.tolist(),
                                       ice_defect=bool(hop), excess_charge=bool(moved)))
    return sorted(events, key=lambda x: x["first_after_s"])


def experiment(movie, output, seconds=4, rtol=2e-11):
    with np.load(movie) as d:
        centers, axes, xy, edges = (d[k] for k in ("centers_m","axes","vertices_m","edges"))
        inertia, gamma, threshold, length = (float(d[k]) for k in
            ("inertia_kg_m2","gamma_s_inv","projection_threshold","length_m"))
        last, velocity = d["theta_rad"][-1], d["omega_rad_s"][-1]
        movie_charge = d["charge"][-1]

    times = np.arange(seconds*SAMPLE_RATE+1)/SAMPLE_RATE
    azimuth = np.deg2rad(FIELD_ANGLE)
    direction = np.array([np.cos(azimuth), np.sin(azimuth), 0.])
    edge_id = np.flatnonzero(np.all(edges == sorted((SOURCE, DESTINATION)), axis=1)).item()
    cases, notes = [], []
    with TemporaryDirectory() as directory:
        magnetic = compiled_potential(directory, centers, axes)
        # Retain the basin actually reached by the film. The 40 s frame still has kinetic energy.
        late, _, _ = integrate(magnetic, last, velocity, [0.,30.], inertia, gamma, 2e-10)
        zero, zero_info = check_minimum(magnetic, late[-1])
        tilted = zero.copy()
        for tenth_mT in range(1,14):
            field = direction*(tenth_mT*1e-4)
            with_field = in_plane_field(magnetic, axes, field)
            tilted = minimize_local(with_field, tilted)
        tilted, field_info = check_minimum(with_field, tilted)

        for reference, field_vector, evaluate, stats in [
                (zero, np.zeros(3), magnetic, zero_info), (tilted, field, with_field, field_info)]:
            q0, degree = vertex_states(reference[None], edges, len(xy), threshold)
            q0 = q0[0]
            np.testing.assert_array_equal(q0, movie_charge)
            assert np.all(np.abs(q0[degree == 3]) == 1)
            at_rest = np.zeros(len(edges))
            control, _, _ = integrate(evaluate, reference, at_rest, times[::12], inertia, gamma, rtol)
            control_drift = float(np.max(np.abs(control-reference)))
            if control_drift > 1e-5:
                raise RuntimeError("Unseeded control moved.")
            prepared = reference.copy()
            prepared[SEED_EDGE] += np.pi
            angles, speeds, heat = integrate(evaluate, prepared, at_rest, times, inertia, gamma, rtol)
            charge, _ = vertex_states(angles, edges, len(xy), threshold)
            assert charge[0,SOURCE] == -3 and charge[0,30] == 3 and np.count_nonzero(abs(charge[0])==3) == 2
            potential = np.array([evaluate(a)[0] for a in angles])
            kinetic = inertia*np.sum(speeds**2, axis=1)/2
            budget = potential+kinetic+heat
            injected = float(potential[0] - stats["energy_J"])
            balance_error = float(np.max(np.abs(budget-budget[0]))/injected)
            if injected <= 0 or not np.isfinite(balance_error) or balance_error > 1e-7:
                raise RuntimeError("Energy accounting failed.")
            events = charge_transfers(angles, times, edges, degree, q0, threshold)
            cases.append((reference, q0, field_vector, angles, speeds, charge, potential, kinetic, heat))
            notes.append(dict(field_mT=float(np.linalg.norm(field_vector)*1e3),
                              background=stats, control_max_angle_change_rad=control_drift,
                              manual_preparation_energy_mJ=injected*1e3, relative_energy_error=balance_error,
                              events=events))

    output.mkdir(parents=True, exist_ok=True)
    keys = ("reference_theta_rad","reference_charge","field_T","theta_rad","omega_rad_s",
            "charge","potential_J","kinetic_J","viscous_heat_J")
    arrays = {key: np.stack(values) for key, values in zip(keys, zip(*cases))}
    np.savez_compressed(output/"trajectories.npz", **arrays, time_s=times, vertices_m=xy, edges=edges,
                        centers_m=centers, axes=axes, degree=degree, length_m=length,
                        seed_edge=SEED_EDGE, shared_edge=edge_id, source=SOURCE, target=DESTINATION,
                        inertia_kg_m2=inertia, gamma_s_inv=gamma, projection_threshold=threshold,
                        field_azimuth_deg=FIELD_ANGLE, rtol=rtol)
    (output/"events.json").write_text(json.dumps(notes, indent=2)+"\n", encoding="utf-8")
    for note in notes:
        print(note["field_mT"], "mT:", [e for e in note["events"] if e["ice_defect"]])


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, default=RELAX / "weak-damping/trajectory.npz")
    p.add_argument("--output", type=Path, default=HERE)
    p.add_argument("--seconds", type=int, default=4)
    p.add_argument("--rtol", type=float, default=2e-11)
    args = p.parse_args()
    if args.seconds < 1 or not 0 < args.rtol < 1:
        p.error("seconds must be positive and 0 < rtol < 1")
    experiment(args.input, args.output, args.seconds, args.rtol)
