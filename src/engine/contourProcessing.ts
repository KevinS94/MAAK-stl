/**
 * Van SVG-geometrie naar één gevalideerde buitencontour in mm:
 * curves discretiseren, schalen, vulregels en clip-paths toepassen,
 * vormen verenigen, achtergrond herkennen, vereenvoudigen en centreren.
 */
import { simplifyPathD, type PathsD } from 'clipper2-ts';
import { GEOMETRY, SVG_LIMITS } from '../config/defaults';
import { fail, toResult } from './errors';
import { ensureCCW, removeNearDuplicates, ringBounds, ringSelfIntersects, signedArea } from './geometry2d';
import { classifyPaths, intersectPaths, toClipperFillRule, unionPaths } from './polygonOffset';
import { createFrameMapping, type FrameMapping } from './svgScaling';
import type { FrameSizeMm, Point2, Result, Ring, SVGGeometry, SVGShape, SVGSubPath, ValidatedContour } from './types';

interface SampleBudget {
  points: number;
}

function sampleSubPath(sp: SVGSubPath, mapping: FrameMapping, budget: SampleBudget): { ring: Ring; gapMm: number } {
  const scale = Math.max(mapping.sx, mapping.sy);
  const pts: Point2[] = [];
  for (const curve of sp.curves) {
    const c = curve as typeof curve & { isLineCurve?: boolean; v1?: Point2 };
    if (c.isLineCurve && c.v1) {
      pts.push(mapping.map(c.v1));
      continue;
    }
    const lengthMm = curve.getLength() * scale;
    const n = Math.min(
      GEOMETRY.maxCurveSegments,
      Math.max(GEOMETRY.minCurveSegments, Math.ceil(lengthMm / GEOMETRY.maxCurveSegmentMm)),
    );
    for (let i = 0; i < n; i++) pts.push(mapping.map(curve.getPoint(i / n)));
    budget.points += n;
    if (budget.points > SVG_LIMITS.maxPoints) {
      fail('SVG_TOO_COMPLEX', 'Deze SVG bevat te veel detail om te verwerken. Vereenvoudig de vorm en probeer opnieuw.');
    }
  }
  const lastCurve = sp.curves[sp.curves.length - 1];
  const end = mapping.map(lastCurve.getPoint(1));
  const first = pts[0];
  const gapMm = first ? Math.hypot(end.x - first.x, end.y - first.y) : 0;
  pts.push(end);
  budget.points += sp.curves.length + 1;
  if (budget.points > SVG_LIMITS.maxPoints) {
    fail('SVG_TOO_COMPLEX', 'Deze SVG bevat te veel detail om te verwerken. Vereenvoudig de vorm en probeer opnieuw.');
  }
  return { ring: removeNearDuplicates(pts, GEOMETRY.minPointDistanceMm), gapMm: sp.closed ? 0 : gapMm };
}

function shapeRegion(shape: SVGShape, mapping: FrameMapping, budget: SampleBudget, closeTol: number): PathsD {
  const rings: Ring[] = [];
  for (const sp of shape.subPaths) {
    const { ring, gapMm } = sampleSubPath(sp, mapping, budget);
    if (gapMm > closeTol) {
      fail(
        'SVG_OPEN_CONTOUR',
        'De vorm in deze SVG is niet gesloten (open contour). Gebruik een gesloten, gevulde vorm.',
      );
    }
    if (ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-6) rings.push(ring);
  }
  return unionPaths(rings, toClipperFillRule(shape.fillRule));
}

/**
 * Bouwt de buitencontour op de gevraagde fysieke kadergrootte.
 * Gooit een GeometryError als de SVG niet bruikbaar is.
 */
