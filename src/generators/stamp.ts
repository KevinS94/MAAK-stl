/**
 * Zelfstandige stempel: basisplaat die de buitencontour volgt (standaard
 * zonder inset), met een verhoogde contourlijn, verhoogde detaillijnen
 * (uit de SVG-selector, rol "Stempeldetail") en een cilindrisch handvat op
 * de achterkant. Zie `stampGeometry.ts` voor de geometrie-opbouw.
 */
import { STAMP_DEFAULTS, STAMP_PARAMS } from '../config/defaults';
import { toResult } from '../engine/errors';
import type { DetailLine, MeshData, ShapeParameters, ValidatedContour } from '../engine/types';
import { assertParameters, withHandleHint } from './shared';
import { buildStamp } from './stampGeometry';
import type { ShapeGenerator } from './types';

export function buildStandaloneStamp(contour: ValidatedContour, details: DetailLine[], params: ShapeParameters): MeshData {
  assertParameters(params, STAMP_PARAMS);
  return withHandleHint(contour, params, 2 * (params.insetOffset ?? 0), () => buildStamp(contour.outer, details, params, true).mesh);
}

export const stampGenerator: ShapeGenerator = {
  id: 'stamp',
  kind: 'single',
  label: 'Stempel',
  title: 'Stempel',
  description: 'Een stempel met een verhoogde contourlijn, verhoogde details en een handvat.',
  defaults: STAMP_DEFAULTS,
  params: STAMP_PARAMS,
  usesDetails: true,
  generate: (contour, details, params) => toResult(() => buildStandaloneStamp(contour, details, params)),
};
