/**
 * Middellijnen (centerlines) en banden rond middellijnen.
 *
 * 1. `extractCenterline`: de middellijn (skelet) van een gevuld gebied,
 *    bv. een smalle band die Canva als gevulde vorm exporteert, een
 *    kalligrafische letter of een getekende nerf. Werkwijze:
 *      a. rasteren op een fijn raster (≈ 10 pixels over de bandbreedte);
 *      b. dunnen tot een 1 pixel breed skelet (Zhang–Suen), plus het
 *         wegwerken van "trapjes" zonder de topologie te wijzigen;
 *      c. afstandstransformatie (exact Euclidisch) voor de lokale breedte;
 *      d. het skelet omzetten naar een graaf (eindpunten, vertakkingen,
 *         gesloten lussen) en korte zijtakjes die door de randen van de
 *         band ontstaan (bv. de hoeken van een rechte uiteinde) wegsnoeien;
 *      e. de takken gladmaken en vereenvoudigen tot polylijnen in mm.
 *    Vertakkingen en lussen blijven behouden.
 *
 * 2. `bandAroundCenterline`: een gesloten band met een vaste breedte rond
 *    één of meer middellijnen, met afgeronde uiteinden en verbindingen
 *    (Clipper2). Het resultaat is altijd een geldige, gesloten regio.
 */
import { CENTERLINE, GEOMETRY } from '../config/defaults';
import { fail } from './errors';
import { ringBounds } from './geometry2d';
import { offsetClosedPolyline, offsetOpenPolyline, regionArea, unionRegions, type RegionRings } from './polygonOffset';
import type { Point2 } from './types';

/** Eén tak van een middellijn (mm). */
export interface CenterlinePath {
  points: Point2[];
  /** Gesloten lus (zonder herhaald eindpunt). */
  closed: boolean;
}

export interface CenterlineResult {
  paths: CenterlinePath[];
  /** Mediane getekende breedte van het gebied langs de middellijn (mm). */
  drawnWidthMm: number;
}

/* ------------------------------------------------------------------ */
/* Maten van een gebied                                                */
/* ------------------------------------------------------------------ */

function ringLength(ring: readonly Point2[]): number {
  let len = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/** Totale omtrek (buitencontouren + gaten). */
export function regionPerimeter(region: RegionRings): number {
  return [...region.outers, ...region.holes].reduce((s, r) => s + ringLength(r), 0);
}

/**
 * Gemiddelde breedte van een gebied: 2 × oppervlakte / omtrek. Exact voor
 * een band van constante breedte (rechte strook, ring), een benadering
 * voor andere vormen.
 */
export function meanBandWidth(region: RegionRings): number {
  const p = regionPerimeter(region);
  return p > 0 ? (2 * regionArea(region)) / p : 0;
}

/** Omtrek² / (4 × oppervlakte): ≈ 3,1 voor een cirkel, ≈ lengte/breedte voor een smalle band. */
export function elongation(region: RegionRings): number {
  const a = regionArea(region);
  const p = regionPerimeter(region);
  return a > 0 ? (p * p) / (4 * a) : Infinity;
}

/* ------------------------------------------------------------------ */
/* a. Rasteren                                                          */
/* ------------------------------------------------------------------ */

interface Raster {
  img: Uint8Array;
  W: number;
  H: number;
  minX: number;
  minY: number;
  px: number;
}

const PAD = 2;

function rasterize(region: RegionRings, px: number): Raster {
  const b = ringBounds(region.outers.flat());
  const W = Math.ceil((b.maxX - b.minX) / px) + 2 * PAD;
  const H = Math.ceil((b.maxY - b.minY) / px) + 2 * PAD;
  const minX = b.minX - PAD * px;
  const minY = b.minY - PAD * px;
  const img = new Uint8Array(W * H);
  const rows: number[][] = Array.from({ length: H }, () => []);
  // Even-odd over alle ringen: correct voor een geklasseerde regio (gaten binnen buitencontouren).
  for (const ring of [...region.outers, ...region.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      if (a.y === c.y) continue;
      const y0 = Math.min(a.y, c.y);
      const y1 = Math.max(a.y, c.y);
      for (let j = Math.max(0, Math.ceil((y0 - minY) / px - 0.5)); j < H; j++) {
        const yc = minY + (j + 0.5) * px;
        if (yc >= y1) break;
        if (yc < y0) continue;
        rows[j].push(a.x + ((yc - a.y) * (c.x - a.x)) / (c.y - a.y));
      }
    }
  }
  for (let j = 0; j < H; j++) {
    const xs = rows[j].sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - minX) / px - 0.5));
      for (let i = i0; i < W; i++) {
        if (minX + (i + 0.5) * px >= xs[k + 1]) break;
        img[j * W + i] = 1;
      }
    }
  }
  return { img, W, H, minX, minY, px };
}

