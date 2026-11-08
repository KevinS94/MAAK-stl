/**
 * Geometrische validatie van een driehoeksmesh, zoals een slicer die ziet:
 * vertices worden op positie samengevoegd (zoals in een STL-bestand), en
 * daarna worden geslotenheid, manifoldness, oriëntatie, samenhang, volume
 * en gedegenereerde driehoeken gecontroleerd.
 */
import type { Bounds3, MeshData, MeshReport } from './types';

export interface ValidationOptions {
  /** Afstand (mm) waaronder vertices als hetzelfde punt gelden. */
  weldTolerance?: number;
  /** Minimale driehoeksoppervlakte (mm²). */
  minTriangleArea?: number;
}

/** Voegt vertices met (bijna) dezelfde positie samen. Geeft per vertex het nieuwe id. */
export function weldVertices(positions: ArrayLike<number>, tolerance: number): Uint32Array {
  const map = new Map<string, number>();
  const n = positions.length / 3;
  const ids = new Uint32Array(n);
  const inv = 1 / tolerance;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(positions[i * 3] * inv)},${Math.round(positions[i * 3 + 1] * inv)},${Math.round(positions[i * 3 + 2] * inv)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = next++;
      map.set(key, id);
    }
    ids[i] = id;
  }
  return ids;
}

function find(parent: Uint32Array, x: number): number {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]];
    x = parent[x];
  }
  return x;
}

export function computeBounds(positions: ArrayLike<number>): Bounds3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** Volume via de divergentiestelling (positief bij naar buiten gerichte normalen). */
export function signedVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

export function validateMesh(mesh: Pick<MeshData, 'positions' | 'indices'>, options: ValidationOptions = {}): MeshReport {
  const weldTolerance = options.weldTolerance ?? 1e-5;
  const minArea = options.minTriangleArea ?? 1e-9;
  const { positions, indices } = mesh;
  const problems: string[] = [];

  let finite = true;
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      finite = false;
      break;
    }
  }
  if (!finite) problems.push('Mesh bevat ongeldige (NaN of oneindige) coördinaten.');

  const triCount = indices.length / 3;
  if (!Number.isInteger(triCount) || triCount === 0) problems.push('Mesh bevat geen geldige driehoeken.');

  const ids = weldVertices(positions, weldTolerance);
  let vertexCount = 0;
  for (let i = 0; i < ids.length; i++) vertexCount = Math.max(vertexCount, ids[i] + 1);

  let degenerate = 0;
  // Gerichte randen: sleutel "a,b" -> aantal. Ongerichte randen -> lijst van driehoeken.
  const directed = new Map<string, number>();
  const undirected = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const v = [ids[indices[t * 3]], ids[indices[t * 3 + 1]], ids[indices[t * 3 + 2]]];
    const p = [indices[t * 3] * 3, indices[t * 3 + 1] * 3, indices[t * 3 + 2] * 3];
    const ux = positions[p[1]] - positions[p[0]];
    const uy = positions[p[1] + 1] - positions[p[0] + 1];
    const uz = positions[p[1] + 2] - positions[p[0] + 2];
    const wx = positions[p[2]] - positions[p[0]];
    const wy = positions[p[2] + 1] - positions[p[0] + 1];
    const wz = positions[p[2] + 2] - positions[p[0] + 2];
    const cx = uy * wz - uz * wy;
    const cy = uz * wx - ux * wz;
    const cz = ux * wy - uy * wx;
    const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2] || !(area > minArea)) degenerate++;
    for (let k = 0; k < 3; k++) {
      const a = v[k];
      const b = v[(k + 1) % 3];
      const dk = `${a},${b}`;
      directed.set(dk, (directed.get(dk) ?? 0) + 1);
      const uk = a < b ? `${a},${b}` : `${b},${a}`;
      let list = undirected.get(uk);
      if (!list) {
        list = [];
        undirected.set(uk, list);
      }
      list.push(t);
    }
  }

  let nonManifold = 0;
  let inconsistent = 0;
  const parent = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  for (const [key, tris] of undirected) {
    if (tris.length !== 2) {
      nonManifold++;
      continue;
    }
    const [a, b] = key.split(',');
    if (directed.get(`${a},${b}`) !== 1 || directed.get(`${b},${a}`) !== 1) inconsistent++;
    const ra = find(parent, tris[0]);
    const rb = find(parent, tris[1]);
    if (ra !== rb) parent[ra] = rb;
  }
  let components = 0;
  for (let i = 0; i < triCount; i++) if (find(parent, i) === i) components++;

  const volume = signedVolume(positions, indices);
  const bounds = computeBounds(positions);

  if (degenerate > 0) problems.push(`${degenerate} gedegenereerde driehoek(en).`);
  if (nonManifold > 0) problems.push(`${nonManifold} rand(en) horen niet bij precies twee driehoeken (mesh niet gesloten of niet manifold).`);
  if (inconsistent > 0) problems.push(`${inconsistent} rand(en) met inconsistente driehoeksoriëntatie.`);
  if (components !== 1) problems.push(`Mesh bestaat uit ${components} losse delen in plaats van één.`);
  if (!(volume > 0)) problems.push('Mesh heeft geen positief volume (verkeerde oriëntatie).');

  return {
    valid: problems.length === 0,
    problems,
    vertexCount,
    triangleCount: triCount,
    volumeMm3: volume,
    bounds,
    components,
    nonManifoldEdges: nonManifold,
    inconsistentEdges: inconsistent,
    degenerateTriangles: degenerate,
  };
}
