/**
 * Gedeelde geometrie-opbouw voor de stempel, gebruikt door zowel de
 * zelfstandige stempel als Cutter & Stempel.
 *
 * Opbouw in Z (onder naar boven): handvat (0 .. handleHeight) · stempelplaat
 * (handleHeight .. +plateThickness) · reliëf: contourlijn + details
 * (.. + reliëfhoogte). Reliëf en handvat zitten dus op de twee
 * tegenoverliggende zijden van de plaat (zie spec §4.5).
 *
 * Een "boss" (verhoogd stukje reliëf op de plaat) wordt NOOIT los boven een
 * reeds getrianguleerd vlak geplakt (dat geeft niet-manifold randen); in
 * plaats daarvan krijgt het vlakke plaatoppervlak een gat exact op de
 * omtrek van elke boss, en wordt dat gat met een wand gevuld tot de
 * reliëfhoogte. Een boss met een eigen gat (bv. de contourring, die zelf
 * een annulus is) krijgt op zijn beurt weer een vlak "eiland" op
 * plaathoogte in dat gat — exact dezelfde wand+vlak-techniek als de
 * bestaande binnenwand van de cookie cutter en de uitsparing van de
 * vulvorm, maar dan naar boven in plaats van naar onder.
 */
import { STAMP_INTERNAL } from '../config/defaults';
import { fail } from '../engine/errors';
import { ensureCCW, pointInRing, ringBounds, ringStrictlyInside, signedArea, SegmentGrid } from '../engine/geometry2d';
import { MeshBuilder, type RingLevel } from '../engine/meshGeneration';
import {
  intersectRegions,
  intersectRegionWithRing,
  offsetRegion,
  regionToPaths,
  splitIslands,
  offsetClosedPolyline,
  offsetOpenPolyline,
  offsetRing,
  regionArea,
  type RegionRings,
  unionRegions,
} from '../engine/polygonOffset';
import { FaceTag, type DetailLine, type MeshData, type Point2, type Ring, type ShapeParameters } from '../engine/types';

/* ------------------------------------------------------------------ */
/* Stempelplaat (met eventuele offset t.o.v. de cutter-binnenzijde)    */
/* ------------------------------------------------------------------ */

export function buildPlateOuter(baseOuter: Ring, insetOffset: number): Ring {
  if (insetOffset <= 1e-9) return ensureCCW(baseOuter);
  const { outers, holes } = offsetRing(baseOuter, -insetOffset);
  if (outers.length !== 1 || holes.length > 0) {
    fail(
      'STAMP_FIT_INVALID',
      `De stempelplaat past niet met ${insetOffset} mm speling binnen deze vorm: inkepingen liggen te dicht bij elkaar. Vereenvoudig de vorm of verklein de speling.`,
    );
  }
  if (!ringStrictlyInside(outers[0], baseOuter, insetOffset * 0.5)) {
    fail('STAMP_FIT_INVALID', 'De stempelplaat kon niet betrouwbaar binnen deze vorm berekend worden.');
  }
  return outers[0];
}

/* ------------------------------------------------------------------ */
/* Verhoogde contourlijn en detaillijnen                                */
/* ------------------------------------------------------------------ */

export function buildRaisedContourRegion(plateOuter: Ring, contourWidth: number): RegionRings {
  const inset = contourWidth / 2 + STAMP_INTERNAL.raisedContourInsetMm;
  const { outers, holes } = offsetRing(plateOuter, -inset);
  if (outers.length !== 1 || holes.length > 0) {
    fail(
      'CONTOUR_RELIEF_INVALID',
      'De verhoogde contourlijn kan voor deze vorm niet gemaakt worden: inkepingen liggen te dicht bij elkaar. Vereenvoudig de vorm.',
    );
  }
  const centerline = outers[0];
  if (!ringStrictlyInside(centerline, plateOuter, inset * 0.5)) {
    fail('CONTOUR_RELIEF_INVALID', 'De verhoogde contourlijn kon niet betrouwbaar berekend worden voor deze vorm.');
  }
  const band = offsetClosedPolyline(centerline, contourWidth / 2);
  if (band.outers.length !== 1) {
    fail('CONTOUR_RELIEF_INVALID', 'De verhoogde contourlijn kon niet betrouwbaar berekend worden voor deze vorm.');
  }
  return band;
}

