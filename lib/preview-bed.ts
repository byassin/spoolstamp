import * as THREE from 'three';
import {
  placeAssemblyOnBed,
  printBedLayout,
  type PrintBed,
} from './build-plate';
import type { LabelMesh } from './generate-3mf';

const RIM = 16;

export function previewModelPosition(
  parts: Pick<LabelMesh, 'vertices'>[],
  bed: PrintBed,
) {
  const { bounds } = printBedLayout(bed);
  const { translation } = placeAssemblyOnBed(parts, bed);
  return new THREE.Vector3(
    translation[0] - (bounds.minX + bounds.maxX) / 2,
    translation[1] - (bounds.minY + bounds.maxY) / 2,
    translation[2],
  );
}

function label(text: string, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#c4cbc7';
  context.font = '600 44px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 512, 32, 990);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.name = text;
  return mesh;
}

/** Preview-only geometry, millimetres throughout. Never included in the 3MF. */
export function createPreviewBed(bed: PrintBed, printerName: string) {
  const layout = printBedLayout(bed);
  const { bounds } = layout;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxY - bounds.minY;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const group = new THREE.Group();
  group.name = `${printerName} print bed`;

  // Rounded outer sheet and a precise, rectangular printable boundary inside.
  const x = width / 2 + 6,
    y = depth / 2 + RIM,
    r = 5;
  const shape = new THREE.Shape();
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  const sheet = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: 2,
      bevelEnabled: false,
      curveSegments: 8,
    }),
    new THREE.MeshStandardMaterial({
      color: '#303633',
      roughness: 0.85,
      metalness: 0.25,
    }),
  );
  sheet.position.z = -2.1;
  sheet.receiveShadow = true;
  group.add(sheet);
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({
      color: '#4b514e',
      roughness: 0.95,
      metalness: 0.05,
    }),
  );
  surface.name = 'Printable area';
  surface.position.z = -0.08;
  surface.receiveShadow = true;
  group.add(surface);

  function lines(points: number[], color: string, opacity = 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(points, 3),
    );
    const mesh = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
    );
    group.add(mesh);
    return mesh;
  }
  const minor: number[] = [],
    major: number[] = [];
  for (let gx = Math.ceil(bounds.minX / 10) * 10; gx <= bounds.maxX; gx += 10)
    (gx % 50 === 0 ? major : minor).push(
      gx - cx,
      -depth / 2,
      -0.06,
      gx - cx,
      depth / 2,
      -0.06,
    );
  for (let gy = Math.ceil(bounds.minY / 10) * 10; gy <= bounds.maxY; gy += 10)
    (gy % 50 === 0 ? major : minor).push(
      -width / 2,
      gy - cy,
      -0.06,
      width / 2,
      gy - cy,
      -0.06,
    );
  const minorGrid = lines(minor, '#7b8580', 0.35);
  minorGrid.name = '10 mm grid';
  const majorGrid = lines(major, '#a0aaa4', 0.5);
  majorGrid.name = '50 mm grid';
  const boundary = lines(
    [
      -width / 2,
      -depth / 2,
      -0.05,
      width / 2,
      -depth / 2,
      -0.05,
      width / 2,
      -depth / 2,
      -0.05,
      width / 2,
      depth / 2,
      -0.05,
      width / 2,
      depth / 2,
      -0.05,
      -width / 2,
      depth / 2,
      -0.05,
      -width / 2,
      depth / 2,
      -0.05,
      -width / 2,
      -depth / 2,
      -0.05,
    ],
    '#bdc5bf',
  );
  boundary.name = 'Printable boundary';

  for (const zone of layout.restricted) {
    const zw = zone.maxX - zone.minX,
      zh = zone.maxY - zone.minY;
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(zw, zh),
      new THREE.MeshBasicMaterial({
        color: zone.kind === 'excluded' ? '#d3a065' : '#aeb6b1',
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      }),
    );
    overlay.name =
      zone.kind === 'excluded' ? 'Keep-out area' : 'Single-nozzle area';
    overlay.position.set(
      (zone.minX + zone.maxX) / 2 - cx,
      (zone.minY + zone.maxY) / 2 - cy,
      -0.04,
    );
    group.add(overlay);
    // Hatch within the exact clipped rectangle, including partial edge stripes.
    const hatch: number[] = [];
    for (let offset = -zh; offset <= zw; offset += 6) {
      const startY = Math.max(0, -offset),
        endY = Math.min(zh, zw - offset);
      if (endY <= startY) continue;
      hatch.push(
        zone.minX - cx + offset + startY,
        zone.minY - cy + startY,
        -0.03,
        zone.minX - cx + offset + endY,
        zone.minY - cy + endY,
        -0.03,
      );
    }
    lines(hatch, zone.kind === 'excluded' ? '#d3a065' : '#c0c8c3', 0.4);
    if (zw >= 15 && zh >= 100) {
      const text = label(overlay.name, Math.min(zh * 0.75, 130), 8);
      if (text) {
        text.position.copy(overlay.position);
        text.position.z = -0.02;
        text.rotation.z = Math.PI / 2;
        group.add(text);
      }
    }
  }
  const title = label(
    `${printerName} · TEXTURED PEI`,
    Math.min(width * 0.85, 220),
    11,
  );
  const size = label(
    `${width} × ${depth} mm · 10 mm grid`,
    Math.min(width * 0.75, 190),
    9,
  );
  if (title) {
    title.position.set(0, depth / 2 + RIM / 2, -0.06);
    group.add(title);
  }
  if (size) {
    size.position.set(0, -depth / 2 - RIM / 2, -0.06);
    group.add(size);
  }
  // Origin accents are deliberately small; the geometry itself provides scale.
  lines(
    [-width / 2, -depth / 2, -0.02, -width / 2 + 15, -depth / 2, -0.02],
    '#d97272',
  );
  lines(
    [-width / 2, -depth / 2, -0.02, -width / 2, -depth / 2 + 15, -0.02],
    '#74b98b',
  );

  const viewDirection = new THREE.Vector3();
  const undersideLines = new Set<THREE.Object3D>([
    minorGrid,
    majorGrid,
    boundary,
  ]);
  return {
    group,
    dimensions: new THREE.Vector3(width + 12, depth + RIM * 2, 4),
    updateView(camera: THREE.Camera) {
      // Keep the checker grid and boundary as a scale reference from below,
      // while hiding the solid sheet, rim, labels and restricted-area shading.
      camera.getWorldDirection(viewDirection);
      const above = viewDirection.z < -1e-6;
      for (const child of group.children)
        child.visible = above || undersideLines.has(child);
    },
    dispose() {
      group.traverse((object) => {
        if (
          !(
            object instanceof THREE.Mesh || object instanceof THREE.LineSegments
          )
        )
          return;
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if ('map' in material)
            (material.map as THREE.Texture | null)?.dispose();
          material.dispose();
        }
      });
      group.removeFromParent();
    },
  };
}
