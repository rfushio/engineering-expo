"""Render the saved 100-rotor trajectory from an oblique orthographic camera."""
import argparse
from functools import lru_cache
from pathlib import Path
import shutil
import subprocess
from tempfile import NamedTemporaryFile

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT, SCALE = 1600, 900, 2
FAST_FROM, TAIL_SPEED = 22., 4
BG, INK, MUTED, RULE = "#f7f7f1", "#203b3a", "#506965", "#cdd6ce"
NORTH, SOUTH, ICE, DEFECT = "#d44f38", "#32699d", "#16796d", "#ac591a"


def point(xy):
    return tuple(round(float(v)*SCALE) for v in xy)


def line(draw, points, color, width=1):
    draw.line([point(p) for p in points], fill=color, width=round(width*SCALE))


def polygon(draw, points, color):
    draw.polygon([point(p) for p in points], fill=color)


def ellipse(draw, x, y, rx, ry, fill, outline=None, width=1):
    draw.ellipse([point((x-rx, y-ry)), point((x+rx, y+ry))], fill=fill,
                 outline=outline, width=round(width*SCALE))


@lru_cache(None)
def font(size, weight):
    if weight == "number":
        from matplotlib import get_data_path
        path = Path(get_data_path()) / "fonts/ttf/DejaVuSansMono.ttf"
    else:
        bold = weight == "bold"
        candidates = [Path("/System/Library/Fonts") / f"ヒラギノ角ゴシック W{6 if bold else 3}.ttc",
                      Path("/usr/share/fonts/opentype/noto") / f"NotoSansCJK-{'Bold' if bold else 'Regular'}.ttc",
                      Path("C:/Windows/Fonts") / ("YuGothB.ttc" if bold else "YuGothM.ttc")]
        path = next((p for p in candidates if p.is_file()), None)
        if path is None:
            raise RuntimeError("Install the Japanese Noto Sans CJK fonts or select a font in render.py.")
    return ImageFont.truetype(str(path), size*SCALE)


def label(draw, x, y, text, size=18, color=INK, weight="regular", anchor="lm"):
    draw.text(point((x, y)), text, font=font(size, weight), fill=color, anchor=anchor)


def symbol(draw, x, y, state, r):
    if state == 3:
        polygon(draw, [(x, y-r*1.22), (x+r*1.22, y), (x, y+r*1.22), (x-r*1.22, y)], DEFECT)
    elif state == 1:
        ellipse(draw, x, y, r, r, ICE)
    else:
        ellipse(draw, x, y, r, r, BG, "#82948e", 1.35)


def fit(points, box):
    lo, hi = points.min(axis=0), points.max(axis=0)
    left, top, right, bottom = box
    scale = min((right-left)/(hi[0]-lo[0]), (bottom-top)/(hi[1]-lo[1]))
    return scale, np.array([(left+right)/2, (top+bottom)/2]) - scale*(lo+hi)/2


