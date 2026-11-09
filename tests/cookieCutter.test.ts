import { describe, expect, it } from 'vitest';
import { COOKIE_CUTTER_DEFAULTS, COOKIE_CUTTER_INTERNAL } from '../src/config/defaults';
import { GeometryError } from '../src/engine/errors';
import { offsetRing } from '../src/engine/polygonOffset';
import { generateModel } from '../src/engine/pipeline';
import { parseSvgOrThrow } from '../src/engine/svgParser';
import { FaceTag } from '../src/engine/types';
import { buildCookieCutter, cookieCutterGenerator, effectiveFlareHeight } from '../src/generators/cookieCutter';
import { SVG } from './fixtures';
import { contourOf } from './helpers';
import { coveredAt, expectBoundsOf, expectValidSolid, expectWallThickness, pointsAt, taggedPoints } from './meshChecks';

const P = COOKIE_CUTTER_DEFAULTS;
const FLARE = COOKIE_CUTTER_INTERNAL.flareWidth;

describe.each(['square', 'rect60x40', 'circle', 'heart', 'star', 'concave', 'canvaLike'] as const)('cookie cutter: %s', (name) => {
  const contour = contourOf(SVG[name]);
  const mesh = buildCookieCutter(contour, P);

  it('is één gesloten, manifold, correct georiënteerd object van 0 tot 15 mm', () => {
    expectValidSolid(mesh, 15);
  });

  it('snijwand volgt exact de SVG-contour (geen verbreding onder 12 mm)', () => {
    // Op Z = 12 begint de eerste verbredingsring; daaronder liggen enkel de onderste ringen.
    expectBoundsOf(pointsAt(mesh, 0, 11.99), contour, 0);
    expect(pointsAt(mesh, 0.01, 11.99)).toHaveLength(0);
  });

  it('bovenrand (Z = 15 mm) is 2 mm naar buiten verbreed', () => {
    // Afgeronde hoeken worden benaderd met een boogtolerantie van 0,01 mm.
    expectBoundsOf(taggedPoints(mesh, FaceTag.Outer, 15), contour, FLARE, 0.02);
  });

  it('verbreding verloopt geleidelijk tussen 12 en 15 mm', () => {
    const mid = pointsAt(mesh, 13.4, 13.6);
    const b = mid.reduce((m, p) => Math.max(m, p.x), -Infinity);
    const c = contour.outer.reduce((m, p) => Math.max(m, p.x), -Infinity);
    expect(b - c).toBeGreaterThan(0.5);
    expect(b - c).toBeLessThan(1.5);
  });

  it('binnenwand ligt overal op 1,2 mm van de buitenzijde', () => {
    expectWallThickness(taggedPoints(mesh, FaceTag.Inner, 0), contour, P.wallThickness);
  });

  it('heeft een open middenruimte (onder én boven)', () => {
    const inside = offsetRing(contour.outer, -(P.wallThickness + 1)).outers[0][0];
    expect(coveredAt(mesh, inside, 0)).toBe(false);
    expect(coveredAt(mesh, inside, 15)).toBe(false);
    // Op de wand zelf ligt wel een vlak.
    const onWall = offsetRing(contour.outer, -P.wallThickness / 2).outers[0][0];
    expect(coveredAt(mesh, onWall, 0)).toBe(true);
  });
});

describe('cookie cutter: parameters en randgevallen', () => {
  it('in Expert blijft de verbredingszone 3 mm bij een andere hoogte', () => {
    const contour = contourOf(SVG.circle);
    const mesh = buildCookieCutter(contour, { ...P, height: 30 });
    expectValidSolid(mesh, 30);
    expectBoundsOf(pointsAt(mesh, 0, 26.99), contour, 0);
    expectBoundsOf(taggedPoints(mesh, FaceTag.Outer, 30), contour, FLARE, 0.02);
    expect(effectiveFlareHeight(30)).toBe(3);
  });

  it('bij een kleine hoogte wordt de verbreding beperkt', () => {
    expect(effectiveFlareHeight(6)).toBe(3);
    expect(effectiveFlareHeight(4)).toBe(2);
    const mesh = buildCookieCutter(contourOf(SVG.square), { ...P, height: 6 });
    expectValidSolid(mesh, 6);
  });

  it('een andere wanddikte wordt exact toegepast', () => {
    const contour = contourOf(SVG.heart);
    const mesh = buildCookieCutter(contour, { ...P, wallThickness: 2.5 });
    expectValidSolid(mesh, 15);
    expectWallThickness(taggedPoints(mesh, FaceTag.Inner, 0), contour, 2.5);
  });

  it('te smalle vorm geeft een foutmelding in plaats van foute geometrie', () => {
    const contour = contourOf(SVG.tiny); // 2 × 2 mm
    expect(() => buildCookieCutter(contour, P)).toThrow(GeometryError);
    const r = cookieCutterGenerator.generate(contour, [], P);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('SHAPE_TOO_NARROW');
      expect(r.error.message).toMatch(/te smal/);
    }
  });

  it('een smalle spleet die de drukrand alleen overbrugt, blijft geldig', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10 H90 V49 H30 V51 H90 V90 H10 Z"/></svg>';
    expectValidSolid(buildCookieCutter(contourOf(svg), P), 15);
  });

  it('een smalle hals die de binnenruimte splitst geeft nog steeds één geldig object', () => {
    const mesh = buildCookieCutter(contourOf(SVG.narrowNeck), P);
    expectValidSolid(mesh, 15);
  });

  it('inkepingen die de drukrand zouden doen overlappen geven een foutmelding', () => {
    // Ringvorm met een ingesloten opening die via een spleet van 2 mm naar buiten loopt:
    // de drukrand zou de spleet dichten en een losse holte insluiten.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10 H90 V49 H70 V30 H30 V70 H70 V51 H90 V90 H10 Z"/></svg>';
    const r = cookieCutterGenerator.generate(contourOf(svg), [], P);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FLARE_INVALID');
  });

  it('ongeldige parameters worden geweigerd', () => {
    const r = cookieCutterGenerator.generate(contourOf(SVG.square), [], { ...P, wallThickness: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_PARAMETERS');
  });

  it('volledige keten in Expert: kader 200 × 120 geeft contour 120 × 48 en drukrand +2 mm', () => {
    const r = generateModel(parseSvgOrThrow(SVG.rect60x40), 'cookieCutter', 'expert', { ...P, length: 200, width: 120 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.contour.widthMm).toBeCloseTo(120, 3);
    expect(r.value.contour.heightMm).toBeCloseTo(48, 3);
    const { min, max } = r.value.report.bounds;
    expect(max[0] - min[0]).toBeCloseTo(124, 2);
    expect(max[1] - min[1]).toBeCloseTo(52, 2);
    expect(max[2] - min[2]).toBeCloseTo(15, 6);
  });
});
