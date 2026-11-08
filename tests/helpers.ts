import { buildContourOrThrow } from '../src/engine/contourProcessing';
import { parseSvgOrThrow } from '../src/engine/svgParser';
import type { FrameSizeMm, MeshData, ValidatedContour } from '../src/engine/types';

export const BASIC: FrameSizeMm = { length: 100, width: 100 };

export function contourOf(svg: string, frame: FrameSizeMm = BASIC): ValidatedContour {
  return buildContourOrThrow(parseSvgOrThrow(svg), frame);
}

/** Leest een binary STL in en levert een geïndexeerde mesh op exacte float32-posities. */
export function parseBinaryStl(buffer: ArrayBuffer): { mesh: MeshData; triangleCount: number; normals: Float32Array } {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  if (buffer.byteLength !== 84 + count * 50) throw new Error('Ongeldige STL-lengte');
  const positions = new Float64Array(count * 9);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = 84 + i * 50;
    for (let k = 0; k < 3; k++) normals[i * 3 + k] = view.getFloat32(o + k * 4, true);
    for (let v = 0; v < 9; v++) positions[i * 9 + v] = view.getFloat32(o + 12 + v * 4, true);
  }
  const indices = new Uint32Array(count * 3).map((_, i) => i);
  return { mesh: { positions, indices, faceTags: new Uint8Array(count) }, triangleCount: count, normals };
}

/** Minimale afstand van punt tot een gesloten ring. */
export function distanceToRing(p: { x: number; y: number }, ring: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return best;
}
