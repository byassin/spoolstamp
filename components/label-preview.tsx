'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Minus, Plus, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DesignId, Filament } from '@/lib/catalog';
import { buildConfiguredMeshes, type LabelMesh } from '@/lib/generate-3mf';
import { createPreviewBed, previewModelPosition } from '@/lib/preview-bed';
import { studioPrinterFor } from '@/lib/studio-project';
import type { PrintBed } from '@/lib/build-plate';
import {
  DEFAULT_PREVIEW_VIEW,
  CLIP_CLOSEUP_CAMERA_POSITION,
  PREVIEW_CAMERA_POSITIONS,
  PREVIEW_ZOOM_LIMITS,
  fitPreviewCamera,
  zoomPreviewCamera,
} from '@/lib/preview-camera';
import {
  createPreviewMaterial,
  geometryFromLabelMesh,
  setAppearanceCoordinates,
} from '@/lib/preview-geometry';

type View = 'top' | 'angle' | 'custom';
type Viewer = {
  printer: (name: string) => void;
  update: (parts: LabelMesh[], filament: Filament, design: DesignId) => void;
  view: (value: 'top' | 'angle') => void;
  zoom: (direction: 'in' | 'out') => void;
  frame: (value: 'label' | 'plate') => void;
  dispose: () => void;
};

export function LabelPreview({
  filament,
  design,
  printerName,
}: {
  filament: Filament;
  design: DesignId;
  printerName: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [pending, setPending] = useState(true);
  const [meshError, setMeshError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<View>(DEFAULT_PREVIEW_VIEW);
  const [zoom, setZoom] = useState(1);
  const [framing, setFraming] = useState<'label' | 'plate'>('label');

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      viewerRef.current = createViewer(
        hostRef.current,
        setView,
        setContextError,
        setZoom,
      );
      queueMicrotask(() => {
        setContextError(null);
        setFraming('label');
      });
    } catch {
      queueMicrotask(() =>
        setContextError(
          '3D preview is unavailable. You can still download the model.',
        ),
      );
    }
    return () => {
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
  }, [retry]);

  useEffect(() => {
    let active = true;
    try {
      viewerRef.current?.printer(printerName);
    } catch (cause) {
      queueMicrotask(() => {
        if (active)
          setContextError(
            cause instanceof Error
              ? cause.message
              : 'The printer bed could not be displayed.',
          );
      });
    }
    return () => {
      active = false;
    };
  }, [printerName, retry]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setPending(true);
        setMeshError(null);
      }
    });
    // Coalesce rapid keyboard selections before starting expensive CAD work.
    const timer = setTimeout(() => {
      void buildConfiguredMeshes(filament, design)
        .then((parts) => {
          if (!active) return;
          viewerRef.current?.update(parts, filament, design);
          setPending(false);
        })
        .catch((cause: unknown) => {
          if (!active) return;
          setPending(false);
          setMeshError(
            cause instanceof Error
              ? cause.message
              : 'The preview could not be prepared.',
          );
        });
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [filament, design, retry]);

  return (
    <>
      <div ref={hostRef} className="absolute inset-0 overflow-hidden" />
      <div className="preview-controls">
        <button
          type="button"
          aria-pressed={view === 'top'}
          onClick={() => viewerRef.current?.view('top')}
          title="Top view"
        >
          <Square size={14} />
          Top
        </button>
        <button
          type="button"
          aria-pressed={view === 'angle'}
          onClick={() => viewerRef.current?.view('angle')}
          title="Angled 3D view"
        >
          <Box size={14} />
          3D
        </button>
        <span className="preview-control-divider" />
        {(['label', 'plate'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={framing === value}
            onClick={() => {
              setFraming(value);
              viewerRef.current?.frame(value);
            }}
          >
            {value === 'label' ? 'Fit label' : 'Full plate'}
          </button>
        ))}
      </div>
      <fieldset
        className="preview-controls preview-zoom-controls"
        aria-label="Preview zoom"
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => viewerRef.current?.zoom('out')}
          disabled={
            pending ||
            !!meshError ||
            !!contextError ||
            zoom <= PREVIEW_ZOOM_LIMITS.min
          }
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus size={18} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => viewerRef.current?.zoom('in')}
          disabled={
            pending ||
            !!meshError ||
            !!contextError ||
            zoom >= PREVIEW_ZOOM_LIMITS.max
          }
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus size={18} />
        </Button>
      </fieldset>
      {pending && !contextError && (
        <output className="preview-status" aria-live="polite">
          Updating preview…
        </output>
      )}
      {(meshError || contextError) && (
        <div className="preview-error" role="alert">
          <p>{meshError || contextError}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry preview
          </button>
        </div>
      )}
    </>
  );
}

