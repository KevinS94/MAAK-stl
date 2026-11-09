/**
 * Stap B en C van de SVG-keten.
 *
 * B. Selectie: alle zichtbare geometrie uit stap A (`parseSvgSceneOrThrow`)
 *    wordt omgezet naar selecteerbare onderdelen in mm. Clip-paths worden
 *    hierbij exact als polygonbewerking toegepast (gevulde vormen:
 *    doorsnede van gebieden; omlijningen: lijnclipping), ook bij geneste
 *    clips en getransformeerde groepen. Daarna worden de zichtbare stukken
 *    gegroepeerd tot "logische vormen", zodat de gebruiker niet op
 *    technische hulpgeometrie hoeft te klikken. Elk onderdeel krijgt een
 *    voorgestelde rol: buitencontour / stempeldetail / negeren.
 *
 *    Naast de rol krijgt elk onderdeel een interpretatie: gesloten vorm of
 *    middellijn (zie `PathInterpretation`). Open lijnen en smalle
 *    bandvormen krijgen standaard "middellijn" voorgesteld.
 *
 * C. Validatie: pas NADAT de rollen gekend zijn, wordt gecontroleerd of de
 *    gekozen buitencontour één samenhangende, gesloten vorm oplevert. Een
 *    middellijn wordt daarvoor eerst tot een band met de vormdikte
 *    verbreed. Een SVG met meerdere losse vormen is op zich dus nooit een
 *    fout.
 */
import type { PathsD } from 'clipper2-ts';
import { CENTERLINE, GEOMETRY } from '../config/defaults';
import { bandAroundCenterline, elongation, extractCenterline, meanBandWidth, type CenterlinePath } from './centerline';
import { fail, toResult } from './errors';
import { ensureCCW, pointInRing, ringBounds, signedArea } from './geometry2d';
import type { SampleBudget } from './contourProcessing';
import { finalizeOuterRing, sampleSubPath } from './contourProcessing';
import {
  clipOpenPolyline,
  differencePaths,
  intersectPaths,
  islandsToPaths,
  offsetOpenPolyline,
  pathsArea,
  pointInPaths,
  regionToPaths,
  splitIslands,
  toClipperFillRule,
  unionPaths,
  type Island,
} from './polygonOffset';
import { parseSvgSceneOrThrow, type SceneElement, type SvgScene } from './svgParser';
import { createFrameMapping, type FrameMapping } from './svgScaling';
import type {
  Bounds2,
  DetailLine,
  FrameSizeMm,
  PathInterpretation,
  PathRole,
  Point2,
  Result,
  Ring,
  SVGShape,
  SVGSubPath,
  SvgPathCandidate,
  ValidatedContour,
} from './types';

/**
 * `shapes`: zichtbare stukken gegroepeerd tot logische vormen (standaard).
 * `elements`: elk zichtbaar stuk van elk SVG-element afzonderlijk.
 */
export type Granularity = 'shapes' | 'elements';

/** Stukken kleiner dan dit (mm²) zijn numerieke restjes van het clippen. */
const MIN_PIECE_AREA_MM2 = 1e-3;
/** Minimale overlap (mm²) om twee stukken van dezelfde kleur als één vorm te zien. */
const MIN_OVERLAP_MM2 = 1e-3;
/** Een stuk waarvan minder dan dit deel zichtbaar is (de rest ligt onder later getekende geometrie) is hulpgeometrie. */
const HIDDEN_VISIBLE_FRACTION = 0.1;

