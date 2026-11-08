/**
 * Zet een (opgeschoonde) SVG om naar curve-gebaseerde geometrie met behulp
 * van de officiële Three.js SVGLoader. Transformaties van groepen en
 * individuele vormen worden door SVGLoader toegepast.
 */
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { ShapePath } from 'three';
import { fail, toResult } from './errors';
import { CLIP_GEOMETRY_ATTR, CLIP_TARGET_ATTR, sanitizeSvg } from './svgValidation';
import type { Result, SVGGeometry, SVGShape, SVGSubPath } from './types';

interface LoaderStyle {
  fill?: string;
  fillOpacity?: number;
  fillRule?: string;
  opacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  visibility?: string;
}

function isPainted(paint: string | undefined): boolean {
  if (paint === undefined) return false;
  const p = paint.trim().toLowerCase();
  return p !== 'none' && p !== 'transparent' && p !== '';
}

function toSubPaths(shapePath: ShapePath): SVGSubPath[] {
  return shapePath.subPaths
    .filter((sp) => sp.curves.length > 0)
    .map((sp) => ({ curves: sp.curves, closed: Boolean(sp.autoClose) }));
}

/** Leest de SVG-tekst veilig in. Gooit een GeometryError bij problemen. */
export function parseSvgOrThrow(text: string): SVGGeometry {
  const sanitized = sanitizeSvg(text);
  const notices = new Set(sanitized.notices);

  let data: { paths: ShapePath[] };
  const originalWarn = console.warn;
  try {
    // SVGLoader meldt niet-ondersteunde zaken via console.warn; dat is voor
    // eindgebruikers niet relevant.
    console.warn = () => undefined;
    data = new SVGLoader().parse(sanitized.text);
  } catch (err) {
    return fail('SVG_PARSE', 'Deze SVG kon niet gelezen worden.', err instanceof Error ? err.message : String(err));
  } finally {
    console.warn = originalWarn;
  }

  const shapes: SVGShape[] = [];
  const clipRegions: Record<string, SVGShape[]> = {};
  let strokeOnly = 0;
  let invisible = 0;

  for (const shapePath of data.paths) {
    const userData = (shapePath.userData ?? {}) as { node?: Element; style?: LoaderStyle };
    const node = userData.node;
    const style = userData.style ?? {};
    const elementName = node ? (node.localName || node.nodeName).toLowerCase() : 'path';
    const subPaths = toSubPaths(shapePath);
    if (subPaths.length === 0) continue;
    const fillRule = style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';

    const clipGeometry = node?.closest(`[${CLIP_GEOMETRY_ATTR}]`);
    if (clipGeometry) {
      const key = clipGeometry.getAttribute(CLIP_GEOMETRY_ATTR) ?? '';
      (clipRegions[key] ??= []).push({ subPaths, fillRule, clipIds: [], elementName });
      continue;
    }

    if (style.visibility === 'hidden' || style.opacity === 0) {
      invisible++;
      continue;
    }
    // Een <line> wordt in SVG nooit gevuld, ook al heeft hij een fill.
    const filled = elementName !== 'line' && isPainted(style.fill) && style.fillOpacity !== 0;
    const stroked = isPainted(style.stroke) && (style.strokeWidth ?? 1) > 0 && style.strokeOpacity !== 0;
    if (!filled) {
      if (stroked) strokeOnly++;
      else invisible++;
      continue;
    }
    if (stroked) notices.add('Omlijningen (stroke) worden genegeerd: enkel de gevulde vorm telt.');

    const clipIds: string[] = [];
    let el: Element | null = node ?? null;
    while (el) {
      const key = el.getAttribute(CLIP_TARGET_ATTR);
      if (key) clipIds.push(key);
      el = el.parentElement;
    }
    shapes.push({ subPaths, fillRule, clipIds, elementName });
  }

  if (strokeOnly > 0) {
    fail(
      'SVG_STROKE_ONLY',
      shapes.length > 0
        ? 'De SVG bevat lijnen zonder vulling. Verwijder die lijnen of zet ze om naar een gevulde vorm.'
        : 'De SVG bevat enkel lijnen zonder vulling (open contour). Gebruik een gesloten, gevulde vorm.',
    );
  }
  if (invisible > 0) notices.add('Onzichtbare vormen in de SVG worden genegeerd.');
  if (shapes.length === 0) {
    fail('SVG_EMPTY', 'Er werd geen gevulde vorm gevonden in deze SVG.');
  }

  return { frame: sanitized.frame, shapes, clipRegions, notices: [...notices] };
}

export function parseSvg(text: string): Result<SVGGeometry> {
  return toResult(() => parseSvgOrThrow(text));
}
