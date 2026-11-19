import * as THREE from 'three';
import { CONTROL_POINTS, HEIGHT, WIDTH, type Snapshot } from '../shared/protocol';
import { controlColor } from './control-view';
import { SpinLattice } from './spin-lattice';

const BLUE = new THREE.Color('#3199cc');
const ORANGE = new THREE.Color('#e8a06a');
const BORDER = new THREE.Color('#dce8e5');
const BASE_Y = -18;
const SEGMENTS = 80;

function textTexture(text: string, background: string, foreground: string, width = 256, height = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.beginPath(); ctx.roundRect(0, 0, width, height, height * .15); ctx.fill();
  ctx.fillStyle = foreground; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${height * .53}px -apple-system, sans-serif`;
  ctx.fillText(text, width / 2, height * .53);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function label(text: string, color: string, width: number, height: number) {
  const material = new THREE.SpriteMaterial({ map: textTexture(text, '#142b3d', color), depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1); sprite.renderOrder = 10;
  return sprite;
}

interface Magnet {
  group: THREE.Group;
  body: THREE.Group;
  marker: THREE.Sprite;
  ring: THREE.LineLoop;
  tether: THREE.Line;
  beams: THREE.LineSegments;
  glow: THREE.PointLight;
  patch: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  volume: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
}
interface ControlMarker {
  group: THREE.Group;
  ring: THREE.LineLoop;
  progress: THREE.Line;
  post: THREE.Line;
  flag: THREE.Sprite;
}

/** A presentation of the existing 2D field. No simulation or scoring lives here. */
export class ReliefRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-120, 120, 70, -70, .1, 800);
  private surface: THREE.BufferGeometry;
  private skirt: THREE.BufferGeometry;
  private magnets: Magnet[];
  private controlMarkers: ControlMarker[];
  private lastFrame?: Uint8Array;
  private frame?: Uint8Array;
  private heightScale = 8;
  private angle = 52;
  private width = 0;
  private height = 0;
  private lastTime = 0;
  private perimeter: number[] = [];
  private terrainGroup = new THREE.Group();
  private spinLattice = new SpinLattice();
  private spinOnly = false;
  private fieldVisibility = .65;
  private plate: THREE.Mesh;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor('#122535');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(new THREE.HemisphereLight('#e6f5ff', '#47526b', 2.2));
    const sun = new THREE.DirectionalLight('#fff1db', 3.0);
    sun.position.set(-55, 160, 80); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 110, bottom: -110, near: 1, far: 400 });
    sun.shadow.bias = -.0005; sun.shadow.normalBias = .3;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#a2d8ff', 1.0);
    fill.position.set(90, 80, -90); this.scene.add(fill);

    const plate = new THREE.Mesh(new THREE.BoxGeometry(WIDTH + 7, 4, HEIGHT + 7), new THREE.MeshStandardMaterial({ color: '#33495a', roughness: .65, metalness: .25 }));
    this.plate = plate;
    plate.position.y = BASE_Y - 2.1; plate.receiveShadow = true; this.scene.add(plate);
    this.scene.add(this.terrainGroup, this.spinLattice.group);
    this.spinLattice.group.visible = false;
    const grid = new THREE.GridHelper(250, 25, '#35536a', '#203e52');
    grid.position.y = BASE_Y - 4.3; this.scene.add(grid);

    this.surface = new THREE.BufferGeometry();
    const positions = new Float32Array(WIDTH * HEIGHT * 3);
    const colors = new Float32Array(positions.length);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      positions[i] = x - (WIDTH - 1) / 2; positions[i + 2] = y - (HEIGHT - 1) / 2;
    }
    const indices = new Uint32Array((WIDTH - 1) * (HEIGHT - 1) * 6);
    let k = 0;
    for (let y = 0; y < HEIGHT - 1; y++) for (let x = 0; x < WIDTH - 1; x++) {
      const a = y * WIDTH + x, b = a + 1, c = a + WIDTH, d = c + 1;
      // Looking from above, the triangles face +Y.
      indices.set([a, c, b, b, c, d], k); k += 6;
    }
    this.surface.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.surface.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.surface.setIndex(new THREE.BufferAttribute(indices, 1));
    const terrain = new THREE.Mesh(this.surface, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7, metalness: .05, side: THREE.DoubleSide }));
    terrain.receiveShadow = true; terrain.frustumCulled = false; this.terrainGroup.add(terrain);

    for (let x = 0; x < WIDTH; x++) this.perimeter.push(x);
    for (let y = 1; y < HEIGHT; y++) this.perimeter.push(y * WIDTH + WIDTH - 1);
    for (let x = WIDTH - 2; x >= 0; x--) this.perimeter.push((HEIGHT - 1) * WIDTH + x);
    for (let y = HEIGHT - 2; y > 0; y--) this.perimeter.push(y * WIDTH);
    this.skirt = new THREE.BufferGeometry();
    this.skirt.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.perimeter.length * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.skirt.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.perimeter.length * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const walls = new THREE.Mesh(this.skirt, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide }));
    walls.frustumCulled = false; this.terrainGroup.add(walls);
    this.magnets = [this.makeMagnet(0), this.makeMagnet(1)];
    this.controlMarkers = CONTROL_POINTS.map(point => this.makeControlMarker(point.id));
    this.setAngle(this.angle);
  }

  private makeControlMarker(id: string): ControlMarker {
    const group = new THREE.Group(); group.visible = false; this.scene.add(group);
    const geometry = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
      return g;
    };
    const ring = new THREE.LineLoop(geometry(), new THREE.LineBasicMaterial({ color: '#edf4f4', depthTest: false }));
    const progress = new THREE.Line(geometry(), new THREE.LineBasicMaterial({ color: '#edf4f4', depthTest: false }));
    const post = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#e1eef2', depthTest: false }));
    const flag = label(id, '#ffffff', 8, 5.5);
    for (const object of [ring, progress, post]) { object.frustumCulled = false; object.renderOrder = 4; }
    group.add(ring, progress, post, flag);
    return { group, ring, progress, post, flag };
  }

  private drawControl(state: Snapshot | undefined) {
    for (let i = 0; i < this.controlMarkers.length; i++) {
      const marker = this.controlMarkers[i], point = state?.control?.points[i];
      marker.group.visible = !!point;
      if (!point) continue;
      const ring = marker.ring.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arc = marker.progress.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k <= SEGMENTS; k++) {
        const theta = k / SEGMENTS * Math.PI * 2 - Math.PI / 2;
        for (const [geometry, radius] of [[ring, point.radius], [arc, point.radius + .8]] as const) {
          const x = point.x + Math.cos(theta) * radius, y = point.y + Math.sin(theta) * radius;
          geometry.setXYZ(k, x - (WIDTH - 1) / 2, this.sample(x, y) + .65, y - (HEIGHT - 1) / 2);
        }
      }
      ring.needsUpdate = arc.needsUpdate = true;
      (marker.ring.material as THREE.LineBasicMaterial).color.set(controlColor(point.owner));
      (marker.flag.material as THREE.SpriteMaterial).color.set(controlColor(point.owner));
      (marker.progress.material as THREE.LineBasicMaterial).color.set(controlColor(point.claimant));
      marker.progress.visible = point.claimant !== null;
      marker.progress.geometry.setDrawRange(0, Math.floor((SEGMENTS + 1) * point.progress));
      const x = point.x - (WIDTH - 1) / 2, z = point.y - (HEIGHT - 1) / 2, y = this.sample(point.x, point.y);
      marker.flag.position.set(x, y + 8, z);
      const post = marker.post.geometry.getAttribute('position') as THREE.BufferAttribute;
      post.setXYZ(0, x, y + .5, z); post.setXYZ(1, x, y + 5.5, z); post.needsUpdate = true;
    }
  }

  private makeMagnet(id: number): Magnet {
    const group = new THREE.Group(), body = new THREE.Group();
    const accent = id === 0 ? '#6fd1ff' : '#ffc18d';
    const north = new THREE.MeshStandardMaterial({ map: textTexture('N', '#c74944', '#fff7e7', 128, 128), roughness: .38, metalness: .15 });
    const south = new THREE.MeshStandardMaterial({ map: textTexture('S', '#e1e9eb', '#183a57', 128, 128), roughness: .38, metalness: .15 });
    const geometry = new THREE.BoxGeometry(6, 6, 6);
    const lower = new THREE.Mesh(geometry, id === 0 ? south : north);
    const upper = new THREE.Mesh(geometry, id === 0 ? north : south);
    lower.position.y = 3; upper.position.y = 9;
    lower.castShadow = upper.castShadow = true; body.add(lower, upper);
    const band = new THREE.Mesh(new THREE.BoxGeometry(6.4, .65, 6.4), new THREE.MeshStandardMaterial({ color: accent, metalness: .4, roughness: .3 }));
    band.position.y = 6; body.add(band);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(6.1, 12.1, 6.1)), new THREE.LineBasicMaterial({ color: '#183a4d', transparent: true, opacity: .5 }));
    edge.position.y = 6; body.add(edge);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.8, 12), new THREE.MeshBasicMaterial({ color: accent }));
    arrow.rotation.z = Math.PI; arrow.position.y = -2; body.add(arrow);
    const marker = label(`P${id + 1}  ${id === 0 ? 'S' : 'N'}↓`, accent, 16, 6);
    body.add(marker); marker.position.y = 17;
    group.add(body); this.scene.add(group);
    const ringGeometry = new THREE.BufferGeometry();
    ringGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEGMENTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const ring = new THREE.LineLoop(ringGeometry, new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: .8, depthTest: false }));
    ring.frustumCulled = false; ring.renderOrder = 3; this.scene.add(ring);
    const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: accent, dashSize: 1.4, gapSize: 1.2, transparent: true, opacity: .55, depthTest: false }));
    tether.frustumCulled = false; this.scene.add(tether);
    const beamsGeometry = new THREE.BufferGeometry();
    beamsGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const beams = new THREE.LineSegments(beamsGeometry, new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: .28, depthTest: true }));
    beams.frustumCulled = false; this.scene.add(beams);
    const glow = new THREE.PointLight(accent, 0, 24, 2); this.scene.add(glow);
    const fieldColor = id === 0 ? '#168fff' : '#ff792c';
    const patch = new THREE.Mesh(new THREE.RingGeometry(0, 1, SEGMENTS, 8), new THREE.MeshBasicMaterial({ color: fieldColor, transparent: true, opacity: .4, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    patch.frustumCulled = false; patch.visible = false; this.scene.add(patch);
    const volume = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 40, 1, true), new THREE.MeshBasicMaterial({ color: fieldColor, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
    volume.visible = false; this.scene.add(volume);
    return { group, body, marker, ring, tether, beams, glow, patch, volume };
  }

  setHeight(value: number) {
    this.heightScale = THREE.MathUtils.clamp(value, 3, 14); this.lastFrame = undefined;
  }
  setSpinOnly(enabled: boolean) {
    this.spinOnly = enabled;
    this.terrainGroup.visible = !enabled;
    this.spinLattice.group.visible = enabled;
    this.plate.position.y = (enabled ? 0 : BASE_Y) - 2.1;
    this.lastFrame = undefined;
  }
  setSpinColumns(columns: number) {
    this.spinLattice.setColumns(columns);
  }
  setFieldVisibility(value: number) {
    this.fieldVisibility = THREE.MathUtils.clamp(value, 0, 1);
  }
  setAngle(value: number) {
    this.angle = THREE.MathUtils.clamp(value, 35, 75);
    const angle = THREE.MathUtils.degToRad(this.angle);
    this.camera.position.set(0, Math.sin(angle) * 240, Math.cos(angle) * 240);
    this.camera.lookAt(0, 0, 0);
  }
  private sample(x: number, y: number) {
    if (this.spinOnly) return 0;
    if (!this.frame) return 0;
    x = THREE.MathUtils.clamp(x, 0, WIDTH - 1); y = THREE.MathUtils.clamp(y, 0, HEIGHT - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(WIDTH - 1, x0 + 1), y1 = Math.min(HEIGHT - 1, y0 + 1);
    const a = THREE.MathUtils.lerp(this.frame[y0 * WIDTH + x0], this.frame[y0 * WIDTH + x1], x - x0);
    const b = THREE.MathUtils.lerp(this.frame[y1 * WIDTH + x0], this.frame[y1 * WIDTH + x1], x - x0);
    return (THREE.MathUtils.lerp(a, b, y - y0) / 127.5 - 1) * this.heightScale;
  }
  private updateTerrain(frame: Uint8Array) {
    this.frame = frame;
    const positions = this.surface.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.surface.getAttribute('color') as THREE.BufferAttribute;
    const color = new THREE.Color();
    for (let i = 0; i < frame.length; i++) {
      const m = frame[i] / 127.5 - 1;
      positions.setY(i, m * this.heightScale);
      color.copy(m >= 0 ? BLUE : ORANGE).lerp(BORDER, Math.exp(-((m / .22) ** 2)) * .8);
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    positions.needsUpdate = colors.needsUpdate = true;
    this.surface.computeVertexNormals();
    const wallPositions = this.skirt.getAttribute('position') as THREE.BufferAttribute;
    const wallColors = this.skirt.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < this.perimeter.length; i++) {
      const a = this.perimeter[i], b = this.perimeter[(i + 1) % this.perimeter.length];
      const verts = [[a, true], [a, false], [b, true], [b, true], [a, false], [b, false]] as const;
      verts.forEach(([index, top], j) => {
        const k = i * 6 + j;
        wallPositions.setXYZ(k, positions.getX(index), top ? positions.getY(index) : BASE_Y, positions.getZ(index));
        const shade = top ? .55 : .22;
        wallColors.setXYZ(k, colors.getX(index) * shade, colors.getY(index) * shade, colors.getZ(index) * shade);
      });
    }
    wallPositions.needsUpdate = wallColors.needsUpdate = true;
    this.skirt.computeVertexNormals();
    this.lastFrame = frame;
  }

  render(frame: Uint8Array | undefined, state: Snapshot | undefined, now: number) {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    if (width !== this.width || height !== this.height) {
      this.width = width; this.height = height; this.renderer.setSize(width, height, false);
      const aspect = width / height, viewHeight = Math.max(155, 226 / aspect);
      this.camera.left = -viewHeight * aspect / 2; this.camera.right = viewHeight * aspect / 2;
      this.camera.top = viewHeight / 2; this.camera.bottom = -viewHeight / 2;
      this.camera.updateProjectionMatrix();
    }
    this.frame = frame;
    if (frame && frame !== this.lastFrame && !this.spinOnly) this.updateTerrain(frame);
    this.drawControl(state);
    const dt = Math.min(.05, (now - this.lastTime) / 1000); this.lastTime = now;
    if (frame && this.spinOnly) this.spinLattice.update(frame, dt);
    if (state) for (const p of state.players) {
      const magnet = this.magnets[p.id];
      magnet.group.position.set(p.x - (WIDTH - 1) / 2, 0, p.y - (HEIGHT - 1) / 2);
      const targetY = (this.spinOnly ? 9 : this.heightScale) + (p.active ? 5 : 10);
      magnet.body.position.y = this.lastTime ? THREE.MathUtils.lerp(magnet.body.position.y || targetY, targetY, 1 - Math.exp(-dt * 18)) : targetY;
      const bx = magnet.group.position.x, bz = magnet.group.position.z, tip = magnet.body.position.y - 3.4;
      const ring = magnet.ring.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < SEGMENTS; k++) {
        const theta = k / SEGMENTS * Math.PI * 2;
        const x = p.x + Math.cos(theta) * state.settings.fieldRadius, y = p.y + Math.sin(theta) * state.settings.fieldRadius;
        ring.setXYZ(k, THREE.MathUtils.clamp(x, 0, WIDTH - 1) - (WIDTH - 1) / 2, this.sample(x, y) + .35, THREE.MathUtils.clamp(y, 0, HEIGHT - 1) - (HEIGHT - 1) / 2);
      }
      ring.needsUpdate = true;
      (magnet.ring.material as THREE.LineBasicMaterial).opacity = p.active ? .95 : .55;
      const tether = magnet.tether.geometry.getAttribute('position') as THREE.BufferAttribute;
      tether.setXYZ(0, bx, tip, bz); tether.setXYZ(1, bx, this.sample(p.x, p.y) + .3, bz); tether.needsUpdate = true;
      magnet.tether.computeLineDistances();
      magnet.beams.visible = p.active && this.fieldVisibility > 0;
      (magnet.beams.material as THREE.LineBasicMaterial).opacity = .55 * this.fieldVisibility;
      magnet.patch.visible = magnet.volume.visible = p.active && this.fieldVisibility > 0;
      if (magnet.patch.visible) {
        const positions = magnet.patch.geometry.getAttribute('position') as THREE.BufferAttribute;
        const uv = magnet.patch.geometry.getAttribute('uv') as THREE.BufferAttribute;
        for (let k = 0; k < positions.count; k++) {
          const x = THREE.MathUtils.clamp(p.x + (uv.getX(k) * 2 - 1) * state.settings.fieldRadius, 0, WIDTH - 1);
          const y = THREE.MathUtils.clamp(p.y + (uv.getY(k) * 2 - 1) * state.settings.fieldRadius, 0, HEIGHT - 1);
          positions.setXYZ(k, x - (WIDTH - 1) / 2, this.sample(x, y) + .18, y - (HEIGHT - 1) / 2);
        }
        positions.needsUpdate = true;
        magnet.patch.material.opacity = .65 * this.fieldVisibility;
        magnet.volume.material.opacity = .18 * this.fieldVisibility;
        const base = this.sample(p.x, p.y) + .2, height = Math.max(.1, tip - base);
        magnet.volume.position.set(bx, base + height / 2, bz);
        magnet.volume.scale.set(state.settings.fieldRadius, height, state.settings.fieldRadius);
      }
      const beams = magnet.beams.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < 8; k++) {
        const theta = k / 8 * Math.PI * 2 + now * .0003;
        const x = THREE.MathUtils.clamp(p.x + Math.cos(theta) * state.settings.fieldRadius * .85, 0, WIDTH - 1);
        const y = THREE.MathUtils.clamp(p.y + Math.sin(theta) * state.settings.fieldRadius * .85, 0, HEIGHT - 1);
        beams.setXYZ(k * 2, bx, tip, bz);
        beams.setXYZ(k * 2 + 1, x - (WIDTH - 1) / 2, this.sample(x, y) + .5, y - (HEIGHT - 1) / 2);
      }
      beams.needsUpdate = true;
      magnet.glow.position.set(bx, this.sample(p.x, p.y) + 7, bz);
      magnet.glow.intensity = p.active ? 500 * this.fieldVisibility : 0;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) geometries.add(object.geometry);
      if ('material' in object) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof THREE.Material)) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    this.renderer.dispose();
  }
}
