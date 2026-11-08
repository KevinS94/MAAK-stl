import type { ParameterLimits } from '../config/defaults';
import { fail } from '../engine/errors';
import { ringStrictlyInside } from '../engine/geometry2d';
import { offsetRing } from '../engine/polygonOffset';
import type { Ring, ShapeParameters } from '../engine/types';

const LABELS: Record<keyof ShapeParameters, string> = {
  length: 'Lengte',
  width: 'Breedte',
  height: 'Hoogte',
  wallThickness: 'Wanddikte',
};

export function assertParameters(params: ShapeParameters, limits: ParameterLimits): void {
  for (const key of Object.keys(LABELS) as (keyof ShapeParameters)[]) {
    const v = params[key];
    const { min, max } = limits[key];
    if (!Number.isFinite(v) || v < min || v > max) {
      fail('INVALID_PARAMETERS', `${LABELS[key]} moet tussen ${min} en ${max} mm liggen.`);
    }
  }
}

/**
 * Binnencontour(en) op `thickness` mm binnen de buitencontour. Als de vorm
 * te smal is, verdwijnt de binnenruimte en volgt een foutmelding.
 */
export function innerContours(outer: Ring, thickness: number): Ring[] {
  const { outers } = offsetRing(outer, -thickness);
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
