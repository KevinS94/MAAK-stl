/**
 * Cookie cutter: dunne verticale snijwand met bovenaan een naar buiten
 * verbrede drukrand.
 *
 * Doorsnede (Z = 0 onderaan):
 *
 *   Z = H        ┌──────────┐   bovenrand: buitencontour + flareWidth
 *                │        ╱    verbredingszone (flareHeight hoog)
 *   Z = H - fh   │       │
 *                │       │     verticale snijwand
 *   Z = 0        └───────┘
 *            binnen     buiten (= SVG-contour)
 *
 * De verbreding wordt opgebouwd uit fijne concentrische offsetringen (Clipper2
 * met afgeronde hoeken). Elke ring krijgt een eigen korte verticale wand en
 * wordt met de vorige verbonden door een smalle horizontale strook die als
 * polygoon-met-gat getrianguleerd wordt. Zo hoeven ringen met een
 * verschillend aantal punten nooit punt-per-punt verbonden te worden, en
 * blijft de mesh gegarandeerd gesloten, manifold en zelfsnijdingsvrij.
 * De trapjes (≤ 0,15 mm) liggen onder de laaghoogte van een FDM-printer.
 */
import {
  COOKIE_CUTTER_DEFAULTS,
  COOKIE_CUTTER_INTERNAL,
  COOKIE_CUTTER_PARAMS,
} from '../config/defaults';
import { fail, toResult } from '../engine/errors';
import { ringStrictlyInside } from '../engine/geometry2d';
import { MeshBuilder } from '../engine/meshGeneration';
import { offsetRing } from '../engine/polygonOffset';
import { FaceTag, type MeshData, type Ring, type ShapeParameters, type ValidatedContour } from '../engine/types';
import { assertParameters, innerContours } from './shared';
import type { ShapeGenerator } from './types';

export interface CookieCutterOptions {
  flareWidth: number;
  flareHeight: number;
  minCuttingWallHeight: number;
  flareStepHeight: number;
}

/** Effectieve hoogte van de verbredingszone voor een gegeven totale hoogte. */
export function effectiveFlareHeight(height: number, opts: CookieCutterOptions = COOKIE_CUTTER_INTERNAL): number {
  return Math.max(0, Math.min(opts.flareHeight, height - opts.minCuttingWallHeight));
}

export function buildCookieCutter(
  contour: ValidatedContour,
  params: ShapeParameters,
  opts: CookieCutterOptions = COOKIE_CUTTER_INTERNAL,
): MeshData {
  assertParameters(params, COOKIE_CUTTER_PARAMS);
  const H = params.height;
  const t = params.wallThickness;
  const outer = contour.outer;

  const inners = innerContours(outer, t, contour.centerline?.thicknessMm);

  const flareH = effectiveFlareHeight(H, opts);
  const steps = flareH > 0 && opts.flareWidth > 0 ? Math.max(4, Math.ceil(flareH / opts.flareStepHeight)) : 0;
  const cutTop = H - flareH;

  // Offsetringen voor de verbreding: rings[0] = SVG-contour, rings[steps] = volledig verbreed.
  const rings: Ring[] = [outer];
  for (let k = 1; k <= steps; k++) {
    const { outers, holes } = offsetRing(outer, (opts.flareWidth * k) / steps);
    if (outers.length !== 1 || holes.length > 0) {
      fail(
        'FLARE_INVALID',
        'De drukrand kan voor deze vorm niet gemaakt worden: inkepingen in de vorm liggen te dicht bij elkaar. Vereenvoudig de vorm.',
      );
    }
    const prev = rings[k - 1];
    const gap = opts.flareWidth / steps;
    if (!ringStrictlyInside(prev, outers[0], gap * 0.5)) {
      fail('FLARE_INVALID', 'De drukrand kon niet betrouwbaar berekend worden voor deze vorm.');
    }
    rings.push(outers[0]);
  }

  const mb = new MeshBuilder();

  // Binnenwand(en): volledig verticaal van onder tot boven, open middenruimte.
  const innerBottom = inners.map((r) => mb.ringLevel(r, 0));
  const innerTop = inners.map((r) => mb.ringLevel(r, H));
  inners.forEach((_, i) => mb.wall(innerBottom[i], innerTop[i], 'in', FaceTag.Inner));

  // Snijwand: buitenzijde volgt de SVG-contour.
  const outerBottom = mb.ringLevel(outer, 0);
  mb.cap(outerBottom, innerBottom, 'down'); // snijrand onderaan
  let lowerLevel = outerBottom;
  let currentTop = mb.ringLevel(outer, cutTop);
  mb.wall(lowerLevel, currentTop, 'out', FaceTag.Outer);

  // Verbredingszone: per stap een horizontale strook (naar onder gericht) en een korte wand.
  const dz = steps > 0 ? flareH / steps : 0;
  for (let k = 1; k <= steps; k++) {
    const z = cutTop + (k - 1) * dz;
    const zNext = k === steps ? H : cutTop + k * dz;
    const ringBottom = mb.ringLevel(rings[k], z);
    mb.cap(ringBottom, [currentTop], 'down', FaceTag.Outer);
    lowerLevel = ringBottom;
    currentTop = mb.ringLevel(rings[k], zNext);
    mb.wall(lowerLevel, currentTop, 'out', FaceTag.Outer);
  }

  // Bovenrand: brede drukrand met de binnenopening(en).
  mb.cap(currentTop, innerTop, 'up');
  return mb.build();
}

export const cookieCutterGenerator: ShapeGenerator = {
  id: 'cookieCutter',
  kind: 'single',
  label: 'Cookie cutter',
  title: 'Cookie cutter',
  description: 'Een koekjesuitsteker met een dunne snijwand en een brede drukrand bovenaan.',
  defaults: COOKIE_CUTTER_DEFAULTS,
  params: COOKIE_CUTTER_PARAMS,
  usesDetails: false,
  generate: (contour, _details, params) => toResult(() => buildCookieCutter(contour, params)),
};
