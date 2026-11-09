/**
 * Cutter & Stempel: een cookie cutter plus een afzonderlijke stempel die
 * precies binnen de binnenzijde van die cutter past (spec §4.1). Hergebruikt
 * de bestaande cookie-cuttergenerator en de gedeelde stempelgeometrie.
 */
import { CUTTER_STAMP_DEFAULTS, CUTTER_STAMP_PARAMS } from '../config/defaults';
import { toResult } from '../engine/errors';
import { signedArea } from '../engine/geometry2d';
import type { DetailLine, ShapeParameters, ValidatedContour } from '../engine/types';
import { buildCookieCutter } from './cookieCutter';
import { assertParameters, innerContours } from './shared';
import { buildStamp } from './stampGeometry';
import type { ComboGenerator, ComboResult } from './types';

export function buildCutterAndStamp(contour: ValidatedContour, details: DetailLine[], params: ShapeParameters): ComboResult {
  assertParameters(params, CUTTER_STAMP_PARAMS);
  const cutter = buildCookieCutter(contour, params);
  const inners = innerContours(contour.outer, params.wallThickness);
  // Bij een gesplitste binnenruimte (smalle hals) wordt de grootste holte gebruikt.
  const cutterInner = inners.reduce((best, r) => (Math.abs(signedArea(r)) > Math.abs(signedArea(best)) ? r : best));
  const { mesh: stamp } = buildStamp(cutterInner, details, params, true);
  return { cutter, stamp };
}

export const cutterStampGenerator: ComboGenerator = {
  id: 'cutterStamp',
  kind: 'combo',
  label: 'Cutter & Stempel',
  title: 'Cutter & Stempel',
  description: 'Een cookie cutter met een afzonderlijke stempel die er precies in past.',
  defaults: CUTTER_STAMP_DEFAULTS,
  params: CUTTER_STAMP_PARAMS,
  usesDetails: true,
  generate: (contour, details, params) => toResult(() => buildCutterAndStamp(contour, details, params)),
};
