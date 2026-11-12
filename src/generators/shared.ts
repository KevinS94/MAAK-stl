import { fail, GeometryError } from '../engine/errors';
import { ringStrictlyInside } from '../engine/geometry2d';
import { offsetRing } from '../engine/polygonOffset';
import type { ParamSpec, Ring, ShapeParameters, ValidatedContour } from '../engine/types';
import { STAMP_INTERNAL } from '../config/defaults';

export function assertParameters(params: ShapeParameters, specs: ParamSpec[]): void {
  for (const spec of specs) {
    const v = params[spec.key];
    // Conditionele parameters (bv. vormdikte) mogen ontbreken: ze worden niet door de generator zelf gebruikt.
    if (spec.showWhen && v === undefined) continue;
    if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
      fail('INVALID_PARAMETERS', `${spec.label} moet tussen ${spec.min} en ${spec.max} mm liggen.`);
    }
  }
}

/**
 * Binnencontour(en) op `thickness` mm binnen de buitencontour. Als de vorm
 * te smal is, verdwijnt de binnenruimte en volgt een foutmelding. Is de
 * vorm een band rond een middellijn (`bandThicknessMm`), dan verwijst de
 * melding naar de vormdikte.
 */
export function innerContours(outer: Ring, thickness: number, bandThicknessMm?: number): Ring[] {
  const { outers } = offsetRing(outer, -thickness);
  if (outers.length === 0 && bandThicknessMm !== undefined) {
    fail(
      'SHAPE_TOO_NARROW',
      `Een vormdikte van ${bandThicknessMm} mm is te smal voor een wanddikte van ${thickness} mm: er blijft geen binnenruimte over. Kies een vormdikte groter dan ${Math.round(2 * thickness * 10) / 10} mm of een kleinere wanddikte.`,
    );
  }
  if (outers.length === 0) {
    fail(
      'SHAPE_TOO_NARROW',
      `De vorm is te smal voor een wanddikte van ${thickness} mm: er blijft geen binnenruimte over. Kies een grotere vorm of een kleinere wanddikte.`,
    );
  }
  for (const inner of outers) {
    if (!ringStrictlyInside(inner, outer, thickness * 0.9)) {
      fail('SHAPE_TOO_NARROW', 'De binnencontour kon niet betrouwbaar binnen de vorm berekend worden.');
    }
  }
  return outers;
}

/**
 * Een handvat dat niet op de stempelplaat past, krijgt bij een vorm rond een
 * middellijn een concrete oplossing: de vormdikte die nodig is. `narrowingMm`
 * is hoeveel de plaat in totaal smaller is dan de band (bv. 2 × (wanddikte +
 * speling) bij Cutter & Stempel).
 */
export function withHandleHint<T>(contour: ValidatedContour, params: ShapeParameters, narrowingMm: number, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GeometryError && e.code === 'HANDLE_INVALID' && contour.centerline) {
      const needed = Math.ceil((params.handleDiameter + 2 * STAMP_INTERNAL.handleSafetyMarginMm + narrowingMm) * 2) / 2;
      fail(
        'HANDLE_INVALID',
        `Een handvat van ${params.handleDiameter} mm doorsnede past niet op een vorm met een vormdikte van ${contour.centerline.thicknessMm} mm. Kies een vormdikte van minstens ${String(needed).replace('.', ',')} mm of een kleiner handvat.`,
      );
    }
    throw e;
  }
}
