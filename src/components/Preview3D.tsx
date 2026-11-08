import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FaceTag, type MeshData } from '../engine/types';

interface Preview3DProps {
  mesh: MeshData;
}

const COLORS = {
  background: 0xf6f6f4,
  outer: 0xf26b1d,
  inner: 0xc2541a,
  cap: 0xf7894a,
  grid: 0xdedcd8,
  gridCenter: 0xcfccc6,
};

/**
 * Zet de engine-mesh om naar een niet-geïndexeerde geometrie met harde
 * randen (vlakke normalen) en materiaalgroepen per soort oppervlak. De
 * posities zijn exact dezelfde als in de STL-export.
 */
function buildPreviewGeometry(mesh: MeshData): BufferGeometry {
  const triCount = mesh.indices.length / 3;
  const order = [FaceTag.Outer, FaceTag.Inner, FaceTag.Cap];
  const positions = new Float32Array(triCount * 9);
  const geometry = new BufferGeometry();
  let cursor = 0;
  for (let gi = 0; gi < order.length; gi++) {
    const start = cursor;
    for (let t = 0; t < triCount; t++) {
      if (mesh.faceTags[t] !== order[gi]) continue;
      for (let k = 0; k < 3; k++) {
        const v = mesh.indices[t * 3 + k] * 3;
        positions[cursor * 3] = mesh.positions[v];
        positions[cursor * 3 + 1] = mesh.positions[v + 1];
        positions[cursor * 3 + 2] = mesh.positions[v + 2];
        cursor++;
      }
    }
    if (cursor > start) geometry.addGroup(start, cursor - start, gi);
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Verwijdert alle kinderen en ruimt hun geometrie (en eigen materialen) op. */
function clearGroup(root: Group): void {
  for (const child of [...root.children]) {
    root.remove(child);
    if (child instanceof Mesh) child.geometry.dispose(); // materialen worden gedeeld en apart opgeruimd
    if (child instanceof GridHelper) {
      child.geometry.dispose();
      (child.material as Material).dispose();
    }
  }
}

interface Viewer {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  root: Group;
  materials: MeshStandardMaterial[];
  render: () => void;
}

export function Preview3D({ mesh }: Preview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [supported] = useState(webglAvailable);

  // Eenmalige opbouw van renderer, scène en besturing.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !supported) return;

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(COLORS.background);
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '3D-preview van het model. Sleep om te draaien, scroll of knijp om te zoomen.');
    renderer.domElement.setAttribute('role', 'img');

    const scene = new Scene();
    scene.background = new Color(COLORS.background);
    const camera = new PerspectiveCamera(35, 1, 0.1, 5000);

    scene.add(new HemisphereLight(0xffffff, 0xe9e4dc, 1.4));
    scene.add(new AmbientLight(0xffffff, 0.25));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 2, 1.5);
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1.5, 0.8, -1);
    scene.add(fill);

    const root = new Group();
    scene.add(root);

    const materials = [COLORS.outer, COLORS.inner, COLORS.cap].map(
      (color) => new MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02 }),
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.rotateSpeed = 0.9;

    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);

    const resize = () => {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    viewerRef.current = { renderer, scene, camera, controls, root, materials, render };

    return () => {
      ro.disconnect();
      controls.removeEventListener('change', render);
      controls.dispose();
      clearGroup(root);
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      viewerRef.current = null;
    };
  }, [supported]);

  // Model vervangen bij elke nieuwe mesh; oude geometrie wordt opgeruimd.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const { root, materials, camera, controls, render } = viewer;

    clearGroup(root);

    const geometry = buildPreviewGeometry(mesh);
    const object = new Mesh(geometry, materials);
    // Engine en STL gebruiken Z omhoog; Three.js toont Y omhoog.
    object.rotation.x = -Math.PI / 2;
    root.add(object);

    const sphere = geometry.boundingSphere ?? new Sphere(new Vector3(), 50);
    const radius = Math.max(sphere.radius, 1);
    const size = Math.ceil((radius * 2.6) / 10) * 10;
    const grid = new GridHelper(size, size / 5, COLORS.gridCenter, COLORS.grid);
    grid.position.y = -0.01;
    root.add(grid);

    // Centreren en passend in beeld brengen.
    const center = new Vector3(sphere.center.x, sphere.center.z, -sphere.center.y);
    const fov = (camera.fov * Math.PI) / 180;
    const fitHeight = radius / Math.sin(fov / 2);
    const fitWidth = fitHeight / Math.min(camera.aspect, 1);
    const distance = Math.max(fitHeight, fitWidth) * 1.05;
    const dir = new Vector3(0.55, 0.75, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, distance);
    camera.near = distance / 100;
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.minDistance = radius * 0.8;
    controls.maxDistance = distance * 4;
    controls.update();
    render();
  }, [mesh]);

  if (!supported) {
    return (
      <div className="preview3d preview3d--fallback">
        <p>De 3D-preview wordt niet ondersteund door deze browser. Je kunt de STL wel downloaden.</p>
      </div>
    );
  }
  return (
    <div className="preview3d" ref={containerRef}>
      <p className="preview3d__hint" aria-hidden="true">
        Sleep om te draaien · scroll of knijp om te zoomen
      </p>
    </div>
  );
}
