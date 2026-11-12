import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Test-SVG's. Allemaal in een viewBox van 100 × 100 (= Canva-frame van 100 × 100 mm). */
const wrap = (body: string, viewBox = '0 0 100 100') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox}">${body}</svg>`;

function starPoints(cx: number, cy: number, R: number, r: number, n = 5): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(4)},${(cy + rad * Math.sin(a)).toFixed(4)}`);
  }
  return pts.join(' ');
}

export const SVG = {
  square: wrap('<rect x="20" y="20" width="60" height="60" fill="#f26b1d"/>'),
  /** Contour van 60 × 40 eenheden in een kader van 100 × 100. */
  rect60x40: wrap('<rect x="20" y="30" width="60" height="40"/>'),
  circle: wrap('<circle cx="50" cy="50" r="35"/>'),
  heart: wrap(
    '<path d="M50 85 C 20 65, 5 45, 15 28 C 25 12, 45 15, 50 30 C 55 15, 75 12, 85 28 C 95 45, 80 65, 50 85 Z"/>',
  ),
  star: wrap(`<polygon points="${starPoints(50, 52, 42, 18)}"/>`),
  /** Concave L-/C-vorm. */
  concave: wrap('<path d="M15 15 H85 V35 H40 V65 H85 V85 H15 Z"/>'),
  openStroke: wrap('<path d="M10 10 L 90 10 L 90 90" fill="none" stroke="#000" stroke-width="2"/>'),
  openFilled: wrap('<path d="M10 10 L 90 10 L 90 90"/>'),
  multiple: wrap('<circle cx="25" cy="50" r="15"/><circle cx="75" cy="50" r="15"/>'),
  overlapping: wrap('<circle cx="40" cy="50" r="20"/><circle cx="60" cy="50" r="20"/>'),
  raster: wrap('<image x="0" y="0" width="100" height="100" href="data:image/png;base64,iVBORw0KGgo="/>'),
  script: wrap('<script>alert(1)</script><circle cx="50" cy="50" r="30"/>'),
  foreignObject: wrap('<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><circle cx="50" cy="50" r="30"/>'),
  onload: wrap('<circle cx="50" cy="50" r="30" onclick="alert(1)"/>'),
  externalUse: wrap('<use href="https://example.com/a.svg#x"/>'),
  externalFill: wrap('<circle cx="50" cy="50" r="30" fill="url(https://example.com/x.svg#g)"/>'),
  text: wrap('<text x="10" y="50">Hallo</text>'),
  /** Canva-achtig: px-viewBox, achtergrond, clipPath, groepstransformaties. */
  canvaLike: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="375" zoomAndPan="magnify" viewBox="0 0 375 375" height="375" preserveAspectRatio="xMidYMid meet" version="1.0"><defs><clipPath id="c1"><path d="M 0 0 L 375 0 L 375 375 L 0 375 Z" clip-rule="nonzero"/></clipPath></defs><rect x="-37.5" width="450" fill="#ffffff" y="-37.5" height="450" fill-opacity="1"/><g clip-path="url(#c1)"><g transform="translate(187.5 187.5) scale(1.5)"><rect x="-50" y="-25" width="100" height="50" fill="#000000"/></g></g></svg>`,
  /** Clip die de helft van de vorm wegsnijdt. */
  clipped: wrap('<defs><clipPath id="half"><rect x="0" y="0" width="50" height="100"/></clipPath></defs><rect x="20" y="20" width="60" height="60" clip-path="url(#half)"/>'),
  /** Transformatie op een groep én op het element. */
  transformed: wrap('<g transform="translate(50 50)"><rect x="-10" y="-5" width="20" height="10" transform="scale(2 3)"/></g>'),
  useRef: wrap('<defs><rect id="r" x="0" y="0" width="30" height="20"/></defs><use href="#r" x="10" y="10"/>'),
  noFrame: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="30"/></svg>',
  mmNoViewBox: '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm"><circle cx="188.97638" cy="188.97638" r="113.38583"/></svg>',
  tiny: wrap('<rect x="49" y="49" width="2" height="2"/>'),
  narrowNeck: wrap('<path d="M10 30 H45 V49.6 H55 V30 H90 V70 H55 V50.4 H45 V70 H10 Z"/>'),
  donut: wrap('<path fill-rule="evenodd" d="M50 10 A40 40 0 1 1 49.99 10 Z M50 30 A20 20 0 1 0 50.01 30 Z"/>'),
  entity: '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30"/></svg>',
  broken: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50"',
  /** Gesloten buitencontour (blad) + drie open "nerven" als stempeldetail. */
  leafWithVeins: wrap(
    '<path d="M50 88 C22 72,10 45,25 18 C35 3,65 3,75 18 C90 45,78 72,50 88 Z" fill="#2e7d32"/>' +
      '<path d="M50 80 L50 15" fill="none" stroke="#1b4d1b" stroke-width="1.5"/>' +
      '<path d="M50 55 L28 32" fill="none" stroke="#1b4d1b" stroke-width="1.5"/>' +
      '<path d="M50 55 L72 32" fill="none" stroke="#1b4d1b" stroke-width="1.5"/>',
  ),
  /** Gesloten buitencontour + één gesloten detailpad (ring), voor het testen van annulus-reliëf. */
  circleWithClosedDetail: wrap('<circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="20" fill="none" stroke="#000" stroke-width="1"/>'),
  /** Enkel open lijnen, geen gesloten vorm: geen geldige buitencontour mogelijk. */
  onlyOpenLines: wrap('<path d="M10 10 L90 10" fill="none" stroke="#000" stroke-width="1"/><path d="M10 90 L90 90" fill="none" stroke="#000" stroke-width="1"/>'),
  /** Twee losse gesloten vormen van verschillende grootte: cirkel (r = 15) links, vierkant 40 × 40 rechts. */
  circleAndSquare: wrap('<circle cx="25" cy="50" r="15"/><rect x="55" y="30" width="40" height="40"/>'),
  /** Gesloten buitencontour (cirkel r = 40) met twee afzonderlijke GEVULDE detailbanden van 40 × 2 (los van elkaar). */
  circleWithFilledBands: wrap(
    '<circle cx="50" cy="50" r="40" fill="#2e7d32"/>' +
      '<rect x="30" y="39" width="40" height="2" fill="#0b2e0b"/>' +
      '<rect x="30" y="59" width="40" height="2" fill="#0b2e0b"/>',
  ),
  /** Twee gevulde detailbanden van dezelfde kleur die elkaar kruisen: één logische vorm (een kruis). */
  circleWithCrossingBands: wrap(
    '<circle cx="50" cy="50" r="40" fill="#2e7d32"/>' +
      '<rect x="30" y="49" width="40" height="2" fill="#0b2e0b"/>' +
      '<rect x="49" y="30" width="2" height="30" fill="#0b2e0b"/>',
  ),
  /** Dikke gesloten buitenlijn als gevulde band (ring r 36..40), met één gevulde nerf binnenin. */
  thickRing: wrap(
    '<path fill-rule="evenodd" fill="#0034bb" d="M50 10 A40 40 0 1 1 49.99 10 Z M50 14 A36 36 0 1 0 50.01 14 Z"/>' +
      '<rect x="49" y="25" width="2" height="50" fill="#01184e"/>',
  ),
  /** Dikke gesloten buitenlijn als stroke (geen vulling), middellijn r = 38. */
  strokedRing: wrap('<circle cx="50" cy="50" r="38" fill="none" stroke="#0034bb" stroke-width="4"/>'),
  /**
   * Geneste clipPaths met transformaties: een groot vlak wordt geknipt door
   * een cirkel (r = 30 rond 50,50) en daarbinnen door een verschoven
   * rechthoek (rechterhelft). Zichtbaar: een halve schijf x = 50..80.
   */
  nestedClips: wrap(
    '<defs><clipPath id="disk"><circle cx="50" cy="50" r="30"/></clipPath>' +
      '<clipPath id="half"><rect x="0" y="-100" width="100" height="300"/></clipPath></defs>' +
      '<g clip-path="url(#disk)"><g transform="translate(50 0)"><g clip-path="url(#half)">' +
      '<rect x="-200" y="-200" width="500" height="500" fill="#123456"/></g></g></g>',
  ),
  /** Omlijnde lijn (geen vulling) die door een clipPath tot x = 20..60 wordt bijgesneden, naast een gesloten vorm. */
  clippedStroke: wrap(
    '<defs><clipPath id="win"><rect x="20" y="0" width="40" height="100"/></clipPath></defs>' +
      '<rect x="10" y="10" width="80" height="80" fill="#ccc"/>' +
      '<path d="M0 50 L100 50" fill="none" stroke="#000" stroke-width="1" clip-path="url(#win)"/>',
  ),
  /** clip-path op een element binnen een clipPath-definitie: niet exact te verwerken. */
  clipInsideClip: wrap(
    '<defs><clipPath id="a"><rect x="0" y="0" width="50" height="50"/></clipPath>' +
      '<clipPath id="b"><rect x="0" y="0" width="100" height="100" clip-path="url(#a)"/></clipPath></defs>' +
      '<rect x="10" y="10" width="80" height="80" clip-path="url(#b)"/>',
  ),
  /** Smalle strook (90 × 16 mm): genoeg oppervlak voor reliëf, te smal voor een handvat van 20 mm. */
  thinStrip: wrap('<rect x="5" y="42" width="90" height="16"/>'),
};

