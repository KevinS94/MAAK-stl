/**
 * Open contouren en smalle banden als middellijn (centerline): een band met
 * een instelbare dikte rond de middellijn wordt de buitenvorm (vormdikte)
 * of het reliëf van een stempeldetail (dikte details).
 */
import { describe, expect, it } from 'vitest';
import { CENTERLINE, DEFAULT_PARAMETERS, STAMP_INTERNAL } from '../src/config/defaults';
import { bandAroundCenterline, extractCenterline } from '../src/engine/centerline';
import { pointInRing, signedArea } from '../src/engine/geometry2d';
import { validateMesh } from '../src/engine/meshValidation';
import { generateFromSelection } from '../src/engine/pipeline';
import { pointInPaths, regionArea, regionToPaths } from '../src/engine/polygonOffset';
import { exportBinaryStl } from '../src/engine/stlExporter';
import {
  buildSelection,
  buildSelectionOrThrow,
  centerlineOf,
  defaultRoles,
  interpretationOf,
  suggestInterpretation,
} from '../src/engine/svgPaths';
import type { GeneratorType, MeshData, PathInterpretation, Point2, SvgPathCandidate } from '../src/engine/types';
import { buildStamp } from '../src/generators/stampGeometry';
import { LETTERS, lineDrawingSvg, openLetterSSvg, SVG, sCenterlineMm } from './fixtures';
import { BASIC, candidatesOf, parseBinaryStl } from './helpers';
import { coveredAt, expectValidSolid } from './meshChecks';

const GENERATORS: GeneratorType[] = ['fillingMold', 'cookieCutter', 'stamp', 'cutterStamp'];