/**
 * Reliëfgebied van de stempeldetails.
 * - Lijnen (open of gesloten omlijningen) worden een band van exact
 *   `detailWidth` mm breed (halve breedte aan elke kant van de lijn).
 * - Reeds gevulde vormen/banden uit de SVG worden ongewijzigd gebruikt:
 *   hun breedte is de getekende breedte op de gekozen kaderschaal. Ze
 *   nogmaals verbreden zou de reliëfbreedte onvoorspelbaar maken.
 */
export function buildDetailRegion(details: DetailLine[], detailWidth: number): RegionRings {
  const halfW = detailWidth / 2;
  const regions = details.map((d): RegionRings => {
    if (d.region) return { outers: d.region.outers, holes: d.region.holes };
    if (d.ring.length < 2) return { outers: [], holes: [] };
    return d.closed ? offsetClosedPolyline(d.ring, halfW) : offsetOpenPolyline(d.ring, halfW);
  });
  return unionRegions(regions);
}

/** Eén reliëfniveau: het gebied dat tot `heightMm` boven het plaatoppervlak reikt. */
export interface ReliefLevel {
  region: RegionRings;
  heightMm: number;
}

/**
 * Eén samenhangend reliëfeiland op de plaat. Het staat volledig op
 * `heightMm`, of — waar contour en details met een verschillende hoogte
 * samenkomen — op de laagste hoogte met daarop een hoger `terrace`, dat
 * minstens `reliefStepInsetMm` binnen de rand van het eiland blijft.
 */
export interface ReliefIsland {
  outer: Ring;
  holes: Ring[];
  heightMm: number;
  terrace?: ReliefLevel;
}

export interface ReliefResult {
  islands: ReliefIsland[];
  /** Volledige voetafdruk van het reliëf (alle eilanden samen). */
  region: RegionRings;
  notices: string[];
}

function dropSpecks(region: RegionRings): RegionRings {
  return {
    outers: region.outers.filter((r) => Math.abs(signedArea(r)) >= STAMP_INTERNAL.minReliefAreaMm2),
    holes: region.holes.filter((r) => Math.abs(signedArea(r)) >= STAMP_INTERNAL.minReliefAreaMm2 * 0.3),
  };
}

const isEmpty = (r: RegionRings) => r.outers.length === 0;

/**
 * Bouwt het reliëf: verhoogde contourlijn (hoogte `contourHeight`; 0 = geen
 * contourlijn) en details (hoogte `detailHeight`), elk bijgesneden tot een
 * veilige binnenmarge t.o.v. de plaatrand (spec §4.3).
 *
 * Het geheel wordt opgesplitst in eilanden. Een eiland dat enkel uit
 * contour of enkel uit details bestaat, staat exact op die hoogte. Raken
 * contour en details elkaar met een verschillende hoogte, dan staat dat
 * eiland op de laagste hoogte en krijgt het hogere deel een terras erop.
 */
export function buildReliefLevels(
  plateOuter: Ring,
  details: DetailLine[],
  params: ShapeParameters,
  includeContour: boolean,
): ReliefResult {
  const notices: string[] = [];
  const contourHeight = includeContour ? params.contourHeight : 0;
  const detailHeight = params.detailHeight;

  const safe = offsetRing(plateOuter, -STAMP_INTERNAL.reliefSafetyMarginMm);
  if (safe.outers.length !== 1) {
    fail('CONTOUR_RELIEF_INVALID', 'Er blijft geen veilige binnenmarge over voor reliëf op deze vorm.');
  }
  let clippedAway = false;
  const clip = (region: RegionRings): RegionRings => {
    const before = regionArea(region);
    const clipped = intersectRegionWithRing(region, safe.outers[0]);
    if (before > 1e-6 && regionArea(clipped) < before * (1 - STAMP_INTERNAL.reliefClipWarnFraction)) clippedAway = true;
    return dropSpecks(clipped);
  };

  const parts: ReliefLevel[] = [];
  if (contourHeight > 0) {
    parts.push({ region: clip(buildRaisedContourRegion(plateOuter, params.contourWidth)), heightMm: contourHeight });
  }
  if (details.length > 0 && detailHeight > 0) {
    parts.push({ region: clip(buildDetailRegion(details, params.detailWidth)), heightMm: detailHeight });
  }
  if (clippedAway) {
    notices.push('Een deel van de contourlijn of details viel buiten de veilige rand van de plaat en is afgesneden.');
  }

  const present = parts.filter((p) => !isEmpty(p.region));
  const footprint = dropSpecks(unionRegions(present.map((p) => p.region)));
  const islands: ReliefIsland[] = [];
  const minOverlap = STAMP_INTERNAL.minReliefAreaMm2 * 0.1;
  for (const isl of splitIslands(regionToPaths(footprint))) {
    const islandRegion: RegionRings = { outers: [isl.outer], holes: isl.holes };
    const touching = present
      .filter((p) => regionArea(intersectRegions(islandRegion, p.region)) > minOverlap)
      .sort((a, b) => a.heightMm - b.heightMm);
    if (touching.length === 0) continue;
    const low = touching[0];
    const high = touching[touching.length - 1];
    const island: ReliefIsland = { outer: isl.outer, holes: isl.holes, heightMm: low.heightMm };
    if (high.heightMm - low.heightMm > 1e-9) {
      const inner = offsetRegion(islandRegion, -STAMP_INTERNAL.reliefStepInsetMm);
      const top = dropSpecks(intersectRegions(high.region, inner));
      if (!isEmpty(top)) island.terrace = { region: top, heightMm: high.heightMm };
    }
    islands.push(island);
  }
  return { islands, region: footprint, notices };
}

