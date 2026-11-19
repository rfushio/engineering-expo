"""Tap one rotor on two charge-identical honeycomb ice backgrounds."""
import argparse
from collections import deque
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "defect_propagation"))
from defect_dynamics import check_minimum, compiled_potential, integrate, vertex_states

# An oriented hexagon in the zero-field ice snapshot, in traversal order.
LOOP = np.array([34, 42, 50, 44, 35, 33])
SOURCE, RECEIVER = 43, 40
KICK = .5  # rad/s, with sign chosen to lift the north end
TIMES = np.arange(481) / 240  # model seconds
RTOL = 2e-11


def distances_from(edges, source):
    """One step connects two rods sharing a vertex."""
    touching = [[] for _ in range(int(edges.max()) + 1)]
    for i, (a, b) in enumerate(edges):
        touching[a].append(i)
        touching[b].append(i)
    distance = np.full(len(edges), -1)
    distance[source] = 0
    queue = deque([source])
    while queue:
        i = queue.popleft()
        for vertex in edges[i]:
            for j in touching[vertex]:
                if distance[j] == -1:
                    distance[j] = distance[i] + 1
                    queue.append(j)
    if np.any(distance < 0):
        raise ValueError("The patch must be connected.")
    return distance


def linear_response(evaluate, reference, initial_speed, inertia, gamma):
    """Normal modes of the same four-pole energy, driven by the same initial velocity."""
    step = 1e-5
    hessian = np.column_stack([(evaluate(reference+d)[1] - evaluate(reference-d)[1]) / (2*step)
                               for d in step*np.eye(len(reference))])
    np.testing.assert_allclose(hessian, hessian.T, rtol=1e-7, atol=2e-11)
    stiffness, modes = np.linalg.eigh((hessian+hessian.T)/2)
    damped_squared = stiffness/inertia - (gamma/2)**2
    if damped_squared.min() <= 0:
        raise ValueError("Expected a stable, underdamped reference configuration.")
    freq = np.sqrt(damped_squared)
    time = TIMES[:, None]
    speed_modes = np.einsum("ik,i->k", modes, initial_speed)
    amplitudes = np.exp(-gamma*time/2) * np.sin(freq*time) / freq * speed_modes
    return np.einsum("tk,ik->ti", amplitudes, modes), freq/(2*np.pi)


def run(reference_file, output):
    with np.load(reference_file) as previous:
        xy, edges, centers, axes = (previous[k] for k in ("vertices_m", "edges", "centers_m", "axes"))
        inertia, gamma, length, threshold = (float(previous[k]) for k in
            ("inertia_kg_m2", "gamma_s_inv", "length_m", "projection_threshold"))
        zero = np.flatnonzero(np.all(previous["field_T"] == 0, axis=1)).item()
        original = previous["reference_theta_rad"][zero]
        initial_charge = previous["reference_charge"][zero]
    distances = distances_from(edges, SOURCE)
    # The receiver lies across the hexagon on the line through the source and its centre.
    np.testing.assert_allclose(centers[RECEIVER], 2*centers[LOOP].mean(axis=0)-centers[SOURCE], atol=1e-12)
    radius = np.linalg.norm(centers[:,:2], axis=1)
    assert SOURCE == np.flatnonzero(np.isclose(radius, radius.min()))[0]
    cases = []
    with TemporaryDirectory() as tmp:
        magnetic = compiled_potential(tmp, centers, axes)
        prepared = original.copy()
        prepared[LOOP] += np.pi
        reversed_loop, _ = check_minimum(magnetic, prepared)
        changed = np.flatnonzero(np.sign(np.cos(original)) != np.sign(np.cos(reversed_loop)))
        np.testing.assert_array_equal(changed, np.sort(LOOP))

        for name, reference in [("A", original), ("B", reversed_loop)]:
            ref_energy, grad = magnetic(reference)
            assert np.max(abs(grad)) < 1e-12
            at_rest = np.zeros_like(reference)
            control, _, _ = integrate(magnetic, reference, at_rest, TIMES[::12], inertia, gamma, RTOL)
            drift = np.max(abs(control-reference))
            assert drift < 1e-8
            initial_speed = at_rest.copy()
            initial_speed[SOURCE] = np.sign(np.cos(reference[SOURCE])) * KICK
            injected = .5 * inertia * KICK**2
            linear, frequencies = linear_response(magnetic, reference, initial_speed, inertia, gamma)
            theta, omega, heat = integrate(magnetic, reference, initial_speed, TIMES, inertia, gamma, RTOL)
            charge, degree = vertex_states(theta, edges, len(xy), threshold)
            np.testing.assert_array_equal(charge, np.broadcast_to(initial_charge, charge.shape))
            assert np.all(abs(initial_charge[degree == 3]) == 1)
            assert np.all(np.sign(np.cos(theta)) == np.sign(np.cos(reference)))
            delta = theta-reference
            model_difference = np.linalg.norm(delta-linear) / np.linalg.norm(delta)
            assert np.isfinite(model_difference)
            kinetic = .5 * inertia * omega**2
            potential = np.array([magnetic(t)[0] for t in theta])
            balance_error = np.max(abs(potential-ref_energy + kinetic.sum(axis=1) + heat - injected)) / injected
            assert balance_error < 1e-7
            cases.append((reference, theta, omega, charge, potential, heat, frequencies))

            dz = (length*500) * (np.sin(theta)-np.sin(reference))  # north-end height change in mm
            half_second = TIMES <= .5
            peak_far = kinetic[:, distances >= 3].sum(axis=1).argmax()
            print(f"{name}: source {SOURCE}, receiver {RECEIVER}, initial {injected*1e6:.3f} uJ, "
                  f"{sum(degree==3)} ice vertices; rest drift {drift:.2e} rad; energy error {balance_error:.2e}")
            print(f"  Max tilt {np.rad2deg(abs(delta).max()):.4f} deg; damped modes "
                  f"{frequencies.min():.4f}..{frequencies.max():.4f} Hz; linear/full relative L2 {model_difference:.4%}")
            print(f"  Receiver peak (0..0.5 s) {abs(dz[half_second, RECEIVER]).max():.4f} mm; "
                  f"peak kinetic beyond 3 steps (incl.) {kinetic[peak_far, distances>=3].sum()/injected:.2%} "
                  f"of input at {TIMES[peak_far]:.4f} s")
            for shell in (1, 2, 3, 4, 5, 6):
                above = np.flatnonzero(abs(dz[:, distances==shell]).max(axis=1) >= .05)
                if len(above):
                    print(f"  First |dz| >= 0.05 mm at distance {shell}: {TIMES[above[0]]:.4f} s")

    keys = ("reference_theta_rad", "theta_rad", "omega_rad_s", "charge", "potential_J",
            "viscous_heat_J", "mode_frequency_Hz")
    arrays = {key: np.stack(vals) for key, vals in zip(keys, zip(*cases))}
    output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(output, **arrays, time_s=TIMES, vertices_m=xy, edges=edges, centers_m=centers,
                        axes=axes, degree=degree, source=SOURCE, receiver=RECEIVER, loop=LOOP,
                        distance_steps=distances, length_m=length, inertia_kg_m2=inertia, gamma_s_inv=gamma,
                        projection_threshold=threshold, initial_speed_magnitude_rad_s=KICK, rtol=RTOL)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, default=HERE.parent/"defect_propagation"/"trajectories.npz")
    parser.add_argument("--output", type=Path, default=HERE/"response.npz")
    args = parser.parse_args()
    run(args.reference, args.output)