/** Minimale afstand van een punt tot een open polylijn (of gesloten met `closed`). */
function distToPolyline(p: Point2, line: readonly Point2[], closed = false): number {
  let best = Infinity;
  const n = line.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = line[i];
    const b = line[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return n === 1 ? Math.hypot(line[0].x - p.x, line[0].y - p.y) : best;
}

const shift = (o: Point2) => (r: readonly Point2[]) => r.map((p) => ({ x: p.x - o.x, y: p.y - o.y }));

interface Built {
  candidates: SvgPathCandidate[];
  outer: SvgPathCandidate;
  selection: ReturnType<typeof buildSelectionOrThrow>;
  /** Middellijn(en) van de buitencontour, gecentreerd zoals de contour. */
  centerlines: { points: Point2[]; closed: boolean }[];
}

/** Bouwt de selectie met de voorgestelde rollen, de buitencontour als middellijn en een vormdikte. */
function build(svg: string, shapeThicknessMm = 8, interp: PathInterpretation = 'centerline'): Built {
  const candidates = candidatesOf(svg);
  const roles = defaultRoles(candidates);
  const outers = candidates.filter((c) => roles[c.id] === 'outer');
  const outer = outers.reduce((a, c) => (c.silhouetteAreaMm2 > a.silhouetteAreaMm2 ? c : a), outers[0]);
  expect(outer).toBeDefined();
  const selection = buildSelectionOrThrow(candidates, roles, BASIC, [], {
    interpretations: Object.fromEntries(outers.map((c) => [c.id, interp])),
    shapeThicknessMm,
  });
  const centerlines = outers
    .flatMap((c) => centerlineOf(c))
    .map((p) => ({ points: shift(selection.contour.centerOffset)(p.points), closed: p.closed }));
  return { candidates, outer, selection, centerlines };
}

/** De band volgt de middellijn: elk randpunt ligt op exact de halve vormdikte; elk middellijnpunt ligt binnen de vorm. */
function expectBandFollowsCenterline(b: Built, thickness: number, tol = 0.03): void {
  const { contour } = b.selection;
  expect(contour.centerline).toEqual({ thicknessMm: thickness });
  let min = Infinity;
  let max = 0;
  for (const p of contour.outer) {
    const d = Math.min(...b.centerlines.map((c) => distToPolyline(p, c.points, c.closed)));
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  expect(min).toBeGreaterThan(thickness / 2 - tol);
  expect(max).toBeLessThan(thickness / 2 + tol);
  for (const c of b.centerlines) for (const p of c.points) expect(pointInRing(p, contour.outer)).toBe(true);
}

function expectStlValid(mesh: MeshData): void {
  const { mesh: back, triangleCount } = parseBinaryStl(exportBinaryStl(mesh));
  expect(triangleCount).toBe(mesh.indices.length / 3);
  const r = validateMesh(back);
  expect(r.nonManifoldEdges).toBe(0);
  expect(r.valid).toBe(true);
}

/**
 * Genereert met elke generator (Basismodus: elk met zijn eigen standaard
 * vormdikte) en controleert mesh + STL.
 */
function expectAllGeneratorsValid(svg: string, interp: PathInterpretation = 'centerline'): void {
  for (const gen of GENERATORS) {
    const params = DEFAULT_PARAMETERS[gen];
    const b = build(svg, params.shapeThickness, interp);
    expectBandFollowsCenterline(b, params.shapeThickness);
    const r = generateFromSelection(b.selection.contour, b.selection.details, gen, params);
    if (!r.ok) throw new Error(`${gen}: ${r.error.message}`);
    if ('cutter' in r.value) {
      for (const sub of [r.value.cutter, r.value.stamp]) {
        expect(sub.report.valid).toBe(true);
        expect(sub.report.components).toBe(1);
        expectStlValid(sub.mesh);
      }
    } else {
      expect(r.value.report.valid).toBe(true);
      expect(r.value.report.components).toBe(1);
      expect(r.value.report.bounds.min[2]).toBeCloseTo(0, 9);
      expectStlValid(r.value.mesh);
    }
  }
}

/* ------------------------------------------------------------------ */

describe('voorstellen: rol en interpretatie', () => {
  it('een open lijn zonder gesloten vorm wordt buitencontour met voorstel "Middellijn"', () => {
    const cands = candidatesOf(LETTERS.openS);
    expect(cands).toHaveLength(1);
    const roles = defaultRoles(cands);
    expect(roles[cands[0].id]).toBe('outer');
    expect(interpretationOf(cands[0], roles)).toBe('centerline');
  });

  it('een echte gevulde vorm krijgt "Gesloten vorm", een smalle gevulde band "Middellijn"', () => {
    const [heart] = candidatesOf(SVG.heart);
    expect(heart.bandLike).toBe(false);
    expect(suggestInterpretation(heart, 'outer')).toBe('shape');
    const s = candidatesOf(LETTERS.canvaCalligraphicS).find((c) => c.suggestedRole === 'outer')!;
    expect(s.bandLike).toBe(true);
    expect(suggestInterpretation(s, 'outer')).toBe('centerline');
    expect(suggestInterpretation(s, 'detail')).toBe('centerline');
  });

  it('gesloten vormen blijven ongewijzigd: geen vormdikte, zelfde contour als voorheen', () => {
    for (const svg of [SVG.heart, SVG.star, SVG.circle, SVG.concave]) {
      const cands = candidatesOf(svg);
      const r = buildSelection(cands, defaultRoles(cands), BASIC, [], { shapeThicknessMm: 3 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.contour.centerline).toBeUndefined();
    }
  });
});

describe('1–3. open lettervorm "S" als buitencontour', () => {
  const b = build(LETTERS.openS, 8);
  const truth = sCenterlineMm();

  it('de band volgt de middellijn met exact de vormdikte', () => {
    expectBandFollowsCenterline(b, 8);
    // De middellijn is de getekende lijn zelf.
    const shiftedTruth = shift(b.selection.contour.centerOffset)(truth);
    for (const c of b.centerlines) for (const p of c.points) expect(distToPolyline(p, shiftedTruth)).toBeLessThan(0.01);
    expect(signedArea(b.selection.contour.outer)).toBeGreaterThan(0);
    expect(b.selection.contour.notices.join(' ')).toMatch(/middellijn.*vormdikte van 8 mm/);
  });

  it('1. Vulvorm: geldige, gesloten mesh en STL', () => {
    const r = generateFromSelection(b.selection.contour, [], 'fillingMold', DEFAULT_PARAMETERS.fillingMold);
    expect(r.ok).toBe(true);
    if (r.ok && 'mesh' in r.value) {
      expectValidSolid(r.value.mesh, DEFAULT_PARAMETERS.fillingMold.height);
      expectStlValid(r.value.mesh);
    }
  });

  it('2. Cookie cutter: geldige, gesloten mesh en STL', () => {
    const r = generateFromSelection(b.selection.contour, [], 'cookieCutter', DEFAULT_PARAMETERS.cookieCutter);
    expect(r.ok).toBe(true);
    if (r.ok && 'mesh' in r.value) {
      expectValidSolid(r.value.mesh, DEFAULT_PARAMETERS.cookieCutter.height);
      expectStlValid(r.value.mesh);
    }
  });

  it('3. Stempel (en Cutter & Stempel): geldige meshes en STL', () => {
    expectAllGeneratorsValid(LETTERS.openS);
  });

  it('Stempel met een te smalle vormdikte voor het handvat: melding met de benodigde vormdikte', () => {
    const r = generateFromSelection(b.selection.contour, [], 'stamp', DEFAULT_PARAMETERS.stamp);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('HANDLE_INVALID');
      expect(r.error.message).toMatch(/vormdikte van 8 mm.*minstens 23 mm/);
    }
    const narrow = build(LETTERS.openS, 12);
    const ok = generateFromSelection(narrow.selection.contour, [], 'stamp', { ...DEFAULT_PARAMETERS.stamp, handleDiameter: 8 });
    expect(ok.ok).toBe(true);
  });
});

describe('4. Canva-achtige gevulde kalligrafische "S" als buitencontour (middellijninterpretatie)', () => {
  const b = build(LETTERS.canvaCalligraphicS, 8, 'centerline');

  it('de middellijn wordt uit de gevulde band gehaald en volgt de echte middellijn', () => {
    expect(b.outer.kind).toBe('region');
    expect(b.centerlines).toHaveLength(1);
    expect(b.centerlines[0].closed).toBe(false);
    const truth = shift(b.selection.contour.centerOffset)(sCenterlineMm());
    let worst = 0;
    for (const p of b.centerlines[0].points) worst = Math.max(worst, distToPolyline(p, truth));
    expect(worst).toBeLessThan(0.25);
    // De middellijn loopt over de hele letter, tot op een halve getekende breedte (1,2 mm) van elk uiteinde.
    const len = b.centerlines[0].points.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - b.centerlines[0].points[i].x, p.y - b.centerlines[0].points[i].y), 0);
    const truthLen = truth.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - truth[i].x, p.y - truth[i].y), 0);
    expect(len).toBeGreaterThan(truthLen - 2 * 1.2 - 0.5);
    expect(len).toBeLessThan(truthLen - 2 * 1.2 + 0.5);
  });

  it('de band heeft exact de vormdikte (niet de getekende 2,4–4,4 mm)', () => {
    expectBandFollowsCenterline(b, 8);
  });

  it('werkt voor alle vier generators, met geldige STL', () => {
    expectAllGeneratorsValid(LETTERS.canvaCalligraphicS);
  });

  it('als gesloten vorm gebruikt, blijft de getekende band zelf de buitencontour', () => {
    const shape = build(LETTERS.canvaCalligraphicS, 8, 'shape');
    expect(shape.selection.contour.centerline).toBeUndefined();
    expect(shape.selection.contour.areaMm2).toBeCloseTo(regionArea(shape.outer.region!), 0);
    expect(shape.selection.contour.areaMm2).toBeLessThan(0.6 * b.selection.contour.areaMm2);
  });
});

