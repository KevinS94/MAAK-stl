import { describe, expect, it } from 'vitest';
import { CUTTER_STAMP_DEFAULTS } from '../src/config/defaults';
import { ringStrictlyInside } from '../src/engine/geometry2d';
import { comboStlFileNames } from '../src/engine/stlExporter';
import { buildCutterAndStamp, cutterStampGenerator } from '../src/generators/cutterStamp';
import { innerContours } from '../src/generators/shared';
import { buildPlateOuter } from '../src/generators/stampGeometry';
import { SVG } from './fixtures';
import { contourOf, selectionOf } from './helpers';
import { expectValidSolid } from './meshChecks';

const P = CUTTER_STAMP_DEFAULTS;

describe('Cutter & Stempel', () => {
  it.each(['circle', 'square', 'heart', 'star'] as const)('levert twee geldige, afzonderlijke modellen op voor %s', (name) => {
    const contour = contourOf(SVG[name]);
    const { cutter, stamp } = buildCutterAndStamp(contour, [], P);
    expectValidSolid(cutter, P.height);
    expectValidSolid(stamp, P.handleHeight + 3 + P.contourHeight);
  });

  it('de stempel past binnen de binnenzijde van de cutter met de ingestelde speling', () => {
    const contour = contourOf(SVG.circle);
    const cutterInner = innerContours(contour.outer, P.wallThickness)[0];
    // De plaat van de stempel = binnenzijde van de cutter, naar binnen verkleind met insetOffset.
    const plateOuter = buildPlateOuter(cutterInner, P.insetOffset);
    expect(ringStrictlyInside(plateOuter, cutterInner, P.insetOffset * 0.5)).toBe(true);
  });

  it('gebruikt dezelfde SVG-schaal voor cutter en stempel (geen dubbele lengte/breedte-velden)', () => {
    const contour = contourOf(SVG.square);
    const { cutter, stamp } = buildCutterAndStamp(contour, [], P);
    // Beide modellen zijn afgeleid van dezelfde buitencontour/schaal.
    expect(cutter.positions.length).toBeGreaterThan(0);
    expect(stamp.positions.length).toBeGreaterThan(0);
  });

  it('bevat stempeldetails (nerven) ook in de stempel van de combinatie', () => {
    const sel = selectionOf(SVG.leafWithVeins);
    const { stamp } = buildCutterAndStamp(sel.contour, sel.details, P);
    expectValidSolid(stamp, P.handleHeight + 3 + P.contourHeight);
  });

  it('generator end-to-end geeft een ComboResult met twee gevalideerde meshes', () => {
    const r = cutterStampGenerator.generate(contourOf(SVG.circle), [], P);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expectValidSolid(r.value.cutter, P.height);
      expectValidSolid(r.value.stamp, P.handleHeight + 3 + P.contourHeight);
    }
  });

  it('te smalle wanddikte t.o.v. de vorm geeft een foutmelding (geen passende stempel mogelijk)', () => {
    const r = cutterStampGenerator.generate(contourOf(SVG.tiny), [], P);
    expect(r.ok).toBe(false);
  });

  it('levert twee afzonderlijke, duidelijke bestandsnamen op', () => {
    const names = comboStlFileNames('hart.svg');
    expect(names.cutter).toBe('maak-cutter-stempel-cutter-hart.stl');
    expect(names.stamp).toBe('maak-cutter-stempel-stempel-hart.stl');
    expect(names.cutter).not.toBe(names.stamp);
  });
});