/* ------------------------------------------------------------------ */
/* b. Dunnen                                                            */
/* ------------------------------------------------------------------ */

/** Buurposities in de volgorde P2..P9 van Zhang–Suen: N, NE, E, SE, S, SW, W, NW. */
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

function neighborMask(img: Uint8Array, W: number, idx: number): number {
  let m = 0;
  for (let k = 0; k < 8; k++) if (img[idx + DY[k] * W + DX[k]]) m |= 1 << k;
  return m;
}

const popcount = (m: number) => {
  let c = 0;
  for (let k = 0; k < 8; k++) if (m & (1 << k)) c++;
  return c;
};

/** Aantal 0→1-overgangen rond de pixel (Zhang–Suen "A"). */
const TRANSITIONS = Array.from({ length: 256 }, (_, m) => {
  let t = 0;
  for (let k = 0; k < 8; k++) if (!(m & (1 << k)) && m & (1 << ((k + 1) % 8))) t++;
  return t;
});

/** Aantal 8-samenhangende componenten van de buren onderling. */
const COMPONENTS = Array.from({ length: 256 }, (_, m) => {
  const parent = [0, 1, 2, 3, 4, 5, 6, 7];
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < 8; a++) {
    for (let b = a + 1; b < 8; b++) {
      if (!(m & (1 << a)) || !(m & (1 << b))) continue;
      if (Math.max(Math.abs(DX[a] - DX[b]), Math.abs(DY[a] - DY[b])) === 1) parent[find(a)] = find(b);
    }
  }
  const roots = new Set<number>();
  for (let k = 0; k < 8; k++) if (m & (1 << k)) roots.add(find(k));
  return roots.size;
});

function thin(r: Raster): void {
  const { img, W } = r;
  let fg: number[] = [];
  for (let i = 0; i < img.length; i++) if (img[i]) fg.push(i);
  const del: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (const idx of fg) {
        if (!img[idx]) continue;
        const m = neighborMask(img, W, idx);
        const n = popcount(m);
        if (n < 2 || n > 6 || TRANSITIONS[m] !== 1) continue;
        const p = (k: number) => (m >> k) & 1; // 0=N(P2) 2=E(P4) 4=S(P6) 6=W(P8)
        if (step === 0 ? p(0) * p(2) * p(4) === 0 && p(2) * p(4) * p(6) === 0 : p(0) * p(2) * p(6) === 0 && p(0) * p(4) * p(6) === 0) {
          del.push(idx);
        }
      }
      for (const d of del) img[d] = 0;
      if (del.length > 0) changed = true;
    }
    fg = fg.filter((i) => img[i]);
  }
  // Trapjes wegwerken: een pixel met ≥ 2 buren die onderling al verbonden zijn, is overbodig.
  for (const idx of fg) {
    const m = neighborMask(img, W, idx);
    if (popcount(m) >= 2 && COMPONENTS[m] === 1) img[idx] = 0;
  }
}

/* ------------------------------------------------------------------ */
/* c. Afstandstransformatie (Felzenszwalb & Huttenlocher)              */
/* ------------------------------------------------------------------ */

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Gekwadrateerde afstand (pixels²) van elke pixel van het (originele) gebied tot de dichtstbijzijnde achtergrondpixel. */
function distanceTransform(mask: Uint8Array, W: number, H: number): Float32Array {
  const INF = 1e20;
  const out = new Float32Array(W * H);
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) f[j] = mask[j * W + i] ? INF : 0;
    edt1d(f, H, d, v, z);
    for (let j = 0; j < H; j++) out[j * W + i] = d[j];
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) f[i] = out[j * W + i];
    edt1d(f, W, d, v, z);
    for (let i = 0; i < W; i++) out[j * W + i] = d[i];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* d. Skelet -> graaf, zijtakjes snoeien                               */
/* ------------------------------------------------------------------ */

interface Edge {
  /** Pixelindices van begin tot eind (inclusief beide knopen). */
  px: number[];
  closed: boolean;
  removed: boolean;
}

