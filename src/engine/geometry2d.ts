/**
 * Kleine, afhankelijkheidsvrije 2D-hulpfuncties voor polygonen.
 */
import type { Bounds2, Point2, Ring } from './types';

/** Shoelace-oppervlakte: positief voor tegen de klok in (Y omhoog). */
export function signedArea(ring: readonly Point2[]): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return a / 2;
}

export function ensureCCW(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

export function ringBounds(ring: readonly Point2[]): Bounds2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function mergeBounds(list: Bounds2[]): Bounds2 {
  return list.reduce(
    (acc, b) => ({
      minX: Math.min(acc.minX, b.minX),
      minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX),
      maxY: Math.max(acc.maxY, b.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

/** Even-odd point-in-polygon test (punt op de rand telt niet betrouwbaar). */
export function pointInRing(p: Point2, ring: readonly Point2[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

export function distPointSegmentSq(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * dx - p.x;
  const qy = a.y + t * dy - p.y;
  return qx * qx + qy * qy;
}

function orient(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point2, b: Point2, p: Point2): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/** Snijden of raken de gesloten lijnstukken ab en cd elkaar? */
export function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    return true;
  }
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

/**
 * Uniform raster met de lijnstukken van een ring, voor snelle
 * intersectie- en afstandsvragen.
 */
export class SegmentGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly cellSize: number;
  private readonly bounds: Bounds2;
  private readonly cols: number;

  constructor(private readonly ring: readonly Point2[], cellSize?: number) {
    this.bounds = ringBounds(ring);
    const w = this.bounds.maxX - this.bounds.minX;
    const h = this.bounds.maxY - this.bounds.minY;
    const n = Math.max(ring.length, 1);
    this.cellSize = cellSize ?? Math.max(Math.sqrt((w * h) / n) * 2, 1e-3);
    this.cols = Math.floor(w / this.cellSize) + 1;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      this.forCells(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.max(a.x, b.x),
        Math.max(a.y, b.y),
        (key) => {
          let list = this.cells.get(key);
          if (!list) {
            list = [];
            this.cells.set(key, list);
          }
          list.push(i);
        },
      );
    }
  }

  private forCells(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    cb: (key: number) => void,
  ): void {
    const s = this.cellSize;
    const b = this.bounds;
    const c0 = Math.max(0, Math.floor((minX - b.minX) / s));
    const c1 = Math.min(this.cols - 1, Math.floor((maxX - b.minX) / s));
    const rows = Math.floor((b.maxY - b.minY) / s) + 1;
    const r0 = Math.max(0, Math.floor((minY - b.minY) / s));
    const r1 = Math.min(rows - 1, Math.floor((maxY - b.minY) / s));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) cb(r * this.cols + c);
    }
  }

  /** Indices van lijnstukken waarvan de cel de gegeven rechthoek raakt. */
  query(minX: number, minY: number, maxX: number, maxY: number): Set<number> {
    const out = new Set<number>();
    this.forCells(minX, minY, maxX, maxY, (key) => {
      const list = this.cells.get(key);
      if (list) for (const i of list) out.add(i);
    });
    return out;
  }

  segment(i: number): [Point2, Point2] {
    return [this.ring[i], this.ring[(i + 1) % this.ring.length]];
  }

  /** Snijdt lijnstuk ab een van de lijnstukken in het raster? */
  intersects(a: Point2, b: Point2, skip?: (i: number) => boolean): boolean {
    const cand = this.query(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.max(a.x, b.x),
      Math.max(a.y, b.y),
    );
    for (const i of cand) {
      if (skip?.(i)) continue;
      const [c, d] = this.segment(i);
      if (segmentsIntersect(a, b, c, d)) return true;
    }
    return false;
  }

  /** Ligt er een lijnstuk dichter dan `dist` bij punt p? */
  hasSegmentWithin(p: Point2, dist: number): boolean {
    const cand = this.query(p.x - dist, p.y - dist, p.x + dist, p.y + dist);
    const d2 = dist * dist;
    for (const i of cand) {
      const [a, b] = this.segment(i);
      if (distPointSegmentSq(p, a, b) < d2) return true;
    }
    return false;
  }

  /** Kleinste afstand van p tot de ring (exact, brute kracht in de buurt). */
  distanceTo(p: Point2): number {
    let best = Infinity;
    for (let i = 0; i < this.ring.length; i++) {
      const [a, b] = this.segment(i);
      const d = distPointSegmentSq(p, a, b);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
}

/** Heeft de ring snijdende (niet-aangrenzende) randen? */
export function ringSelfIntersects(ring: readonly Point2[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  const grid = new SegmentGrid(ring);
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const hit = grid.intersects(a, b, (j) => j === i || j === (i + 1) % n || (j + 1) % n === i);
    if (hit) return true;
  }
  return false;
}

/**
 * Ligt `inner` volledig binnen `outer`, zonder dat de randen elkaar
 * raken, en met minstens `minGap` speling?
 */
export function ringStrictlyInside(inner: readonly Point2[], outer: readonly Point2[], minGap = 0): boolean {
  if (!pointInRing(inner[0], outer)) return false;
  const grid = new SegmentGrid(outer);
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    if (grid.intersects(a, b)) return false;
    if (minGap > 0 && grid.hasSegmentWithin(a, minGap)) return false;
  }
  return true;
}

/** Verwijdert opeenvolgende punten die dichter dan `minDist` bij elkaar liggen. */
export function removeNearDuplicates(ring: Ring, minDist: number): Ring {
  const out: Ring = [];
  const d2 = minDist * minDist;
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || (p.x - last.x) ** 2 + (p.y - last.y) ** 2 >= d2) out.push(p);
  }
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if ((first.x - last.x) ** 2 + (first.y - last.y) ** 2 < d2) out.pop();
    else break;
  }
  return out;
}