/** Voetafdruk van het volledige reliëf (alle niveaus samen); zie `buildReliefLevels`. */
export function buildReliefRegion(
  plateOuter: Ring,
  details: DetailLine[],
  params: ShapeParameters,
  includeContour: boolean,
): ReliefResult {
  return buildReliefLevels(plateOuter, details, params, includeContour);
}

/* ------------------------------------------------------------------ */
/* Handvat: plaatsing op een veilig intern steunpunt                   */
/* ------------------------------------------------------------------ */

/** Grootste ingeschreven cirkel (benaderend): middelpunt + straal tot de rand van `outer`. */
export function findInteriorSupportPoint(outer: Ring): { center: Point2; radius: number } {
  const b = ringBounds(outer);
  const grid = new SegmentGrid(outer);
  const score = (p: Point2): number => (pointInRing(p, outer) ? grid.distanceTo(p) : -grid.distanceTo(p));

  let best = { center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, radius: -Infinity };
  let range = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  for (let iter = 0; iter < 7; iter++) {
    const steps = iter === 0 ? 22 : 7;
    const stepSize = range / steps;
    const cx = best.center.x;
    const cy = best.center.y;
    for (let ix = -steps; ix <= steps; ix++) {
      for (let iy = -steps; iy <= steps; iy++) {
        const p = { x: cx + ix * stepSize, y: cy + iy * stepSize };
        if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
        const d = score(p);
        if (d > best.radius) best = { center: p, radius: d };
      }
    }
    range = stepSize * 3;
  }
  return best;
}

export function circleRing(center: Point2, radius: number, segments: number): Ring {
  const ring: Point2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ring.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return ensureCCW(ring);
}

/** Zoekt een veilig steunpunt voor het handvat en geeft de cirkelring terug, of weigert duidelijk. */
export function placeHandle(plateOuter: Ring, diameterMm: number): Ring {
  const { center, radius } = findInteriorSupportPoint(plateOuter);
  const needed = diameterMm / 2 + STAMP_INTERNAL.handleSafetyMarginMm;
  if (radius < needed) {
    fail(
      'HANDLE_INVALID',
      `Een handvat van ${diameterMm} mm doorsnede past niet veilig op deze stempelplaat. Kies een kleinere diameter of gebruik een grotere/bredere vorm.`,
    );
  }
  return circleRing(center, diameterMm / 2, STAMP_INTERNAL.handleSegments);
}

/* ------------------------------------------------------------------ */
/* Mesh-opbouw                                                         */
/* ------------------------------------------------------------------ */

/**
 * Vlak op één hoogte tussen twee niveaus: het gebied `lower − upper`.
 * Randen: buitencontouren van `lower` en gaten van `upper` begrenzen het
 * vlak van buiten; gaten van `lower` en buitencontouren van `upper` zijn er
 * gaten in. Elk gat hoort bij de kleinste omsluitende buitenrand.
 */
function capBetween(mb: MeshBuilder, outersAt: RingLevel[], holesAt: RingLevel[]): void {
  const area = (r: RingLevel) => Math.abs(signedArea(r.ring));
  const assigned: RingLevel[][] = outersAt.map(() => []);
  for (const h of holesAt) {
    let best = -1;
    outersAt.forEach((o, oi) => {
      if (area(o) > area(h) && pointInRing(h.ring[0], o.ring) && (best < 0 || area(o) < area(outersAt[best]))) best = oi;
    });
    if (best < 0) fail('CONTOUR_RELIEF_INVALID', 'Het reliëf van de stempel kon niet betrouwbaar opgebouwd worden.');
    assigned[best].push(h);
  }
  outersAt.forEach((o, oi) => mb.cap(o, assigned[oi], 'up', FaceTag.Cap));
}

