/**
 * Polygonbewerkingen en offsets via Clipper2 (clipper2-ts).
 * Alle coördinaten zijn in mm; Clipper rekent intern met gehele getallen
 * op `GEOMETRY.clipperPrecision` decimalen.
 */
import { booleanOpD, ClipType, EndType, FillRule, inflatePathsD, JoinType, type PathsD } from 'clipper2-ts';
import { GEOMETRY } from '../config/defaults';
import { ensureCCW, removeNearDuplicates, signedArea } from './geometry2d';
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

/** Vereniging van ringen met gaten (bv. om details + contourreliëf samen te voegen). */
export function unionRegions(regions: readonly RegionRings[], fillRule: FillRule = FillRule.NonZero): RegionRings {
  const all = regions.flatMap((r) => [...r.outers, ...r.holes]);
  return classifyPaths(unionPaths(all, fillRule));
}

/** Doorsnede van een regio (outers + holes) met een enkele begrenzende ring. */
export function intersectRegionWithRing(region: RegionRings, clipRing: Ring): RegionRings {
  const subject = toPaths([...region.outers, ...region.holes]);
  const out = intersectPaths(subject, toPaths([clipRing]));
  return classifyPaths(out);
}

/** Som van de absolute oppervlaktes van een regio (outers minus holes, correct bij geneste eilanden). */
export function regionArea(region: RegionRings): number {
  const outerArea = region.outers.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
  const holeArea = region.holes.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
  return outerArea - holeArea;
}