export function buildContourOrThrow(geometry: SVGGeometry, frameSize: FrameSizeMm): ValidatedContour {
  const mapping = createFrameMapping(geometry.frame, frameSize);
  const notices = new Set(geometry.notices);
  const budget: SampleBudget = { points: 0 };
  const closeTol = GEOMETRY.closeToleranceFraction * Math.hypot(frameSize.length, frameSize.width);

  const clipCache = new Map<string, PathsD>();
  const clipRegion = (id: string): PathsD => {
    let region = clipCache.get(id);
    if (!region) {
      const parts = (geometry.clipRegions[id] ?? []).flatMap((s) => shapeRegion(s, mapping, budget, Infinity));
      region = unionPaths(parts);
      clipCache.set(id, region);
    }
    return region;
  };

  interface Region {
    paths: PathsD;
    isBackground: boolean;
  }
  const regions: Region[] = [];
  for (const shape of geometry.shapes) {
    let paths = shapeRegion(shape, mapping, budget, closeTol);
    for (const id of shape.clipIds) paths = intersectPaths(paths, clipRegion(id));
    if (paths.length === 0) continue;
    const b = ringBounds(paths.flat());
    const isBackground =
      b.maxX - b.minX >= GEOMETRY.backgroundCoverage * frameSize.length &&
      b.maxY - b.minY >= GEOMETRY.backgroundCoverage * frameSize.width;
    regions.push({ paths, isBackground });
  }
  if (regions.length === 0) fail('SVG_EMPTY', 'Er werd geen zichtbare vorm met oppervlakte gevonden in deze SVG.');

  let used = regions;
  if (regions.some((r) => r.isBackground) && regions.some((r) => !r.isBackground)) {
    used = regions.filter((r) => !r.isBackground);
    notices.add('Een achtergrondvorm die het volledige kader vult, werd genegeerd.');
  }

  const merged = classifyPaths(unionPaths(used.flatMap((r) => r.paths)));
  const islands = merged.outers.filter((r) => signedArea(r) >= GEOMETRY.minIslandAreaMm2);
  if (islands.length < merged.outers.length && islands.length > 0) {
    notices.add('Enkele minuscule losse puntjes werden genegeerd.');
  }
  if (islands.length === 0) fail('SVG_EMPTY', 'De vorm in deze SVG is te klein om te gebruiken.');
  if (islands.length > 1) {
    fail(
      'SVG_MULTIPLE_SHAPES',
      `Deze SVG bevat ${islands.length} losse vormen. Gebruik één samenhangende vorm (laat delen overlappen of verbind ze).`,
    );
  }
  if (merged.holes.some((h) => signedArea(h) >= GEOMETRY.minIslandAreaMm2)) {
    notices.add('Openingen binnenin de vorm worden genegeerd: enkel de buitencontour wordt gebruikt.');
  }

  // Vereenvoudigen en opnieuw opschonen, zodat de contour gegarandeerd eenvoudig is.
  const simplified = simplifyPathD(islands[0], GEOMETRY.simplifyToleranceMm, true);
  const cleaned = classifyPaths(unionPaths([simplified])).outers;
  let outer = cleaned.length > 0 ? cleaned[0] : islands[0];
  outer = ensureCCW(removeNearDuplicates(outer, GEOMETRY.minPointDistanceMm));
  if (outer.length < 3 || ringSelfIntersects(outer)) {
    fail('SVG_UNSUPPORTED', 'De contour van deze vorm kon niet betrouwbaar bepaald worden.');
  }

  const b = ringBounds(outer);
  const centerOffset = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const centered = outer.map((p) => ({ x: p.x - centerOffset.x, y: p.y - centerOffset.y }));

  return {
    outer: centered,
    widthMm: b.maxX - b.minX,
    heightMm: b.maxY - b.minY,
    areaMm2: signedArea(centered),
    frameMm: { ...frameSize },
    centerOffset,
    notices: [...notices],
  };
}

export function buildContour(geometry: SVGGeometry, frameSize: FrameSizeMm): Result<ValidatedContour> {
  return toResult(() => buildContourOrThrow(geometry, frameSize));
}
