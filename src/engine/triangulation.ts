/**
 * Triangulatie van polygonen (met gaten).
 *
 * Primair wordt Earcut (Three.js) gebruikt. Wanneer punten van
 * verschillende ringen toevallig op één lijn liggen, kan Earcut een driehoek
 * met nul oppervlak opleveren; die wordt lokaal hersteld door de buurdriehoek
 * op dat punt te splitsen (de topologie blijft daarbij gesloten). Voor kleine
 * polygonen is de constrained Delaunay-triangulatie van Clipper2 een
 * terugvaloptie.
 *
 * Elk resultaat wordt gecontroleerd: alle hoekpunten moeten bestaande
 * vertices zijn (geen extra punten), geen enkele driehoek mag gedegenereerd
 * zijn en de som van de driehoeksoppervlakken moet het polygoonoppervlak
 * opleveren.
 */
import { triangulateD, TriangulateResult } from 'clipper2-ts';
import { ShapeUtils, Vector2 } from 'three';
import { fail } from './errors';
import { signedArea } from './geometry2d';
import type { Point2, Ring } from './types';

export type Triangle = [number, number, number];

const CDT_DECIMALS = 5;
/** Clipper2-CDT is traag bij veel punten; enkel terugvaloptie voor kleine polygonen. */
const CDT_MAX_POINTS = 400;
const MATCH_TOLERANCE = 1e-4;
const MIN_DOUBLE_AREA = 1e-10;

class PointIndex {
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly points: readonly Point2[], private readonly cell = MATCH_TOLERANCE * 4) {
    points.forEach((p, i) => {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    });
  }
  nearest(p: Point2): number {
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    let best = -1;
    let bestD = MATCH_TOLERANCE * MATCH_TOLERANCE;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const q = this.points[i];
          const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d <= bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best;
  }
}

function doubleArea(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);

/** Randen van de ringen zelf (de rand van het polygoon). */
function boundaryEdges(ringSizes: number[]): Set<string> {
  const set = new Set<string>();
  let start = 0;
  for (const n of ringSizes) {
    for (let i = 0; i < n; i++) set.add(edgeKey(start + i, start + ((i + 1) % n)));
    start += n;
  }
  return set;
}

function edgeMap(tris: number[][]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(t[k], t[(k + 1) % 3]);
      const list = map.get(key);
      if (list) list.push(ti);
      else map.set(key, [ti]);
    }
  });
  return map;
}

/**
 * Topologische controle: elke polygoonrand hoort bij precies één driehoek,
 * elke inwendige rand bij precies twee. Dit sluit T-verbindingen uit.
 */
function topologyOk(tris: number[][], boundary: Set<string>): boolean {
  const map = edgeMap(tris);
  for (const [key, list] of map) {
    if (list.length !== (boundary.has(key) ? 1 : 2)) return false;
  }
  for (const key of boundary) if (!map.has(key)) return false;
  return true;
}

/**
 * Herstelt T-verbindingen: als een vertex c precies op de rand ab van een
 * driehoek (a, b, d) ligt, wordt die driehoek gesplitst in (a, c, d) en
 * (c, b, d).
 */
function repairTJunctions(input: number[][], all: readonly Point2[], boundary: Set<string>): number[][] | null {
  let list = input.map((t) => [...t]);
  for (let guard = 0; guard < 10000; guard++) {
    const map = edgeMap(list);
    let fixed = false;
    for (const [key, owners] of map) {
      if (owners.length > 2) return null;
      if (owners.length !== 1 || boundary.has(key)) continue;
      const [a, b] = key.split(',').map(Number);
      const pa = all[a];
      const pb = all[b];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len2 = dx * dx + dy * dy;
      let best = -1;
      let bestT = 0;
      for (let c = 0; c < all.length; c++) {
        if (c === a || c === b) continue;
        const t = ((all[c].x - pa.x) * dx + (all[c].y - pa.y) * dy) / len2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        if (Math.abs(doubleArea(pa, pb, all[c])) / Math.sqrt(len2) < 1e-7) {
          // dichtstbij a eerst, zodat meerdere punten op één rand stap voor stap opgelost worden
          if (best < 0 || t < bestT) {
            best = c;
            bestT = t;
          }
        }
      }
      if (best < 0) continue;
      const ti = owners[0];
      const tri = list[ti];
      const d = tri.find((v) => v !== a && v !== b);
      if (d === undefined) return null;
      list = list.filter((_, j) => j !== ti);
      list.push([a, best, d], [best, b, d]);
      fixed = true;
      break;
    }
    if (!fixed) return list;
  }
  return null;
}

