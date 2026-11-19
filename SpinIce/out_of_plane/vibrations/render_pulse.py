"""Render north-end displacements and the signal at a fixed receiver."""
import argparse
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "relaxation"))
from render import BG, HEIGHT, INK, MUTED, RULE, SCALE, WIDTH, ellipse, encode_movie, fit, label, line, point, polygon

CASE_COLORS = ("#087a72", "#85539a")
WARM, NEUTRAL, COOL = (194, 60, 31), (229, 231, 217), (40, 89, 163)


def square(draw, xy, r):
    x, y = xy
    draw.rectangle([point((x-r, y-r)), point((x+r, y+r))], outline=INK, width=2*SCALE)


class PulseScene:
    def __init__(self, data):
        self.time = data["time_s"]
        step = float(self.time[1]-self.time[0])
        self.fps = 30
        self.slowdown = 1/(step*self.fps)
        theta, ref = data["theta_rad"], data["reference_theta_rad"]
        self.dz = 500*float(data["length_m"]) * (np.sin(theta)-np.sin(ref[:, None, :]))
        self.source, self.receiver = int(data["source"]), int(data["receiver"])
        self.edges, self.loop = data["edges"], data["loop"]
        self.sign = np.sign(np.cos(ref))
        self.n_vertices = int(np.sum(data["degree"] == 3))
        self.changed_charge = np.count_nonzero(data["charge"] != data["charge"][0, 0], axis=2)
        centers = data["centers_m"]
        self.distance_cm = np.linalg.norm(centers[self.source]-centers[self.receiver])*100
        self.recv = self.dz[:, :, self.receiver]
        self.graph_limit = np.ceil(np.max(abs(self.recv))/.025)*.025
        peak = np.max(abs(self.dz))
        self.color_limit = next(limit for limit in (.1, .25, .5, 1., 2., 5.) if peak <= limit)

        # A shared asinh scale shows weak distal motion and strong source motion in one map.
        self.palette = []
        for u in np.linspace(-1, 1, 511):
            end = np.array(COOL if u < 0 else WARM)
            self.palette.append(tuple(np.rint((1-abs(u))*np.array(NEUTRAL) + abs(u)*end).astype(int)))
        self.colors = self.color_index(self.dz)

        xy = data["vertices_m"] * [1, -1]
        self.panels = []
        for x in (0, 781):
            scale, offset = fit(xy, (57+x, 205, 762+x, 587))
            vertices = scale*xy+offset
            start, finish = vertices[self.edges[:,0]], vertices[self.edges[:,1]]
            middle = (start+finish)/2
            vector = finish-start
            unit = vector / np.linalg.norm(vector, axis=1)[:,None]
            self.panels.append((vertices, middle, vector, unit))
        self.graph_x = 117 + 846*self.time/self.time[-1]
        self.graph_y = 752 - 68*self.recv/self.graph_limit
        self.base = self.background()

    def color_fraction(self, z):
        return np.arcsinh(35*np.asarray(z)/self.color_limit)/np.arcsinh(35.)

    def color_index(self, z):
        return np.rint(255*(1 + self.color_fraction(z))).clip(0, 510).astype(int)

    def background(self):
        img = Image.new("RGB", (WIDTH*SCALE, HEIGHT*SCALE), BG)
        d = ImageDraw.Draw(img)
        label(d, 47, 57, "磁荷を動かさずに、揺れを送る", 43, weight="bold")
        label(d, 49, 105, "中央付近の棒の N 極を一度だけ上向きに弾き、外場ゼロで100本を自由に動かす。", 21, MUTED)
        label(d, 1550, 45, f"モデル時間　／　1/{self.slowdown:g} 速", 18, MUTED, anchor="rm")
        line(d, [(48,136),(1552,136)], RULE, 1.3)
        line(d, [(800,155),(800,598)], RULE, 1.2)

        for case, title in enumerate(("緩和して得た氷則配置", "六角形の6本を反転してから再緩和")):
            x = 56+781*case
            label(d, x, 170, "AB"[case], 26, CASE_COLORS[case], "bold")
            label(d, x+39, 170, title, 25, weight="bold")
            vertices, middle, vector, _ = self.panels[case]
            loop_vertices = np.unique(self.edges[self.loop])
            ring = vertices[loop_vertices]
            rel = ring-ring.mean(axis=0)
            ring = ring[np.argsort(np.arctan2(rel[:,1], rel[:,0]))]
            polygon(d, ring, "#fae6b7")
            line(d, [*ring, ring[0]], "#c78e40", 2.5)
            # In screen coordinates a positive cross product circulates clockwise.
            radial = middle[self.loop]-ring.mean(axis=0)
            directed = self.sign[case,self.loop,None]*vector[self.loop]
            sense = np.sign(np.sum(radial[:,0]*directed[:,1]-radial[:,1]*directed[:,0]))
            angles = np.deg2rad(-95+sense*np.linspace(0,249,40))
            arc = ring.mean(axis=0)+13.5*np.column_stack((np.cos(angles),np.sin(angles)))
            line(d, arc, "#94692e", 1.9)
            tangent = sense*np.array([-np.sin(angles[-1]),np.cos(angles[-1])])
            broadside = np.array([-tangent[1],tangent[0]])*3.7
            polygon(d, [arc[-1]+3*tangent,arc[-1]-4*tangent+broadside,arc[-1]-4*tangent-broadside], "#94692e")
            for a, b in self.edges:
                line(d, vertices[[a,b]], "#c4cec5", 1.45)
            for vx, vy in vertices:
                ellipse(d, vx, vy, 2.4, 2.4, "#98aaa3")
            for m, v in zip(middle, vector):
                line(d, [m-.34*v,m+.34*v], "#97a69f", 10.5)

        line(d, [(48,610),(1552,610)], RULE, 1.3)
        line(d, [(997,628),(997,869)], RULE, 1.2)
        label(d, 49, 645, f"{self.distance_cm:.0f} cm 先の棒で測った N 極の高さ変化", 24, weight="bold")
        for j, (x, tag) in enumerate(((721,"配置 A"),(850,"配置 B"))):
            line(d, [(x,646),(x+26,646)], CASE_COLORS[j], 3)
            label(d, x+36, 645, tag, 16, CASE_COLORS[j])
        label(d, 52, 677, "mm", 14, MUTED, "number")
        for y, num in ((684,self.graph_limit),(752,0),(820,-self.graph_limit)):
            label(d, 103, y, f"{num:g}", 15, MUTED, "number", "rm")
            line(d, [(117,y),(963,y)], "#abbab1" if num == 0 else RULE, 1)
        for t in np.linspace(0, self.time[-1], 5):
            x = 117+846*t/self.time[-1]
            line(d, [(x,820),(x,826)], MUTED)
            label(d, x, 848, f"{t:g} s", 15, MUTED, "number", "mm")

        label(d, 1032, 645, "棒の色は N 極の高さ変化（mm）", 23, weight="bold")
        x0, x1 = 1053, 1524
        for j, col in enumerate(self.palette):
            x = x0 + (x1-x0)*j/(len(self.palette)-1)
            line(d, [(x,681),(x,701)], col, 1.8)
        for val in self.color_limit*np.array([-1., -.2, -.05, 0., .05, .2, 1.]):
            x = x0+(x1-x0)*(1+self.color_fraction(val))/2
            line(d, [(x,702),(x,707)], MUTED)
            label(d, x, 723, f"{val:+g}" if val else "0", 14, MUTED, "number", "mm")
        label(d, x0, 751, "沈む", 16, MUTED)
        label(d, x1, 751, "上がる", 16, MUTED, anchor="rm")
        ellipse(d, 1046, 791, 9, 9, None, INK, 2)
        label(d, 1066, 791, "弾いた棒", 17)
        square(d, (1191,791), 8)
        label(d, 1211, 791, "観測点", 17)
        polygon(d, [(1321,783),(1337,783),(1342,791),(1337,799),(1321,799),(1316,791)], "#fae6b7")
        label(d, 1351, 791, "矢印は6本の周回向き", 17)
        return img

    def frame(self, i):
        img = self.base.copy()
        d = ImageDraw.Draw(img)
        label(d, 1550, 92, f"{self.time[i]:.3f} s", 34, INK, "number", "rm")
        for case, (_, middle, vector, unit) in enumerate(self.panels):
            for edge, (m, v, u) in enumerate(zip(middle, vector, unit)):
                color = self.palette[self.colors[case, i, edge]]
                line(d, [m-.34*v,m+.34*v], color, 8.2)
                direction = self.sign[case,edge]*u
                tip = m+.39*np.linalg.norm(v)*direction
                base = tip-5.7*direction
                side = np.array([-direction[1],direction[0]])*3.6
                polygon(d, [tip,base+side,base-side], "#58685f")
            ellipse(d, *middle[self.source], 11.5, 11.5, None, INK, 2)
            square(d, middle[self.receiver], 10.5)

        x = self.graph_x[i]
        line(d, [(x,680),(x,822)], "#95a79b", 1)
        for case, col in enumerate(CASE_COLORS):
            if i:
                pts = np.column_stack((self.graph_x[:i+1], self.graph_y[case,:i+1]))
                line(d, pts, col, 2.4)
            ellipse(d, x, self.graph_y[case,i], 3.3, 3.3, col)
        a, b = self.changed_charge[:,i]
        label(d, 1032, 845, f"磁荷が変わった頂点　 A {a}/{self.n_vertices}　 B {b}/{self.n_vertices}", 19, INK)
        return img.resize((WIDTH,HEIGHT), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=HERE/"response.npz")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--still-at", type=float, metavar="MODEL_SECONDS")
    args = parser.parse_args()
    with np.load(args.data) as data:
        scene = PulseScene(data)
    if args.still_at is None:
        encode_movie((scene.frame(i) for i in range(len(scene.time))), args.output or HERE/"pulse.mp4", scene.fps)
    else:
        i = int(np.argmin(abs(scene.time-args.still_at)))
        scene.frame(i).save(args.output or HERE/"preview.png")