function traceSkeleton(img: Uint8Array, W: number): Edge[] {
  const neighbors = (idx: number) => {
    const out: number[] = [];
    for (let k = 0; k < 8; k++) {
      const n = idx + DY[k] * W + DX[k];
      if (img[n]) out.push(n);
    }
    return out;
  };
  const skel: number[] = [];
  for (let i = 0; i < img.length; i++) if (img[i]) skel.push(i);
  const deg = new Map<number, number>();
  for (const p of skel) deg.set(p, neighbors(p).length);
  const isNode = (p: number) => deg.get(p) !== 2;
  const used = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const visited = new Uint8Array(img.length);
  const edges: Edge[] = [];

  for (const start of skel) {
    if (!isNode(start)) continue;
    visited[start] = 1;
    const nb = neighbors(start);
    if (nb.length === 0) {
      edges.push({ px: [start], closed: false, removed: false });
      continue;
    }
    for (const first of nb) {
      if (used.has(key(start, first))) continue;
      used.add(key(start, first));
      const path = [start, first];
      let prev = start;
      let cur = first;
      while (!isNode(cur)) {
        visited[cur] = 1;
        const next = neighbors(cur).find((n) => n !== prev && !used.has(key(cur, n)));
        if (next === undefined) break;
        used.add(key(cur, next));
        path.push(next);
        prev = cur;
        cur = next;
      }
      visited[cur] = 1;
      edges.push({ px: path, closed: false, removed: false });
    }
  }
  // Wat overblijft zijn gesloten lussen zonder knopen.
  for (const start of skel) {
    if (visited[start]) continue;
    const path = [start];
    visited[start] = 1;
    let prev = -1;
    let cur = start;
    for (;;) {
      const next = neighbors(cur).find((n) => n !== prev && !visited[n]);
      if (next === undefined) break;
      visited[next] = 1;
      path.push(next);
      prev = cur;
      cur = next;
    }
    edges.push({ px: path, closed: path.length >= 3, removed: false });
  }
  return edges;
}

function pruneSpurs(edges: Edge[], radiusPx: (idx: number) => number, pxLen: (e: Edge) => number): void {
  for (let round = 0; round < 3; round++) {
    const ends = new Map<number, Edge[]>();
    const live = edges.filter((e) => !e.removed && !e.closed && e.px.length >= 2);
    for (const e of live) {
      for (const n of [e.px[0], e.px[e.px.length - 1]]) {
        const list = ends.get(n);
        if (list) list.push(e);
        else ends.set(n, [e]);
      }
    }
    const degree = (n: number) => ends.get(n)?.length ?? 0;
    let removedAny = false;
    for (const [junction, list] of ends) {
      if (list.length < 3) continue;
      const spurs = list.filter((e) => {
        if (e.px[0] === e.px[e.px.length - 1]) return false;
        const other = e.px[0] === junction ? e.px[e.px.length - 1] : e.px[0];
        return degree(other) === 1 && pxLen(e) < CENTERLINE.spurFactor * radiusPx(junction) + 2;
      });
      if (spurs.length === 0) continue;
      // Blijft er niets anders over dan zijtakjes, dan blijft de langste staan.
      if (spurs.length === list.length) spurs.splice(spurs.indexOf(spurs.reduce((a, b) => (pxLen(b) > pxLen(a) ? b : a))), 1);
      for (const s of spurs) {
        if (!s.removed) {
          s.removed = true;
          removedAny = true;
        }
      }
    }
    mergeThroughDegreeTwo(edges);
    if (!removedAny) break;
  }
}

/** Verbindt takken die na het snoeien via een knoop van graad 2 aan elkaar hangen. */
function mergeThroughDegreeTwo(edges: Edge[]): void {
  for (;;) {
    const ends = new Map<number, Edge[]>();
    for (const e of edges) {
      if (e.removed || e.closed || e.px.length < 2) continue;
      for (const n of [e.px[0], e.px[e.px.length - 1]]) {
        const list = ends.get(n);
        if (list) list.push(e);
        else ends.set(n, [e]);
      }
    }
    let merged = false;
    for (const [node, list] of ends) {
      if (list.length !== 2) continue;
      const [a, b] = list;
      if (a === b) {
        // Een tak die met beide uiteinden op dezelfde knoop van graad 2 eindigt, is een lus.
        a.px.pop();
        a.closed = a.px.length >= 3;
        merged = true;
        break;
      }
      const pa = a.px[a.px.length - 1] === node ? a.px : [...a.px].reverse();
      const pb = b.px[0] === node ? b.px : [...b.px].reverse();
      a.px = [...pa, ...pb.slice(1)];
      b.removed = true;
      merged = true;
      break;
    }
    if (!merged) return;
  }
}