/* ------------------------------------------------------------------ */
/* Open lettervormen (middellijn)                                      */
/* ------------------------------------------------------------------ */

type P2 = { x: number; y: number };
const cubic = (a: P2, b: P2, c: P2, d: P2, t: number): P2 => {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
};

/** Middellijn van een "S" in SVG-eenheden (viewBox 100 × 100, y naar beneden), als drie kubische Béziers. */
export const S_SEGMENTS: [P2, P2, P2, P2][] = [
  [{ x: 72, y: 24 }, { x: 66, y: 12 }, { x: 34, y: 12 }, { x: 32, y: 30 }],
  [{ x: 32, y: 30 }, { x: 30, y: 46 }, { x: 70, y: 50 }, { x: 68, y: 68 }],
  [{ x: 68, y: 68 }, { x: 66, y: 86 }, { x: 34, y: 88 }, { x: 28, y: 76 }],
];
const S_PATH = 'M72 24 C66 12, 34 12, 32 30 C30 46, 70 50, 68 68 C66 86, 34 88, 28 76';

/** Dicht bemonsterde middellijn van de "S" in mm (100 × 100-kader, y naar boven zoals in de engine). */
export function sCenterlineMm(perSegment = 200): P2[] {
  const out: P2[] = [];
  S_SEGMENTS.forEach((seg, k) => {
    for (let i = k === 0 ? 0 : 1; i <= perSegment; i++) {
      const p = cubic(seg[0], seg[1], seg[2], seg[3], i / perSegment);
      out.push({ x: p.x, y: 100 - p.y });
    }
  });
  return out;
}

