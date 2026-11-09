/**
 * Veilige voorverwerking van niet-vertrouwde SVG-bestanden.
 *
 * - Het bestand wordt uitsluitend met DOMParser als XML ingelezen. Er wordt
 *   nooit iets in de live pagina geplaatst (geen innerHTML), dus scripts
 *   kunnen nooit uitgevoerd worden.
 * - Actieve inhoud, externe verwijzingen, rasterafbeeldingen en tekst
 *   leiden tot een duidelijke fout in plaats van stil genegeerd te worden.
 * - `<use>` wordt veilig uitgevouwen en `clip-path` wordt herschreven naar
 *   een vorm die de parser kan toepassen.
 */
import { SVG_LIMITS } from '../config/defaults';
import { fail } from './errors';
import type { SVGFrame } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Attribuutnamen die de parser hieronder als markering gebruikt. */
export const CLIP_GEOMETRY_ATTR = 'data-maak-clip';
export const CLIP_TARGET_ATTR = 'data-maak-clip-target';

const ACTIVE_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'audio',
  'video',
  'canvas',
  'handler',
  'listener',
]);
const RASTER_ELEMENTS = new Set(['image', 'feimage']);
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'textpath']);
const REMOVABLE_ELEMENTS = new Set(['metadata', 'title', 'desc']);
const ANIMATION_ELEMENTS = new Set(['animate', 'animatetransform', 'animatemotion', 'set', 'animatecolor']);
/** Containers die zelf niet getekend worden en na verwerking weg mogen. */
const NON_RENDERED_CONTAINERS = new Set(['clippath', 'symbol', 'marker', 'pattern']);
/** Namespaces van ontwerpprogramma's die enkel metadata bevatten. */
const EDITOR_NAMESPACE_HINTS = ['inkscape', 'sodipodi', 'adobe', 'sketch', 'figma', 'canva', 'rdf', 'purl.org/dc', 'creativecommons'];

const EXTERNAL_URL = /url\(\s*['"]?\s*(?!#)[^)\s]/i;

export interface SanitizedSvg {
  /** Opgeschoonde SVG-tekst, veilig om aan de parser te geven. */
  text: string;
  frame: SVGFrame;
  notices: string[];
}

export interface FileLike {
  name: string;
  size: number;
  type?: string;
}

/** Controle vóór het inlezen: extensie, MIME-type en grootte. */
export function validateSvgFile(file: FileLike): void {
  const lower = file.name.toLowerCase();
  const typeOk = !file.type || file.type === 'image/svg+xml' || file.type === 'text/xml' || file.type === 'application/xml';
  if (!lower.endsWith('.svg') || !typeOk) {
    fail('FILE_TYPE', 'Dit is geen SVG-bestand. Kies een bestand dat eindigt op .svg.');
  }
  if (file.size > SVG_LIMITS.maxFileBytes) {
    fail(
      'FILE_TOO_LARGE',
      `Het bestand is te groot (${(file.size / 1024 / 1024).toFixed(1)} MB). Het maximum is ${SVG_LIMITS.maxFileBytes / 1024 / 1024} MB.`,
    );
  }
  if (file.size === 0) fail('SVG_PARSE', 'Het bestand is leeg.');
}

function lname(el: Element): string {
  return (el.localName || el.nodeName).toLowerCase();
}

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.getElementsByTagName('*'))];
}

function findById(doc: Document, id: string): Element | null {
  for (const el of allElements(doc.documentElement)) {
    if (el.getAttribute('id') === id) return el;
  }
  return null;
}

function getHref(el: Element): string | null {
  return el.getAttributeNS(XLINK_NS, 'href') ?? el.getAttribute('xlink:href') ?? el.getAttribute('href');
}

