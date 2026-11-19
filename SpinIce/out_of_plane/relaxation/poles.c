/* The same 4 x 4 pole sum as physics/prototype.py, for long parameter scans. */
#include <math.h>
#include <string.h>

double poles(int n, const double *angle, const double *center, const double *axis,
             const double *offset, double strength, double *gradient) {
    double pos[4*n][3], tangent[4*n][3];
    memset(gradient, 0, n * sizeof *gradient);
    for (int i = 0; i < n; i++) {
        double co = cos(angle[i]), si = sin(angle[i]);
        double v[3] = {co*axis[3*i], co*axis[3*i+1], si};
        double dv[3] = {-si*axis[3*i], -si*axis[3*i+1], co};
        for (int k = 0; k < 4; k++) {
            for (int d = 0; d < 3; d++) {
                pos[4*i+k][d] = center[3*i+d] + offset[k]*v[d];
                tangent[4*i+k][d] = offset[k]*dv[d];
            }
        }
    }

    double total = 0.;
    for (int i = 0; i < n; i++) {
        for (int j = i+1; j < n; j++) {
            double gi = 0., gj = 0., energy = 0.;
            for (int k = 0; k < 4; k++) {
                for (int l = 0; l < 4; l++) {
                    const double *p = pos[4*i+k], *q = pos[4*j+l];
                    const double *v = tangent[4*i+k], *w = tangent[4*j+l];
                    double x = p[0]-q[0], y = p[1]-q[1], z = p[2]-q[2];
                    double r2 = x*x + y*y + z*z;
                    double u = ((k+l)%2 ? -strength : strength) / sqrt(r2);
                    double f = u/r2;
                    energy += u;
                    gi -= f * (x*v[0] + y*v[1] + z*v[2]);
                    gj += f * (x*w[0] + y*w[1] + z*w[2]);
                }
            }
            total += energy;
            gradient[i] += gi;
            gradient[j] += gj;
        }
    }
    return total;
}
