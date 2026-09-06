import * as THREE from 'three';

export const DEFAULT_PREVIEW_VIEW = 'angle' as const;
export const PREVIEW_ZOOM_LIMITS = { min: 0.5, max: 4 } as const;

/** Shared button/keyboard zoom; preserve the viewing angle and model position. */
export function zoomPreviewCamera(
  camera: THREE.OrthographicCamera,
  direction: 'in' | 'out',
) {
  camera.zoom = THREE.MathUtils.clamp(
    camera.zoom * (direction === 'in' ? 1.2 : 1 / 1.2),
    PREVIEW_ZOOM_LIMITS.min,
    PREVIEW_ZOOM_LIMITS.max,
  );
  camera.updateProjectionMatrix();
}

// Look from the front-left of the bed, revealing the clip's -Y-facing text.
export const PREVIEW_CAMERA_POSITIONS = {
  top: [0, 0, 240],
  angle: [-75, -95, 240],
} satisfies Record<string, [number, number, number]>;

// The clip's lettering faces -Y, unlike the hinged card's +Z label face.
export const CLIP_CLOSEUP_CAMERA_POSITION = [-55, -240, 95] as const;

/** Fit the displayed bounding box, including depth at the current view angle. */
export function fitPreviewCamera(
  camera: THREE.OrthographicCamera,
  dimensions: THREE.Vector3,
  aspect: number,
) {
  camera.updateMatrixWorld(true);
  const projected = new THREE.Box3(
    dimensions.clone().multiplyScalar(-0.5),
    dimensions.clone().multiplyScalar(0.5),
  ).applyMatrix4(camera.matrixWorldInverse);
  const size = projected.getSize(new THREE.Vector3());
  const viewHeight = Math.max(size.y, size.x / aspect, 1) * 1.3;
  camera.left = (-viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
}