class Scene:
    def __init__(self, data, azimuth, elevation):
        self.edges, self.xy = data["edges"], data["vertices_m"]
        self.theta, self.times = data["theta_rad"], data["time_s"]
        self.charge, self.degree = data["charge"], data["degree"]
        self.gamma = float(data["gamma_s_inv"])
        self.threshold = float(data["projection_threshold"])
        self.centers, self.axes = data["centers_m"], data["axes"]
        self.length = float(data["length_m"])
        self.interior = np.flatnonzero(self.degree == 3)
        self.mean_angle = np.rad2deg(np.arcsin(np.clip(np.abs(np.sin(self.theta)), 0, 1))).mean(axis=1)
        az, el = np.deg2rad([azimuth, elevation])
        eye = np.array([np.cos(el)*np.cos(az), np.cos(el)*np.sin(az), np.sin(el)])
        right = np.array([-np.sin(az), np.cos(az), 0.])
        self.basis = np.stack([right, -np.cross(eye, right)], axis=1)
        self.eye = eye
        x0, y0 = self.xy.min(axis=0)-.037
        x1, y1 = self.xy.max(axis=0)+.037
        self.board = np.array([(x0,y0,0), (x1,y0,0), (x1,y1,0), (x0,y1,0)])
        self.board_bottom = self.board - [0,0,.014]
        bounds = np.vstack([self.board_bottom, self.board+[0,0,.113]])
        self.scale, self.offset = fit(bounds @ self.basis, (48, 190, 1150, 692))
        self.pivots = self.project(self.centers)
        self.order = np.argsort(self.centers @ eye)
        axle = np.column_stack((self.axes[:,1], -self.axes[:,0], np.zeros(len(self.axes))))
        axle *= np.where(axle @ eye >= 0, 1., -1.)[:,None]
        far, near = self.centers-.012*axle, self.centers+.012*axle
        self.far, self.near = self.project(far), self.project(near)
        self.far_foot = self.project(far-[0,0,.058])
        self.near_foot = self.project(near-[0,0,.058])
        self.axis_screen = self.axes @ self.basis * self.scale
        self.vertical_screen = self.basis[2]*self.scale
        map_xy = self.xy * [1, -1]
        m, shift = fit(map_xy, (1226, 237, 1547, 488))
        self.map_xy = map_xy*m+shift
        a, b = self.edges.T
        uv = self.map_xy[b] - self.map_xy[a]
        uv /= np.linalg.norm(uv, axis=1)[:,None]
        self.arrow = uv
        self.map_mid = (self.map_xy[a]+self.map_xy[b])/2
        self.graph = np.column_stack((251+873*self.times/self.times[-1], 827-78*self.mean_angle/90))
        self.base = self.background()

    def project(self, xyz):
        return xyz @ self.basis * self.scale + self.offset

    def background(self):
        img = Image.new("RGB", (WIDTH*SCALE, HEIGHT*SCALE), BG)
        d = ImageDraw.Draw(img)
        label(d, 46, 59, "100本の磁石の緩和", 43, weight="bold")
        label(d, 49, 105, f"ハニカム格子の面外ローターを鉛直付近から同時に解放　／　粘性減衰率 γ = {self.gamma:g} /s", 21, MUTED)
        line(d, [(48,136),(1552,136)], RULE, 1.3)
        line(d, [(1181,157),(1181,857)], RULE, 1.3)
        label(d, 48, 168, "斜め横から", 23, weight="bold")
        for x, color, caption in [(848,NORTH,"N 極"),(951,SOUTH,"S 極"),(1053,"#9baaa3","支柱")]:
            line(d, [(x,169),(x+24,169)], color, 6)
            label(d, x+33, 169, caption, 17)
        top, bottom = self.project(self.board), self.project(self.board_bottom)
        polygon(d, bottom+[5,7], "#e0e2d7")
        for a,b in [(0,1),(1,2),(2,3),(3,0)]:
            polygon(d, [top[a],top[b],bottom[b],bottom[a]], "#c7baa2")
        polygon(d, top, "#ede8d9")
        line(d, [*top, top[0]], "#c6bfad", 1.25)
        board_points = self.project(np.column_stack((self.xy, np.zeros(len(self.xy)))))
        for a,b in self.edges:
            line(d, board_points[[a,b]], "#d2cbb8", 1.2)
        for x,y in board_points:
            ellipse(d, x, y, 1.6, 1., "#bcb49d")

        label(d, 1216, 168, "真上から見た氷則", 23, weight="bold")
        label(d, 1217, 204, "矢印は磁石の S → N", 17, MUTED)
        for a,b in self.edges:
            line(d, self.map_xy[[a,b]], "#bdc9c2", 1.2)
        line(d, [(1218,521),(1551,521)], RULE, 1.1)
        label(d, 1217, 553, f"3本が集まる {len(self.interior)} 頂点", 19, weight="bold")
        for y, state, text in [(603,1,"氷則（2 対 1）"),(658,3,"違反（3 対 0）"),(713,0,"未判定")]:
            symbol(d, 1228, y, state, 7)
            label(d, 1250, y, text, 19)
        cutoff = np.rad2deg(np.arcsin(self.threshold))
        label(d, 1218, 780, f"鉛直から{cutoff:g}°未満の棒が", 17, MUTED)
        label(d, 1218, 810, "1本でもある頂点は未判定。", 17, MUTED)

        line(d, [(48,716),(1148,716)], RULE, 1.1)
        label(d, 48, 756, "水平からの平均角", 17, MUTED)
        for y, text in [(749,"90°"),(827,"0°")]:
            label(d, 233, y, text, 14, MUTED, "number", "rm")
            line(d, [(251,y),(1124,y)], RULE)
        for seconds in range(0, int(self.times[-1])+1, 10):
            x = 251+873*seconds/self.times[-1]
            line(d, [(x,827),(x,832)], MUTED)
            label(d, x, 849, f"{seconds} s", 13, MUTED, "number", "mm")
        return img

    def frame(self, index):
        img = self.base.copy()
        d = ImageDraw.Draw(img)
        angles = self.theta[index]
        co, si = np.cos(angles), np.sin(angles)
        half = self.length/2
        extension = half*(self.axis_screen*co[:,None] + self.vertical_screen*si[:,None])
        # Project a shadow onto the board using a fixed oblique light.
        n = self.axes*co[:,None]
        n[:,2] = si
        light = np.array([.35, -.18, -1.])
        floor = self.centers + self.centers[:,2,None]*light
        shadows = self.project(floor)
        shade_extent = half*(n+si[:,None]*light) @ self.basis * self.scale
        for p,v in zip(shadows, shade_extent):
            line(d, [p-v,p+v], "#d8d1bd", 2.5)

        for i in self.order:
            far, near = self.far[i], self.near[i]
            foot1, foot2 = self.far_foot[i], self.near_foot[i]
            p, v = self.pivots[i], extension[i]
            line(d, [foot1,foot2], "#b1b5a9", 5)
            line(d, [foot1,far], "#a6b1a6", 2.5)
            line(d, [far,near], "#878e7c", 2)
            line(d, [p-v,p+v], "#745735", 4.6)
            line(d, [p-v,p+v], "#d5b27b", 2.65)
            # Paint the nearer pole last when a rod points towards the camera.
            caps = [(-1,SOUTH,"#244f73"), (1,NORTH,"#963f31")]
            if n[i] @ self.eye < 0:
                caps.reverse()
            for sign, color, outline in caps:
                a, b = p+sign*.77*v, p+sign*v
                line(d, [a,b], outline, 6.0)
                line(d, [a,b], color, 4.4)
                ellipse(d, *b, 2.55, 2.55, color, outline, .65)
            ellipse(d, *p, 2.7, 2.7, "#65736d")
            line(d, [foot2,near], "#93a49b", 2.35)
            ellipse(d, *near, 1.65, 1.65, "#536a62")

        for i in np.flatnonzero(np.abs(co) >= self.threshold):
            p = self.map_mid[i]
            u = self.arrow[i]*np.sign(co[i])
            normal = np.array([-u[1],u[0]])
            line(d, [p-5*u,p+3*u], "#617671", 1.2)
            polygon(d, [p+5*u,p-1.1*u+2.4*normal,p-1.1*u-2.4*normal], "#617671")
        states = np.abs(self.charge[index,self.interior])
        for vertex, state in zip(self.interior, states):
            symbol(d, *self.map_xy[vertex], state, 3.25 if state != 3 else 4.1)
        for y, state, color in [(603,1,ICE),(658,3,DEFECT),(713,0,MUTED)]:
            label(d, 1547, y, str(np.count_nonzero(states == state)), 30, color, "number", "rm")

        speed = f"{TAIL_SPEED}倍速" if self.times[index] > FAST_FROM else "等速"
        label(d, 1551, 45, f"モデル時間　／　{speed}", 18, MUTED, anchor="rm")
        label(d, 1554, 94, f"{self.times[index]:05.2f} s", 36, INK, "number", "rm")
        label(d, 47, 809, f"{self.mean_angle[index]:.1f}°", 36, INK, "number")
        if index:
            line(d, self.graph[:index+1], ICE, 2.6)
        ellipse(d, *self.graph[index], 4.0, 4.0, ICE)
        return img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)