function styleHas(el: Element, prop: string, value?: RegExp): boolean {
  const style = el.getAttribute('style');
  if (!style) return false;
  for (const decl of style.split(';')) {
    const [k, ...rest] = decl.split(':');
    if (k && k.trim().toLowerCase() === prop) {
      return value ? value.test(rest.join(':').trim()) : true;
    }
  }
  return false;
}

function getStyleValue(el: Element, prop: string): string | null {
  const style = el.getAttribute('style');
  if (style) {
    for (const decl of style.split(';')) {
      const [k, ...rest] = decl.split(':');
      if (k && k.trim().toLowerCase() === prop) return rest.join(':').trim();
    }
  }
  return el.getAttribute(prop);
}

function removeStyleProp(el: Element, prop: string): void {
  el.removeAttribute(prop);
  const style = el.getAttribute('style');
  if (!style) return;
  const kept = style
    .split(';')
    .filter((decl) => decl.split(':')[0]?.trim().toLowerCase() !== prop)
    .join(';');
  el.setAttribute('style', kept);
}

const UNIT_TO_PX: Record<string, number> = {
  '': 1,
  px: 1,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  pt: 96 / 72,
  pc: 16,
};

/** Lengte-attribuut omzetten naar SVG-gebruikerseenheden (px). */
function parseLength(value: string | null): number | null {
  if (!value) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|mm|cm|in|pt|pc)?\s*$/i.exec(value);
  if (!m) return null;
  const factor = UNIT_TO_PX[(m[2] ?? '').toLowerCase()];
  const n = parseFloat(m[1]) * factor;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readFrame(svg: Element): SVGFrame {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3], source: 'viewBox' };
    }
    fail('SVG_NO_FRAME', 'De viewBox van deze SVG is ongeldig.');
  }
  const w = parseLength(svg.getAttribute('width'));
  const h = parseLength(svg.getAttribute('height'));
  if (w && h) return { x: 0, y: 0, width: w, height: h, source: 'widthHeight' };
  return fail(
    'SVG_NO_FRAME',
    'Deze SVG heeft geen viewBox of vaste breedte en hoogte, dus de schaal is onbekend. Exporteer opnieuw vanuit Canva.',
  );
}

/** Vervangt `<use>` door een veilige kopie van het doel-element. */
function expandUses(doc: Document): number {
  let expansions = 0;
  for (;;) {
    const uses = Array.from(doc.getElementsByTagNameNS(SVG_NS, 'use'));
    if (uses.length === 0) return expansions;
    for (const use of uses) {
      if (++expansions > SVG_LIMITS.maxUseExpansions) {
        fail('SVG_TOO_COMPLEX', 'Deze SVG bevat te veel herhaalde verwijzingen (<use>).');
      }
      const href = getHref(use) ?? '';
      const target = href.startsWith('#') ? findById(doc, href.slice(1)) : null;
      if (target && (target === use || target.contains(use))) {
        fail('SVG_TOO_COMPLEX', 'Deze SVG bevat een kringverwijzing (<use> verwijst naar zichzelf).');
      }
      if (doc.getElementsByTagName('*').length > SVG_LIMITS.maxElements) {
        fail('SVG_TOO_COMPLEX', 'Deze SVG bevat te veel onderdelen. Vereenvoudig de vorm en probeer opnieuw.');
      }
      const g = doc.createElementNS(SVG_NS, 'g');
      for (const attr of Array.from(use.attributes)) {
        const n = attr.name.toLowerCase();
        if (['href', 'xlink:href', 'x', 'y', 'width', 'height', 'transform', 'id'].includes(n)) continue;
        g.setAttribute(attr.name, attr.value);
      }
      const x = parseFloat(use.getAttribute('x') ?? '0') || 0;
      const y = parseFloat(use.getAttribute('y') ?? '0') || 0;
      const transforms = [use.getAttribute('transform') ?? '', x || y ? `translate(${x} ${y})` : ''];
      const t = transforms.filter(Boolean).join(' ');
      if (t) g.setAttribute('transform', t);
      if (target) {
        if (lname(target) === 'svg') fail('SVG_UNSUPPORTED', 'Geneste <svg>-elementen worden niet ondersteund.');
        if (lname(target) === 'symbol') {
          if (target.hasAttribute('viewBox')) {
            fail('SVG_UNSUPPORTED', 'Symbolen met een eigen viewBox worden nog niet ondersteund.');
          }
          for (const child of Array.from(target.childNodes)) g.appendChild(child.cloneNode(true));
        } else {
          g.appendChild(target.cloneNode(true));
        }
        for (const el of Array.from(g.getElementsByTagName('*'))) el.removeAttribute('id');
      }
      use.parentNode?.replaceChild(g, use);
    }
  }
}

