import { describe, expect, it } from 'vitest';
import { STAMP_DEFAULTS, STAMP_INTERNAL } from '../src/config/defaults';
import { GeometryError } from '../src/engine/errors';
import { pointInRing, signedArea } from '../src/engine/geometry2d';
import { validateMesh } from '../src/engine/meshValidation';
import { stampGenerator } from '../src/generators/stamp';
import { buildPlateOuter, buildStamp, findInteriorSupportPoint, placeHandle } from '../src/generators/stampGeometry';
import { SVG } from './fixtures';
import { contourOf, selectionOf } from './helpers';
import { expectValidSolid } from './meshChecks';

const P = STAMP_DEFAULTS;

describe('stempel: basisplaat en reliëf', () => {
  it('standalone plaat gebruikt standaard geen inset (volgt exact de buitencontour)', () => {
    const contour = contourOf(SVG.circle);
    const plate = buildPlateOuter(contour.outer, 0);
    expect(Math.abs(signedArea(plate) - signedArea(contour.outer))).toBeLessThan(1e-6);
  });

  it('een inset-offset verkleint de plaat naar binnen', () => {
    const contour = contourOf(SVG.circle);
    const plate = buildPlateOuter(contour.outer, 2);
    expect(Math.abs(signedArea(plate))).toBeLessThan(Math.abs(signedArea(contour.outer)));
  });

  it.each(['circle', 'square', 'heart', 'star', 'concave'] as const)(
    'zelfstandige stempel op %s is één gesloten, manifold object',
    (name) => {
      const contour = contourOf(SVG[name]);
      const { mesh } = buildStamp(contour.outer, [], P, true);
      const totalHeight = P.handleHeight + STAMP_INTERNAL.plateThicknessMm + P.reliefHeight;
      expectValidSolid(mesh, totalHeight);
    },
  );

  it('verhoogde contourlijn met variabele breedte blijft geldig', () => {
    for (const contourWidth of [0.6, 1.2, 2.5]) {
      const contour = contourOf(SVG.circle);
      const { mesh } = buildStamp(contour.outer, [], { ...P, contourWidth }, true);
      expectValidSolid(mesh, P.handleHeight + STAMP_INTERNAL.plateThicknessMm + P.reliefHeight);
    }
  });

  it('variabele reliëfhoogte wordt exact toegepast op de totale hoogte', () => {
    for (const reliefHeight of [0.4, 1.5, 3]) {
      const contour = contourOf(SVG.circle);
      const { mesh } = buildStamp(contour.outer, [], { ...P, reliefHeight }, true);
      const report = validateMesh(mesh);
      expect(report.bounds.max[2]).toBeCloseTo(P.handleHeight + STAMP_INTERNAL.plateThicknessMm + reliefHeight, 6);
    }
  });

  it('open detaillijnen (nerven) worden verhoogde ribben die de mesh geldig houden', () => {
    const sel = selectionOf(SVG.leafWithVeins);
    const { mesh } = buildStamp(sel.contour.outer, sel.details, P, true);
    expectValidSolid(mesh, P.handleHeight + STAMP_INTERNAL.plateThicknessMm + P.reliefHeight);
  });

  it('variabele detailbreedte blijft geldig', () => {
    const sel = selectionOf(SVG.leafWithVeins);
    for (const detailWidth of [0.4, 1.0, 2.0]) {
      const { mesh } = buildStamp(sel.contour.outer, sel.details, { ...P, detailWidth }, true);
      expectValidSolid(mesh, P.handleHeight + STAMP_INTERNAL.plateThicknessMm + P.reliefHeight);
    }
  });

  it('een gesloten detailpad (ring) wordt een geldige annulus-rib', () => {
    const sel = selectionOf(SVG.circleWithClosedDetail);
    const { mesh } = buildStamp(sel.contour.outer, sel.details, P, true);
    expectValidSolid(mesh, P.handleHeight + STAMP_INTERNAL.plateThicknessMm + P.reliefHeight);
  });

  it('kruisende detaillijnen worden samengevoegd tot geldige geometrie', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/>' +
      '<path d="M20 50 L80 50" fill="none" stroke="#000" stroke-width="1"/>' +
      '<path d="M50 20 L50 80" fill="none" stroke="#000" stroke-width="1"/></svg>';
    const sel = selectionOf(svg);
    expect(sel.details).toHaveLength(2);
    const { mesh } = buildStamp(sel.contour.outer, sel.details, P, true);
    expectValidSolid(mesh, P.handleHeight + STAMP_INTERNAL.plateThicknessMm + P.reliefHeight);
  });
});

describe('stempel: handvat', () => {
  it('plaatst het handvat op het geometrische centrum bij een cirkel', () => {
    const contour = contourOf(SVG.circle);
    const { center, radius } = findInteriorSupportPoint(contour.outer);
    expect(center.x).toBeCloseTo(0, 0);
    expect(center.y).toBeCloseTo(0, 0);
    expect(radius).toBeGreaterThan(30);
  });

  it.each([10, 20, 30] as const)('handvatdiameter %i mm past op een voldoende grote cirkel', (diameter) => {
    const contour = contourOf(SVG.circle);
    const ring = placeHandle(contour.outer, diameter);
    expect(ring.length).toBe(48);
  });

  it.each([6, 12, 24] as const)('handvathoogte %i mm wordt exact toegepast op de totale hoogte', (handleHeight) => {
    const contour = contourOf(SVG.circle);
    const { mesh } = buildStamp(contour.outer, [], { ...P, handleHeight }, true);
    const report = validateMesh(mesh);
    expect(report.bounds.max[2]).toBeCloseTo(handleHeight + STAMP_INTERNAL.plateThicknessMm + P.reliefHeight, 6);
  });

  it('een te grote diameter op een kleine vorm geeft een duidelijke foutmelding in plaats van ongeldige geometrie', () => {
    const contour = contourOf(SVG.tiny); // 2 × 2 mm
    expect(() => placeHandle(contour.outer, P.handleDiameter)).toThrow(GeometryError);
  });

  it('een handvat dat niet op een smalle strook past, geeft HANDLE_INVALID (reliëf past er wel op)', () => {
    const contour = contourOf(SVG.thinStrip); // 90 × 16 mm
    const r = stampGenerator.generate(contour, [], P);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('HANDLE_INVALID');
      expect(r.error.message).toMatch(/past niet veilig/);
    }
    // Een kleinere diameter past wel op diezelfde strook.
    const ok = stampGenerator.generate(contour, [], { ...P, handleDiameter: 10 });
    expect(ok.ok).toBe(true);
  });

  it('bij een concave vorm wordt een intern steunpunt gebruikt, niet zomaar het bounding-box-midden', () => {
    const contour = contourOf(SVG.concave); // L-vorm: bbox-midden ligt buiten de vorm
    const { center } = findInteriorSupportPoint(contour.outer);
    expect(pointInRing(center, contour.outer)).toBe(true);
  });
});

describe('stempel: generator end-to-end', () => {
  it('ongeldige parameters worden geweigerd', () => {
    const r = stampGenerator.generate(contourOf(SVG.circle), [], { ...P, reliefHeight: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_PARAMETERS');
  });

  it('levert een geldige STL-mesh op voor het blad-met-nerven voorbeeld', () => {
    const sel = selectionOf(SVG.leafWithVeins);
    const r = stampGenerator.generate(sel.contour, sel.details, P);
    expect(r.ok).toBe(true);
    if (r.ok) expectValidSolid(r.value, P.handleHeight + STAMP_INTERNAL.plateThicknessMm + P.reliefHeight);
  });
});
