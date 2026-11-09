import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS } from '../src/config/defaults';
import { buildContour } from '../src/engine/contourProcessing';
import { GeometryError } from '../src/engine/errors';
import { pointInRing, ringBounds, signedArea } from '../src/engine/geometry2d';
import { generateFromSelection } from '../src/engine/pipeline';
import { regionArea } from '../src/engine/polygonOffset';
import { parseSvgOrThrow, parseSvgSceneOrThrow } from '../src/engine/svgParser';
import {
  buildSelection,
  buildSelectionOrThrow,
  defaultRoles,
  extractPathCandidates,
  importSvgOrThrow,
  isSelectionUnambiguous,
  selectedOuters,
  transferRoles,
} from '../src/engine/svgPaths';
import type { PathRole, SvgPathCandidate } from '../src/engine/types';
import { buildDetailRegion } from '../src/generators/stampGeometry';
import { canvaLeafSvg, SVG } from './fixtures';
import { BASIC, candidatesOf, contourOf, selectionOf } from './helpers';
import { expectValidSolid } from './meshChecks';

const rolesWith = (cands: SvgPathCandidate[], pick: (c: SvgPathCandidate) => PathRole) =>
  Object.fromEntries(cands.map((c) => [c.id, pick(c)]));

const circleArea = (r: number) => Math.PI * r * r;

describe('stap A: inlezen weigert nooit op basis van meerdere vormen', () => {
  it('twee losse gesloten vormen worden zonder fout geïmporteerd', () => {
    const { candidates, roles } = importSvgOrThrow(SVG.multiple, BASIC);
    expect(candidates).toHaveLength(2);
    expect(Object.values(roles).filter((r) => r === 'outer')).toHaveLength(1);
  });

  it('de strikte "één vorm"-lezing bestaat nog als aparte validatie, maar wordt niet bij het importeren gebruikt', () => {
    const r = buildContour(parseSvgOrThrow(SVG.multiple), BASIC);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SVG_MULTIPLE_SHAPES');
  });
});

describe('1. één gesloten contour', () => {
  it('levert één onderdeel op, automatisch buitencontour, met dezelfde geometrie als de klassieke keten', () => {
    const cands = candidatesOf(SVG.heart);
    expect(cands).toHaveLength(1);
    expect(cands[0].suggestedRole).toBe('outer');
    expect(isSelectionUnambiguous(cands, BASIC)).toBe(true);
    const sel = selectionOf(SVG.heart);
    const legacy = contourOf(SVG.heart);
    expect(sel.details).toHaveLength(0);
    expect(sel.contour.widthMm).toBeCloseTo(legacy.widthMm, 1);
    expect(sel.contour.heightMm).toBeCloseTo(legacy.heightMm, 1);
    expect(sel.contour.areaMm2).toBeCloseTo(legacy.areaMm2, 0);
  });
});

describe('2. twee losse gesloten contouren', () => {
  it('de grootste wordt voorgesteld als buitencontour, de andere (erbuiten) genegeerd', () => {
    const cands = candidatesOf(SVG.circleAndSquare);
    const outer = cands.find((c) => c.suggestedRole === 'outer')!;
    expect(outer.bounds.minX).toBeCloseTo(55, 1);
    expect(cands.find((c) => c.id !== outer.id)!.suggestedRole).toBe('ignore');
    const sel = selectionOf(SVG.circleAndSquare);
    expect(sel.contour.widthMm).toBeCloseTo(40, 1);
    expect(sel.contour.areaMm2).toBeCloseTo(1600, 0);
    expect(sel.details).toHaveLength(0);
  });

  it('beide als buitencontour gekozen: pas DAN volgt de melding over losse delen', () => {
    const cands = candidatesOf(SVG.circleAndSquare);
    const r = buildSelection(cands, rolesWith(cands, () => 'outer'), BASIC);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('SVG_MULTIPLE_SHAPES');
      expect(r.error.message).toMatch(/2 losse delen/);
    }
  });
});

