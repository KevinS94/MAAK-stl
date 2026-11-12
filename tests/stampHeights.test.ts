/**
 * Onafhankelijke hoogte van de verhoogde contour en van de details, voor de
 * zelfstandige Stempel én Cutter & Stempel (gedeelde stempelgeometrie).
 */
import { describe, expect, it } from 'vitest';
import { CUTTER_STAMP_DEFAULTS, STAMP_DEFAULTS, STAMP_INTERNAL } from '../src/config/defaults';
import { validateMesh } from '../src/engine/meshValidation';
import { generateFromSelection } from '../src/engine/pipeline';
import { regionArea } from '../src/engine/polygonOffset';
import { exportBinaryStl } from '../src/engine/stlExporter';
import type { MeshData, ShapeParameters } from '../src/engine/types';
import { buildCutterAndStamp } from '../src/generators/cutterStamp';
import { buildStandaloneStamp } from '../src/generators/stamp';
import { buildPlateOuter, buildReliefLevels, buildStamp } from '../src/generators/stampGeometry';
import { canvaLeafSvg, SVG } from './fixtures';
import { ALL_SHAPES, BASIC, parseBinaryStl, selectionOf } from './helpers';
import { coveredAt, expectValidSolid } from './meshChecks';

const P = STAMP_DEFAULTS;
const PLATE_TOP = P.handleHeight + STAMP_INTERNAL.plateThicknessMm;
/** Cirkel r = 40 mm met twee gevulde detailbanden van 40 × 2 mm rond y = ±10 mm (los van de contour). */
const sel = selectionOf(SVG.circleWithFilledBands, BASIC, undefined, 'shapes', ALL_SHAPES);
/** Punt op de middellijn van de verhoogde contour (r = 40 − halve contourbreedte − inset). */
const ON_CONTOUR = { x: 40 - (P.contourWidth / 2 + STAMP_INTERNAL.raisedContourInsetMm), y: 0 };
const ON_DETAIL = { x: 0, y: 10 };
const PLAIN = { x: 0, y: 0 };

const stamp = (params: ShapeParameters, details = sel.details): MeshData =>
  buildStandaloneStamp(sel.contour, details, { ...P, ...params });

describe('hoogte contour = 0 mm', () => {
  const mesh = stamp({ contourHeight: 0 });

  it('geen verhoogde contourlijn, wel de volledige plaat, de details en het handvat', () => {
    expectValidSolid(mesh, PLATE_TOP + P.detailHeight);
    expect(coveredAt(mesh, ON_CONTOUR, PLATE_TOP + P.detailHeight)).toBe(false);
    expect(coveredAt(mesh, ON_CONTOUR, PLATE_TOP)).toBe(true);
    expect(coveredAt(mesh, PLAIN, PLATE_TOP)).toBe(true);
    expect(coveredAt(mesh, ON_DETAIL, PLATE_TOP + P.detailHeight)).toBe(true);
    // Volledige plaat: zelfde breedte als met contour; handvat aanwezig (onderkant op Z = 0).
    const report = validateMesh(mesh);
    const withContour = validateMesh(stamp({}));
    expect(report.bounds.max[0] - report.bounds.min[0]).toBeCloseTo(withContour.bounds.max[0] - withContour.bounds.min[0], 6);
    expect(report.bounds.min[2]).toBeCloseTo(0, 9);
  });

  it('geen nulhoogte-extrusies: geen enkele vertex tussen plaattop en detailtop buiten de details', () => {
    const report = validateMesh(mesh);
    expect(report.degenerateTriangles).toBe(0);
    const heights = new Set<number>();
    for (let i = 2; i < mesh.positions.length; i += 3) heights.add(Math.round(mesh.positions[i] * 1e6) / 1e6);
    expect([...heights].sort((a, b) => a - b)).toEqual([0, P.handleHeight, PLATE_TOP, PLATE_TOP + P.detailHeight]);
  });

  it('"dikte contour" heeft dan geen invloed meer op de geometrie', () => {
    const a = validateMesh(stamp({ contourHeight: 0, contourWidth: 0.4 }));
    const b = validateMesh(stamp({ contourHeight: 0, contourWidth: 4 }));
    expect(a.triangleCount).toBe(b.triangleCount);
    expect(a.volumeMm3).toBeCloseTo(b.volumeMm3, 6);
  });

  it('zonder details en zonder contour blijft een geldige vlakke plaat met handvat over', () => {
    expectValidSolid(stamp({ contourHeight: 0 }, []), PLATE_TOP);
  });

  it('werkt ook voor Cutter & Stempel; de cutter blijft ongewijzigd', () => {
    const C = CUTTER_STAMP_DEFAULTS;
    const off = buildCutterAndStamp(sel.contour, sel.details, { ...C, contourHeight: 0 });
    const on = buildCutterAndStamp(sel.contour, sel.details, C);
    expectValidSolid(off.stamp, C.handleHeight + STAMP_INTERNAL.plateThicknessMm + C.detailHeight);
    expect(validateMesh(off.cutter).volumeMm3).toBeCloseTo(validateMesh(on.cutter).volumeMm3, 6);
    expect(validateMesh(off.stamp).volumeMm3).toBeLessThan(validateMesh(on.stamp).volumeMm3);
  });
});