/* ------------------------------------------------------------------ */
/* e. Gladmaken en vereenvoudigen                                       */
/* ------------------------------------------------------------------ */

function smooth(points: Point2[], closed: boolean, radius: number): Point2[] {
  const n = points.length;
  if (n < 3 || radius < 1) return points;
  return points.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return p;
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let k = -radius; k <= radius; k++) {
      let j = i + k;
      if (closed) j = (j + n) % n;
      else j = Math.max(0, Math.min(n - 1, j));
      sx += points[j].x;
      sy += points[j].y;
      c++;
    }
    return { x: sx / c, y: sy / c };
  });
}

function simplifyOpen(points: Point2[], eps: number): Point2[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [i0, i1] = stack.pop()!;
    const a = points[i0];
    const b = points[i1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    let best = -1;
    let bestD = eps;
    for (let i = i0 + 1; i < i1; i++) {
      const p = points[i];
      const d = l > 0 ? Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / l : Math.hypot(p.x - a.x, p.y - a.y);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Subpixelcorrectie: verschuift elk punt van de middellijn loodrecht op de
 * lijn naar het midden tussen de twee echte randen van het gebied (stralen
 * naar beide kanten). Verschuivingen groter dan `maxShift` (bv. bij een
 * vertakking, waar een straal in een andere tak terechtkomt) worden niet
 * toegepast. Levert ook de lokale breedtes op.
 */
/** Stralen vanuit een punt tot de eerste rand van het gebied (exacte polygoonranden, geen raster). */
class RayCaster {
  readonly segs: [Point2, Point2][] = [];
  constructor(region: RegionRings) {
    for (const ring of [...region.outers, ...region.holes]) {
      for (let i = 0; i < ring.length; i++) this.segs.push([ring[i], ring[(i + 1) % ring.length]]);
    }
  }
  /** Afstand langs de eenheidsrichting (nx, ny) tot de dichtstbijzijnde rand, of Infinity. */
  cast(p: Point2, nx: number, ny: number): number {
    let best = Infinity;
    for (const [a, b] of this.segs) {
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const den = nx * ey - ny * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = a.x - p.x;
      const wy = a.y - p.y;
      const t = (wx * ey - wy * ex) / den;
      const u = (wx * ny - wy * nx) / den;
      if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
    }
    return best;
  }
}

/**
 * Verlengt elk vrij uiteinde (geen vertakking) van een middellijn tot waar
 * de rand vóór het uiteinde op één lokale halve breedte ligt — precies waar
 * de middellijn van een afgerond of recht afgesneden uiteinde eindigt. Het
 * dunnen kort uiteinden soms meer in dan dat; zo wordt de lengte van de
 * getekende vorm hersteld. Elke stap wordt opnieuw tussen de randen
 * gecentreerd, zodat ook een gebogen uiteinde gevolgd wordt.
 */
function extendFreeEnds(paths: CenterlinePath[], caster: RayCaster, px: number, maxExtend: number): void {
  const key = (p: Point2) => `${Math.round(p.x / px)},${Math.round(p.y / px)}`;
  const count = new Map<string, number>();
  for (const p of paths) {
    if (p.closed || p.points.length < 2) continue;
    for (const e of [p.points[0], p.points[p.points.length - 1]]) count.set(key(e), (count.get(key(e)) ?? 0) + 1);
  }
  const extend = (pts: Point2[]): Point2[] => {
    // `pts` loopt naar het uiteinde toe; richting = gemiddelde over het laatste stuk.
    const end = pts[pts.length - 1];
    let back = pts[pts.length - 2];
    for (let i = pts.length - 2; i >= 0; i--) {
      back = pts[i];
      if (Math.hypot(end.x - back.x, end.y - back.y) >= 3 * px) break;
    }
    let dx = end.x - back.x;
    let dy = end.y - back.y;
    let l = Math.hypot(dx, dy);
    if (l < 1e-9) return pts;
    dx /= l;
    dy /= l;
    const out = [...pts];
    let p = end;
    let travelled = 0;
    while (travelled < maxExtend) {
      const ahead = caster.cast(p, dx, dy);
      const left = caster.cast(p, -dy, dx);
      const right = caster.cast(p, dy, -dx);
      if (!Number.isFinite(ahead) || !Number.isFinite(left) || !Number.isFinite(right)) break;
      const r = (left + right) / 2;
      if (ahead <= r + 1e-6) break;
      const step = Math.min(px, ahead - r);
      let q = { x: p.x + dx * step, y: p.y + dy * step };
      const ql = caster.cast(q, -dy, dx);
      const qr = caster.cast(q, dy, -dx);
      if (Number.isFinite(ql) && Number.isFinite(qr) && Math.abs(ql - qr) / 2 < px) {
        const s = (ql - qr) / 2;
        q = { x: q.x - dy * s, y: q.y + dx * s };
      }
      const nx = q.x - p.x;
      const ny = q.y - p.y;
      l = Math.hypot(nx, ny);
      if (l < 1e-9) break;
      dx = nx / l;
      dy = ny / l;
      travelled += l;
      out.push(q);
      p = q;
    }
    return out;
  };
  for (const path of paths) {
    if (path.closed || path.points.length < 2) continue;
    if (count.get(key(path.points[path.points.length - 1])) === 1) path.points = extend(path.points);
    if (count.get(key(path.points[0])) === 1) path.points = extend([...path.points].reverse()).reverse();
  }
}

function refineToMidline(paths: CenterlinePath[], caster: RayCaster, maxShift: number, maxReach: number): number[] {
  const widths: number[] = [];
  const total = paths.reduce((s, p) => s + p.points.length, 0);
  if (total * caster.segs.length > 3e7) return widths;
  const cast = (p: Point2, nx: number, ny: number) => caster.cast(p, nx, ny);

  for (const path of paths) {
    const pts = path.points;
    const n = pts.length;
    if (n < 2) continue;
    path.points = pts.map((p, i) => {
      const prev = path.closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
      const next = path.closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
      const tx = next.x - prev.x;
      const ty = next.y - prev.y;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-12) return p;
      const nx = -ty / tl;
      const ny = tx / tl;
      const dPlus = cast(p, nx, ny);
      const dMin = cast(p, -nx, -ny);
      if (!Number.isFinite(dPlus) || !Number.isFinite(dMin) || dPlus + dMin > maxReach) return p;
      const shift = (dPlus - dMin) / 2;
      if (Math.abs(shift) > maxShift) return p;
      widths.push(dPlus + dMin);
      return { x: p.x + nx * shift, y: p.y + ny * shift };
    });
  }
  return widths;
}

/* ------------------------------------------------------------------ */
/* Publieke functies                                                    */
/* ------------------------------------------------------------------ */

const TOO_NARROW =
  'Deze vorm is te smal of te complex om veilig naar een middellijn om te zetten. Kies "Gesloten vorm" of vereenvoudig de vorm.';

/**
 * Middellijn van een gevuld gebied (mm). Gooit `CENTERLINE_INVALID` als
 * het gebied te smal, te groot t.o.v. zijn breedte of te vertakt is om
 * betrouwbaar om te zetten.
 */
export function extractCenterline(region: RegionRings): CenterlineResult {
  if (region.outers.length === 0) fail('CENTERLINE_INVALID', 'Er is geen vorm om een middellijn van te bepalen.');
  const width = meanBandWidth(region);
  if (!(width >= CENTERLINE.minBandWidthMm)) fail('CENTERLINE_INVALID', TOO_NARROW, `Gemiddelde breedte ${width.toFixed(3)} mm.`);

  const b = ringBounds(region.outers.flat());
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  let px = width / CENTERLINE.pixelsPerWidth;
  const pixelsAt = (s: number) => (bw / s + 2 * PAD + 1) * (bh / s + 2 * PAD + 1);
  if (pixelsAt(px) > CENTERLINE.maxPixels) {
    px = Math.sqrt((bw * bh) / CENTERLINE.maxPixels) * 1.1;
    while (pixelsAt(px) > CENTERLINE.maxPixels) px *= 1.1;
  }
  if (width / px < CENTERLINE.minPixelsPerWidth) {
    fail('CENTERLINE_INVALID', TOO_NARROW, `Slechts ${(width / px).toFixed(1)} rasterpixels over de breedte.`);
  }

  const raster = rasterize(region, px);
  const dist = distanceTransform(raster.img, raster.W, raster.H);
  thin(raster);
  const edges = traceSkeleton(raster.img, raster.W);
  if (edges.length === 0) fail('CENTERLINE_INVALID', TOO_NARROW);
  if (edges.length > CENTERLINE.maxBranches * 4) fail('CENTERLINE_INVALID', TOO_NARROW, `${edges.length} takken.`);

  // Afstand tot de rand (pixels): middelpunt-tot-middelpunt min een halve pixel.
  const radiusPx = (idx: number) => Math.max(0.5, Math.sqrt(dist[idx]) - 0.5);
  const pxLen = (e: Edge) => {
    let len = 0;
    for (let i = 1; i < e.px.length; i++) {
      const a = e.px[i - 1];
      const c = e.px[i];
      len += Math.hypot((c % raster.W) - (a % raster.W), Math.floor(c / raster.W) - Math.floor(a / raster.W));
    }
    return len;
  };
  pruneSpurs(edges, radiusPx, pxLen);
  const live = edges.filter((e) => !e.removed);
  if (live.length > CENTERLINE.maxBranches) {
    fail('CENTERLINE_INVALID', TOO_NARROW, `${live.length} takken na het snoeien.`);
  }

  const radii: number[] = [];
  const toMm = (idx: number): Point2 => ({
    x: raster.minX + ((idx % raster.W) + 0.5) * px,
    y: raster.minY + (Math.floor(idx / raster.W) + 0.5) * px,
  });
  const paths: CenterlinePath[] = live.map((e) => {
    for (const idx of e.px) radii.push(radiusPx(idx));
    let pts = e.px.map(toMm);
    if (pts.length === 1) pts = [pts[0], { x: pts[0].x + px * 0.01, y: pts[0].y }]; // stip
    const smoothR = Math.max(1, Math.min(3, Math.round(CENTERLINE.pixelsPerWidth / 4)));
    pts = smooth(pts, e.closed, smoothR);
    if (e.closed) {
      // Vereenvoudig een lus als open lijn vanaf het verste punt, zodat de vorm behouden blijft.
      const far = pts.reduce((best, p, i) => (Math.hypot(p.x - pts[0].x, p.y - pts[0].y) > Math.hypot(pts[best].x - pts[0].x, pts[best].y - pts[0].y) ? i : best), 0);
      const a = simplifyOpen(pts.slice(0, far + 1), px * 0.35);
      const c = simplifyOpen([...pts.slice(far), pts[0]], px * 0.35);
      pts = [...a, ...c.slice(1, -1)];
    } else {
      pts = simplifyOpen(pts, px * 0.35);
    }
    return { points: pts, closed: e.closed && pts.length >= 3 };
  });
  radii.sort((p, q) => p - q);
  const maxRadiusMm = (radii.length > 0 ? radii[radii.length - 1] : width / px / 2) * px;
  const caster = new RayCaster(region);
  const widths = refineToMidline(paths, caster, 1.5 * px, 2 * maxRadiusMm + 4 * px).sort((p, q) => p - q);
  const total = paths.reduce((s, p) => s + p.points.length, 0);
  if (total * caster.segs.length <= 3e7) {
    extendFreeEnds(paths, caster, px, 4 * maxRadiusMm + 4 * px);
    for (const p of paths) if (!p.closed) p.points = simplifyOpen(p.points, px * 0.1);
  }
  const drawnWidthMm =
    widths.length > 0 ? widths[Math.floor(widths.length / 2)] : 2 * (radii.length > 0 ? radii[Math.floor(radii.length / 2)] : 0) * px;
  return { paths, drawnWidthMm };
}

/**
 * Gesloten band van breedte `widthMm` rond middellijnen, met afgeronde
 * uiteinden en verbindingen. Overlappende takken worden verenigd.
 */
export function bandAroundCenterline(paths: readonly CenterlinePath[], widthMm: number): RegionRings {
  const half = widthMm / 2;
  const parts = paths
    .filter((p) => p.points.length >= 1)
    .map((p) => {
      const pts = p.points.length === 1 ? [p.points[0], { x: p.points[0].x + GEOMETRY.minPointDistanceMm, y: p.points[0].y }] : p.points;
      return p.closed && pts.length >= 3 ? offsetClosedPolyline(pts, half) : offsetOpenPolyline(pts, half);
    });
  const band = unionRegions(parts);
  if (band.outers.length === 0) fail('CENTERLINE_INVALID', 'Rond deze middellijn kon geen geldige vorm gebouwd worden.');
  return band;
}