/** Controleert en oriënteert driehoeken; geeft null als het resultaat onbruikbaar is. */
function checkTriangles(raw: number[][], all: readonly Point2[], expectedArea: number, boundary: Set<string>): Triangle[] | null {
  let total = 0;
  const out: Triangle[] = [];
  for (const [a, b, c] of raw) {
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) return null;
    const area2 = doubleArea(all[a], all[b], all[c]);
    if (Math.abs(area2) < MIN_DOUBLE_AREA) return null;
    total += Math.abs(area2) / 2;
    out.push(area2 > 0 ? [a, b, c] : [a, c, b]);
  }
  const tolerance = Math.max(1e-6, expectedArea * 1e-6);
  if (out.length === 0 || Math.abs(total - expectedArea) > tolerance) return null;
  if (!topologyOk(out, boundary)) return null;
  return out;
}

/**
 * Herstelt driehoeken met nul oppervlak: het derde punt c ligt op de
 * lange rand ab. De buurdriehoek (a, b, d) wordt gesplitst in (a, c, d) en
 * (c, b, d) en de lege driehoek vervalt. Oppervlak en randverbindingen
 * blijven daarbij exact behouden.
 */
function repairDegenerates(input: number[][], all: readonly Point2[]): number[][] | null {
  const list = input.map((t) => [...t]);
  for (let guard = 0; guard < 10000; guard++) {
    const idx = list.findIndex(([a, b, c]) => Math.abs(doubleArea(all[a], all[b], all[c])) < MIN_DOUBLE_AREA);
    if (idx < 0) return list;
    const t = list[idx];
    let best = 0;
    let bestLen = -1;
    for (let k = 0; k < 3; k++) {
      const p = all[t[k]];
      const q = all[t[(k + 1) % 3]];
      const len = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (len > bestLen) {
        bestLen = len;
        best = k;
      }
    }
    const a = t[best];
    const b = t[(best + 1) % 3];
    const c = t[(best + 2) % 3];
    const n = list.findIndex((u, j) => j !== idx && u.includes(a) && u.includes(b));
    if (n < 0 || bestLen === 0) return null;
    const d = list[n].find((v) => v !== a && v !== b);
    if (d === undefined) return null;
    const [hi, lo] = idx > n ? [idx, n] : [n, idx];
    list.splice(hi, 1);
    list.splice(lo, 1);
    list.push([a, c, d], [c, b, d]);
  }
  return null;
}

function triangulateEarcut(outer: Ring, holes: Ring[]): number[][] {
  const contour = outer.map((p) => new Vector2(p.x, p.y));
  const holeVecs = holes.map((h) => h.map((p) => new Vector2(p.x, p.y)));
  return ShapeUtils.triangulateShape(contour, holeVecs);
}

function triangulateCdt(outer: Ring, holes: Ring[], all: readonly Point2[]): number[][] | null {
  const { result, solution } = triangulateD([outer, ...holes], CDT_DECIMALS, true);
  if (result !== TriangulateResult.success) return null;
  const index = new PointIndex(all);
  const tris: number[][] = [];
  for (const tri of solution) {
    if (tri.length !== 3) return null;
    tris.push(tri.map((p) => index.nearest(p)));
  }
  return tris;
}

/**
 * Trianguleert `outer` met gaten `holes`. De indices verwijzen naar de
 * aaneengeschakelde puntenlijst [outer..., holes[0]..., holes[1]..., ...].
 * Elke driehoek is tegen de klok in georiënteerd (normaal +Z).
 */
export function triangulatePolygon(outer: Ring, holes: Ring[] = []): Triangle[] {
  const all: Point2[] = [...outer, ...holes.flat()];
  const expected = Math.abs(signedArea(outer)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);

  const boundary = boundaryEdges([outer.length, ...holes.map((h) => h.length)]);

  const tFixed = repairTJunctions(triangulateEarcut(outer, holes), all, boundary);
  const earcut = tFixed ? repairDegenerates(tFixed, all) : null;
  const fromEarcut = earcut ? checkTriangles(earcut, all, expected, boundary) : null;
  if (fromEarcut) return fromEarcut;

  if (all.length <= CDT_MAX_POINTS) {
    const cdt = triangulateCdt(outer, holes, all);
    const fromCdt = cdt ? checkTriangles(cdt, all, expected, boundary) : null;
    if (fromCdt) return fromCdt;
  }

  return fail('TRIANGULATION_FAILED', 'De vorm kon niet betrouwbaar in driehoeken verdeeld worden. Vereenvoudig de vorm.');
}