describe('de geüploade open letter "S" (echte Canva-export: 2 omlijnde lijnen + 1 gevulde boog)', () => {
  const svg = openLetterSSvg();
  const cands = candidatesOf(svg);
  const roles = defaultRoles(cands);

  it('alle drie de stukken van dezelfde kleur worden samen de buitencontour, als middellijn', () => {
    expect(cands).toHaveLength(3);
    expect(cands.filter((c) => c.kind === 'line' && !c.closed)).toHaveLength(2);
    expect(cands.every((c) => roles[c.id] === 'outer')).toBe(true);
    expect(cands.every((c) => interpretationOf(c, roles) === 'centerline')).toBe(true);
  });

  it('levert één samenhangende S op waarvan de band exact de vormdikte heeft', () => {
    for (const t of [6, 8, 12]) {
      const sel = buildSelectionOrThrow(cands, roles, BASIC, [], { shapeThicknessMm: t });
      expect(sel.contour.centerline).toEqual({ thicknessMm: t });
      const lines = cands.flatMap((c) => centerlineOf(c)).map((p) => ({ ...p, points: shift(sel.contour.centerOffset)(p.points) }));
      for (const p of sel.contour.outer) {
        const d = Math.min(...lines.map((c) => distToPolyline(p, c.points, c.closed)));
        expect(d).toBeGreaterThan(t / 2 - 0.03);
        expect(d).toBeLessThan(t / 2 + 0.03);
      }
      for (const c of lines) for (const p of c.points) expect(pointInRing(p, sel.contour.outer)).toBe(true);
    }
  });

  it('werkt voor alle vier generators, met geldige STL', () => {
    expectAllGeneratorsValid(svg);
  });

  it('een gesloten vorm in dezelfde kleur trekt geen losse lijnen mee (bestaand gedrag blijft)', () => {
    const c = candidatesOf(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#000"/>' +
        '<path d="M50 50 L95 50" fill="none" stroke="#000" stroke-width="1"/></svg>',
    );
    const r = defaultRoles(c);
    expect(c.filter((x) => r[x.id] === 'outer')).toHaveLength(1);
  });
});

