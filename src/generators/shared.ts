import { fail } from '../engine/errors';
import { ringStrictlyInside } from '../engine/geometry2d';
import { offsetRing } from '../engine/polygonOffset';
import type { ParamSpec, Ring, ShapeParameters } from '../engine/types';

export function assertParameters(params: ShapeParameters, specs: ParamSpec[]): void {
  for (const spec of specs) {
    const v = params[spec.key];
    if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
      fail('INVALID_PARAMETERS', `${spec.label} moet tussen ${spec.min} en ${spec.max} mm liggen.`);
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