describe('3. gesloten contour met open detaillijnen', () => {
  it('herkent de buitencontour en drie open nerven; de nerven liggen binnen de contour', () => {
    const cands = candidatesOf(SVG.leafWithVeins);
    expect(cands).toHaveLength(4);
    expect(cands.filter((c) => c.kind === 'line' && !c.closed)).toHaveLength(3);
    const sel = selectionOf(SVG.leafWithVeins);
    expect(sel.details).toHaveLength(3);
    for (const d of sel.details) {
      expect(d.region).toBeUndefined();
      for (const p of d.ring) expect(pointInRing(p, sel.contour.outer)).toBe(true);
    }
  });

  it('een open lijn wordt een band van exact de ingestelde detailbreedte', () => {
    // Middennerf: verticale lijn van 65 mm. Band = lengte × breedte + twee halve cirkels.
    const sel = selectionOf(SVG.leafWithVeins);
    const mid = sel.details.find((d) => Math.abs(ringBounds(d.ring).maxY - ringBounds(d.ring).minY - 65) < 0.5)!;
    for (const w of [0.8, 2]) {
      const area = regionArea(buildDetailRegion([mid], w));
      expect(area).toBeCloseTo(65 * w + circleArea(w / 2), 0);
    }
  });

  it('een open lijn kan geen buitencontour zijn', () => {
    const cands = candidatesOf(SVG.leafWithVeins);
    const open = cands.find((c) => !c.closed)!;
    expect(() => selectedOuters(cands, rolesWith(cands, (c) => (c.id === open.id ? 'outer' : 'ignore')))).toThrow(GeometryError);
  });
});

describe('4. gesloten contour met afzonderlijke gevulde detailbanden', () => {
  it('de banden worden gevulde details en worden NIET opnieuw verbreed', () => {
    const cands = candidatesOf(SVG.circleWithFilledBands);
    const details = cands.filter((c) => c.suggestedRole === 'detail');
    expect(details).toHaveLength(2);
    expect(details.every((d) => d.kind === 'region')).toBe(true);
    const sel = selectionOf(SVG.circleWithFilledBands);
    expect(sel.contour.areaMm2).toBeCloseTo(circleArea(40), -1);
    // Getekende oppervlakte: 2 × (40 × 2) = 160 mm², ongeacht de ingestelde detailbreedte.
    for (const detailWidth of [0.4, 1, 3]) {
      expect(regionArea(buildDetailRegion(sel.details, detailWidth))).toBeCloseTo(160, 0);
    }
  });

  it('kruisende banden van dezelfde kleur vormen één logische vorm (overlap telt één keer)', () => {
    const details = candidatesOf(SVG.circleWithCrossingBands).filter((c) => c.suggestedRole === 'detail');
    expect(details).toHaveLength(1);
    expect(details[0].memberIds).toHaveLength(2);
    // 40 × 2 + 2 × 30 − overlap 2 × 2 = 136 mm².
    expect(details[0].areaMm2).toBeCloseTo(136, 0);
  });
});

describe('5. dikke gesloten buitenlijn (ringvorm)', () => {
  it('als gevulde band: de buitencontour wordt de volle schijf, niet de smalle ring', () => {
    const cands = candidatesOf(SVG.thickRing);
    const ring = cands.find((c) => c.suggestedRole === 'outer')!;
    expect(ring.kind).toBe('region');
    expect(ring.region!.holes).toHaveLength(1);
    expect(ring.areaMm2).toBeCloseTo(circleArea(40) - circleArea(36), -1);
    const sel = selectionOf(SVG.thickRing);
    expect(sel.contour.areaMm2).toBeCloseTo(circleArea(40), -1);
    expect(sel.contour.widthMm).toBeCloseTo(80, 0);
    expect(sel.contour.notices.join(' ')).toMatch(/volledig opgevuld/);
    // De nerf binnenin wordt detail en ligt binnen het silhouet.
    expect(sel.details).toHaveLength(1);
    for (const p of sel.details[0].region!.outers[0]) expect(pointInRing(p, sel.contour.outer)).toBe(true);
  });

  it('de binnenrand wordt geen uitsparing: een vulvorm heeft de volle schijf als holte', () => {
    const sel = selectionOf(SVG.thickRing);
    const r = generateFromSelection(sel.contour, sel.details, 'fillingMold', DEFAULT_PARAMETERS.fillingMold);
    expect(r.ok).toBe(true);
    if (r.ok && 'mesh' in r.value) {
      expectValidSolid(r.value.mesh, 20);
      // Volume = schijf × hoogte − holte (schijf − 2 mm wand) × (hoogte − 2 mm bodem).
      const expected = circleArea(40) * 20 - circleArea(38) * 18;
      expect(r.value.report.volumeMm3).toBeCloseTo(expected, -2);
    }
  });

  it('als omlijnde gesloten lijn (stroke zonder vulling): de lijn begrenst de buitencontour', () => {
    const sel = selectionOf(SVG.strokedRing);
    expect(sel.contour.areaMm2).toBeCloseTo(circleArea(38), -1);
  });
});

