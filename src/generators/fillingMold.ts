/**
 * Vulvorm: een bakje in de vorm van de SVG, met een gesloten bodem,
 * opstaande wanden en een open bovenzijde.
 *
 *   Z = H     ┌─┐         ┌─┐
 *             │ │ uitsparing│ │
 *   Z = b     │ └─────────┘ │   b = bodemdikte
 *   Z = 0     └─────────────┘
 */
import { FILLING_MOLD_DEFAULTS, FILLING_MOLD_INTERNAL, FILLING_MOLD_PARAMS } from '../config/defaults';
import { fail, toResult } from '../engine/errors';
import { MeshBuilder } from '../engine/meshGeneration';
import { FaceTag, type MeshData, type ShapeParameters, type ValidatedContour } from '../engine/types';
import { assertParameters, innerContours } from './shared';
import type { ShapeGenerator } from './types';

export interface FillingMoldOptions {
  floorThickness: number;
  minCavityDepth: number;
}

export function buildFillingMold(
  contour: ValidatedContour,
  params: ShapeParameters,
  opts: FillingMoldOptions = FILLING_MOLD_INTERNAL,
): MeshData {
  assertParameters(params, FILLING_MOLD_PARAMS);
  const H = params.height;
  const b = opts.floorThickness;
  if (!(H > b + opts.minCavityDepth - 1e-9)) {
    fail(
      'INVALID_PARAMETERS',
      `De hoogte moet minstens ${b + opts.minCavityDepth} mm zijn (bodem van ${b} mm plus uitsparing).`,
    );
  }
  const outer = contour.outer;
  const inners = innerContours(outer, params.wallThickness);

  const mb = new MeshBuilder();
  const outerBottom = mb.ringLevel(outer, 0);
  const outerTop = mb.ringLevel(outer, H);
  mb.cap(outerBottom, [], 'down'); // gesloten bodem
  mb.wall(outerBottom, outerTop, 'out', FaceTag.Outer);

  const innerFloor = inners.map((r) => mb.ringLevel(r, b));
  const innerTop = inners.map((r) => mb.ringLevel(r, H));
  inners.forEach((_, i) => {
    mb.cap(innerFloor[i], [], 'up', FaceTag.Inner); // vloer van de uitsparing
    mb.wall(innerFloor[i], innerTop[i], 'in', FaceTag.Inner);
  });

  mb.cap(outerTop, innerTop, 'up'); // bovenrand van de wanden
  return mb.build();
}

export const fillingMoldGenerator: ShapeGenerator = {
  id: 'fillingMold',
  kind: 'single',
  label: 'Vulvorm',
  title: 'Vulvorm',
  description: 'Een hol bakje in de vorm van je ontwerp, met een bodem en opstaande wanden.',
  defaults: FILLING_MOLD_DEFAULTS,
  params: FILLING_MOLD_PARAMS,
  usesDetails: false,
  generate: (contour, _details, params) => toResult(() => buildFillingMold(contour, params)),
};
