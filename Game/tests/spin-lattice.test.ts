import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpinLattice } from '../src/client/spin-lattice';
import { HEIGHT, WIDTH } from '../src/shared/protocol';

test('3D spin glyphs keep unit scale while rotating through zero and changing colour locally', () => {
  const lattice = new SpinLattice();
  const shafts = lattice.group.getObjectByName('spin-shafts') as THREE.InstancedMesh;
  const heads = lattice.group.getObjectByName('spin-heads') as THREE.InstancedMesh;
  assert.equal(shafts.count, 144);
  const frame = new Uint8Array(WIDTH * HEIGHT).fill(255);
  lattice.update(frame, 1 / 60);
  const blue = new THREE.Color(); shafts.getColorAt(0, blue);
  const inspect = (expectedY: number) => {
    for (const mesh of [shafts, heads]) {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      matrix.decompose(position, rotation, scale);
      assert.ok(scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6);
      assert.ok(Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).y - expectedY) < .01);
      assert.equal(position.y, 5);
    }
  };
  inspect(1);
  // First site is at (5.5, 5.5); the transport can represent mean zero exactly.
  frame[5 * WIDTH + 5] = frame[6 * WIDTH + 5] = 127;
  frame[5 * WIDTH + 6] = frame[6 * WIDTH + 6] = 128;
  for (let i = 0; i < 60; i++) lattice.update(frame, 1 / 60);
  inspect(0);
  for (const y of [5, 6]) for (const x of [5, 6]) frame[y * WIDTH + x] = 0;
  for (let i = 0; i < 60; i++) lattice.update(frame, 1 / 60);
  inspect(-1);
  const flipped = new THREE.Color(), neighbour = new THREE.Color(), head = new THREE.Color();
  shafts.getColorAt(0, flipped); shafts.getColorAt(1, neighbour); heads.getColorAt(0, head);
  assert.notDeepEqual(flipped, blue); assert.deepEqual(neighbour, blue); assert.deepEqual(head, flipped);
  frame.fill(255);
  for (let i = 0; i < 60; i++) lattice.update(frame, 1 / 60);
  inspect(1);
  shafts.getColorAt(0, flipped); assert.deepEqual(flipped, blue);
  // Repeated density changes reuse GPU buffers, including both end points.
  const matrices = shafts.instanceMatrix;
  for (const [columns, count] of [[8, 40], [48, 1296], [12, 84], [16, 144]]) {
    lattice.setColumns(columns); lattice.update(frame, 1 / 60);
    assert.equal(shafts.count, count); assert.equal(heads.count, count);
    assert.equal(shafts.instanceMatrix, matrices);
    const matrix = new THREE.Matrix4(); shafts.getMatrixAt(count - 1, matrix);
    assert.ok(matrix.elements.every(Number.isFinite));
    shafts.getColorAt(count - 1, flipped); assert.deepEqual(flipped, blue);
  }
  inspect(1);
});