describe('6. geneste clipPaths', () => {
  it('worden exact als polygondoorsnede toegepast, inclusief getransformeerde groepen', () => {
    const cands = candidatesOf(SVG.nestedClips);
    expect(cands).toHaveLength(1);
    const c = cands[0];
    expect(c.areaMm2).toBeCloseTo(circleArea(30) / 2, -1);
    expect(c.bounds.minX).toBeCloseTo(50, 1);
    expect(c.bounds.maxX).toBeCloseTo(80, 1);
    expect(c.bounds.maxY - c.bounds.minY).toBeCloseTo(60, 1);
  });

  it('een omlijnde lijn wordt exact bijgesneden tot het zichtbare stuk', () => {
    const line = candidatesOf(SVG.clippedStroke).find((c) => c.kind === 'line')!;
    expect(line.lengthMm).toBeCloseTo(40, 1);
    expect(line.bounds.minX).toBeCloseTo(20, 1);
    expect(line.bounds.maxX).toBeCloseTo(60, 1);
  });

  it('niet exact verwerkbare clipping geeft een specifieke melding in plaats van stil genegeerd te worden', () => {
    expect(() => parseSvgSceneOrThrow(SVG.clipInsideClip)).toThrow(/clip-path binnen een clipPath/);
  });
});

describe('7. het Canva-blad (getekende rand + nerven via geneste clipping)', () => {
  const svg = canvaLeafSvg();

  it('wordt zonder fout ingelezen tot twee logische vormen: de rand en de nerven', () => {
    const { candidates } = importSvgOrThrow(svg, BASIC);
    expect(candidates).toHaveLength(2);
    const rim = candidates.find((c) => c.suggestedRole === 'outer')!;
    const veins = candidates.find((c) => c.suggestedRole === 'detail')!;
    // De rand bestaat uit meerdere geclipte stukken die samen één band met binnenruimte vormen.
    expect(rim.kind).toBe('region');
    expect(rim.elementIndices.length).toBeGreaterThan(1);
    expect(rim.region!.outers).toHaveLength(1);
    expect(rim.region!.holes).toHaveLength(1);
    expect(veins.kind).toBe('region');
    expect(veins.elementIndices).toHaveLength(1);
    // De nerven liggen in de binnenruimte van de rand.
    for (const p of veins.region!.outers[0]) expect(pointInRing(p, rim.region!.holes[0])).toBe(true);
  });

  it('de buitencontour is het volledige, gesloten blad (niet de smalle getekende rand)', () => {
    const { candidates } = importSvgOrThrow(svg, BASIC);
    const rim = candidates.find((c) => c.suggestedRole === 'outer')!;
    const sel = selectionOf(svg);
    expect(sel.contour.areaMm2).toBeCloseTo(rim.silhouetteAreaMm2, -1);
    expect(sel.contour.areaMm2).toBeGreaterThan(3 * rim.areaMm2);
    // Bladgrootte in het 100 × 100 mm-kader (viewBox 283,5 eenheden).
    expect(sel.contour.widthMm).toBeGreaterThan(68);
    expect(sel.contour.widthMm).toBeLessThan(73);
    expect(sel.contour.heightMm).toBeGreaterThan(78);
    expect(sel.contour.heightMm).toBeLessThan(84);
    expect(signedArea(sel.contour.outer)).toBeGreaterThan(0);
  });

  it('de nerven worden een gevuld detail binnen het blad, op hun getekende breedte', () => {
    const { candidates } = importSvgOrThrow(svg, BASIC);
    const veins = candidates.find((c) => c.suggestedRole === 'detail')!;
    const sel = selectionOf(svg);
    expect(sel.details).toHaveLength(1);
    const d = sel.details[0];
    expect(d.region).toBeDefined();
    for (const p of d.region!.outers.flat()) expect(pointInRing(p, sel.contour.outer)).toBe(true);
    expect(regionArea(buildDetailRegion(sel.details, 3))).toBeCloseTo(veins.areaMm2, 0);
  });

  it('Stempel verwerkt de nerven en Cutter & Stempel levert twee geldige modellen', () => {
    const sel = selectionOf(svg);
    const stamp = generateFromSelection(sel.contour, sel.details, 'stamp', DEFAULT_PARAMETERS.stamp);
    expect(stamp.ok).toBe(true);
    const noDetails = generateFromSelection(sel.contour, [], 'stamp', DEFAULT_PARAMETERS.stamp);
    expect(noDetails.ok).toBe(true);
    if (stamp.ok && noDetails.ok && 'mesh' in stamp.value && 'mesh' in noDetails.value) {
      expect(stamp.value.report.valid).toBe(true);
      // Het nervenreliëf voegt volume toe: ongeveer de nervenoppervlakte × de reliëfhoogte.
      const extra = stamp.value.report.volumeMm3 - noDetails.value.report.volumeMm3;
      const veinsArea = regionArea(buildDetailRegion(sel.details, DEFAULT_PARAMETERS.stamp.detailWidth));
      expect(extra).toBeGreaterThan(0.9 * veinsArea * DEFAULT_PARAMETERS.stamp.reliefHeight);
      expect(extra).toBeLessThan(1.05 * veinsArea * DEFAULT_PARAMETERS.stamp.reliefHeight);
    }
    const combo = generateFromSelection(sel.contour, sel.details, 'cutterStamp', DEFAULT_PARAMETERS.cutterStamp);
    expect(combo.ok).toBe(true);
    if (combo.ok && 'cutter' in combo.value) {
      expect(combo.value.cutter.report.valid).toBe(true);
      expect(combo.value.stamp.report.valid).toBe(true);
      expect(combo.value.cutter.report.components).toBe(1);
      expect(combo.value.stamp.report.components).toBe(1);
    }
  });

  it('cookie cutter en vulvorm volgen het volle blad', () => {
    const sel = selectionOf(svg);
    for (const gen of ['cookieCutter', 'fillingMold'] as const) {
      const r = generateFromSelection(sel.contour, sel.details, gen, DEFAULT_PARAMETERS[gen]);
      expect(r.ok).toBe(true);
      if (r.ok && 'mesh' in r.value) expectValidSolid(r.value.mesh, DEFAULT_PARAMETERS[gen].height);
    }
  });

  it('afzonderlijke onderdelen tonen behoudt de keuze van de gebruiker en dezelfde contour', () => {
    const scene = parseSvgSceneOrThrow(svg);
    const shapes = extractPathCandidates(scene, BASIC, 'shapes');
    const elements = extractPathCandidates(scene, BASIC, 'elements');
    expect(elements.length).toBeGreaterThan(shapes.length);
    const roles = transferRoles(shapes, defaultRoles(shapes), elements);
    const a = buildSelectionOrThrow(shapes, defaultRoles(shapes), BASIC);
    const b = buildSelectionOrThrow(elements, roles, BASIC);
    expect(b.contour.areaMm2).toBeCloseTo(a.contour.areaMm2, -1);
    expect(b.details).toHaveLength(1);
  });
});