def encode_movie(frames, path, fps):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        from imageio_ffmpeg import get_ffmpeg_exe
        ffmpeg = get_ffmpeg_exe()
    with NamedTemporaryFile(suffix=".mp4", dir=path.parent, delete=False) as f:
        temporary = Path(f.name)
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt",
           "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(fps), "-i", "-", "-an", "-c:v",
           "libx264", "-preset", "fast", "-crf", "18", "-vf", "scale=out_color_matrix=bt709",
           "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", str(temporary)]
    try:
        with subprocess.Popen(cmd, stdin=subprocess.PIPE) as proc:
            for frame in frames:
                proc.stdin.write(frame.tobytes())
            proc.stdin.close()
            if proc.wait():
                raise RuntimeError("Video encoding failed")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def save_movie(scene, path):
    fps = int(round(1/np.diff(scene.times[:2])[0]))
    cut = np.searchsorted(scene.times, FAST_FROM, side="right")-1
    indices = list(range(cut+1)) + list(range(cut+TAIL_SPEED, len(scene.times), TAIL_SPEED))
    if indices[-1] != len(scene.times)-1:
        indices.append(len(scene.times)-1)
    encode_movie((scene.frame(i) for i in indices), path, fps)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=HERE / "trajectory.npz")
    parser.add_argument("--output", type=Path, help="default relaxation-100.mp4, or a PNG for a still")
    parser.add_argument("--azimuth", type=float, default=-69, help="camera bearing from +x, degrees")
    parser.add_argument("--elevation", type=float, default=27, help="degrees above the desk")
    parser.add_argument("--still-at", type=float, metavar="SECONDS", help="render one model time")
    args = parser.parse_args()
    with np.load(args.data) as data:
        scene = Scene(data, args.azimuth, args.elevation)
    if args.still_at is None:
        save_movie(scene, args.output or HERE / "relaxation-100.mp4")
    else:
        frame = int(np.argmin(abs(scene.times-args.still_at)))
        scene.frame(frame).save(args.output or HERE / "relaxation-100.png")
