/**
 * De vier generatortypes getest op exact hetzelfde SVG-bestand: een blad
 * met een gesloten buitencontour en drie open nerven als stempeldetail
 * (zie spec §8: "Gebruik als belangrijke test een blad met een gesloten
 * buitencontour en open nerven als details").
 */
import { describe, expect, it } from 'vitest';
import { COOKIE_CUTTER_DEFAULTS, CUTTER_STAMP_DEFAULTS, FILLING_MOLD_DEFAULTS, STAMP_DEFAULTS, STAMP_INTERNAL } from '../src/config/defaults';
import { generateFromSelection } from '../src/engine/pipeline';
import { cookieCutterGenerator } from '../src/generators/cookieCutter';
import { cutterStampGenerator } from '../src/generators/cutterStamp';
import { fillingMoldGenerator } from '../src/generators/fillingMold';
import { stampGenerator } from '../src/generators/stamp';
import { SVG } from './fixtures';
import { selectionOf } from './helpers';
import { expectValidSolid } from './meshChecks';

describe('alle vier generators op hetzelfde SVG (blad met nerven)', () => {
  const sel = selectionOf(SVG.leafWithVeins);

  it('heeft één gesloten buitencontour en drie open details', () => {
    expect(sel.contour.outer.length).toBeGreaterThan(3);
    expect(sel.details).toHaveLength(3);
  });

  it('cookie cutter: negeert de nerven, gebruikt enkel de buitencontour', () => {
    const r = generateFromSelection(sel.contour, sel.details, 'cookieCutter', COOKIE_CUTTER_DEFAULTS);
    expect(r.ok).toBe(true);
    if (r.ok && 'mesh' in r.value) expectValidSolid(r.value.mesh, COOKIE_CUTTER_DEFAULTS.height);
  });

  it('vulvorm: negeert de nerven, gebruikt enkel de buitencontour', () => {
    const r = generateFromSelection(sel.contour, sel.details, 'fillingMold', FILLING_MOLD_DEFAULTS);
    expect(r.ok).toBe(true);
    if (r.ok && 'mesh' in r.value) expectValidSolid(r.value.mesh, FILLING_MOLD_DEFAULTS.height);
  });

  it('stempel: gebruikt de nerven als verhoogde details', () => {
    const r = generateFromSelection(sel.contour, sel.details, 'stamp', STAMP_DEFAULTS);
    expect(r.ok).toBe(true);
    if (r.ok && 'mesh' in r.value) {
      expectValidSolid(r.value.mesh, STAMP_DEFAULTS.handleHeight + STAMP_INTERNAL.plateThicknessMm + STAMP_DEFAULTS.reliefHeight);
    }
  });

  it('cutter & stempel: levert een cutter en een passende stempel-met-nerven op', () => {
    const r = generateFromSelection(sel.contour, sel.details, 'cutterStamp', CUTTER_STAMP_DEFAULTS);
    expect(r.ok).toBe(true);
    if (r.ok && 'cutter' in r.value) {
      expectValidSolid(r.value.cutter.mesh, CUTTER_STAMP_DEFAULTS.height);
      expectValidSolid(
        r.value.stamp.mesh,
        CUTTER_STAMP_DEFAULTS.handleHeight + STAMP_INTERNAL.plateThicknessMm + CUTTER_STAMP_DEFAULTS.reliefHeight,
      );
    }
  });

  it('alle vier generatoren accepteren hetzelfde contour+details object zonder onderlinge interferentie', () => {
    const results = [
      cookieCutterGenerator.generate(sel.contour, sel.details, COOKIE_CUTTER_DEFAULTS),
      fillingMoldGenerator.generate(sel.contour, sel.details, FILLING_MOLD_DEFAULTS),
      stampGenerator.generate(sel.contour, sel.details, STAMP_DEFAULTS),
      cutterStampGenerator.generate(sel.contour, sel.details, CUTTER_STAMP_DEFAULTS),
    ];
    for (const r of results) expect(r.ok).toBe(true);
  });
});
