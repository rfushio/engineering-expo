"""Geometry sensitivity and equal-area quadrature of uniformly charged end faces."""
import itertools
import numpy as np
from scipy.optimize import minimize_scalar
from prototype import L, t, delta, diameter, radial, Z, potential, relax, write_table, magnetization


def faces(theta, nr, naz):
    phi = 2*np.pi*(np.arange(naz)+.5)/naz
    rho = diameter/2*np.sqrt((np.arange(nr)+.5)/nr)
    x = np.outer(rho,np.cos(phi)).ravel()
    y = np.outer(rho,np.sin(phi)).ravel()
    n = -radial*np.cos(theta)[:,None] + Z*np.sin(theta)[:,None]
    a = np.cross(-radial,Z)
    b = np.cross(n,a)
    shifts = a[:,None,:]*x[:,None]+b[:,None,:]*y[:,None]
    offsets = np.array([-L/2,-L/2+t,L/2-t,L/2])
    p = ((L/2+delta)*radial[:,None,None,:]+n[:,None,None,:]*offsets[:,None,None]
         +shifts[:,None,:,:]).reshape(3,-1,3)
    q = magnetization*np.pi*(diameter/2)**2
    charges = np.repeat([-q,q,-q,q],len(x))/len(x)
    total = 0.
    for i,j in itertools.combinations(range(3),2):
        r = np.linalg.norm(p[i,:,None,:]-p[j,None,:,:],axis=-1)
        total += 1e-7*np.sum(np.outer(charges,charges)/r)
    return total


if __name__ == "__main__":
    rows = []
    for length,thick,width in [(L,t,diameter),(.08,t,diameter),(.12,t,diameter),
                               (L,.003,diameter),(L,.007,diameter),(L,t,.004),(L,t,.006)]:
        fn = potential((length/2+delta)*radial,-radial,length,thick,width)
        x,u,curv = relax(fn,np.deg2rad([5.,-4.,180.]))
        rows.append([1000*length,1000*thick,1000*width,np.rad2deg(x[0]),u,curv])
    write_table("dimensions.csv","L_mm t_mm d_mm cant_deg U_mJ min_curvature_J_rad2",rows)
    rows = []
    for nr,naz in [(2,8),(3,12),(4,16)]:
        def cut(a):
            return faces(np.array([a,-a,np.pi]),nr,naz)
        optimum = minimize_scalar(cut,bounds=(0,.25),method="bounded")
        gap = faces(np.zeros(3),nr,naz)-cut(0.)
        rows.append([nr,naz,np.rad2deg(optimum.x),1000*optimum.fun,1000*gap])
    write_table("faces.csv","radial_cells azimuth_cells cant_deg U_mJ planar_gap_mJ",rows)
