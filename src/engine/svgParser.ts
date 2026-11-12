/**
 * Stap A van de SVG-keten: het bestand veilig inlezen en ALLE zichtbare
 * vectorgeometrie herkennen, zonder al te oordelen over "één vorm" of
 * "meerdere vormen". Dat oordeel hoort pas bij de generatorvalidatie, nadat
 * de gebruiker gekozen heeft wat de buitencontour is (zie `svgPaths.ts`).
 *
 * Gebruikt de officiële Three.js SVGLoader; transformaties van groepen en
 * individuele vormen worden door SVGLoader toegepast. Clip-paths worden
 * door `sanitizeSvg` herschreven naar gemarkeerde geometrie, die hier per
 * clip-id verzameld wordt zodat de geometrische stap ze exact (met
 * polygonbewerkingen) kan toepassen.
 */
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { ShapePath } from 'three';
import { fail, toResult } from './errors';
import { CLIP_GEOMETRY_ATTR, CLIP_TARGET_ATTR, sanitizeSvg } from './svgValidation';
import type { Result, SVGFillRule, SVGFrame, SVGGeometry, SVGShape, SVGSubPath } from './types';

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

/** Eén zichtbaar, getekend SVG-element, in tekenvolgorde. */
export interface SceneElement {
  /** Tekenvolgorde (later = bovenop). */
  index: number;
  elementName: string;
  /**
   * `fill`: het element heeft een vulling; de zichtbare geometrie is het
   * gevulde gebied (ook als het een dikke "lijn" is die als gevulde band
   * geëxporteerd werd). `stroke`: enkel een omlijning, geen vulling; de
   * geometrie is een (open of gesloten) lijn.
   */
  kind: 'fill' | 'stroke';
  subPaths: SVGSubPath[];
  fillRule: SVGFillRule;
  /** Id's van alle clipPaths die (via voorouders) op dit element van toepassing zijn. */
  clipIds: string[];
  /** Genormaliseerde kleur van de vulling of omlijning (voor het groeperen tot logische vormen). */
  paint: string;
}

/** Resultaat van stap A: alle zichtbare geometrie, nog zonder rollen. */
export interface SvgScene {
  frame: SVGFrame;
  elements: SceneElement[];
  /** Geometrie per clipPath-id (in hetzelfde coördinatenstelsel als de elementen). */
  clipRegions: Record<string, SVGShape[]>;
  /** Aantal onzichtbare (niet gevulde én niet omlijnde, of verborgen) elementen. */
  invisibleCount: number;
  notices: string[];
}

/**
 * Leest de SVG veilig in en geeft alle zichtbare vectorgeometrie terug.
 * Verwerpt NOOIT op basis van het aantal vormen of open lijnen; enkel
 * onveilige, onleesbare of niet-ondersteunde bestanden en een SVG zonder
 * enige zichtbare geometrie leiden tot een fout.
 */
export function parseSvgSceneOrThrow(text: string): SvgScene {
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

  const elements: SceneElement[] = [];
  const clipRegions: Record<string, SVGShape[]> = {};
  let invisibleCount = 0;

  for (const shapePath of data.paths) {
    const userData = (shapePath.userData ?? {}) as { node?: Element; style?: LoaderStyle };
    const node = userData.node;
    const style = userData.style ?? {};
    const elementName = node ? (node.localName || node.nodeName).toLowerCase() : 'path';
    const subPaths = toSubPaths(shapePath);
    if (subPaths.length === 0) continue;
    const fillRule: SVGFillRule = style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';

    const clipGeometry = node?.closest(`[${CLIP_GEOMETRY_ATTR}]`);
    if (clipGeometry) {
      const key = clipGeometry.getAttribute(CLIP_GEOMETRY_ATTR) ?? '';
      (clipRegions[key] ??= []).push({ subPaths, fillRule, clipIds: [], elementName });
      continue;
    }

    if (style.visibility === 'hidden' || style.opacity === 0) {
      invisibleCount++;
      continue;
    }
    // Een <line> wordt in SVG nooit gevuld, ook al heeft hij een fill.
    const filled = elementName !== 'line' && isPainted(style.fill) && style.fillOpacity !== 0;
    const stroked = isPainted(style.stroke) && (style.strokeWidth ?? 1) > 0 && style.strokeOpacity !== 0;
    if (!filled && !stroked) {
      invisibleCount++;
      continue;
    }
    if (filled && stroked) notices.add('Omlijningen (stroke) van gevulde vormen worden genegeerd: enkel de gevulde vorm telt.');

    const clipIds: string[] = [];
    let el: Element | null = node ?? null;
    while (el) {
      const key = el.getAttribute(CLIP_TARGET_ATTR);
      if (key) clipIds.push(key);
      el = el.parentElement;
    }
    elements.push({
      index: elements.length,
      elementName,
      kind: filled ? 'fill' : 'stroke',
      subPaths,
      fillRule,
      clipIds,
      paint: ((filled ? style.fill : style.stroke) ?? '').trim().toLowerCase(),
    });
  }

  if (invisibleCount > 0) notices.add('Onzichtbare vormen in de SVG worden genegeerd.');
  if (elements.length === 0) fail('SVG_EMPTY', 'Er werd geen zichtbare vorm of lijn gevonden in deze SVG.');

  return { frame: sanitized.frame, elements, clipRegions, invisibleCount, notices: [...notices] };
}

export function parseSvgScene(text: string): Result<SvgScene> {
  return toResult(() => parseSvgSceneOrThrow(text));
}

/**
 * Strikte, klassieke lezing "de hele SVG is één gevulde vorm", gebruikt
 * door `buildContour`/`generateModel` (bibliotheekfuncties en tests). De
 * applicatie zelf gebruikt de rolgebaseerde keten (`svgPaths.ts`), zodat
 * meerdere losse vormen of open lijnen nooit al bij het importeren een
 * fout opleveren.
 */
export function parseSvgOrThrow(text: string): SVGGeometry {
  const scene = parseSvgSceneOrThrow(text);
  const shapes: SVGShape[] = scene.elements
    .filter((e) => e.kind === 'fill')
    .map((e) => ({ subPaths: e.subPaths, fillRule: e.fillRule, clipIds: e.clipIds, elementName: e.elementName }));
  const strokeOnly = scene.elements.length - shapes.length;
  if (strokeOnly > 0) {
    fail(
      'SVG_STROKE_ONLY',
      shapes.length > 0
        ? 'De SVG bevat lijnen zonder vulling. Verwijder die lijnen of zet ze om naar een gevulde vorm.'
        : 'De SVG bevat enkel lijnen zonder vulling (open contour). Gebruik een gesloten, gevulde vorm.',
    );
  }
  return { frame: scene.frame, shapes, clipRegions: scene.clipRegions, notices: scene.notices };
}

export function parseSvg(text: string): Result<SVGGeometry> {
  return toResult(() => parseSvgOrThrow(text));
}
