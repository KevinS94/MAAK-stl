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