describe('dunne lijntekening (echte Canva-export)', () => {
  it('wordt als middellijn een vorm met vormdikte, voor alle vier generators', () => {
    const svg = lineDrawingSvg();
    const cands = candidatesOf(svg);
    const roles = defaultRoles(cands);
    const outer = cands.find((c) => roles[c.id] === 'outer')!;
    expect(outer.bandLike).toBe(true);
    expect(outer.bandWidthMm).toBeLessThan(0.5);
    expect(interpretationOf(outer, roles)).toBe('centerline');
    for (const gen of GENERATORS) {
      const P = DEFAULT_PARAMETERS[gen];
      const sel = buildSelectionOrThrow(cands, roles, BASIC, [], { shapeThicknessMm: P.shapeThickness });
      const r = generateFromSelection(sel.contour, sel.details, gen, P);
      if (!r.ok) throw new Error(`${gen}: ${r.error.message}`);
    }
  }, 30000);
});

describe('5. dunne gevulde band als stempeldetail', () => {
  const cands = candidatesOf(LETTERS.circleWithFilledS);
  const roles = defaultRoles(cands);
  const s = cands.find((c) => roles[c.id] === 'detail')!;
  const P = DEFAULT_PARAMETERS.stamp;
  const reliefTop = P.handleHeight + STAMP_INTERNAL.plateThicknessMm + P.detailHeight;

  it('wordt standaard middellijn en krijgt de ingestelde detaildikte in plaats van de getekende 3 mm', () => {
    expect(s).toBeDefined();
    expect(interpretationOf(s, roles)).toBe('centerline');
    const sel = buildSelectionOrThrow(cands, roles, BASIC);
    expect(sel.details).toHaveLength(1);
    expect(sel.details[0].region).toBeUndefined();
    const truth = shift(sel.contour.centerOffset)(sCenterlineMm());
    for (const p of sel.details[0].ring) expect(distToPolyline(p, truth)).toBeLessThan(0.2);

    for (const detailWidth of [0.6, 1.0, 2.0]) {
      const { mesh } = buildStamp(sel.contour.outer, sel.details, { ...P, detailWidth, contourHeight: 0 }, true);
      expectValidSolid(mesh, reliefTop);
      // Op de middellijn: reliëf. Net buiten de halve detaildikte (maar binnen de getekende band): plaat.
      const mid = truth[300];
      const a = truth[299];
      const c = truth[301];
      const l = Math.hypot(c.x - a.x, c.y - a.y);
      const n = { x: -(c.y - a.y) / l, y: (c.x - a.x) / l };
      const off = detailWidth / 2 + 0.15;
      expect(coveredAt(mesh, mid, reliefTop)).toBe(true);
      if (off < 1.5) expect(coveredAt(mesh, { x: mid.x + n.x * off, y: mid.y + n.y * off }, reliefTop)).toBe(false);
      expectStlValid(mesh);
    }
  });

  it('als gesloten vorm blijft de getekende breedte behouden', () => {
    const sel = buildSelectionOrThrow(cands, roles, BASIC, [], { interpretations: { [s.id]: 'shape' } });
    expect(sel.details[0].region).toBeDefined();
    expect(regionArea(sel.details[0].region!)).toBeCloseTo(regionArea(s.region!), 3);
  });
});