describe('8. de gebruiker wijzigt de buitencontour', () => {
  it('een andere vorm als buitencontour kiezen verandert positie en grootte van de contour', () => {
    const cands = candidatesOf(SVG.circleAndSquare);
    const circle = cands.find((c) => c.bounds.maxX < 50)!;
    const sel = buildSelectionOrThrow(cands, rolesWith(cands, (c) => (c.id === circle.id ? 'outer' : 'ignore')), BASIC);
    expect(sel.contour.widthMm).toBeCloseTo(30, 0);
    expect(sel.contour.areaMm2).toBeCloseTo(circleArea(15), -1);
    expect(sel.contour.centerOffset.x).toBeCloseTo(25, 0);
  });

  it('Canva-blad: enkel één stuk van de rand als buitencontour geeft een ander (kleiner) silhouet', () => {
    const svg = canvaLeafSvg();
    const elements = candidatesOf(svg, BASIC, 'elements');
    const biggest = elements.reduce((a, b) => (b.areaMm2 > a.areaMm2 ? b : a));
    const full = selectionOf(svg);
    const partial = buildSelectionOrThrow(elements, rolesWith(elements, (c) => (c.id === biggest.id ? 'outer' : 'ignore')), BASIC);
    expect(partial.contour.areaMm2).toBeLessThan(0.5 * full.contour.areaMm2);
  });

  it('details kunnen individueel genegeerd worden', () => {
    const cands = candidatesOf(SVG.leafWithVeins);
    const roles = defaultRoles(cands);
    roles[cands.find((c) => roles[c.id] === 'detail')!.id] = 'ignore';
    expect(buildSelectionOrThrow(cands, roles, BASIC).details).toHaveLength(2);
  });

  it('zonder gekozen buitencontour kan er niet gestart worden', () => {
    const cands = candidatesOf(SVG.onlyOpenLines);
    const r = buildSelection(cands, defaultRoles(cands), BASIC);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NO_OUTER_SELECTED');
  });

  it('een gesloten detail (omlijnde ring) naast de buitencontour blijft een lijn-detail', () => {
    const sel = selectionOf(SVG.circleWithClosedDetail);
    expect(sel.details).toHaveLength(1);
    expect(sel.details[0].closed).toBe(true);
    expect(sel.details[0].region).toBeUndefined();
  });
});
