import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_PREVIEW_VIEW,
  CLIP_CLOSEUP_CAMERA_POSITION,
  PREVIEW_CAMERA_POSITIONS,
  PREVIEW_ZOOM_LIMITS,
  fitPreviewCamera,
  zoomPreviewCamera,
} from '../lib/preview-camera';

describe('preview camera', () => {
  it('shows the clip lettering from its front while still revealing its thickness', () => {
    const position = new THREE.Vector3(...CLIP_CLOSEUP_CAMERA_POSITION);
    expect(position.y).toBeLessThan(0);
    expect(position.z).toBeGreaterThan(0);
    expect(
      THREE.MathUtils.radToDeg(position.angleTo(new THREE.Vector3(0, -1, 0))),
    ).toBeLessThan(30);
  });
  it('fits a label centered away from the plate origin without changing its placement', () => {
    const center = new THREE.Vector3(18, -12, 2);
    const dimensions = new THREE.Vector3(60, 88, 4);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    camera.position.set(...PREVIEW_CAMERA_POSITIONS.angle).add(center);
    camera.lookAt(center);
    fitPreviewCamera(camera, dimensions, 0.65);
    const projectedCenter = center.clone().project(camera);
    expect(projectedCenter.x).toBeCloseTo(0);
    expect(projectedCenter.y).toBeCloseTo(0);
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) {
          const corner = new THREE.Vector3(x, y, z)
            .multiply(dimensions)
            .multiplyScalar(0.5)
            .add(center)
            .project(camera);
          expect(Math.abs(corner.x)).toBeLessThan(1);
          expect(Math.abs(corner.y)).toBeLessThan(1);
        }
    const closeUpWidth = camera.right - camera.left;
    fitPreviewCamera(camera, new THREE.Vector3(288, 288, 4), 0.65);
    expect(camera.right - camera.left).toBeGreaterThan(closeUpWidth * 2);
    expect(center.toArray()).toEqual([18, -12, 2]);
  });
  it('zooms in and out reversibly without changing the viewing angle or position', () => {
    const camera = new THREE.OrthographicCamera(-70, 70, 70, -70, 0.1, 1000);
    camera.position.set(...PREVIEW_CAMERA_POSITIONS.angle);
    camera.lookAt(0, 0, 0);
    const position = camera.position.clone();
    const rotation = camera.quaternion.clone();
    const initialProjection = camera.projectionMatrix.clone();
    zoomPreviewCamera(camera, 'in');
    expect(camera.zoom).toBeCloseTo(1.2);
    expect(camera.projectionMatrix.equals(initialProjection)).toBe(false);
    zoomPreviewCamera(camera, 'out');
    expect(camera.zoom).toBeCloseTo(1);
    expect(camera.position.equals(position)).toBe(true);
    expect(camera.quaternion.equals(rotation)).toBe(true);
  });

  it('clamps repeated zoom actions to the same limits as scroll and pinch zoom', () => {
    const camera = new THREE.OrthographicCamera();
    for (let i = 0; i < 100; i++) zoomPreviewCamera(camera, 'in');
    expect(camera.zoom).toBe(PREVIEW_ZOOM_LIMITS.max);
    for (let i = 0; i < 100; i++) zoomPreviewCamera(camera, 'out');
    expect(camera.zoom).toBe(PREVIEW_ZOOM_LIMITS.min);
  });

  it('defaults to a gentle front-facing tilt that reveals the top and left side', () => {
    expect(DEFAULT_PREVIEW_VIEW).toBe('angle');
    const position = new THREE.Vector3(
      ...PREVIEW_CAMERA_POSITIONS[DEFAULT_PREVIEW_VIEW],
    );
    expect(position.x).toBeLessThan(0);
    expect(position.y).toBeLessThan(0);
    const tilt = THREE.MathUtils.radToDeg(
      position.angleTo(new THREE.Vector3(0, 0, 1)),
    );
    expect(tilt).toBeGreaterThan(15);
    expect(tilt).toBeLessThan(30);
    expect(PREVIEW_CAMERA_POSITIONS.top).toEqual([0, 0, 240]);
  });

  it.each([
    { name: 'hinged dry-box card', size: [60, 88, 4] },
    { name: 'flat-front clip', size: [51.4, 15.01, 13.82] },
  ])(
    'fits all corners of the $name at either preset across viewport shapes',
    ({ size }) => {
      const dimensions = new THREE.Vector3(...size);
      const before = dimensions.toArray();
      for (const position of Object.values(PREVIEW_CAMERA_POSITIONS)) {
        for (const aspect of [0.5, 1.5, 4]) {
          const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
          camera.position.set(...position);
          camera.lookAt(0, 0, 0);
          fitPreviewCamera(camera, dimensions, aspect);
          expect(
            (camera.right - camera.left) / (camera.top - camera.bottom),
          ).toBeCloseTo(aspect);
          for (const x of [-1, 1]) {
            for (const y of [-1, 1]) {
              for (const z of [-1, 1]) {
                const corner = new THREE.Vector3(x, y, z)
                  .multiply(dimensions)
                  .multiplyScalar(0.5)
                  .project(camera);
                expect(Math.abs(corner.x)).toBeLessThanOrEqual(1 / 1.3 + 1e-9);
                expect(Math.abs(corner.y)).toBeLessThanOrEqual(1 / 1.3 + 1e-9);
                expect(Math.abs(corner.z)).toBeLessThan(1);
              }
            }
          }
          expect(dimensions.toArray()).toEqual(before);
        }
      }
    },
  );
});
