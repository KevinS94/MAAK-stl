import { describe, expect, it } from 'vitest';
import { buildContour } from '../src/engine/contourProcessing';
import { GeometryError } from '../src/engine/errors';
import { parseSvg } from '../src/engine/svgParser';
import { validateSvgFile } from '../src/engine/svgValidation';
import type { GeometryValidationError } from '../src/engine/types';
import { SVG } from './fixtures';
import { BASIC } from './helpers';

function check(svg: string): GeometryValidationError | null {
  const parsed = parseSvg(svg);
  if (!parsed.ok) return parsed.error;
  const contour = buildContour(parsed.value, BASIC);
  return contour.ok ? null : contour.error;
}

describe('SVG-validatie en veiligheid', () => {
  it.each([
    ['square', null],
    ['rect60x40', null],
    ['circle', null],
    ['heart', null],
    ['star', null],
    ['concave', null],
    ['overlapping', null],
    ['canvaLike', null],
    ['openStroke', 'SVG_STROKE_ONLY'],
    ['openFilled', 'SVG_OPEN_CONTOUR'],
    ['multiple', 'SVG_MULTIPLE_SHAPES'],
    ['raster', 'SVG_RASTER_IMAGE'],
    ['script', 'SVG_UNSAFE'],
    ['foreignObject', 'SVG_UNSAFE'],
    ['onload', 'SVG_UNSAFE'],
    ['externalUse', 'SVG_EXTERNAL_REFERENCE'],
    ['externalFill', 'SVG_EXTERNAL_REFERENCE'],
    ['text', 'SVG_TEXT'],
    ['noFrame', 'SVG_NO_FRAME'],
    ['entity', 'SVG_UNSAFE'],
    ['broken', 'SVG_PARSE'],
  ] as const)('%s → %s', (name, expected) => {
    expect(check(SVG[name])?.code ?? null).toBe(expected);
  });

  it('geeft begrijpelijke Nederlandse meldingen', () => {
    expect(check(SVG.multiple)?.message).toMatch(/2 losse vormen/);
    expect(check(SVG.raster)?.message).toMatch(/rasterafbeelding/);
    expect(check(SVG.openFilled)?.message).toMatch(/niet gesloten/);
    expect(check(SVG.openStroke)?.message).toMatch(/lijnen zonder vulling/);
  });

  it('weigert te grote, lege en verkeerde bestanden', () => {
    expect(() => validateSvgFile({ name: 'a.svg', size: 5 * 1024 * 1024, type: 'image/svg+xml' })).toThrow(GeometryError);
    expect(() => validateSvgFile({ name: 'a.png', size: 100, type: 'image/png' })).toThrow(/geen SVG/);
    expect(() => validateSvgFile({ name: 'a.svg', size: 0, type: 'image/svg+xml' })).toThrow(/leeg/);
    expect(() => validateSvgFile({ name: 'Hart.SVG', size: 1000, type: '' })).not.toThrow();
  });

  it('weigert te complexe bestanden', () => {
    const many = Array.from({ length: 6000 }, (_, i) => `<rect x="${i % 90}" y="10" width="1" height="1"/>`).join('');
    expect(check(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${many}</svg>`)?.code).toBe('SVG_TOO_COMPLEX');
  });

  it('weigert recursieve <use>-verwijzingen', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="a"><rect width="10" height="10"/><use href="#a"/></g></svg>';
    expect(check(svg)?.code).toBe('SVG_TOO_COMPLEX');
  });

  it('negeert verborgen elementen en metadata, en aanvaardt SVG zonder namespace', () => {
    const svg =
      '<svg viewBox="0 0 100 100"><metadata><x>y</x></metadata><title>t</title><rect x="1" y="1" width="98" height="5" display="none"/><circle cx="50" cy="50" r="20"/></svg>';
    expect(check(svg)).toBeNull();
  });

  it('voert nooit scripts uit, ook niet tijdens het inlezen', () => {
    const w = window as unknown as { __pwned?: boolean };
    w.__pwned = false;
    parseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>window.__pwned = true</script></svg>');
    parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="window.__pwned = true"><rect width="5" height="5"/></svg>',
    );
    expect(w.__pwned).toBe(false);
  });
});
