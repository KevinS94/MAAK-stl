/**
 * Schaalconversie van SVG-gebruikerseenheden naar millimeter.
 *
 * Het volledige SVG-referentiekader (viewBox) komt overeen met het fysieke
 * kader: 100 × 100 mm in Basismodus, of lengte × breedte in Expertmodus.
 * Er wordt bewust NIET geschaald op de bounding box van de zichtbare vorm:
 * lege ruimte in het Canva-frame blijft meetellen.
 */
import { BASIC_FRAME_MM } from '../config/defaults';
import type { ApplicationMode, FrameSizeMm, Point2, SVGFrame, ShapeParameters } from './types';

export interface FrameMapping {
  /** mm per SVG-eenheid in X. */
  sx: number;
  /** mm per SVG-eenheid in Y. */
  sy: number;
  frameMm: FrameSizeMm;
  /** Zet een SVG-punt (Y omlaag) om naar mm in het kader (Y omhoog, oorsprong linksonder). */
  map(p: Point2): Point2;
}

export function createFrameMapping(frame: SVGFrame, target: FrameSizeMm): FrameMapping {
  const sx = target.length / frame.width;
  const sy = target.width / frame.height;
  return {
    sx,
    sy,
    frameMm: { ...target },
    map: (p) => ({ x: (p.x - frame.x) * sx, y: (frame.height - (p.y - frame.y)) * sy }),
  };
}

/** Kadergrootte die bij de gekozen modus en parameters hoort. */
export function frameSizeFor(mode: ApplicationMode, params: ShapeParameters): FrameSizeMm {
  if (mode === 'basis') return { length: BASIC_FRAME_MM.length, width: BASIC_FRAME_MM.width };
  return { length: params.length, width: params.width };
}