describe('hoogte contour > 0 en verschillende detailhoogtes', () => {
  it.each([
    [2.5, 0.8],
    [0.8, 2.5],
    [1.5, 1.5],
    [0.4, 4],
  ])('contour %s mm en details %s mm worden elk op hun eigen hoogte gezet', (contourHeight, detailHeight) => {
    const mesh = stamp({ contourHeight, detailHeight });
    expectValidSolid(mesh, PLATE_TOP + Math.max(contourHeight, detailHeight));
    expect(coveredAt(mesh, ON_CONTOUR, PLATE_TOP + contourHeight)).toBe(true);
    expect(coveredAt(mesh, ON_DETAIL, PLATE_TOP + detailHeight)).toBe(true);
    expect(coveredAt(mesh, PLAIN, PLATE_TOP)).toBe(true);
    if (contourHeight !== detailHeight) {
      expect(coveredAt(mesh, ON_DETAIL, PLATE_TOP + contourHeight)).toBe(false);
      expect(coveredAt(mesh, ON_CONTOUR, PLATE_TOP + detailHeight)).toBe(false);
    }
  });

  it('volume volgt afzonderlijk oppervlak × hoogte voor contour en details', () => {
    const plate = buildPlateOuter(sel.contour.outer, 0);
    const contourArea = regionArea(buildReliefLevels(plate, [], P, true).region);
    const detailArea = regionArea(buildReliefLevels(plate, sel.details, { ...P, contourHeight: 0 }, true).region);
    expect(detailArea).toBeCloseTo(160, 0); // twee gevulde banden van 40 × 2 mm
    const v = (contourHeight: number, detailHeight: number) => validateMesh(stamp({ contourHeight, detailHeight })).volumeMm3;
    expect(v(2, 1) - v(1, 1)).toBeCloseTo(contourArea, 0);
    expect(v(1, 3) - v(1, 1)).toBeCloseTo(2 * detailArea, 0);
    expect(v(1, 1) - v(0, 1)).toBeCloseTo(contourArea, 0);
  });

  it('details die de contour kruisen, met een andere hoogte, geven een geldig getrapt reliëf', () => {
    const crossing = selectionOf(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#2e7d32"/>' +
        '<rect x="12" y="49" width="76" height="2" fill="#0b2e0b"/></svg>',
      BASIC,
      undefined,
      'shapes',
      ALL_SHAPES,
    );
    expect(crossing.details).toHaveLength(1);
    for (const [contourHeight, detailHeight] of [
      [2.5, 0.8],
      [0.8, 2.5],
    ]) {
      const { mesh } = buildStamp(crossing.contour.outer, crossing.details, { ...P, contourHeight, detailHeight }, true);
      expectValidSolid(mesh, PLATE_TOP + Math.max(contourHeight, detailHeight));
      // Waar band (x ≤ 38 mm) en contourring (37,8–39 mm) overlappen, reikt het reliëf tot het hoogste van beide;
      // elders op de ring en op de band staat elk op zijn eigen hoogte.
      expect(coveredAt(mesh, { x: 37.95, y: 0 }, PLATE_TOP + Math.max(contourHeight, detailHeight))).toBe(true);
      expect(coveredAt(mesh, { x: 0, y: 38.4 }, PLATE_TOP + contourHeight)).toBe(true);
      expect(coveredAt(mesh, { x: 0, y: 0 }, PLATE_TOP + detailHeight)).toBe(true);
      expect(coveredAt(mesh, { x: 0, y: 38.4 }, PLATE_TOP + detailHeight)).toBe(false);
      expect(coveredAt(mesh, { x: 0, y: 0 }, PLATE_TOP + contourHeight)).toBe(false);
    }
  });

  it('Canva-blad: contour en nerven met verschillende hoogtes, Stempel en Cutter & Stempel', () => {
    const leaf = selectionOf(canvaLeafSvg());
    for (const [contourHeight, detailHeight] of [
      [0, 1.5],
      [2, 1],
      [1, 2.5],
    ]) {
      const r = generateFromSelection(leaf.contour, leaf.details, 'stamp', { ...P, contourHeight, detailHeight });
      expect(r.ok).toBe(true);
      if (r.ok && 'mesh' in r.value) expectValidSolid(r.value.mesh, PLATE_TOP + Math.max(contourHeight, detailHeight));
      const c = generateFromSelection(leaf.contour, leaf.details, 'cutterStamp', { ...CUTTER_STAMP_DEFAULTS, contourHeight, detailHeight });
      expect(c.ok).toBe(true);
      if (c.ok && 'cutter' in c.value) {
        expect(c.value.cutter.report.valid).toBe(true);
        expect(c.value.stamp.report.valid).toBe(true);
        expect(c.value.stamp.report.bounds.max[2]).toBeCloseTo(
          CUTTER_STAMP_DEFAULTS.handleHeight + STAMP_INTERNAL.plateThicknessMm + Math.max(contourHeight, detailHeight),
          6,
        );
      }
    }
  });
});

describe('STL-export gebruikt dezelfde, onafhankelijke hoogtes', () => {
  it('na export en opnieuw inlezen kloppen contour- en detailhoogte nog', () => {
    const mesh = stamp({ contourHeight: 2.5, detailHeight: 0.8 });
    const { mesh: back } = parseBinaryStl(exportBinaryStl(mesh));
    expect(validateMesh(back).valid).toBe(true);
    const z = (v: number) => Math.fround(v);
    expect(coveredAt(back, ON_CONTOUR, z(PLATE_TOP + 2.5))).toBe(true);
    expect(coveredAt(back, ON_DETAIL, z(PLATE_TOP + 0.8))).toBe(true);
    expect(coveredAt(back, ON_DETAIL, z(PLATE_TOP + 2.5))).toBe(false);
  });
});
