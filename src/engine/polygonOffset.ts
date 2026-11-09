/**
 * Polygonbewerkingen en offsets via Clipper2 (clipper2-ts).
 * Alle coördinaten zijn in mm; Clipper rekent intern met gehele getallen
 * op `GEOMETRY.clipperPrecision` decimalen.
 */
import {
  booleanOpD,
  booleanOpDWithPolyTree,
  ClipperD,
  ClipType,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
  PolyTreeD,
  type PathsD,
  type PolyPathD,
} from 'clipper2-ts';
import { GEOMETRY } from '../config/defaults';
import { ensureCCW, pointInRing, removeNearDuplicates, signedArea } from './geometry2d';
import type { Point2, Ring, SVGFillRule } from './types';

export interface RegionRings {
  /** Buitencontouren (tegen de klok in), grootste eerst. */
  outers: Ring[];
  /** Gaten (tegen de klok in opgeslagen). */
  holes: Ring[];
}

const PRECISION = GEOMETRY.clipperPrecision;

function toPaths(rings: readonly (readonly Point2[])[]): PathsD {
  return rings.map((r) => r.map((p) => ({ x: p.x, y: p.y })));
}

/**
 * Splitst Clipper-uitvoer in buitencontouren en gaten op basis van de
 * oriëntatie (Clipper geeft buitencontouren en gaten een tegengestelde
 * oriëntatie).
 */
export function classifyPaths(paths: PathsD): RegionRings {
  const cleaned = paths
    .map((p) => removeNearDuplicates(p.map((q) => ({ x: q.x, y: q.y })), GEOMETRY.minPointDistanceMm))
    .filter((p) => p.length >= 3)
    .map((p) => ({ ring: p, area: signedArea(p) }))
    .filter((p) => Math.abs(p.area) > 1e-8);
  if (cleaned.length === 0) return { outers: [], holes: [] };
  const dominant = cleaned.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a));
  const sign = Math.sign(dominant.area);
  const outers: Ring[] = [];
  const holes: Ring[] = [];
  for (const { ring, area } of cleaned) {
    (Math.sign(area) === sign ? outers : holes).push(ensureCCW(ring));
  }
  outers.sort((a, b) => signedArea(b) - signedArea(a));
  return { outers, holes };
}

export function toClipperFillRule(rule: SVGFillRule): FillRule {
  return rule === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero;
}

/** Vereniging van ringen volgens de opgegeven vulregel. */
export function unionPaths(rings: readonly (readonly Point2[])[], fillRule: FillRule = FillRule.NonZero): PathsD {
  if (rings.length === 0) return [];
  return booleanOpD(ClipType.Union, toPaths(rings), null, fillRule, PRECISION);
}

export function intersectPaths(subject: PathsD, clip: PathsD): PathsD {
  if (subject.length === 0 || clip.length === 0) return [];
  return booleanOpD(ClipType.Intersection, subject, clip, FillRule.NonZero, PRECISION);
}

/**
 * Offset van een gesloten contour. Positief = naar buiten, negatief = naar
 * binnen. Afgeronde hoeken (Round join) geven overal exact dezelfde
 * afstand tot de oorspronkelijke contour, dus een gelijkmatige wanddikte.
 */
export function offsetRing(ring: Ring, delta: number): RegionRings {
  const out = inflatePathsD(
    toPaths([ensureCCW(ring)]),
    delta,
    JoinType.Round,
    EndType.Polygon,
    2,
    PRECISION,
    GEOMETRY.arcToleranceMm,
  );
  return classifyPaths(out);
}

/**
 * "Opblazen" van een open lijn tot een band van breedte `2 * halfWidth`,
 * met afgeronde eindpunten. Gebruikt voor open stempeldetails (ribben).
 */
export function offsetOpenPolyline(points: readonly Point2[], halfWidth: number): RegionRings {
  const out = inflatePathsD(
    toPaths([points]),
    halfWidth,
    JoinType.Round,
    EndType.Round,
    2,
    PRECISION,
    GEOMETRY.arcToleranceMm,
  );
  return classifyPaths(out);
}

/**
 * "Opblazen" van een gesloten lijn (omtrek, geen vulling) tot een gesloten
 * band van breedte `2 * halfWidth`. Levert een annulus (buitenring + gat)
 * op. Gebruikt voor gesloten stempeldetails en de verhoogde contourlijn.
 */
export function offsetClosedPolyline(points: readonly Point2[], halfWidth: number): RegionRings {
  const out = inflatePathsD(
    toPaths([points]),
    halfWidth,
    JoinType.Round,
    EndType.Joined,
    2,
    PRECISION,
    GEOMETRY.arcToleranceMm,
  );
  return classifyPaths(out);
}

/**
 * Een regio als Clipper-paden met de juiste oriëntatie: buitencontouren
 * tegen de klok in, gaten met de klok mee. Alleen zo blijven gaten onder
 * de vulregel nonzero ook echt gaten (in `RegionRings` worden gaten,
 * net als buitencontouren, tegen de klok in bewaard).
 */
export function regionToPaths(region: RegionRings): PathsD {
  return toPaths([...region.outers.map((r) => ensureCCW(r)), ...region.holes.map((h) => [...ensureCCW(h)].reverse())]);
}

