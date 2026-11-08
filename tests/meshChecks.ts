/** Gedeelde geometrische controles voor de generatortests. */
import { expect } from 'vitest';
import { ringBounds } from '../src/engine/geometry2d';
import { validateMesh } from '../src/engine/meshValidation';
import { FaceTag, type MeshData, type Point2, type ValidatedContour } from '../src/engine/types';
import { distanceToRing } from './helpers';

export const EPS = 1e-6;

export function expectValidSolid(mesh: MeshData, height: number): void {
  const r = validateMesh(mesh);
  expect(r.problems).toEqual([]);
  expect(r.valid).toBe(true);
  expect(r.components).toBe(1);
  expect(r.nonManifoldEdges).toBe(0);
  expect(r.inconsistentEdges).toBe(0);
  expect(r.degenerateTriangles).toBe(0);
  expect(r.volumeMm3).toBeGreaterThan(0);
  expect(r.bounds.min[2]).toBeCloseTo(0, 9);
  expect(r.bounds.max[2]).toBeCloseTo(height, 9);
  for (const v of mesh.positions) expect(Number.isFinite(v)).toBe(true);
}

/** Alle vertices binnen een Z-bereik, als 2D-punten. */
export function pointsAt(mesh: MeshData, zMin: number, zMax = zMin): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const z = mesh.positions[i + 2];
    if (z >= zMin - EPS && z <= zMax + EPS) out.push({ x: mesh.positions[i], y: mesh.positions[i + 1] });
  }
  return out;
}

/** Vertices van driehoeken met een bepaalde FaceTag. */
export function taggedPoints(mesh: MeshData, tag: FaceTag, z?: number): Point2[] {
  const seen = new Set<number>();
  const out: Point2[] = [];
  for (let t = 0; t < mesh.faceTags.length; t++) {
    if (mesh.faceTags[t] !== tag) continue;
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[t * 3 + k];
      if (seen.has(v)) continue;
      seen.add(v);
      if (z !== undefined && Math.abs(mesh.positions[v * 3 + 2] - z) > EPS) continue;
      out.push({ x: mesh.positions[v * 3], y: mesh.positions[v * 3 + 1] });
    }
  }
  return out;
}

export function expectBoundsOf(points: Point2[], contour: ValidatedContour, grow: number, tol = 0.01): void {
  const b = ringBounds(points);
  const c = ringBounds(contour.outer);
  expect(Math.abs(b.minX - (c.minX - grow))).toBeLessThan(tol);
  expect(Math.abs(b.maxX - (c.maxX + grow))).toBeLessThan(tol);
  expect(Math.abs(b.minY - (c.minY - grow))).toBeLessThan(tol);
  expect(Math.abs(b.maxY - (c.maxY + grow))).toBeLessThan(tol);
}

/** Alle binnenwandpunten liggen op `thickness` mm van de buitencontour. */
export function expectWallThickness(inner: Point2[], contour: ValidatedContour, thickness: number): void {
  expect(inner.length).toBeGreaterThan(2);
  let min = Infinity;
  let max = 0;
  for (const p of inner) {
    const d = distanceToRing(p, contour.outer);
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  expect(min).toBeGreaterThan(thickness - 0.015);
  expect(max).toBeLessThan(thickness + 0.015);
}

/** Ligt punt p (2D) binnen een driehoek van de mesh op hoogte z? */
export function coveredAt(mesh: MeshData, p: Point2, z: number): boolean {
  const P = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t] * 3, mesh.indices[t + 1] * 3, mesh.indices[t + 2] * 3];
    if (Math.abs(P[a + 2] - z) > EPS || Math.abs(P[b + 2] - z) > EPS || Math.abs(P[c + 2] - z) > EPS) continue;
    const s = (q: number, r: number) => (P[r] - P[q]) * (p.y - P[q + 1]) - (P[r + 1] - P[q + 1]) * (p.x - P[q]);
    const d1 = s(a, b);
    const d2 = s(b, c);
    const d3 = s(c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return true;
  }
  return false;
}
