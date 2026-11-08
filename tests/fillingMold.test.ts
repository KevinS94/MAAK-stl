import { describe, expect, it } from 'vitest';
import { FILLING_MOLD_DEFAULTS, FILLING_MOLD_INTERNAL } from '../src/config/defaults';
import { GeometryError } from '../src/engine/errors';
import { offsetRing } from '../src/engine/polygonOffset';
import { validateMesh } from '../src/engine/meshValidation';
import { generateModel } from '../src/engine/pipeline';
import { parseSvgOrThrow } from '../src/engine/svgParser';
import { FaceTag } from '../src/engine/types';
import { buildFillingMold, fillingMoldGenerator } from '../src/generators/fillingMold';
import { SVG } from './fixtures';
import { contourOf } from './helpers';
import { coveredAt, expectBoundsOf, expectValidSolid, expectWallThickness, pointsAt, taggedPoints } from './meshChecks';

const P = FILLING_MOLD_DEFAULTS;
const FLOOR = FILLING_MOLD_INTERNAL.floorThickness;

describe.each(['square', 'rect60x40', 'circle', 'heart', 'star', 'concave', 'canvaLike'] as const)('vulvorm: %s', (name) => {
  const contour = contourOf(SVG[name]);
  const mesh = buildFillingMold(contour, P);

  it('is één gesloten, manifold object van 0 tot 20 mm', () => {
    expectValidSolid(mesh, 20);
  });

  it('buitenzijde volgt exact de SVG-contour over de volledige hoogte', () => {
    expectBoundsOf(pointsAt(mesh, 0, 20), contour, 0);
  });

  it('binnenwand op 2 mm van de buitenzijde', () => {
    expectWallThickness(taggedPoints(mesh, FaceTag.Inner, 20), contour, P.wallThickness);
  });

  it('gesloten bodem van 2 mm en open bovenzijde', () => {
    const inside = offsetRing(contour.outer, -(P.wallThickness + 1)).outers[0][0];
    expect(coveredAt(mesh, inside, 0)).toBe(true); // bodem onderaan
    expect(coveredAt(mesh, inside, FLOOR)).toBe(true); // vloer van de uitsparing
    expect(coveredAt(mesh, inside, 20)).toBe(false); // open bovenaan
    const innerZ = taggedPoints(mesh, FaceTag.Inner).length;
    expect(innerZ).toBeGreaterThan(0);
    const floorPts = pointsAt(mesh, FLOOR);
    expect(floorPts.length).toBeGreaterThan(2);
  });

  it('volume = buitenvolume − uitsparing', () => {
    const inner = offsetRing(contour.outer, -P.wallThickness).outers;
    const innerArea = inner.reduce((s, r) => {
      let a = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j].x * r[i].y - r[i].x * r[j].y;
      return s + a / 2;
    }, 0);
    const expected = contour.areaMm2 * 20 - innerArea * (20 - FLOOR);
    expect(validateMesh(mesh).volumeMm3).toBeCloseTo(expected, 3);
  });
});

describe('vulvorm: exacte waarden en randgevallen', () => {
  it('vierkant 60 × 60 × 20 met wand 2 en bodem 2: volume exact 15 552 mm³', () => {
    const mesh = buildFillingMold(contourOf(SVG.square), P);
    expect(validateMesh(mesh).volumeMm3).toBeCloseTo(60 * 60 * 20 - 56 * 56 * 18, 6);
  });

  it('hoogte moet groter zijn dan de bodemdikte', () => {
    expect(() => buildFillingMold(contourOf(SVG.square), { ...P, height: 5 }, { floorThickness: 5, minCavityDepth: 1 })).toThrow(
      /hoogte moet minstens/,
    );
  });

  it('binnenruimte die verdwijnt geeft een foutmelding', () => {
    const r = fillingMoldGenerator.generate(contourOf(SVG.tiny), P);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SHAPE_TOO_NARROW');
    expect(() => buildFillingMold(contourOf(SVG.tiny), P)).toThrow(GeometryError);
  });

  it('volledige keten in Expert met andere hoogte en wanddikte', () => {
    const r = generateModel(parseSvgOrThrow(SVG.heart), 'fillingMold', 'expert', {
      length: 150,
      width: 100,
      height: 35,
      wallThickness: 3,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { min, max } = r.value.report.bounds;
    expect(max[0] - min[0]).toBeCloseTo(r.value.contour.widthMm, 6);
    expect(max[2]).toBeCloseTo(35, 6);
    expect(r.value.contour.widthMm).toBeGreaterThan(113);
  });
});