function clipRefId(el: Element): string | null | undefined {
  const value = getStyleValue(el, 'clip-path');
  if (!value || value === 'none') return undefined;
  const m = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(value);
  return m ? m[1] : null;
}

/**
 * Herschrijft elk element met `clip-path` naar een groep met een
 * gemarkeerde kopie van de clip-geometrie, in hetzelfde coördinatenstelsel.
 */
function rewriteClipPaths(doc: Document, notices: Set<string>): void {
  const holders = allElements(doc.documentElement).filter((el) => clipRefId(el) !== undefined);
  // Clipping die niet exact als polygonbewerking verwerkt kan worden: duidelijk
  // melden in plaats van stil te negeren (anders klopt de geometrie niet).
  for (const el of holders) {
    if (clipRefId(el) === null) {
      fail(
        'SVG_UNSUPPORTED',
        'Deze SVG gebruikt een clip-path met een CSS-vorm (bv. circle() of inset()); dat wordt nog niet ondersteund. Gebruik een clipPath-element of exporteer opnieuw.',
      );
    }
    let p: Element | null = el;
    while (p) {
      if (lname(p) === 'clippath') {
        fail(
          'SVG_UNSUPPORTED',
          'Deze SVG gebruikt een clip-path binnen een clipPath-definitie; die combinatie kan niet exact verwerkt worden. Vereenvoudig de clipping of exporteer opnieuw.',
        );
      }
      p = p.parentElement;
    }
  }
  let counter = 0;
  for (const el of holders) {
    const id = clipRefId(el);
    removeStyleProp(el, 'clip-path');
    const clip = id ? findById(doc, id) : null;
    if (!clip || lname(clip) !== 'clippath') {
      notices.add('Een ongeldige clip-path-verwijzing werd genegeerd.');
      continue;
    }
    if (el.closest(`[${CLIP_GEOMETRY_ATTR}]`)) continue;
    if (clip.getAttribute('clipPathUnits') === 'objectBoundingBox') {
      fail('SVG_UNSUPPORTED', 'Deze SVG gebruikt een clip-path in objectBoundingBox-eenheden; dat wordt nog niet ondersteund.');
    }
    let holder: Element;
    if (el === doc.documentElement) {
      holder = doc.createElementNS(SVG_NS, 'g');
      while (el.firstChild) holder.appendChild(el.firstChild);
      el.appendChild(holder);
    } else if (lname(el) === 'g') {
      holder = el;
    } else {
      holder = doc.createElementNS(SVG_NS, 'g');
      const t = el.getAttribute('transform');
      if (t) {
        holder.setAttribute('transform', t);
        el.removeAttribute('transform');
      }
      el.parentNode?.replaceChild(holder, el);
      holder.appendChild(el);
    }
    const key = `c${counter++}`;
    holder.setAttribute(CLIP_TARGET_ATTR, key);
    const geo = doc.createElementNS(SVG_NS, 'g');
    geo.setAttribute(CLIP_GEOMETRY_ATTR, key);
    const ct = clip.getAttribute('transform');
    if (ct) geo.setAttribute('transform', ct);
    for (const child of Array.from(clip.childNodes)) geo.appendChild(child.cloneNode(true));
    for (const shape of allElements(geo)) {
      if (shape === geo) continue;
      shape.removeAttribute('id');
      shape.removeAttribute('class');
      removeStyleProp(shape, 'clip-path');
      const rule = getStyleValue(shape, 'clip-rule') === 'evenodd' ? 'evenodd' : 'nonzero';
      shape.setAttribute(
        'style',
        `fill:#000;fill-opacity:1;opacity:1;visibility:visible;stroke:none;fill-rule:${rule}`,
      );
    }
    holder.insertBefore(geo, holder.firstChild);
  }
}

