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
  stamp: 'stempel',
  cutterStamp: 'cutter-stempel',
};

function slugify(sourceFileName: string): string {
  const base = sourceFileName.replace(/\.[^.]*$/, '');
  return (
    base
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'vorm'
  );
}

/** `maak-cookie-cutter-hart.stl` op basis van de oorspronkelijke bestandsnaam. */
export function stlFileName(generator: GeneratorType, sourceFileName: string): string {
  return `maak-${GENERATOR_SLUG[generator]}-${slugify(sourceFileName)}.stl`;
}

/** Twee bestandsnamen voor Cutter & Stempel: `maak-cutter-stempel-cutter-hart.stl` / `...-stempel-hart.stl`. */
export function comboStlFileNames(sourceFileName: string): { cutter: string; stamp: string } {
  const slug = slugify(sourceFileName);
  return {
    cutter: `maak-cutter-stempel-cutter-${slug}.stl`,
    stamp: `maak-cutter-stempel-stempel-${slug}.stl`,
  };
}