/** Vereniging van regio's met gaten (bv. om details + contourreliëf samen te voegen). */
export function unionRegions(regions: readonly RegionRings[]): RegionRings {
  const all = regions.flatMap((r) => regionToPaths(r));
  if (all.length === 0) return { outers: [], holes: [] };
  return classifyPaths(booleanOpD(ClipType.Union, all, null, FillRule.NonZero, PRECISION));
}

/** Doorsnede van een regio (outers + holes) met een enkele begrenzende ring. */
export function intersectRegionWithRing(region: RegionRings, clipRing: Ring): RegionRings {
  const out = intersectPaths(regionToPaths(region), toPaths([ensureCCW(clipRing)]));
  return classifyPaths(out);
}

/** Som van de absolute oppervlaktes van een regio (outers minus holes, correct bij geneste eilanden). */
export function regionArea(region: RegionRings): number {
  const outerArea = region.outers.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
  const holeArea = region.holes.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
  return outerArea - holeArea;
}

export function differencePaths(subject: PathsD, clip: PathsD): PathsD {
  if (subject.length === 0) return [];
  if (clip.length === 0) return subject;
  return booleanOpD(ClipType.Difference, subject, clip, FillRule.NonZero, PRECISION);
}

/** Netto oppervlakte (mm²) van Clipper-uitvoer (buitencontouren min gaten). */
export function pathsArea(paths: PathsD): number {
  return regionArea(classifyPaths(paths));
}

/** Eén samenhangend eiland: een buitencontour met de gaten die er rechtstreeks in liggen. */
export interface Island {
  outer: Ring;
  holes: Ring[];
}

/**
 * Splitst een gebied in samenhangende eilanden, met correcte nesting
 * (een eiland binnen een gat van een ander eiland wordt een eigen eiland).
 */
export function splitIslands(paths: PathsD, fillRule: FillRule = FillRule.NonZero): Island[] {
  if (paths.length === 0) return [];
  const tree = new PolyTreeD();
  booleanOpDWithPolyTree(ClipType.Union, paths, null, tree, fillRule, PRECISION);
  const islands: Island[] = [];
  const clean = (p: readonly { x: number; y: number }[] | null): Ring | null => {
    if (!p) return null;
    const r = removeNearDuplicates(p.map((q) => ({ x: q.x, y: q.y })), GEOMETRY.minPointDistanceMm);
    return r.length >= 3 && Math.abs(signedArea(r)) > 1e-8 ? ensureCCW(r) : null;
  };
  const visitOuter = (node: PolyPathD) => {
    const outer = clean(node.poly);
    const holes: Ring[] = [];
    for (let i = 0; i < node.count; i++) {
      const hole = node.child(i);
      const h = clean(hole.poly);
      if (h) holes.push(h);
      for (let j = 0; j < hole.count; j++) visitOuter(hole.child(j));
    }
    if (outer) islands.push({ outer, holes });
  };
  for (let i = 0; i < tree.count; i++) visitOuter(tree.child(i));
  islands.sort((a, b) => signedArea(b.outer) - signedArea(a.outer));
  return islands;
}

/** Ligt punt p binnen het gebied `paths` (vulregel nonzero, zoals Clipper-uitvoer)? */
export function pointInPaths(p: Point2, paths: PathsD): boolean {
  let winding = 0;
  for (const path of paths) {
    if (!pointInRing(p, path)) continue;
    winding += signedArea(path) > 0 ? 1 : -1;
  }
  return winding !== 0;
}

/**
 * Knipt een open polylijn bij tot het gebied `clip` (exacte lijnclipping
 * via Clipper2). Levert de zichtbare stukken als open polylijnen op.
 */
export function clipOpenPolyline(points: readonly Point2[], clip: PathsD): Point2[][] {
  if (points.length < 2 || clip.length === 0) return [];
  const c = new ClipperD(PRECISION);
  c.addOpenSubject(points.map((p) => ({ x: p.x, y: p.y })));
  c.addClipPaths(clip);
  const closed: PathsD = [];
  const open: PathsD = [];
  c.execute(ClipType.Intersection, FillRule.NonZero, closed, open);
  return open
    .map((p) => removeNearDuplicates(p.map((q) => ({ x: q.x, y: q.y })), GEOMETRY.minPointDistanceMm))
    .filter((p) => p.length >= 2);
}

/** Converteert eilanden terug naar Clipper-paden (voor verdere booleaanse bewerkingen). */
export function islandsToPaths(islands: readonly Island[]): PathsD {
  return regionToPaths({ outers: islands.map((i) => i.outer), holes: islands.flatMap((i) => i.holes) });
}

/** Offset van een volledige regio (buitencontouren én gaten); negatief = krimpen. */
export function offsetRegion(region: RegionRings, delta: number): RegionRings {
  const paths = regionToPaths(region);
  if (paths.length === 0) return { outers: [], holes: [] };
  return classifyPaths(
    inflatePathsD(paths, delta, JoinType.Round, EndType.Polygon, 2, PRECISION, GEOMETRY.arcToleranceMm),
  );
}

/** Doorsnede van twee regio's. */
export function intersectRegions(a: RegionRings, b: RegionRings): RegionRings {
  return classifyPaths(intersectPaths(regionToPaths(a), regionToPaths(b)));
}
