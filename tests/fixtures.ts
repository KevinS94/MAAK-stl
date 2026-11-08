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
};