function createViewer(
  host: HTMLDivElement,
  onView: (view: View) => void,
  onError: (message: string | null) => void,
  onZoom: (zoom: number) => void,
): Viewer {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-70, 70, 70, -70, 0.1, 1000);
  camera.position.set(...PREVIEW_CAMERA_POSITIONS[DEFAULT_PREVIEW_VIEW]);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    '3D label. Drag to rotate, scroll to zoom, or use arrow keys and plus or minus.',
  );
  host.appendChild(canvas);
  const controls = new OrbitControls(camera, canvas);
  canvas.style.touchAction = 'pan-y';
  controls.enablePan = false;
  controls.minZoom = PREVIEW_ZOOM_LIMITS.min;
  controls.maxZoom = PREVIEW_ZOOM_LIMITS.max;
  const model = new THREE.Group();
  scene.add(model);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x606a63, 1));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-180, -160, 400);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -260,
    right: 260,
    top: 260,
    bottom: -260,
    near: 1,
    far: 800,
  });
  key.shadow.normalBias = 0.04;
  key.shadow.bias = -0.0001;
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(80, 60, 100);
  scene.add(fill);
  let plate: ReturnType<typeof createPreviewBed> | null = null;
  let currentBed: PrintBed | null = null;
  let currentPrinter: string | null = null;
  let currentParts: LabelMesh[] | null = null;
  const geometryCache = new Map<number[], THREE.BufferGeometry>();
  const dimensions = new THREE.Vector3(288, 288, 4);
  const labelDimensions = new THREE.Vector3(90, 100, 10);
  const labelCenter = new THREE.Vector3();
  let framing: 'label' | 'plate' = 'label';
  let modelHeight = 4;
  let currentDesign: DesignId | null = null;
  let lost = false;
  const render = () => {
    plate?.updateView(camera);
    onZoom(camera.zoom);
    if (!lost) renderer.render(scene, camera);
  };
  const resize = () => {
    const rect = host.getBoundingClientRect();
    const width = Math.max(rect.width, 1),
      height = Math.max(rect.height, 1);
    const aspect = width / height;
    fitPreviewCamera(
      camera,
      framing === 'label' ? labelDimensions : dimensions,
      aspect,
    );
    renderer.setSize(width, height, false);
    render();
  };
  const setView = (value: 'top' | 'angle') => {
    const clipCloseup =
      value === 'angle' &&
      currentDesign === 'clip-label' &&
      framing === 'label';
    camera.up.set(0, clipCloseup ? 0 : 1, clipCloseup ? 1 : 0);
    const position = clipCloseup
      ? CLIP_CLOSEUP_CAMERA_POSITION
      : PREVIEW_CAMERA_POSITIONS[value];
    camera.position.set(position[0], position[1], position[2]);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.target.copy(
      framing === 'label' ? labelCenter : new THREE.Vector3(),
    );
    camera.position.add(controls.target);
    controls.update();
    onView(value);
    resize();
  };
  const orbit = () => onView('custom');
  const zoom = (direction: 'in' | 'out') => {
    zoomPreviewCamera(camera, direction);
    controls.update();
    render();
  };
  const keydown = (event: KeyboardEvent) => {
    if (
      ![
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        '+',
        '=',
        '-',
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    if (['+', '=', '-'].includes(event.key)) {
      zoom(event.key === '-' ? 'out' : 'in');
      return;
    } else {
      const horizontal =
        event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const sign =
        event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 1 : -1;
      camera.position
        .sub(controls.target)
        .applyAxisAngle(
          new THREE.Vector3(horizontal ? 0 : 1, horizontal ? 1 : 0, 0),
          (sign * Math.PI) / 24,
        )
        .add(controls.target);
      onView('custom');
    }
    camera.updateProjectionMatrix();
    controls.update();
    render();
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    onError(
      'The 3D connection was interrupted. Retry the preview, or download the model.',
    );
  };
  const contextRestored = () => {
    lost = false;
    onError(null);
    render();
  };
  canvas.addEventListener('keydown', keydown);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  controls.addEventListener('start', orbit);
  controls.addEventListener('change', render);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const clearMaterials = () => {
    for (const child of model.children) {
      const material = (child as THREE.Mesh)
        .material as THREE.MeshStandardMaterial;
      material.map?.dispose();
      material.dispose();
    }
    model.clear();
  };
  return {
    printer(name) {
      if (name === currentPrinter) return;
      const bed = studioPrinterFor(name);
      const nextPlate = createPreviewBed(bed, name.replace(/^Bambu Lab /, ''));
      plate?.dispose();
      plate = nextPlate;
      currentBed = bed;
      currentPrinter = name;
      scene.add(plate.group);
      dimensions.copy(plate.dimensions);
      dimensions.z = modelHeight;
      if (currentParts) {
        const position = previewModelPosition(currentParts, bed);
        labelCenter.add(position.clone().sub(model.position));
        model.position.copy(position);
      }
      setView(DEFAULT_PREVIEW_VIEW);
    },
    view: setView,
    zoom,
    frame(value) {
      framing = value;
      setView(DEFAULT_PREVIEW_VIEW);
    },
    update(parts, filament, design) {
      if (!currentBed)
        throw new Error('Select a printer to display its build plate.');
      const position = previewModelPosition(parts, currentBed);
      const bounds = new THREE.Box3();
      const point = new THREE.Vector3();
      const used = new Set<number[]>();
      for (const part of parts) {
        used.add(part.vertices);
        if (!geometryCache.has(part.vertices))
          geometryCache.set(
            part.vertices,
            geometryFromLabelMesh(part, design === 'clip-label' ? 'y' : 'z'),
          );
        for (let index = 0; index < part.vertices.length; index += 3)
          bounds.expandByPoint(point.fromArray(part.vertices, index));
      }
      // Retain structural buffers across color changes. Old text and shapes
      // are released as soon as the replacement is ready.
      clearMaterials();
      for (const [vertices, geometry] of geometryCache)
        if (!used.has(vertices)) {
          geometry.dispose();
          geometryCache.delete(vertices);
        }
      for (const part of parts) {
        const geometry = geometryCache.get(part.vertices)!;
        if (part.materialRole === 'structure' && filament.colors.length > 1)
          setAppearanceCoordinates(
            geometry,
            bounds,
            filament.colorType,
            design === 'clip-label' ? 'z' : 'y',
          );
        const mesh = new THREE.Mesh(
          geometry,
          createPreviewMaterial(part, filament),
        );
        mesh.name = part.name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        model.add(mesh);
      }
      model.position.copy(position);
      bounds.getSize(labelDimensions).multiplyScalar(1.25);
      bounds.getCenter(labelCenter).add(position);
      currentParts = parts;
      // Both framing modes retain the original print orientation and bed contact.
      modelHeight = Math.max(4, (bounds.max.z - bounds.min.z) * 2 + 4);
      dimensions.z = modelHeight;
      if (currentDesign !== design) {
        currentDesign = design;
        setView(DEFAULT_PREVIEW_VIEW);
      }
      resize();
    },
    dispose() {
      observer.disconnect();
      controls.removeEventListener('start', orbit);
      controls.removeEventListener('change', render);
      controls.dispose();
      canvas.removeEventListener('keydown', keydown);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      clearMaterials();
      geometryCache.forEach((geometry) => geometry.dispose());
      geometryCache.clear();
      plate?.dispose();
      key.shadow.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
