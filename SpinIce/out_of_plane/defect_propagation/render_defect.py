"""Compare the same central patch with and without a uniform bias field."""
import argparse
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "relaxation"))
from render import (BG, INK, MUTED, NORTH, RULE, SCALE, SOUTH, WIDTH, HEIGHT,
                    ellipse, encode_movie, label, line, point)

NEG, POS, GOLD = "#684897", "#ad532e", "#ac7728"
MAP_W, MAP_H, MAP_Y = 730, 297, 234
COL_X = (45, 825)


def draw_poles(d, center, vector, width):
    line(d, [center-vector,center+vector], "#796347", width)
    line(d, [center-vector,center+vector], "#dbc394", width*.52)
    for sign, color in [(-1,SOUTH), (1,NORTH)]:
        tip = center + sign*vector
        line(d, [center+sign*.70*vector,tip], color, width*1.28)
        ellipse(d, *tip, width*.56, width*.56, color)


def charge_color(q):
    return NEG if q == -3 else POS if q == 3 else MUTED


def node(d, p, q):
    if abs(q) == 3:
        ellipse(d, *p, 12, 12, charge_color(q))
        label(d, *p, "−" if q < 0 else "+", 19, "#ffffff", "number", "mm")
    elif q == 0:
        ellipse(d, *p, 9, 9, "#f5f4ea", "#96a29b", 1.2)
        label(d, *p, "?", 14, MUTED, "number", "mm")
    else:
        ellipse(d, *p, 4, 4, "#6c8177")