/**
 * Bouwt de stempelmesh: handvat, plaat en reliëfeilanden. Elk eiland krijgt
 * verticale wanden van het plaatoppervlak tot zijn hoogte; een terras
 * daarop krijgt wanden van de eilandhoogte tot zijn eigen hoogte. Er
 * bestaan geen niveaus zonder hoogte (geen nulhoogte-extrusies).
 */
export function buildStampMesh(
  plateOuter: Ring,
  islands: ReliefIsland[],
  handleRing: Ring,
  plateThicknessMm: number,
  handleHeightMm: number,
): MeshData {
  const mb = new MeshBuilder();
  const baseZ = handleHeightMm;
  const topZ = baseZ + plateThicknessMm;

  // Handvat: cilinder van Z = 0 (vlakke onderkant) tot Z = baseZ (vergroeid met de plaat).
  const handleBottom = mb.ringLevel(handleRing, 0);
  const handleTopAtPlate = mb.ringLevel(handleRing, baseZ);
  mb.wall(handleBottom, handleTopAtPlate, 'out', FaceTag.Outer);
  mb.cap(handleBottom, [], 'down', FaceTag.Outer);

  // Onderkant van de plaat: volledige buitencontour, met een gat voor het handvat
  // (zelfde ring/vertices als de top van het handvat, dus naadloos verbonden).
  const plateBottom = mb.ringLevel(plateOuter, baseZ);
  mb.cap(plateBottom, [handleTopAtPlate], 'down', FaceTag.Cap);

  // Zijwand van de plaat.
  const plateTop = mb.ringLevel(plateOuter, topZ);
  mb.wall(plateBottom, plateTop, 'out', FaceTag.Outer);

  const extrude = (ring: Ring, z0: number, z1: number, side: 'out' | 'in') => {
    const bottom = mb.ringLevel(ring, z0);
    const top = mb.ringLevel(ring, z1);
    mb.wall(bottom, top, side, side === 'out' ? FaceTag.Outer : FaceTag.Inner);
    return { bottom, top };
  };

  const plateOuters: RingLevel[] = [plateTop];
  const plateHoles: RingLevel[] = [];
  for (const island of islands.filter((i) => i.heightMm > 1e-9)) {
    const z1 = topZ + island.heightMm;
    const outer = extrude(island.outer, topZ, z1, 'out');
    const holes = island.holes.map((h) => extrude(h, topZ, z1, 'in'));
    // Plaatoppervlak: het eiland is er een gat in; zijn eigen gaten tonen weer plaatoppervlak.
    plateHoles.push(outer.bottom);
    plateOuters.push(...holes.map((h) => h.bottom));

    const topOuters = [outer.top];
    const topHoles = holes.map((h) => h.top);
    const t = island.terrace;
    if (t && t.heightMm > island.heightMm + 1e-9 && t.region.outers.length > 0) {
      const z2 = topZ + t.heightMm;
      const tOuters = t.region.outers.map((r) => extrude(r, z1, z2, 'out'));
      const tHoles = t.region.holes.map((r) => extrude(r, z1, z2, 'in'));
      topHoles.push(...tOuters.map((o) => o.bottom));
      topOuters.push(...tHoles.map((h) => h.bottom));
      capBetween(mb, tOuters.map((o) => o.top), tHoles.map((h) => h.top));
    }
    capBetween(mb, topOuters, topHoles);
  }
  capBetween(mb, plateOuters, plateHoles);

  return mb.build();
}

export interface StampBuildResult {
  mesh: MeshData;
  notices: string[];
}

/**
 * Bouwt een volledige stempel: plaat (met optionele inset t.o.v. een
 * cutter-binnenzijde), verhoogde contourlijn (hoogte `contourHeight`, 0 =
 * geen contourlijn), detailreliëf (hoogte `detailHeight`) en handvat.
 * Gedeeld door de zelfstandige Stempel en Cutter & Stempel.
 */
export function buildStamp(
  outer: Ring,
  details: DetailLine[],
  params: ShapeParameters,
  includeContour = true,
): StampBuildResult {
  const plateOuter = buildPlateOuter(outer, params.insetOffset ?? 0);
  const { islands, notices } = buildReliefLevels(plateOuter, details, params, includeContour);
  const handleRing = placeHandle(plateOuter, params.handleDiameter);
  const mesh = buildStampMesh(plateOuter, islands, handleRing, STAMP_INTERNAL.plateThicknessMm, params.handleHeight);
  return { mesh, notices };
}
