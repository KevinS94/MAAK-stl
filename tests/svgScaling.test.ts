import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS } from '../src/config/defaults';
import { buildContour } from '../src/engine/contourProcessing';
import { ringBounds } from '../src/engine/geometry2d';
import { parseSvgOrThrow } from '../src/engine/svgParser';
import { createFrameMapping, frameSizeFor } from '../src/engine/svgScaling';
import { SVG } from './fixtures';
import { BASIC, contourOf } from './helpers';

describe('schaalconversie op basis van het SVG-referentiekader', () => {
  it('Basis: contour van 60 × 40 eenheden in een 100 × 100-viewBox wordt 60 × 40 mm', () => {
    const c = contourOf(SVG.rect60x40);
    expect(c.widthMm).toBeCloseTo(60, 3);
    expect(c.heightMm).toBeCloseTo(40, 3);
  });

  it('Expert: kader 200 × 120 mm maakt dezelfde contour 120 × 48 mm (niet-proportioneel)', () => {
    const c = contourOf(SVG.rect60x40, { length: 200, width: 120 });
    expect(c.widthMm).toBeCloseTo(120, 3);
    expect(c.heightMm).toBeCloseTo(48, 3);
  });

  it('de contour wordt niet opgerekt tot het kader (lege ruimte telt mee)', () => {
    const c = contourOf(SVG.tiny);
    expect(c.widthMm).toBeCloseTo(2, 3);
    expect(c.heightMm).toBeCloseTo(2, 3);
  });

  it('verhouding blijft behouden in Basis (hart ≈ 76 × 68 mm, zoals in het frame)', () => {
    const c = contourOf(SVG.heart);
    expect(c.widthMm).toBeGreaterThan(75);
    expect(c.widthMm).toBeLessThan(77);
    expect(c.heightMm).toBeGreaterThan(67);
    expect(c.heightMm).toBeLessThan(69);
  });

  it('de geometrie wordt gecentreerd zonder de afmetingen te wijzigen', () => {
    const c = contourOf(SVG.rect60x40);
    const b = ringBounds(c.outer);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 6);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0, 6);
    expect(b.maxX - b.minX).toBeCloseTo(60, 3);
    expect(c.centerOffset.x).toBeCloseTo(50, 3);
    expect(c.centerOffset.y).toBeCloseTo(50, 3);
  });

  it('viewBox in pixels (zoals Canva) wordt correct omgezet; achtergrond en clip-path verwerkt', () => {
    // 150 × 75 px in een frame van 375 px = 40 × 20 mm.
    const c = contourOf(SVG.canvaLike);
    expect(c.widthMm).toBeCloseTo(40, 3);
    expect(c.heightMm).toBeCloseTo(20, 3);
    expect(c.notices.join(' ')).toMatch(/achtergrond/i);
  });

  it('breedte/hoogte in mm zonder viewBox wordt gebruikt als kader', () => {
    const c = contourOf(SVG.mmNoViewBox);
    expect(c.widthMm).toBeCloseTo(60, 2);
  });

  it('respecteert transformaties op groepen en elementen', () => {
    const c = contourOf(SVG.transformed);
    expect(c.widthMm).toBeCloseTo(40, 3);
    expect(c.heightMm).toBeCloseTo(30, 3);
  });

  it('respecteert <use>-verwijzingen', () => {
    const c = contourOf(SVG.useRef);
    expect(c.widthMm).toBeCloseTo(30, 3);
    expect(c.heightMm).toBeCloseTo(20, 3);
  });

  it('past clip-paths toe', () => {
    const c = contourOf(SVG.clipped);
    expect(c.widthMm).toBeCloseTo(30, 3);
    expect(c.heightMm).toBeCloseTo(60, 3);
  });

  it('Y-as wordt omgedraaid: SVG-boven is mm-boven', () => {
    const m = createFrameMapping({ x: 0, y: 0, width: 100, height: 100, source: 'viewBox' }, BASIC);
    expect(m.map({ x: 0, y: 0 })).toEqual({ x: 0, y: 100 });
    expect(m.map({ x: 100, y: 100 })).toEqual({ x: 100, y: 0 });
  });

  it('viewBox met verschoven oorsprong', () => {
    const svg = SVG.rect60x40.replace('viewBox="0 0 100 100"', 'viewBox="10 10 100 100"');
    const c = contourOf(svg);
    expect(c.widthMm).toBeCloseTo(60, 3);
    expect(c.centerOffset.x).toBeCloseTo(40, 3);
  });

  it('frameSizeFor: Basis negeert expertwaarden', () => {
    expect(frameSizeFor('basis', { length: 200, width: 120, height: 1, wallThickness: 1 })).toEqual({ length: 100, width: 100 });
    expect(frameSizeFor('expert', { ...DEFAULT_PARAMETERS.cookieCutter, length: 200, width: 120 })).toEqual({
      length: 200,
      width: 120,
    });
  });

  it('curves worden fijn genoeg gediscretiseerd (cirkel r = 35 mm)', () => {
    const c = contourOf(SVG.circle);
    let maxDev = 0;
    let maxSeg = 0;
    for (let i = 0; i < c.outer.length; i++) {
      const p = c.outer[i];
      const q = c.outer[(i + 1) % c.outer.length];
      maxDev = Math.max(maxDev, Math.abs(Math.hypot(p.x, p.y) - 35));
      maxSeg = Math.max(maxSeg, Math.hypot(q.x - p.x, q.y - p.y));
    }
    expect(maxDev).toBeLessThan(0.01);
    // Koordefout (sagitta = s² / 8r) blijft ruim onder de printnauwkeurigheid.
    expect((maxSeg * maxSeg) / (8 * 35)).toBeLessThan(0.002);
  });

  it('overlappende vormen worden samengevoegd tot één contour', () => {
    const c = contourOf(SVG.overlapping);
    expect(c.widthMm).toBeCloseTo(60, 2);
    expect(c.heightMm).toBeCloseTo(40, 2);
  });

  it('openingen binnenin worden gemeld en enkel de buitencontour gebruikt', () => {
    const c = contourOf(SVG.donut);
    expect(c.widthMm).toBeCloseTo(80, 1);
    expect(c.notices.join(' ')).toMatch(/Openingen/);
  });

  it('buildContour geeft een gestructureerd resultaat', () => {
    const r = buildContour(parseSvgOrThrow(SVG.square), BASIC);
    expect(r.ok).toBe(true);
  });
});