class Comparison:
    def __init__(self, data):
        self.times, self.angles = data["time_s"], data["theta_rad"]
        self.charges, self.ref_q = data["charge"], data["reference_charge"]
        self.ref_theta, self.xy = data["reference_theta_rad"], data["vertices_m"]
        self.edges, self.degree = data["edges"], data["degree"]
        self.seed, self.shared = int(data["seed_edge"]), int(data["shared_edge"])
        self.a, self.b = int(data["source"]), int(data["target"])
        self.length = float(data["length_m"])
        self.field = data["field_T"]
        along = self.xy[self.b]-self.xy[self.a]
        along /= np.linalg.norm(along)
        screen = np.column_stack((along, [along[1],-along[0]]))
        map_scale = 1100.
        mid = (self.xy[self.a]+self.xy[self.b])/2
        self.map_xy = (self.xy-mid) @ screen * map_scale + [365,136]
        self.map_mid = self.map_xy[self.edges].mean(axis=1)
        self.half = data["axes"][:,:2] @ screen * (self.length*map_scale/2)
        self.shared_sign = np.dot(data["axes"][self.shared,:2], along)
        self.near = [k for k,(x,y) in enumerate(self.map_mid)
                     if -70 < x < MAP_W+70 and -70 < y < MAP_H+70]
        self.nodes = [k for k,(x,y) in enumerate(self.map_xy)
                      if 0 < x < MAP_W and 0 < y < MAP_H and self.degree[k] == 3]
        self.map_base = self.static_map()
        self.base = self.background()

    def static_map(self):
        img = Image.new("RGB", (MAP_W*SCALE, MAP_H*SCALE), "#efeee3")
        d = ImageDraw.Draw(img)
        for k in self.near:
            line(d, self.map_xy[self.edges[k]], "#d1d4c8", 1.7)
        line(d, self.map_xy[[self.a,self.b]], "#bdd4ca", 11)
        for x,y in self.map_mid[self.near]:
            ellipse(d, x, y, 3, 3, "#a8b0a4")
        return img

    def map_frame(self, angles, charges):
        img = self.map_base.copy()
        d = ImageDraw.Draw(img)
        for k in self.near:
            p = self.map_mid[k]
            draw_poles(d, p, self.half[k]*np.cos(angles[k]), 3.8)
            ellipse(d, *p, 2.1, 2.1, "#596d60")
        ellipse(d, *self.map_mid[self.seed], 9, 9, None, GOLD, 2.6)
        for k in self.nodes:
            node(d, self.map_xy[k], charges[k])
        for name, k in [("A",self.a),("B",self.b)]:
            x,y = self.map_xy[k]
            label(d, x, y-30, name, 20, INK, "bold", "mm")
        return img

    def background(self):
        img = Image.new("RGB", (WIDTH*SCALE, HEIGHT*SCALE), BG)
        d = ImageDraw.Draw(img)
        label(d, 45, 58, "氷則の欠陥が隣へ移る一歩", 41, weight="bold")
        label(d, 48, 103, "100本の中央部を拡大　／　同じ1本を180°反転させ、全ての棒を静止から解放", 20, MUTED)
        line(d, [(45,139),(1554,139)], RULE, 1.4)
        line(d, [(800,159),(800,729)], RULE, 1.2)
        for c,x in enumerate(COL_X):
            label(d, x+2, 177, "磁場なし" if c == 0 else "一定の面内磁場", 29, weight="bold")
            label(d, x+MAP_W-2, 179, f"{np.linalg.norm(self.field[c])*1e3:g} mT", 24, MUTED, "number", "rm")
            label(d, x+2, 214, "真上から見た磁石と頂点", 17, MUTED)
            if c:
                label(d, x+MAP_W-2, 214, "← 磁場の向き", 17, MUTED, anchor="rm")
            label(d, x+3, 567, "A–B の棒を横から", 19, weight="bold")
            label(d, x+365, 567, "頂点の磁荷 Q", 19, weight="bold")
            for s, name in [(421,"A"),(606,"B")]:
                label(d, x+s, 616, name, 20, MUTED, "bold", "mm")
            for offset, name in [(75,"A 側"),(237,"B 側")]:
                label(d, x+offset, 709, name, 15, MUTED, anchor="mm")
            line(d, [(x+42,690),(x+270,690)], "#c3c9bd", 2)
            line(d, [(x+156,687),(x+156,631)], "#a1b0a4", 7)
            line(d, [(x+141,687),(x+171,687)], "#818e83", 4)

        line(d, [(45,740),(1554,740)], RULE, 1.2)
        ellipse(d, 58, 771, 8, 8, None, GOLD, 2.4)
        label(d, 77, 771, "最初に手で返した棒", 17, MUTED)
        node(d, (338,771), -3)
        label(d, 359, 771, "負の欠陥（3本とも外向き）", 17, MUTED)
        node(d, (708,771), 3)
        label(d, 729, 771, "正の欠陥（3本とも内向き）", 17, MUTED)
        node(d, (1072,771), 0)
        label(d, 1093, 771, "鉛直に近い棒を含み未判定", 17, MUTED)
        for x, color, name in [(1360,NORTH,"N 極"), (1460,SOUTH,"S 極")]:
            line(d, [(x,771),(x+22,771)], color, 5)
            label(d, x+30, 771, name, 16, MUTED)
        return img

    def frame(self, i, stage):
        reference = i is None
        img = self.base.copy()
        d = ImageDraw.Draw(img)
        t = 0. if reference else self.times[i]
        label(d, 1550, 43, stage, 17, MUTED, anchor="rm")
        clock = "解放前" if reference else f"{t:.3f} s"
        label(d, 1553, 94, clock, 33, INK, "bold" if reference else "number", "rm")
        for c,x in enumerate(COL_X):
            angles = self.ref_theta[c] if reference else self.angles[c,i]
            charges = self.ref_q[c] if reference else self.charges[c,i]
            img.paste(self.map_frame(angles, charges), point((x,MAP_Y)))
            pos = np.array([x+156, 631])
            angle = angles[self.shared]
            draw_poles(d, pos, 54*np.array([self.shared_sign*np.cos(angle),-np.sin(angle)]), 5.)
            ellipse(d, *pos, 4, 4, "#405b54")
            for at, offset in [(self.a,421),(self.b,606)]:
                q = int(charges[at])
                value = f"{q:+d}" if q else "?"
                label(d, x+offset, 664, value, 43, charge_color(q), "number", "mm")

        if reference:
            caption = "解放前は、両条件とも三配位の全52頂点が氷則を満たす。A と B の磁荷はともに −1。"
        elif i == 0:
            caption = "金の輪の棒を反転すると、両端に −3 と +3 の欠陥が生まれる。淡緑の A–B の辺は自由に動く。"
        elif t < .60:
            caption = "手を離した後は100本が磁気トルクで動く。右では A がいったん氷則に戻る。"
        elif t < .82:
            caption = "右では揺り戻しで A に負の欠陥が再び現れる。移動直前は A が −3、B が −1。"
        elif t < 1.05 and self.charges[1,i,self.b] != -3:
            caption = "右の A–B の棒が鉛直を通過する。上から向きを読み取れない間は「？」と表示する。"
        elif t < 1.05:
            caption = "右では A が −1 に戻り、B が −3 になった。負の欠陥が共有する一辺を越えた。"
        else:
            caption = "右の B の欠陥は一時的で、その後は再び揺れる。左では B に −3 は現れない。"
        label(d, 48, 837, caption, 21, INK)
        return img.resize((WIDTH,HEIGHT), Image.Resampling.LANCZOS)


def movie_frames(scene):
    # A hold is labeled; the preparation between the two initial stills is imposed.
    def hold(i, text, length):
        frame = scene.frame(i, text)
        for _ in range(length):
            yield frame
    a, b, end = (int(np.argmin(abs(scene.times-t))) for t in (.8, 1., 2.1))
    yield from hold(None, "氷則を満たした静止状態", 36)
    yield from hold(0, "反転直後を静止表示", 30)
    for i in range(1,a+1):
        yield scene.frame(i, "モデル時刻　／　8倍スロー")
    yield from hold(a, "移動の前を静止表示", 36)
    for i in range(a+1,b+1):
        yield from hold(i, "モデル時刻　／　16倍スロー", 2)
    yield from hold(b, "移動の後を静止表示", 60)
    for i in range(b+2,end+1,2):
        yield scene.frame(i, "モデル時刻　／　4倍スロー")
    yield from hold(end, "2.1モデル秒を静止表示", 30)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", type=Path, default=HERE/"trajectories.npz")
    p.add_argument("--output", type=Path, default=HERE/"defect-hop.mp4")
    args = p.parse_args()
    with np.load(args.data) as data:
        scene = Comparison(data)
    encode_movie(movie_frames(scene), args.output, 30)
