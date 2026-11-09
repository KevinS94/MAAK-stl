import { buildContourOrThrow } from '../src/engine/contourProcessing';
import { parseSvgOrThrow, parseSvgSceneOrThrow } from '../src/engine/svgParser';
import { buildSelectionOrThrow, defaultRoles, extractPathCandidates, type ContourSelection, type Granularity } from '../src/engine/svgPaths';
import type { FrameSizeMm, MeshData, PathInterpretation, PathRole, SvgPathCandidate, ValidatedContour } from '../src/engine/types';

export const BASIC: FrameSizeMm = { length: 100, width: 100 };

export function contourOf(svg: string, frame: FrameSizeMm = BASIC): ValidatedContour {
  return buildContourOrThrow(parseSvgOrThrow(svg), frame);
}

/** Alle selecteerbare onderdelen van een SVG (stap A + B), met voorgestelde rollen. */
export function candidatesOf(svg: string, frame: FrameSizeMm = BASIC, granularity: Granularity = 'shapes'): SvgPathCandidate[] {
  return extractPathCandidates(parseSvgSceneOrThrow(svg), frame, granularity);
}

/**
 * Bouwt een volledige padselectie (buitencontour + uitgelijnde details) uit
 * een SVG met meerdere vectorpaden/open lijnen, met de automatisch
 * voorgestelde rollen, of een aangepaste roltoewijzing via `roleOf`.
 */
export function selectionOf(
  svg: string,
  frame: FrameSizeMm = BASIC,
  roleOf?: (candidate: SvgPathCandidate) => PathRole,
  granularity: Granularity = 'shapes',
  options: SelectionTestOptions = {},
): ContourSelection {
  const candidates = candidatesOf(svg, frame, granularity);
  const roles = roleOf ? Object.fromEntries(candidates.map((c) => [c.id, roleOf(c)])) : defaultRoles(candidates);
  const interpretations: Record<string, PathInterpretation> = {};
  if (options.interpretation) {
    for (const c of candidates) {
      const i = options.interpretation(c);
      if (i) interpretations[c.id] = i;
    }
  }
  return buildSelectionOrThrow(candidates, roles, frame, [], { interpretations, shapeThicknessMm: options.shapeThicknessMm });
}

export interface SelectionTestOptions {
  /** Expliciete interpretatie per onderdeel (undefined = voorstel). */
  interpretation?: (candidate: SvgPathCandidate) => PathInterpretation | undefined;
  shapeThicknessMm?: number;
}

/** Interpreteer alle gevulde onderdelen als gesloten vorm (het gedrag van vóór de middellijnen). */
export const ALL_SHAPES: SelectionTestOptions = { interpretation: (c) => (c.kind === 'region' ? 'shape' : undefined) };

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
