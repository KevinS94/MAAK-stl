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
import { MeshBuilder } from '../engine/meshGeneration';
import {
  intersectRegionWithRing,
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

export function buildDetailRegion(details: DetailLine[], detailWidth: number): RegionRings {
  const halfW = detailWidth / 2;
  const regions = details
    .filter((d) => d.ring.length >= 2)
    .map((d) => (d.closed ? offsetClosedPolyline(d.ring, halfW) : offsetOpenPolyline(d.ring, halfW)));
  return unionRegions(regions);
}

export interface ReliefResult {
  region: RegionRings;
  notices: string[];
}

/**
 * Verenigt contourlijn en details, en snijdt het resultaat bij tot een
 * veilige binnenmarge t.o.v. de plaatrand (spec §4.3).
 */
export function buildReliefRegion(
  plateOuter: Ring,
  details: DetailLine[],
  params: ShapeParameters,
  includeContour: boolean,
): ReliefResult {
  const notices: string[] = [];
  const regions: RegionRings[] = [];
  if (includeContour) regions.push(buildRaisedContourRegion(plateOuter, params.contourWidth));
  if (details.length > 0) regions.push(buildDetailRegion(details, params.detailWidth));
  if (regions.length === 0) return { region: { outers: [], holes: [] }, notices };

  const merged = unionRegions(regions);
  const before = regionArea(merged);

  const safe = offsetRing(plateOuter, -STAMP_INTERNAL.reliefSafetyMarginMm);
  if (safe.outers.length !== 1) {
    fail('CONTOUR_RELIEF_INVALID', 'Er blijft geen veilige binnenmarge over voor reliëf op deze vorm.');
  }
  const clipped = intersectRegionWithRing(merged, safe.outers[0]);
  const after = regionArea(clipped);
  if (before > 1e-6 && after < before * (1 - STAMP_INTERNAL.reliefClipWarnFraction)) {
    notices.push('Een deel van de contourlijn of details viel buiten de veilige rand van de plaat en is afgesneden.');
  }

  const outers = clipped.outers.filter((r) => Math.abs(signedArea(r)) >= STAMP_INTERNAL.minReliefAreaMm2);
  const holes = clipped.holes.filter((r) => Math.abs(signedArea(r)) >= STAMP_INTERNAL.minReliefAreaMm2 * 0.3);
  return { region: { outers, holes }, notices };
}

function groupHolesToOuters(outers: Ring[], holes: Ring[]): { outer: Ring; holes: Ring[] }[] {
  return outers.map((outer) => ({ outer, holes: holes.filter((h) => h.length > 0 && pointInRing(h[0], outer)) }));
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

export function buildStampMesh(
  plateOuter: Ring,
  reliefRegion: RegionRings,
  handleRing: Ring,
  plateThicknessMm: number,
  reliefHeightMm: number,
  handleHeightMm: number,
): MeshData {
  const mb = new MeshBuilder();
  const baseZ = handleHeightMm;
  const topZ = baseZ + plateThicknessMm;
  const reliefTopZ = topZ + reliefHeightMm;

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

  // Bovenkant van de plaat: volledig vlak, met een gat per reliëfvorm (boss).
  const bossBottoms = reliefRegion.outers.map((r) => mb.ringLevel(r, topZ));
  mb.cap(plateTop, bossBottoms, 'up', FaceTag.Cap);

  const groups = groupHolesToOuters(reliefRegion.outers, reliefRegion.holes);
  groups.forEach((group, gi) => {
    const outerBottom = bossBottoms[gi];
    const outerTop = mb.ringLevel(group.outer, reliefTopZ);
    mb.wall(outerBottom, outerTop, 'out', FaceTag.Outer);

    const holeBottoms = group.holes.map((h) => mb.ringLevel(h, topZ));
    const holeTops = group.holes.map((h) => mb.ringLevel(h, reliefTopZ));
    mb.cap(outerTop, holeTops, 'up', FaceTag.Cap);
    group.holes.forEach((_, hi) => {
      mb.wall(holeBottoms[hi], holeTops[hi], 'in', FaceTag.Inner);
      // Vlak "eiland" op plaathoogte binnen het gat van deze boss (bv. de kern van de contourring).
      mb.cap(holeBottoms[hi], [], 'up', FaceTag.Cap);
    });
  });

  return mb.build();
}

export interface StampBuildResult {
  mesh: MeshData;
  notices: string[];
}

/**
 * Bouwt een volledige stempel: plaat (met optionele inset t.o.v. een
 * cutter-binnenzijde), verhoogde contourlijn, detailribben en handvat.
 */
export function buildStamp(
  outer: Ring,
  details: DetailLine[],
  params: ShapeParameters,
  includeContour = true,
): StampBuildResult {
  const plateOuter = buildPlateOuter(outer, params.insetOffset ?? 0);
  const { region, notices } = buildReliefRegion(plateOuter, details, params, includeContour);
  const handleRing = placeHandle(plateOuter, params.handleDiameter);
  const mesh = buildStampMesh(plateOuter, region, handleRing, STAMP_INTERNAL.plateThicknessMm, params.reliefHeight, params.handleHeight);
  return { mesh, notices };
}
