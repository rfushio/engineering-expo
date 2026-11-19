import * as THREE from 'three';
import { HEIGHT, WIDTH } from '../shared/protocol';
import { spinLayout } from './spin-layout';

const MAX_COUNT = spinLayout(48).count;
const BLUE = new THREE.Color('#249fe5');
const ORANGE = new THREE.Color('#f28b42');

/** Fixed-length glyphs of a scalar field. Rotation is visual, not spin dynamics. */
export class SpinLattice {
  readonly group = new THREE.Group();
  private sites: { x: number; y: number; angle: number }[] = [];
  private shafts: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private anchors: THREE.InstancedMesh;
  private columns = 0;
  private scale = 1;
  private transform = new THREE.Object3D();
  private initialized = false;

  constructor() {
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .32, metalness: .22 });
    const shaft = new THREE.CylinderGeometry(.5, .5, 5.5, 12);
    shaft.translate(0, -1.35, 0);
    const head = new THREE.ConeGeometry(1.7, 2.7, 16);
    head.translate(0, 2.75, 0);
    this.shafts = new THREE.InstancedMesh(shaft, material, MAX_COUNT);
    this.heads = new THREE.InstancedMesh(head, material, MAX_COUNT);
    this.shafts.name = 'spin-shafts'; this.heads.name = 'spin-heads';
    for (const mesh of [this.shafts, this.heads]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    const anchors = new THREE.InstancedMesh(new THREE.RingGeometry(1.5, 1.7, 24), new THREE.MeshBasicMaterial({ color: '#627c8c', side: THREE.DoubleSide }), MAX_COUNT);
    this.anchors = anchors;
    anchors.frustumCulled = false;
    anchors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    anchors.name = 'spin-sites';
    this.group.add(anchors);
    this.setColumns(16);
  }

  setColumns(value: number) {
    const layout = spinLayout(value);
    if (layout.columns === this.columns) return;
    this.columns = layout.columns; this.scale = layout.scale;
    this.sites = [];
    for (let row = 0; row < layout.rows; row++) for (let column = 0; column < layout.columns; column++) {
      this.sites.push({ x: (column + .5) * WIDTH / layout.columns - .5, y: (row + .5) * HEIGHT / layout.rows - .5, angle: 0 });
    }
    for (const mesh of [this.shafts, this.heads, this.anchors]) mesh.count = layout.count;
    this.sites.forEach((site, i) => {
      this.transform.position.set(site.x - (WIDTH - 1) / 2, .05, site.y - (HEIGHT - 1) / 2);
      this.transform.rotation.set(-Math.PI / 2, 0, 0); this.transform.scale.setScalar(this.scale); this.transform.updateMatrix();
      this.anchors.setMatrixAt(i, this.transform.matrix);
    });
    this.anchors.instanceMatrix.needsUpdate = true;
    this.initialized = false;
  }

  update(frame: Uint8Array, dt: number) {
    const blend = this.initialized ? 1 - Math.exp(-Math.max(0, dt) * 18) : 1;
    this.sites.forEach((site, i) => {
      // Bilinear sampling also works for layouts between simulation cells.
      const x = Math.floor(site.x), y = Math.floor(site.y);
      const a = THREE.MathUtils.lerp(frame[y * WIDTH + x], frame[y * WIDTH + x + 1], site.x - x);
      const b = THREE.MathUtils.lerp(frame[(y + 1) * WIDTH + x], frame[(y + 1) * WIDTH + x + 1], site.x - x);
      const value = THREE.MathUtils.lerp(a, b, site.y - y);
      const m = value / 127.5 - 1;
      site.angle = THREE.MathUtils.lerp(site.angle, Math.acos(THREE.MathUtils.clamp(m, -1, 1)), blend);
      this.transform.position.set(site.x - (WIDTH - 1) / 2, 5 * this.scale, site.y - (HEIGHT - 1) / 2);
      this.transform.rotation.set(0, 0, -site.angle);
      // Size depends only on spacing, never on magnetization or flip progress.
      this.transform.scale.setScalar(this.scale); this.transform.updateMatrix();
      for (const mesh of [this.shafts, this.heads]) {
        mesh.setMatrixAt(i, this.transform.matrix);
        mesh.setColorAt(i, m >= 0 ? BLUE : ORANGE);
      }
    });
    for (const mesh of [this.shafts, this.heads]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.initialized = true;
  }
}