/**
 * Gevulde band rond de "S" met een variërende halve breedte (kalligrafisch,
 * met smallere uiteinden), als één gesloten polygoon in SVG-eenheden.
 */
function calligraphicS(halfWidth: (t: number) => number, scale = 1): string {
  const pts: P2[] = [];
  S_SEGMENTS.forEach((seg, k) => {
    for (let i = k === 0 ? 0 : 1; i <= 120; i++) pts.push(cubic(seg[0], seg[1], seg[2], seg[3], i / 120));
  });
  const left: P2[] = [];
  const right: P2[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / l;
    const ny = (b.x - a.x) / l;
    const w = halfWidth(i / (pts.length - 1));
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  });
  const ring = [...left, ...right.reverse()];
  return 'M' + ring.map((p) => `${(p.x * scale).toFixed(4)} ${(p.y * scale).toFixed(4)}`).join(' L') + ' Z';
}

export const LETTERS = {
  /** Open "S" als omlijnde lijn (geen vulling): een echte open contour. */
  openS: wrap(`<path d="${S_PATH}" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/>`),
  /**
   * Canva-achtige export van een kalligrafische, open lettervorm "S": px-viewBox (375 × 375),
   * witte achtergrond, clipPath en groepsmatrix; de letter zelf is een smalle GEVULDE band
   * (2,4–4,4 mm breed, smallere uiteinden) — zo exporteert Canva penseel- en lijnvormen.
   */
  canvaCalligraphicS:
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="375" zoomAndPan="magnify" viewBox="0 0 375 375" height="375" preserveAspectRatio="xMidYMid meet" version="1.0">' +
    '<defs><clipPath id="frame"><path d="M 0 0 L 375 0 L 375 375 L 0 375 Z" clip-rule="nonzero"/></clipPath></defs>' +
    '<rect x="-37.5" width="450" fill="#ffffff" y="-37.5" height="450" fill-opacity="1"/>' +
    `<g clip-path="url(#frame)"><g transform="matrix(3.75, 0, 0, 3.75, 0, 0)"><path fill="#0034bb" fill-rule="nonzero" d="${calligraphicS((t) => 1.2 + 1.0 * Math.sin(Math.PI * t))}"/></g></g></svg>`,
  /** Dezelfde gevulde "S" (constante breedte 3 mm) als stempeldetail binnen een cirkel. */
  circleWithFilledS: wrap(
    '<circle cx="50" cy="50" r="46" fill="#2e7d32"/>' + `<path fill="#0b2e0b" d="${calligraphicS(() => 1.5)}"/>`,
  ),
  /** Open zigzag met scherpe bochten (hoeken van ± 37°). */
  zigzag: wrap('<path d="M10 25 L 35 75 L 60 25 L 85 75" fill="none" stroke="#000" stroke-width="1"/>'),
  /** Open, afgeronde boog (driekwart cirkel, r = 30). */
  roundArc: wrap('<path d="M 20 50 A 30 30 0 1 1 50 80" fill="none" stroke="#000" stroke-width="1"/>'),
  /** Open lijn die zichzelf kruist (strik): de lussen worden opgevuld. */
  selfCrossing: wrap('<path d="M 15 80 L 85 20 L 85 80 L 15 20" fill="none" stroke="#000" stroke-width="1"/>'),
  /** Haarfijne gevulde band (0,03 mm): te smal om een middellijn betrouwbaar te bepalen. */
  hairline: wrap('<rect x="10" y="50" width="80" height="0.03" fill="#000"/>'),
  /** Fijn raster van 24 × 24 kruisende gevulde lijntjes (0,4 mm): te complex om veilig om te zetten. */
  hatch: wrap(
    Array.from({ length: 24 }, (_, i) => `<rect x="10" y="${(10 + i * 3.4).toFixed(2)}" width="80" height="0.4" fill="#000"/>`).join('') +
      Array.from({ length: 24 }, (_, i) => `<rect x="${(10 + i * 3.4).toFixed(2)}" y="10" width="0.4" height="80" fill="#000"/>`).join(''),
  ),
};

/**
 * Echte Canva-export van een open letter "S": twee rechte omlijnde lijnen (stroke 12, ronde
 * uiteinden, elk met een clipPath) en een gebogen gevulde band (een groot vlak, geknipt door
 * geneste clipPaths), allemaal in dezelfde kleur.
 */
export function openLetterSSvg(): string {
  return readFileSync(path.resolve(__dirname, 'fixtures/open-letter-s.svg'), 'utf8');
}

/** Echte Canva-export van een dunne lijntekening (gevulde lijnen van ± 0,3 mm). */
export function lineDrawingSvg(): string {
  return readFileSync(path.resolve(__dirname, 'fixtures/lijntekening.svg'), 'utf8');
}

/** Het echte Canva-bestand (blad met getekende rand en nerven, opgebouwd met geneste clipPaths). */
export function canvaLeafSvg(): string {
  return readFileSync(path.resolve(__dirname, 'fixtures/canva-blad.svg'), 'utf8');
}