/**
 * Controleert en schoont de SVG op. Gooit een GeometryError met een
 * Nederlandstalige melding als het bestand geweigerd wordt.
 */
export function sanitizeSvg(text: string): SanitizedSvg {
  if (text.length > SVG_LIMITS.maxFileBytes) {
    fail('FILE_TOO_LARGE', 'Het bestand is te groot om veilig te verwerken.');
  }
  if (/<!ENTITY/i.test(text)) {
    fail('SVG_UNSAFE', 'Deze SVG bevat XML-entiteiten en wordt om veiligheidsredenen geweigerd.');
  }
  if (typeof DOMParser === 'undefined') {
    fail('SVG_PARSE', 'Deze omgeving kan geen SVG-bestanden inlezen.');
  }

  let doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    fail('SVG_PARSE', 'Dit SVG-bestand is beschadigd of geen geldige SVG.');
  }
  if (doc.documentElement && lname(doc.documentElement) === 'svg' && !doc.documentElement.namespaceURI) {
    // Sommige exports laten de SVG-namespace weg; voeg die toe en lees opnieuw in.
    const fixed = text.replace(/<svg(?=[\s>])/i, `<svg xmlns="${SVG_NS}"`);
    doc = new DOMParser().parseFromString(fixed, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      fail('SVG_PARSE', 'Dit SVG-bestand is beschadigd of geen geldige SVG.');
    }
  }
  const root = doc.documentElement;
  if (!root || lname(root) !== 'svg' || (root.namespaceURI && root.namespaceURI !== SVG_NS)) {
    fail('SVG_PARSE', 'Dit bestand bevat geen geldige SVG-afbeelding.');
  }

  const notices = new Set<string>();

  // Eerst ongevaarlijke metadata verwijderen.
  for (const el of allElements(root)) {
    const name = lname(el);
    const ns = el.namespaceURI ?? '';
    if (el === root) continue;
    if (REMOVABLE_ELEMENTS.has(name) || (ns !== SVG_NS && EDITOR_NAMESPACE_HINTS.some((h) => ns.includes(h)))) {
      el.parentNode?.removeChild(el);
    }
  }

  let pathDataLength = 0;
  for (const el of allElements(root)) {
    if (!el.isConnected && el !== root) continue;
    const name = lname(el);
    const ns = el.namespaceURI ?? '';
    if (ns !== SVG_NS) {
      fail('SVG_UNSAFE', 'Deze SVG bevat niet-SVG-inhoud (bijvoorbeeld HTML) en wordt om veiligheidsredenen geweigerd.');
    }
    if (ACTIVE_ELEMENTS.has(name)) {
      fail('SVG_UNSAFE', 'Deze SVG bevat actieve inhoud (zoals scripts of ingesloten HTML) en wordt om veiligheidsredenen geweigerd.');
    }
    if (RASTER_ELEMENTS.has(name)) {
      fail(
        'SVG_RASTER_IMAGE',
        'Deze SVG bevat een rasterafbeelding (foto of pixelafbeelding). Gebruik enkel vectorvormen en exporteer opnieuw.',
      );
    }
    if (TEXT_ELEMENTS.has(name)) {
      fail('SVG_TEXT', 'Deze SVG bevat tekst. Zet tekst eerst om naar een vorm, of gebruik een eenvoudige vorm zonder tekst.');
    }
    if (name === 'mask') fail('SVG_UNSUPPORTED', 'Maskers in SVG worden nog niet ondersteund.');
    if (name === 'svg' && el !== root) fail('SVG_UNSUPPORTED', 'Geneste <svg>-elementen worden niet ondersteund.');
    if (ANIMATION_ELEMENTS.has(name)) {
      el.parentNode?.removeChild(el);
      notices.add('Animaties in de SVG worden genegeerd.');
      continue;
    }
    if (name === 'style') {
      const css = el.textContent ?? '';
      if (/@import/i.test(css) || EXTERNAL_URL.test(css) || /expression\s*\(/i.test(css)) {
        fail('SVG_EXTERNAL_REFERENCE', 'Deze SVG verwijst naar externe bestanden. Exporteer een SVG zonder externe verwijzingen.');
      }
    }
    for (const attr of Array.from(el.attributes)) {
      const an = attr.name.toLowerCase();
      const local = (attr.localName || attr.name).toLowerCase();
      if (an.startsWith('on')) {
        fail('SVG_UNSAFE', 'Deze SVG bevat scriptcode en wordt om veiligheidsredenen geweigerd.');
      }
      if (local === 'href') {
        const v = attr.value.trim();
        if (name === 'a') {
          el.removeAttributeNode(attr);
          continue;
        }
        if (!v.startsWith('#')) {
          fail('SVG_EXTERNAL_REFERENCE', 'Deze SVG verwijst naar externe bestanden. Exporteer een SVG zonder externe verwijzingen.');
        }
      }
      if (EXTERNAL_URL.test(attr.value) || /expression\s*\(|javascript:/i.test(attr.value)) {
        fail('SVG_EXTERNAL_REFERENCE', 'Deze SVG verwijst naar externe bestanden. Exporteer een SVG zonder externe verwijzingen.');
      }
    }
    if (name === 'path') pathDataLength += (el.getAttribute('d') ?? '').length;
    if (name === 'polygon' || name === 'polyline') pathDataLength += (el.getAttribute('points') ?? '').length;
  }
  if (pathDataLength > SVG_LIMITS.maxPathDataLength) {
    fail('SVG_TOO_COMPLEX', 'Deze SVG is te complex om te verwerken. Vereenvoudig de vorm en probeer opnieuw.');
  }

  // Verborgen elementen verwijderen: die zijn ook in Canva niet zichtbaar.
  for (const el of allElements(root)) {
    if (el === root) continue;
    if (el.getAttribute('display') === 'none' || styleHas(el, 'display', /^none/i)) {
      el.parentNode?.removeChild(el);
      notices.add('Verborgen elementen in de SVG worden genegeerd.');
    }
  }

  // <a> is enkel een groep; de link zelf is al verwijderd.
  for (const a of Array.from(root.getElementsByTagNameNS(SVG_NS, 'a'))) {
    const g = doc.createElementNS(SVG_NS, 'g');
    for (const attr of Array.from(a.attributes)) g.setAttribute(attr.name, attr.value);
    while (a.firstChild) g.appendChild(a.firstChild);
    a.parentNode?.replaceChild(g, a);
  }

  expandUses(doc);
  rewriteClipPaths(doc, notices);

  for (const el of allElements(root)) {
    if (el !== root && NON_RENDERED_CONTAINERS.has(lname(el))) el.parentNode?.removeChild(el);
  }

  const count = root.getElementsByTagName('*').length + 1;
  if (count > SVG_LIMITS.maxElements) {
    fail('SVG_TOO_COMPLEX', `Deze SVG bevat te veel onderdelen (${count}). Vereenvoudig de vorm en probeer opnieuw.`);
  }

  const frame = readFrame(root);
  const out = new XMLSerializer().serializeToString(doc);
  return { text: out, frame, notices: [...notices] };
}
