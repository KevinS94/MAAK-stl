/**
 * Binary STL-export via de officiële Three.js STLExporter. Eenheden zijn mm,
 * Z is omhoog en de onderkant ligt op Z = 0.
 */
import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { GeneratorType, MeshData } from './types';

/** Zet de engine-mesh om naar een Three.js BufferGeometry (dezelfde data voor preview en export). */
export function meshToBufferGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(mesh.positions), 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(mesh.indices), 1));
  return geometry;
}

/** Binary STL als ArrayBuffer. */
export function exportBinaryStl(mesh: MeshData): ArrayBuffer {
  const geometry = meshToBufferGeometry(mesh);
  try {
    const object = new Mesh(geometry);
    object.updateMatrixWorld(true);
    const view = new STLExporter().parse(object, { binary: true }) as DataView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  } finally {
    geometry.dispose();
  }
}

const GENERATOR_SLUG: Record<GeneratorType, string> = {
  cookieCutter: 'cookie-cutter',
  fillingMold: 'vulvorm',
};

/** `maak-cookie-cutter-hart.stl` op basis van de oorspronkelijke bestandsnaam. */
export function stlFileName(generator: GeneratorType, sourceFileName: string): string {
  const base = sourceFileName.replace(/\.[^.]*$/, '');
  const slug = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `maak-${GENERATOR_SLUG[generator]}-${slug || 'vorm'}.stl`;
}
