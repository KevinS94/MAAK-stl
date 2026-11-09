import { describe, expect, it } from 'vitest';
import { GeometryError } from '../src/engine/errors';
import { ringBounds } from '../src/engine/geometry2d';
import { parseSvgPathsOrThrow } from '../src/engine/svgParser';
import {
  buildSelection,
  buildSelectionOrThrow,
  defaultRoles,
  extractPathCandidates,
  isSelectionUnambiguous,
  requireSingleOuter,
} from '../src/engine/svgPaths';
import { SVG } from './fixtures';
import { BASIC, selectionOf } from './helpers';

describe('universele SVG-padselectie', () => {
  it('herkent de gesloten buitencontour en de open nerven als afzonderlijke paden', () => {
    const raw = parseSvgPathsOrThrow(SVG.leafWithVeins);
    const candidates = extractPathCandidates(raw, BASIC);
    expect(candidates).toHaveLength(4);
    const closed = candidates.filter((c) => c.closed);
    const open = candidates.filter((c) => !c.closed);
    expect(closed).toHaveLength(1);
    expect(open).toHaveLength(3);
  });

  it('stelt de grootste gesloten vorm automatisch voor als buitencontour, de open lijnen als detail', () => {
    const raw = parseSvgPathsOrThrow(SVG.leafWithVeins);
    const candidates = extractPathCandidates(raw, BASIC);
    const roles = defaultRoles(candidates);
    const outer = candidates.find((c) => roles[c.id] === 'outer');
    expect(outer?.closed).toBe(true);
    const details = candidates.filter((c) => roles[c.id] === 'detail');
    expect(details).toHaveLength(3);
    expect(details.every((d) => !d.closed)).toBe(true);
  });

  it('is ondubbelzinnig bij precies één gesloten vorm (geen bevestiging nodig)', () => {
    const raw = parseSvgPathsOrThrow(SVG.leafWithVeins);
    const candidates = extractPathCandidates(raw, BASIC);
    expect(isSelectionUnambiguous(candidates, BASIC)).toBe(true);
  });

  it('bouwt een contour + uitgelijnde detaillijnen op basis van de automatische rollen', () => {
    const sel = selectionOf(SVG.leafWithVeins);
    expect(sel.contour.outer.length).toBeGreaterThan(3);
    expect(sel.details).toHaveLength(3);
    for (const d of sel.details) {
      expect(d.closed).toBe(false);
      // De nerven liggen binnen de bounding box van de buitencontour (uitgelijnd op dezelfde schaal/centrering).
      const b = ringBounds(d.ring);
      const c = ringBounds(sel.contour.outer);
      expect(b.minX).toBeGreaterThanOrEqual(c.minX - 1);
      expect(b.maxX).toBeLessThanOrEqual(c.maxX + 1);
    }
  });

  it('ondersteunt een gesloten detailpad (bv. een ring) naast de buitencontour', () => {
    const sel = selectionOf(SVG.circleWithClosedDetail);
    expect(sel.details).toHaveLength(1);
    expect(sel.details[0].closed).toBe(true);
  });

  it('laat de gebruiker de rol van een pad aanpassen (bv. extra vorm negeren)', () => {
    const raw = parseSvgPathsOrThrow(SVG.leafWithVeins);
    const candidates = extractPathCandidates(raw, BASIC);
    const roles = defaultRoles(candidates);
    const oneDetail = candidates.find((c) => roles[c.id] === 'detail')!;
    roles[oneDetail.id] = 'ignore';
    const sel = buildSelectionOrThrow(candidates, roles, BASIC);
    expect(sel.details).toHaveLength(2);
  });

  it('weigert te starten zonder een gekozen buitencontour', () => {
    const raw = parseSvgPathsOrThrow(SVG.onlyOpenLines);
    const candidates = extractPathCandidates(raw, BASIC);
    expect(() => requireSingleOuter(candidates, defaultRoles(candidates))).toThrow(GeometryError);
    const r = buildSelection(candidates, defaultRoles(candidates), BASIC);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NO_OUTER_SELECTED');
  });

  it('weigert twee gelijktijdig gemarkeerde buitencontouren', () => {
    const raw = parseSvgPathsOrThrow(SVG.circleWithClosedDetail);
    const candidates = extractPathCandidates(raw, BASIC);
    const roles = Object.fromEntries(candidates.map((c) => [c.id, 'outer' as const]));
    const r = buildSelection(candidates, roles, BASIC);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NO_OUTER_SELECTED');
  });

  it('een gewone eenvoudige SVG (één gesloten vorm) blijft via deze route ook werken', () => {
    const sel = selectionOf(SVG.heart);
    expect(sel.details).toHaveLength(0);
    expect(sel.contour.widthMm).toBeGreaterThan(75);
  });
});
