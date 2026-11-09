/**
 * Universele SVG-padselectie: elk subpad uit de SVG (open of gesloten,
 * gevuld of enkel omlijnd) wordt een onafhankelijk selecteerbaar
 * vectorpad met een voorgestelde rol (buitencontour / stempeldetail /
 * negeren). De gebruiker kan deze rollen aanpassen in een compacte lijst.
 */
import { GEOMETRY } from '../config/defaults';
import { fail, toResult } from './errors';
import { ringBounds, signedArea } from './geometry2d';
import type { SampleBudget } from './contourProcessing';
import { finalizeOuterRing, sampleSubPath } from './contourProcessing';
import type { SvgRawGeometry } from './svgParser';
import { createFrameMapping } from './svgScaling';
import type { Bounds2, DetailLine, FrameSizeMm, PathRole, Point2, Result, SvgPathCandidate, ValidatedContour } from './types';

function pathLength(ring: readonly Point2[], closed: boolean): number {
  let len = 0;
  for (let i = 0; i < ring.length - 1; i++) len += Math.hypot(ring[i + 1].x - ring[i].x, ring[i + 1].y - ring[i].y);
  if (closed && ring.length > 1) {
    const a = ring[ring.length - 1];
    const b = ring[0];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

function isBackground(bounds: Bounds2, frameSize: FrameSizeMm): boolean {
  return (
    bounds.maxX - bounds.minX >= GEOMETRY.backgroundCoverage * frameSize.length &&
    bounds.maxY - bounds.minY >= GEOMETRY.backgroundCoverage * frameSize.width
  );
}

/** Zet alle subpaden van `raw` om naar selecteerbare kandidaten in mm (nog niet gecentreerd). */
export function extractPathCandidates(raw: SvgRawGeometry, frameSize: FrameSizeMm): SvgPathCandidate[] {
  const mapping = createFrameMapping(raw.frame, frameSize);
  const budget: SampleBudget = { points: 0 };
  const closeTol = GEOMETRY.closeToleranceFraction * Math.hypot(frameSize.length, frameSize.width);

  const candidates: SvgPathCandidate[] = raw.paths.map((p, i) => {
    const { ring, gapMm } = sampleSubPath(p.subPath, mapping, budget);
    const closed = p.subPath.closed || gapMm <= closeTol;
    const bounds = ring.length > 0 ? ringBounds(ring) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const areaMm2 = closed ? Math.abs(signedArea(ring)) : 0;
    return {
      id: `${p.shapeIndex}:${i}`,
      shapeIndex: p.shapeIndex,
      elementName: p.elementName,
      filled: p.filled,
      closed,
      ring,
      areaMm2,
      lengthMm: pathLength(ring, closed),
      bounds,
      suggestedRole: 'ignore' as PathRole,
    };
  });

  return suggestRoles(candidates, frameSize);
}

/**
 * Stelt automatisch rollen voor: de grootste gesloten, niet-achtergrond
 * vorm wordt de buitencontour; andere paden binnen het kader worden
 * stempeldetail; achtergrondvormen (die het volledige kader vullen)
 * worden genegeerd.
 */
export function suggestRoles(candidates: SvgPathCandidate[], frameSize: FrameSizeMm): SvgPathCandidate[] {
  const closedUsable = candidates.filter(
    (c) => c.closed && c.areaMm2 >= GEOMETRY.minIslandAreaMm2 && !isBackground(c.bounds, frameSize),
  );
  const outer = closedUsable.reduce<SvgPathCandidate | null>(
    (best, c) => (!best || c.areaMm2 > best.areaMm2 ? c : best),
    null,
  );
  return candidates.map((c) => {
    if (outer && c.id === outer.id) return { ...c, suggestedRole: 'outer' };
    if (isBackground(c.bounds, frameSize)) return { ...c, suggestedRole: 'ignore' };
    if (c.ring.length < 2) return { ...c, suggestedRole: 'ignore' };
    if (outer) return { ...c, suggestedRole: 'detail' };
    // Geen duidelijke buitencontour gevonden: laat de gebruiker expliciet kiezen.
    return { ...c, suggestedRole: c.closed ? 'outer' : 'detail' };
  });
}

/**
 * Een selectie is ondubbelzinnig (geen bevestiging nodig, zie spec §2.3)
 * als er precies één bruikbare gesloten vorm is om als buitencontour te
 * gebruiken.
 */
export function isSelectionUnambiguous(candidates: SvgPathCandidate[], frameSize: FrameSizeMm): boolean {
  const closedUsable = candidates.filter(
    (c) => c.closed && c.areaMm2 >= GEOMETRY.minIslandAreaMm2 && !isBackground(c.bounds, frameSize),
  );
  return closedUsable.length === 1;
}

export function defaultRoles(candidates: SvgPathCandidate[]): Record<string, PathRole> {
  return Object.fromEntries(candidates.map((c) => [c.id, c.suggestedRole]));
}

/**
 * Bouwt de detaillijnen (rol "detail") uitgelijnd met de gekozen
 * buitencontour: dezelfde kadertransformatie, dezelfde `centerOffset`.
 */
export function alignDetails(
  candidates: SvgPathCandidate[],
  roles: Record<string, PathRole>,
  centerOffset: Point2,
): DetailLine[] {
  return candidates
    .filter((c) => roles[c.id] === 'detail' && c.ring.length >= 2)
    .map((c) => ({
      closed: c.closed,
      ring: c.ring.map((p) => ({ x: p.x - centerOffset.x, y: p.y - centerOffset.y })),
    }));
}

/** Controleert dat precies één kandidaat de rol "outer" heeft en geeft die terug. */
export function requireSingleOuter(candidates: SvgPathCandidate[], roles: Record<string, PathRole>): SvgPathCandidate {
  const outers = candidates.filter((c) => roles[c.id] === 'outer');
  if (outers.length === 0) {
    fail('NO_OUTER_SELECTED', 'Kies precies één vectorpad als buitencontour.');
  }
  if (outers.length > 1) {
    fail('NO_OUTER_SELECTED', 'Er is meer dan één vectorpad als buitencontour gemarkeerd. Kies er precies één.');
  }
  const outer = outers[0];
  if (!outer.closed) {
    fail('NO_OUTER_SELECTED', 'De buitencontour moet een gesloten vectorpad zijn.');
  }
  return outer;
}

export interface ContourSelection {
  contour: ValidatedContour;
  details: DetailLine[];
}

/**
 * Bouwt de uiteindelijke contour + uitgelijnde detaillijnen op basis van de
 * roltoewijzing van de gebruiker (of de automatische voorstellen).
 */
export function buildSelectionOrThrow(
  candidates: SvgPathCandidate[],
  roles: Record<string, PathRole>,
  frameSize: FrameSizeMm,
  extraNotices: string[] = [],
): ContourSelection {
  const outerCandidate = requireSingleOuter(candidates, roles);
  const contour = finalizeOuterRing(outerCandidate.ring, frameSize, extraNotices);
  const details = alignDetails(candidates, roles, contour.centerOffset);
  return { contour, details };
}

export function buildSelection(
  candidates: SvgPathCandidate[],
  roles: Record<string, PathRole>,
  frameSize: FrameSizeMm,
  extraNotices: string[] = [],
): Result<ContourSelection> {
  return toResult(() => buildSelectionOrThrow(candidates, roles, frameSize, extraNotices));
}