function polylineLength(ring: readonly Point2[], closed: boolean): number {
  let len = 0;
  for (let i = 0; i < ring.length - 1; i++) len += Math.hypot(ring[i + 1].x - ring[i].x, ring[i + 1].y - ring[i].y);
  if (closed && ring.length > 1) {
    const a = ring[ring.length - 1];
    const b = ring[0];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

function isBackground(bounds: Bounds2, frameSize: FrameSizeMm): boolean {
  return (
    bounds.maxX - bounds.minX >= GEOMETRY.backgroundCoverage * frameSize.length &&
    bounds.maxY - bounds.minY >= GEOMETRY.backgroundCoverage * frameSize.width
  );
}

function boundsOverlap(a: Bounds2, b: Bounds2): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/* ------------------------------------------------------------------ */
/* Stap B: zichtbare geometrie (clipping exact toegepast)              */
/* ------------------------------------------------------------------ */

interface RegionPiece {
  kind: 'region';
  id: string;
  element: SceneElement;
  island: Island;
  paths: PathsD;
  area: number;
  bounds: Bounds2;
}

interface LinePiece {
  kind: 'line';
  id: string;
  element: SceneElement;
  points: Point2[];
  closed: boolean;
}

type Piece = RegionPiece | LinePiece;

class SceneGeometry {
  private readonly mapping: FrameMapping;
  private readonly budget: SampleBudget = { points: 0 };
  private readonly closeTol: number;
  private readonly clipCache = new Map<string, PathsD>();

  constructor(private readonly scene: SvgScene, frameSize: FrameSizeMm) {
    this.mapping = createFrameMapping(scene.frame, frameSize);
    this.closeTol = GEOMETRY.closeToleranceFraction * Math.hypot(frameSize.length, frameSize.width);
  }

  /** Gevuld gebied van een reeks subpaden. Open subpaden worden (zoals elke SVG-renderer doet) impliciet gesloten. */
  private fillRegion(subPaths: SVGSubPath[], fillRule: SVGShape['fillRule']): PathsD {
    const rings: Ring[] = [];
    for (const sp of subPaths) {
      const { ring } = sampleSubPath(sp, this.mapping, this.budget);
      if (ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-9) rings.push(ring);
    }
    return unionPaths(rings, toClipperFillRule(fillRule));
  }

  private clipRegion(id: string): PathsD {
    let region = this.clipCache.get(id);
    if (!region) {
      const parts = (this.scene.clipRegions[id] ?? []).flatMap((s) => this.fillRegion(s.subPaths, s.fillRule));
      region = unionPaths(parts);
      this.clipCache.set(id, region);
    }
    return region;
  }

  /** Doorsnede van alle (geneste) clips van een element, of `null` als er geen clip is. */
  private clipFor(element: SceneElement): PathsD | null {
    let clip: PathsD | null = null;
    for (const id of element.clipIds) {
      const region = this.clipRegion(id);
      clip = clip === null ? region : intersectPaths(clip, region);
      if (clip.length === 0) return [];
    }
    return clip;
  }

  pieces(): Piece[] {
    const out: Piece[] = [];
    for (const element of this.scene.elements) {
      const clip = this.clipFor(element);
      if (clip !== null && clip.length === 0) continue; // volledig weggeknipt

      if (element.kind === 'fill') {
        let region = this.fillRegion(element.subPaths, element.fillRule);
        if (clip !== null) region = intersectPaths(region, clip);
        splitIslands(region)
          .map((island) => ({ island, paths: islandsToPaths([island]) }))
          .map(({ island, paths }) => ({ island, paths, area: pathsArea(paths) }))
          .filter((p) => p.area >= MIN_PIECE_AREA_MM2)
          .forEach((p, k) => {
            out.push({
              kind: 'region',
              id: `e${element.index}.${k}`,
              element,
              island: p.island,
              paths: p.paths,
              area: p.area,
              bounds: ringBounds(p.island.outer),
            });
          });
        continue;
      }

      let k = 0;
      for (const sp of element.subPaths) {
        const { ring, gapMm } = sampleSubPath(sp, this.mapping, this.budget);
        if (ring.length < 2) continue;
        const closed = (sp.closed || gapMm <= this.closeTol) && ring.length >= 3;
        if (clip === null || ring.every((p) => pointInPaths(p, clip))) {
          out.push({ kind: 'line', id: `e${element.index}.${k++}`, element, points: ring, closed });
          continue;
        }
        // Lijn wordt gedeeltelijk weggeknipt: exact bijsnijden tot de zichtbare stukken.
        const polyline = closed ? [...ring, ring[0]] : ring;
        for (const piece of clipOpenPolyline(polyline, clip)) {
          if (polylineLength(piece, false) < GEOMETRY.minPointDistanceMm * 2) continue;
          out.push({ kind: 'line', id: `e${element.index}.${k++}`, element, points: piece, closed: false });
        }
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Stap B: groeperen tot logische vormen                                */
/* ------------------------------------------------------------------ */

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/**
 * Groepeert zichtbare stukken tot de vormen die een gebruiker ziet:
 * 1. stukken van dezelfde kleur die elkaar overlappen horen samen (Canva
 *    knipt één getekende rand vaak op in meerdere overlappende stukken);
 * 2. een stuk dat bijna volledig onder later getekende geometrie ligt, is
 *    hulpgeometrie en hoort bij de vorm die het bedekt.
 * Stukken van verschillende kleur die beide zichtbaar zijn, blijven
 * gescheiden (bv. donkere nerven bovenop een blad).
 */
function groupRegionPieces(pieces: RegionPiece[]): RegionPiece[][] {
  const uf = new UnionFind(pieces.length);
  const overlap = (a: RegionPiece, b: RegionPiece) =>
    boundsOverlap(a.bounds, b.bounds) ? pathsArea(intersectPaths(a.paths, b.paths)) : 0;

  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (pieces[i].element.paint !== pieces[j].element.paint) continue;
      if (pieces[i].element.index === pieces[j].element.index) continue; // eilanden van één element zijn per definitie los
      if (overlap(pieces[i], pieces[j]) > MIN_OVERLAP_MM2) uf.union(i, j);
    }
  }

  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const later = pieces.filter((q) => q.element.index > p.element.index && boundsOverlap(p.bounds, q.bounds));
    if (later.length === 0) continue;
    const visible = pathsArea(differencePaths(p.paths, unionPaths(later.flatMap((q) => q.paths))));
    if (visible >= HIDDEN_VISIBLE_FRACTION * p.area) continue;
    let best = -1;
    let bestOverlap = 0;
    for (const q of later) {
      const o = overlap(p, q);
      if (o > bestOverlap) {
        bestOverlap = o;
        best = pieces.indexOf(q);
      }
    }
    if (best >= 0) uf.union(i, best);
  }

  const groups = new Map<number, RegionPiece[]>();
  pieces.forEach((p, i) => {
    const root = uf.find(i);
    const list = groups.get(root);
    if (list) list.push(p);
    else groups.set(root, [p]);
  });
  return [...groups.values()];
}

function regionCandidate(id: string, members: RegionPiece[]): SvgPathCandidate {
  const islands = members.length === 1 ? [members[0].island] : splitIslands(members.flatMap((m) => m.paths));
  const outers = islands.map((i) => i.outer);
  const holes = islands.flatMap((i) => i.holes);
  const area = islands.reduce((s, i) => s + signedArea(i.outer) - i.holes.reduce((h, r) => h + signedArea(r), 0), 0);
  const silhouette = pathsArea(unionPaths(outers));
  const ring = outers[0] ?? [];
  const indices = [...new Set(members.map((m) => m.element.index))].sort((a, b) => a - b);
  return {
    id,
    kind: 'region',
    memberIds: members.map((m) => m.id),
    elementIndices: indices,
    elementName: members[0].element.elementName,
    filled: true,
    closed: true,
    ring,
    region: { outers, holes },
    areaMm2: area,
    silhouetteAreaMm2: silhouette,
    lengthMm: polylineLength(ring, true),
    bounds: ringBounds(outers.flat()),
    paint: members[0].element.paint,
    bandWidthMm: meanBandWidth({ outers, holes }),
    bandLike: false,
    suggestedRole: 'ignore',
  };
}

function lineCandidate(p: LinePiece): SvgPathCandidate {
  return {
    id: p.id,
    kind: 'line',
    memberIds: [p.id],
    elementIndices: [p.element.index],
    elementName: p.element.elementName,
    filled: false,
    closed: p.closed,
    ring: p.points,
    areaMm2: 0,
    silhouetteAreaMm2: p.closed ? Math.abs(signedArea(p.points)) : 0,
    lengthMm: polylineLength(p.points, p.closed),
    bounds: ringBounds(p.points),
    paint: p.element.paint,
    bandWidthMm: 0,
    bandLike: false,
    suggestedRole: 'ignore',
  };
}

/**
 * Zet alle zichtbare geometrie van `scene` om naar selecteerbare
 * onderdelen in mm (nog niet gecentreerd), met voorgestelde rollen.
 */
export function extractPathCandidates(
  scene: SvgScene,
  frameSize: FrameSizeMm,
  granularity: Granularity = 'shapes',
): SvgPathCandidate[] {
  const pieces = new SceneGeometry(scene, frameSize).pieces();
  const regions = pieces.filter((p): p is RegionPiece => p.kind === 'region');
  const lines = pieces.filter((p): p is LinePiece => p.kind === 'line');

  const regionGroups = granularity === 'shapes' ? groupRegionPieces(regions) : regions.map((r) => [r]);
  const regionCandidates = regionGroups.map((members) =>
    regionCandidate(granularity === 'shapes' ? `s:${members[0].id}` : members[0].id, members),
  );
  const candidates = [...regionCandidates, ...lines.map(lineCandidate)].sort(
    (a, b) => a.elementIndices[0] - b.elementIndices[0],
  );
  return suggestRoles(candidates, frameSize);
}

/** Heeft groeperen tot logische vormen iets samengevoegd (zinvol om "onderdelen" te kunnen tonen)? */
export function hasGroupedShapes(candidates: SvgPathCandidate[]): boolean {
  return candidates.some((c) => c.kind === 'region' && (c.elementIndices.length > 1 || (c.region?.outers.length ?? 0) > 1));
}

function usableAsOuter(c: SvgPathCandidate, frameSize: FrameSizeMm): boolean {
  return c.closed && c.silhouetteAreaMm2 >= GEOMETRY.minIslandAreaMm2 && !isBackground(c.bounds, frameSize);
}

/** Open lijn die (als middellijn) buitencontour kan zijn als er geen gesloten vorm is. */
function usableAsCenterlineOuter(c: SvgPathCandidate, frameSize: FrameSizeMm): boolean {
  return (
    c.kind === 'line' &&
    !c.closed &&
    c.lengthMm >= CENTERLINE.defaultShapeThicknessMm &&
    !isBackground(c.bounds, frameSize)
  );
}

/** Ligt (het grootste deel van) `c` binnen het gebied `inside`? */
function liesInside(c: SvgPathCandidate, inside: (p: Point2) => boolean): boolean {
  const pts = c.kind === 'region' ? (c.region?.outers ?? []).flat() : c.ring;
  if (pts.length === 0) return false;
  const step = Math.max(1, Math.floor(pts.length / 64));
  let n = 0;
  let total = 0;
  for (let i = 0; i < pts.length; i += step) {
    total++;
    if (inside(pts[i])) n++;
  }
  return n >= total / 2;
}

/** Kortste afstand van p tot een open of gesloten polylijn. */
function distanceToPolyline(p: Point2, line: readonly Point2[], closed: boolean): number {
  let best = Infinity;
  const n = line.length;
  if (n === 1) return Math.hypot(line[0].x - p.x, line[0].y - p.y);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = line[i];
    const b = line[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return best;
}

/** Afstand van p tot de geometrie van een onderdeel (0 binnen een gevuld gebied). */
function distanceToCandidate(p: Point2, c: SvgPathCandidate): number {
  if (c.kind === 'region' && c.region) {
    if (pointInPaths(p, regionToPaths(c.region))) return 0;
    return Math.min(...[...c.region.outers, ...c.region.holes].map((r) => distanceToPolyline(p, r, true)));
  }
  return distanceToPolyline(p, c.ring, c.closed);
}

/** Raken twee onderdelen elkaar (tot op `tol` mm)? Eerst een snelle test op de omhullende rechthoeken. */
function candidatesTouch(a: SvgPathCandidate, b: SvgPathCandidate, tol: number): boolean {
  const grow = (x: Bounds2) => ({ minX: x.minX - tol, minY: x.minY - tol, maxX: x.maxX + tol, maxY: x.maxY + tol });
  if (!boundsOverlap(grow(a.bounds), b.bounds)) return false;
  const pts = a.kind === 'region' ? (a.region?.outers ?? []).flat() : a.ring;
  const step = Math.max(1, Math.floor(pts.length / 200));
  for (let i = 0; i < pts.length; i += step) if (distanceToCandidate(pts[i], b) <= tol) return true;
  // Altijd ook de eindpunten van een open lijn (daar sluiten lijnstukken meestal aan).
  if (a.kind === 'line' && !a.closed) return [a.ring[0], a.ring[a.ring.length - 1]].some((p) => distanceToCandidate(p, b) <= tol);
  return false;
}

/** Ziet een gevuld gebied eruit als een smalle band (lijnvorm)? */
function isBandLike(c: SvgPathCandidate, frameSize: FrameSizeMm): boolean {
  if (c.kind !== 'region' || !c.region) return false;
  return (
    c.bandWidthMm > 0 &&
    c.bandWidthMm <= CENTERLINE.bandMaxWidthFraction * Math.min(frameSize.length, frameSize.width) &&
    elongation(c.region) >= CENTERLINE.bandElongation
  );
}

/**
 * Stelt automatisch rollen voor: de gesloten vorm met het grootste
 * silhouet (gaten opgevuld, dus een getekende rand telt als de volle vorm)
 * wordt de buitencontour; onderdelen die daarbinnen liggen worden
 * stempeldetail; achtergrondvormen en onderdelen erbuiten worden genegeerd.
 * Is er geen bruikbare gesloten vorm, dan wordt de langste open lijn de
 * buitencontour (als middellijn).
 */
export function suggestRoles(candidates: SvgPathCandidate[], frameSize: FrameSizeMm): SvgPathCandidate[] {
  const marked = candidates.map((c) => ({ ...c, bandLike: isBandLike(c, frameSize) }));
  const closedOuter = marked
    .filter((c) => usableAsOuter(c, frameSize))
    .reduce<SvgPathCandidate | null>((best, c) => (!best || c.silhouetteAreaMm2 > best.silhouetteAreaMm2 ? c : best), null);
  const outer =
    closedOuter ??
    marked
      .filter((c) => usableAsCenterlineOuter(c, frameSize))
      .reduce<SvgPathCandidate | null>((best, c) => (!best || c.lengthMm > best.lengthMm ? c : best), null);

  // Een letter of lijntekening bestaat vaak uit meerdere stukken van dezelfde kleur die elkaar
  // raken (bv. twee rechte lijnen en een boog). Is de buitencontour een middellijn, dan horen
  // aansluitende lijnen/smalle banden van dezelfde kleur er ook bij.
  const outers: SvgPathCandidate[] = outer ? [outer] : [];
  if (outer && suggestInterpretation(outer, 'outer') === 'centerline') {
    const tol = Math.max(1, outer.bandWidthMm);
    for (let grown = true; grown; ) {
      grown = false;
      for (const c of marked) {
        if (outers.includes(c) || c.paint !== outer.paint || isBackground(c.bounds, frameSize)) continue;
        if (!(c.kind === 'line' || c.bandLike) || c.ring.length < 2) continue;
        // Numerieke restjes (minuscule vlekjes of lijnstukjes) horen nergens bij.
        if (c.kind === 'region' ? c.areaMm2 < GEOMETRY.minIslandAreaMm2 : c.lengthMm < 1) continue;
        if (outers.some((o) => candidatesTouch(c, o, tol))) {
          outers.push(c);
          grown = true;
        }
      }
    }
  }

  const insideTests = outers.map((o): ((p: Point2) => boolean) => {
    if (o.closed) return (p) => pointInRing(p, o.ring);
    const band = regionToPaths(offsetOpenPolyline(o.ring, CENTERLINE.defaultShapeThicknessMm / 2));
    return (p) => pointInPaths(p, band);
  });
  const inside: ((p: Point2) => boolean) | null = outer ? (p) => insideTests.some((t) => t(p)) : null;

  return marked.map((c) => {
    if (outers.some((o) => o.id === c.id)) return { ...c, suggestedRole: 'outer' };
    if (isBackground(c.bounds, frameSize)) return { ...c, suggestedRole: 'ignore' };
    if (c.ring.length < 2) return { ...c, suggestedRole: 'ignore' };
    if (c.kind === 'region' && c.areaMm2 < GEOMETRY.minIslandAreaMm2) return { ...c, suggestedRole: 'ignore' };
    if (inside) return { ...c, suggestedRole: liesInside(c, inside) ? 'detail' : 'ignore' };
    // Geen bruikbare buitencontour: lijnen kunnen nog detail zijn, de gebruiker moet een buitencontour kiezen.
    return { ...c, suggestedRole: c.kind === 'line' ? 'detail' : 'ignore' };
  });
}

/**
 * Een selectie is ondubbelzinnig als er precies één bruikbare gesloten
 * vorm is om als buitencontour te gebruiken (of, zonder gesloten vorm,
 * precies één open lijn).
 */
export function isSelectionUnambiguous(candidates: SvgPathCandidate[], frameSize: FrameSizeMm): boolean {
  const closed = candidates.filter((c) => usableAsOuter(c, frameSize)).length;
  if (closed > 0) return closed === 1;
  return candidates.filter((c) => usableAsCenterlineOuter(c, frameSize)).length === 1;
}

/**
 * Voorgestelde interpretatie voor een onderdeel met een gegeven rol:
 * - open lijn: altijd middellijn (een open lijn heeft geen binnenkant);
 * - gesloten lijn: als buitencontour het omsloten gebied, als detail de lijn zelf;
 * - smalle gevulde band: middellijn, behalve een getekende rand (band met
 *   binnenruimte) als buitencontour: die wordt de volle vorm;
 * - andere gevulde vormen: gesloten vorm.
 */
export function suggestInterpretation(c: SvgPathCandidate, role: PathRole): PathInterpretation {
  if (c.kind === 'line') return !c.closed || role !== 'outer' ? 'centerline' : 'shape';
  if (!c.bandLike) return 'shape';
  const hasHoles = (c.region?.holes.length ?? 0) > 0;
  return role === 'outer' && hasHoles ? 'shape' : 'centerline';
}

/** Kan dit onderdeel als gesloten vorm geïnterpreteerd worden? (Een open lijn niet.) */
export function canBeShape(c: SvgPathCandidate): boolean {
  return c.kind === 'region' || c.closed;
}

export function interpretationOf(
  c: SvgPathCandidate,
  roles: Record<string, PathRole>,
  interpretations: Record<string, PathInterpretation> = {},
): PathInterpretation {
  const chosen = interpretations[c.id];
  if (chosen === 'shape' && !canBeShape(c)) return 'centerline';
  return chosen ?? suggestInterpretation(c, roleOf(c, roles));
}

/** Wordt (een deel van) de gekozen buitencontour als middellijn geïnterpreteerd? */
export function usesCenterlineOuter(
  candidates: SvgPathCandidate[],
  roles: Record<string, PathRole>,
  interpretations: Record<string, PathInterpretation> = {},
): boolean {
  return candidates.some((c) => roleOf(c, roles) === 'outer' && interpretationOf(c, roles, interpretations) === 'centerline');
}

export function defaultRoles(candidates: SvgPathCandidate[]): Record<string, PathRole> {
  return Object.fromEntries(candidates.map((c) => [c.id, c.suggestedRole]));
}

/**
 * Zet een roltoewijzing om naar een andere granulariteit (vormen <->
 * afzonderlijke onderdelen), zodat de keuze van de gebruiker behouden blijft:
 * elk onderdeel erft de rol van de vorm waartoe het behoort, en een vorm
 * krijgt de rol van zijn grootste onderdeel.
 */
export function transferRoles(
  from: SvgPathCandidate[],
  roles: Record<string, PathRole>,
  to: SvgPathCandidate[],
): Record<string, PathRole> {
  const byMember = new Map<string, { role: PathRole; weight: number }>();
  for (const c of from) {
    const role = roleOf(c, roles);
    const weight = c.kind === 'region' ? c.areaMm2 / Math.max(1, c.memberIds.length) : c.lengthMm;
    for (const m of c.memberIds) byMember.set(m, { role, weight });
  }
  return Object.fromEntries(
    to.map((c) => {
      let best: { role: PathRole; weight: number } | undefined;
      for (const m of c.memberIds) {
        const hit = byMember.get(m);
        if (hit && (!best || hit.weight > best.weight)) best = hit;
      }
      return [c.id, best?.role ?? c.suggestedRole];
    }),
  );
}

/**
 * Zet de interpretaties om naar een andere granulariteit (zoals
 * `transferRoles`): elk onderdeel erft de interpretatie die zijn vorm
 * effectief had (keuze of voorstel). Zo blijft bv. een getekende rand die
 * als volle vorm gebruikt werd ook in afzonderlijke stukken een volle vorm,
 * ook al ziet elk stuk er afzonderlijk uit als een smalle band.
 */
export function transferInterpretations(
  from: SvgPathCandidate[],
  roles: Record<string, PathRole>,
  interpretations: Record<string, PathInterpretation>,
  to: SvgPathCandidate[],
): Record<string, PathInterpretation> {
  const byMember = new Map<string, { interp: PathInterpretation; weight: number }>();
  for (const c of from) {
    if (roleOf(c, roles) === 'ignore' && !interpretations[c.id]) continue;
    const interp = interpretationOf(c, roles, interpretations);
    const weight = c.kind === 'region' ? c.areaMm2 / Math.max(1, c.memberIds.length) : c.lengthMm;
    for (const m of c.memberIds) byMember.set(m, { interp, weight });
  }
  const out: Record<string, PathInterpretation> = {};
  for (const c of to) {
    let best: { interp: PathInterpretation; weight: number } | undefined;
    for (const m of c.memberIds) {
      const hit = byMember.get(m);
      if (hit && (!best || hit.weight > best.weight)) best = hit;
    }
    if (best) out[c.id] = best.interp;
  }
  return out;
}

function roleOf(c: SvgPathCandidate, roles: Record<string, PathRole>): PathRole {
  return roles[c.id] ?? c.suggestedRole;
}

/* ------------------------------------------------------------------ */
/* Stap C: validatie van de gekozen buitencontour + details             */
/* ------------------------------------------------------------------ */

/**
 * De onderdelen met rol "buitencontour"; weigert als er geen is. Een open
 * lijn is hier geen fout meer: die wordt altijd als middellijn gebruikt.
 */
export function selectedOuters(candidates: SvgPathCandidate[], roles: Record<string, PathRole>): SvgPathCandidate[] {
  const outers = candidates.filter((c) => roleOf(c, roles) === 'outer');
  if (outers.length === 0) {
    fail('NO_OUTER_SELECTED', 'Kies een vorm als buitencontour (klik erop tot hij blauw is).');
  }
  return outers;
}

/** Cache: middellijnen van gevulde onderdelen (een onderdeel verandert nooit na het inlezen). */
const centerlineCache = new WeakMap<SvgPathCandidate, CenterlinePath[]>();

/** Middellijn(en) van een onderdeel in mm (nog niet gecentreerd). Een lijn is zijn eigen middellijn. */
export function centerlineOf(c: SvgPathCandidate): CenterlinePath[] {
  if (c.kind === 'line') return [{ points: c.ring, closed: c.closed }];
  let paths = centerlineCache.get(c);
  if (!paths) {
    paths = extractCenterline(c.region ?? { outers: [c.ring], holes: [] }).paths;
    centerlineCache.set(c, paths);
  }
  return paths;
}

export interface SelectionOptions {
  /** Expliciete interpretatiekeuzes (candidate.id -> interpretatie); anders het voorstel. */
  interpretations?: Record<string, PathInterpretation>;
  /** Vormdikte (mm) voor een buitencontour die als middellijn geïnterpreteerd wordt. */
  shapeThicknessMm?: number;
}

/**
 * Reconstrueert het volle silhouet van de gekozen buitencontour: alle
 * gekozen onderdelen worden verenigd en elke binnenruimte wordt opgevuld.
 * Een dikke getekende rand (band met binnen- en buitengrens) levert zo de
 * volledige vorm op, en de binnenrand wordt geen ongewenste uitsparing.
 * Het resultaat moet één samenhangende vorm zijn.
 */
export function buildSilhouette(
  outers: SvgPathCandidate[],
  notices: Set<string>,
  roles: Record<string, PathRole> = Object.fromEntries(outers.map((c) => [c.id, 'outer' as const])),
  options: SelectionOptions = {},
): Ring {
  const thickness = options.shapeThicknessMm ?? CENTERLINE.defaultShapeThicknessMm;
  const isCenterline = (c: SvgPathCandidate) => interpretationOf(c, roles, options.interpretations) === 'centerline';
  const rings: Ring[] = [];
  let centerlineLoops = false;
  for (const c of outers) {
    if (isCenterline(c)) {
      // Middellijn: eerst een gesloten band met de vormdikte, die is daarna de buitenvorm.
      const band = bandAroundCenterline(centerlineOf(c), thickness);
      rings.push(...band.outers);
      if (band.holes.some((h) => signedArea(h) >= GEOMETRY.minIslandAreaMm2)) centerlineLoops = true;
    } else {
      rings.push(...(c.kind === 'region' ? (c.region?.outers ?? []) : [c.ring]));
    }
  }
  if (centerlineLoops) {
    notices.add('Waar de middellijn een lus vormt of zichzelf kruist, wordt de binnenruimte van de vorm opgevuld.');
  }
  const islands = splitIslands(unionPaths(rings));
  // Eilanden die in de binnenruimte van een ander eiland liggen, vallen binnen het opgevulde silhouet.
  const topLevel = islands.filter(
    (isl) => !islands.some((other) => other !== isl && pointInRing(isl.outer[0], other.outer)),
  );
  const significant = topLevel.filter((isl) => signedArea(isl.outer) >= GEOMETRY.minIslandAreaMm2);
  if (significant.length === 0) fail('SVG_EMPTY', 'De gekozen buitencontour is te klein om te gebruiken.');
  if (significant.length < topLevel.length) notices.add('Enkele minuscule losse puntjes werden genegeerd.');
  if (significant.length > 1) {
    fail(
      'SVG_MULTIPLE_SHAPES',
      `De gekozen buitencontour bestaat uit ${significant.length} losse delen. Kies één samenhangende vorm als buitencontour en markeer de andere delen als stempeldetail of negeren.`,
    );
  }
  const filledInside =
    significant[0].holes.some((h) => signedArea(h) >= GEOMETRY.minIslandAreaMm2) ||
    outers.some((c) => !isCenterline(c) && (c.region?.holes ?? []).some((h) => signedArea(h) >= GEOMETRY.minIslandAreaMm2));
  if (filledInside && !centerlineLoops) {
    notices.add('De binnenkant van de buitencontour wordt volledig opgevuld: een getekende rand wordt een volle vorm.');
  }
  return significant[0].outer;
}

/**
 * Bouwt de stempeldetails (rol "detail") uitgelijnd met de gekozen
 * buitencontour: dezelfde kadertransformatie, dezelfde `centerOffset`.
 * - Middellijn: lijnen blijven lijnen; van gevulde banden wordt eerst de
 *   middellijn bepaald. Beide worden later met de detailbreedte verbreed.
 * - Gesloten vorm: gevulde onderdelen blijven gevulde gebieden op hun
 *   getekende breedte (niet opnieuw verbreed); een gesloten lijn wordt het
 *   omsloten gebied.
 */
export function alignDetails(
  candidates: SvgPathCandidate[],
  roles: Record<string, PathRole>,
  centerOffset: Point2,
  interpretations: Record<string, PathInterpretation> = {},
): DetailLine[] {
  const shift = (r: readonly Point2[]) => r.map((p) => ({ x: p.x - centerOffset.x, y: p.y - centerOffset.y }));
  return candidates
    .filter((c) => roleOf(c, roles) === 'detail' && c.ring.length >= 2)
    .flatMap((c): DetailLine[] => {
      if (interpretationOf(c, roles, interpretations) === 'centerline') {
        return centerlineOf(c).map((p) => ({ closed: p.closed, ring: shift(p.points) }));
      }
      if (c.kind === 'region' && c.region) {
        return [
          {
            closed: true,
            ring: shift(c.ring),
            region: { outers: c.region.outers.map(shift), holes: c.region.holes.map(shift) },
          },
        ];
      }
      const ring = ensureCCW(shift(c.ring)); // gesloten lijn als gesloten vorm
      return [{ closed: true, ring, region: { outers: [ring], holes: [] } }];
    });
}

export interface ContourSelection {
  contour: ValidatedContour;
  details: DetailLine[];
}

/**
 * Generatorvalidatie op basis van de roltoewijzing van de gebruiker (of de
 * automatische voorstellen): silhouet van de buitencontour + uitgelijnde
 * stempeldetails.
 */
export function buildSelectionOrThrow(
  candidates: SvgPathCandidate[],
  roles: Record<string, PathRole>,
  frameSize: FrameSizeMm,
  extraNotices: string[] = [],
  options: SelectionOptions = {},
): ContourSelection {
  const notices = new Set(extraNotices);
  const interpretations = options.interpretations ?? {};
  const outers = selectedOuters(candidates, roles);
  const centerline = usesCenterlineOuter(outers, roles, interpretations);
  const thickness = options.shapeThicknessMm ?? CENTERLINE.defaultShapeThicknessMm;
  if (!(thickness > 0)) fail('INVALID_PARAMETERS', 'De vormdikte moet groter dan 0 mm zijn.');
  const silhouette = buildSilhouette(outers, notices, roles, { interpretations, shapeThicknessMm: thickness });
  if (centerline) {
    notices.add(`De buitencontour wordt opgebouwd rond de middellijn, met een vormdikte van ${fmtMm(thickness)} mm.`);
  }
  const contour = finalizeOuterRing(silhouette, frameSize, [...notices]);
  if (centerline) contour.centerline = { thicknessMm: thickness };
  const details = alignDetails(candidates, roles, contour.centerOffset, interpretations);
  return { contour, details };
}

function fmtMm(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

export function buildSelection(
  candidates: SvgPathCandidate[],
  roles: Record<string, PathRole>,
  frameSize: FrameSizeMm,
  extraNotices: string[] = [],
  options: SelectionOptions = {},
): Result<ContourSelection> {
  return toResult(() => buildSelectionOrThrow(candidates, roles, frameSize, extraNotices, options));
}

/**
 * Stap A + B in één keer, voor het importeren: inlezen, alle zichtbare
 * geometrie herkennen en rollen voorstellen. Meerdere losse vormen of open
 * lijnen zijn hier nooit een fout; enkel een SVG waarvan niets zichtbaar
 * overblijft (bv. alles weggeknipt) wordt geweigerd.
 */
export function importSvgOrThrow(
  text: string,
  frameSize: FrameSizeMm,
): { scene: SvgScene; candidates: SvgPathCandidate[]; roles: Record<string, PathRole> } {
  const scene = parseSvgSceneOrThrow(text);
  const candidates = extractPathCandidates(scene, frameSize, 'shapes');
  if (candidates.length === 0) {
    fail('SVG_EMPTY', 'Er blijft geen zichtbare vorm of lijn over in deze SVG (alles valt buiten de clipping).');
  }
  return { scene, candidates, roles: defaultRoles(candidates) };
}

export function importSvg(text: string, frameSize: FrameSizeMm) {
  return toResult(() => importSvgOrThrow(text, frameSize));
}
