"""Independent check of the archived four-pole example (2026-11-19).

SI units. This verifies an idealized three-rotor energy calculation;
it does not validate purchased magnets or the 168-rotor apparatus.
"""
import itertools
import numpy as np
from scipy.optimize import minimize_scalar

L, t, delta, diameter = 0.100, 0.005, 0.010, 0.005
magnetization = 1.0e6
q = magnetization * np.pi * (diameter / 2) ** 2
phi = 2 * np.pi * np.arange(3) / 3
radial = np.column_stack((np.cos(phi), np.sin(phi), np.zeros(3)))
centers = (L / 2 + delta) * radial
e = -radial  # theta = 0 means magnetic moment points toward the vertex.
z = np.array([0., 0., 1.])
h = (L - t) / 2
offsets = np.array([a*h + b*t/2 for a,b in itertools.product((-1,1), repeat=2)])
charges = np.array([b*q for a,b in itertools.product((-1,1), repeat=2)])

def energy(theta):
    theta = np.asarray(theta)
    n = e*np.cos(theta)[:,None] + z*np.sin(theta)[:,None]
    positions = centers[:,None,:] + offsets[None,:,None]*n[:,None,:]
    value = 0.
    for i,j in itertools.combinations(range(3), 2):
        distances = np.linalg.norm(positions[i,:,None,:] - positions[j,None,:,:], axis=-1)
        value += 1.e-7*np.sum(charges[:,None]*charges[None,:]/distances)
    return value

def hessian(theta, step):
    basis = np.eye(3)*step
    return np.array([[(energy(theta+a+b)-energy(theta+a-b)-energy(theta-a+b)+energy(theta-a-b))/(4*step**2)
                      for b in basis] for a in basis])

if __name__ == '__main__':
    all_in = energy([0., 0., 0.])
    two_in = energy([0., 0., np.pi])
    minimum = minimize_scalar(lambda x: energy([x, -x, np.pi]), bounds=(0., np.deg2rad(15)), method='bounded', options={'xatol':1.e-12})
    theta = np.array([minimum.x, -minimum.x, np.pi])
    print('q [A m]:', q)
    print('mu_rotor [A m^2]:', 2*q*t)
    print('all-in energy [mJ]:', all_in*1000)
    print('two-in one-out planar energy [mJ]:', two_in*1000)
    print('gap [mJ]:', (all_in-two_in)*1000)
    print('canted angles [deg]:', np.rad2deg(theta))
    print('canted energy [mJ]:', energy(theta)*1000)
    for step in (1.e-3, 1.e-4):
        gradient = np.array([(energy(theta+a)-energy(theta-a))/(2*step) for a in np.eye(3)*step])
        print('finite-difference step:', step)
        print('gradient [J/rad]:', gradient)
        print('Hessian eigenvalues [J/rad^2]:', np.linalg.eigvalsh(hessian(theta,step)))