describe('6. variërende vormdiktes', () => {
  it.each([3, 5, 8, 12, 15])('vormdikte %s mm: band volgt de middellijn, generators slagen', (t) => {
    const b = build(LETTERS.openS, t);
    expectBandFollowsCenterline(b, t);
    // Wanddikte moet in de band passen; bij een smalle band kiezen we een dunnere wand.
    const wall = Math.min(1.2, t / 3);
    for (const gen of ['cookieCutter', 'fillingMold'] as const) {
      const r = generateFromSelection(b.selection.contour, [], gen, { ...DEFAULT_PARAMETERS[gen], wallThickness: Math.max(wall, gen === 'fillingMold' ? 0.8 : 0.4) });
      if (!r.ok) throw new Error(`${gen}: ${r.error.message}`);
      if ('mesh' in r.value) expectStlValid(r.value.mesh);
    }
    // Het handvat (min. 8 mm) moet op de band passen: vanaf ± 11,5 mm vormdikte.
    if (t >= 12) {
      const stamp = generateFromSelection(b.selection.contour, [], 'stamp', { ...DEFAULT_PARAMETERS.stamp, handleDiameter: t - 4 });
      if (!stamp.ok) throw new Error(stamp.error.message);
    }
  });

  it('de oppervlakte groeit lineair met de vormdikte (lengte × dikte + ronde uiteinden)', () => {
    const len = sCenterlineMm().slice(1).reduce((s, p, i, arr) => s + Math.hypot(p.x - (i === 0 ? sCenterlineMm()[0] : arr[i - 1]).x, p.y - (i === 0 ? sCenterlineMm()[0] : arr[i - 1]).y), 0);
    for (const t of [3, 6]) {
      const area = build(LETTERS.openS, t).selection.contour.areaMm2;
      const expected = len * t + Math.PI * (t / 2) ** 2;
      expect(Math.abs(area - expected) / expected).toBeLessThan(0.01);
    }
  });

  it('een vormdikte die te smal is voor de wanddikte geeft een duidelijke melding (geen binnenruimte)', () => {
    const b = build(LETTERS.openS, 2);
    const r = generateFromSelection(b.selection.contour, [], 'fillingMold', { ...DEFAULT_PARAMETERS.fillingMold, wallThickness: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('SHAPE_TOO_NARROW');
      expect(r.error.message).toMatch(/vormdikte van 2 mm/);
    }
  });
});

describe('7–9. bochten en zelfkruising', () => {
  it('7. scherpe bochten: afgeronde verbindingen, band op exact de vormdikte, alle generators', () => {
    const b = build(LETTERS.zigzag, 8);
    expectBandFollowsCenterline(b, 8);
    expectAllGeneratorsValid(LETTERS.zigzag);
  });

  it('8. afgeronde bochten (driekwart cirkel): band volgt de boog', () => {
    const b = build(LETTERS.roundArc, 8);
    expectBandFollowsCenterline(b, 8);
    // Randpunten liggen tussen r − 4 en r + 4 rond het middelpunt (50, 50), op de ronde uiteinden na.
    const c = { x: 50 - b.selection.contour.centerOffset.x, y: 50 - b.selection.contour.centerOffset.y };
    for (const p of b.selection.contour.outer) {
      const r = Math.hypot(p.x - c.x, p.y - c.y);
      expect(r).toBeGreaterThan(26 - 0.05);
      expect(r).toBeLessThan(34 + 0.05);
    }
    expectAllGeneratorsValid(LETTERS.roundArc);
  });

  it('9. zelfkruising: één geldige gesloten vorm, lussen opgevuld met melding, alle generators', () => {
    const b = build(LETTERS.selfCrossing, 8);
    const { contour } = b.selection;
    expect(contour.notices.join(' ')).toMatch(/lus vormt of zichzelf kruist/);
    // Het kruispunt (50, 50) en de binnenkant van de lussen vallen binnen de vorm.
    const o = contour.centerOffset;
    expect(pointInRing({ x: 50 - o.x, y: 50 - o.y }, contour.outer)).toBe(true);
    expect(pointInRing({ x: 75 - o.x, y: 50 - o.y }, contour.outer)).toBe(true);
    // Elk randpunt ligt op minstens de halve vormdikte van de middellijn (buitenrand van de band).
    for (const p of contour.outer) {
      const d = Math.min(...b.centerlines.map((c) => distToPolyline(p, c.points)));
      expect(d).toBeGreaterThan(4 - 0.03);
    }
    expectAllGeneratorsValid(LETTERS.selfCrossing);
  });
});

describe('10. te smal of te complex om veilig om te zetten', () => {
  it('een haarfijne gevulde band geeft CENTERLINE_INVALID in plaats van een kapotte vorm', () => {
    const cands = candidatesOf(LETTERS.hairline);
    const roles = defaultRoles(cands);
    const r = buildSelection(cands, roles, BASIC, [], { interpretations: { [cands[0].id]: 'centerline' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('CENTERLINE_INVALID');
      expect(r.error.message).toMatch(/te smal of te complex/);
    }
  });

  it('een fijn raster met honderden vertakkingen geeft CENTERLINE_INVALID', () => {
    const cands = candidatesOf(LETTERS.hatch);
    const big = cands.reduce((a, c) => (c.areaMm2 > a.areaMm2 ? c : a));
    const roles = Object.fromEntries(cands.map((c) => [c.id, c.id === big.id ? ('outer' as const) : ('ignore' as const)]));
    const r = buildSelection(cands, roles, BASIC, [], { interpretations: { [big.id]: 'centerline' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CENTERLINE_INVALID');
  }, 30000);
});

describe('centerline-engine', () => {
  it('rechte strook: middellijn exact in het midden, uiteinden op een halve breedte van de rand', () => {
    const r = extractCenterline({ outers: [[{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 2 }, { x: 0, y: 2 }]], holes: [] });
    expect(r.paths).toHaveLength(1);
    for (const p of r.paths[0].points) expect(p.y).toBeCloseTo(1, 2);
    const xs = r.paths[0].points.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(1, 0);
    expect(Math.max(...xs)).toBeCloseTo(39, 0);
    expect(r.drawnWidthMm).toBeCloseTo(2, 1);
  });

  it('ring (band met gat): een gesloten middellijn', () => {
    const ring = (r: number) => Array.from({ length: 180 }, (_, i) => ({ x: r * Math.cos((i / 180) * 2 * Math.PI), y: r * Math.sin((i / 180) * 2 * Math.PI) }));
    const res = extractCenterline({ outers: [ring(20)], holes: [ring(17)] });
    expect(res.paths).toHaveLength(1);
    expect(res.paths[0].closed).toBe(true);
    for (const p of res.paths[0].points) expect(Math.hypot(p.x, p.y)).toBeCloseTo(18.5, 0);
  });

  it('vertakking (T): drie takken met behoud van de verbinding, zonder randruis-takjes', () => {
    const t = { outers: [[{ x: 0, y: 18 }, { x: 40, y: 18 }, { x: 40, y: 20 }, { x: 0, y: 20 }]], holes: [] };
    const stem = { outers: [[{ x: 19, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 19 }, { x: 19, y: 19 }]], holes: [] };
    const merged = regionToPaths(t).concat(regionToPaths(stem));
    const region = { outers: [], holes: [] } as { outers: Point2[][]; holes: Point2[][] };
    // Vereniging via de band-bouwer (Clipper): eenvoudigste manier om een geldige T-regio te krijgen.
    const union = bandAroundCenterline(
      [
        { points: [{ x: 1, y: 19 }, { x: 39, y: 19 }], closed: false },
        { points: [{ x: 20, y: 1 }, { x: 20, y: 19 }], closed: false },
      ],
      2,
    );
    region.outers = union.outers;
    region.holes = union.holes;
    expect(merged.length).toBe(2);
    const res = extractCenterline(region);
    const total = res.paths.reduce((s, p) => s + p.points.slice(1).reduce((q, x, i) => q + Math.hypot(x.x - p.points[i].x, x.y - p.points[i].y), 0), 0);
    expect(total).toBeGreaterThan(38 + 18 - 2);
    expect(total).toBeLessThan(38 + 18 + 1);
    // Alle middellijnpunten liggen in de T.
    const paths = regionToPaths(region);
    for (const p of res.paths.flatMap((x) => x.points)) expect(pointInPaths(p, paths)).toBe(true);
  });

  it('standaard vormdikte: 8 mm voor cookie cutter en vulvorm, breder voor de stempels (handvat)', () => {
    expect(CENTERLINE.defaultShapeThicknessMm).toBe(8);
    expect(DEFAULT_PARAMETERS.cookieCutter.shapeThickness).toBe(8);
    expect(DEFAULT_PARAMETERS.fillingMold.shapeThickness).toBe(8);
    expect(DEFAULT_PARAMETERS.stamp.shapeThickness).toBe(24);
    expect(DEFAULT_PARAMETERS.cutterStamp.shapeThickness).toBe(27);
  });
});
