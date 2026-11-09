/**
 * Gedeelde types van de geometrische engine. Deze module is volledig
 * onafhankelijk van React en van de browser-UI.
 */
import type { Curve, Vector2 } from 'three';

export type GeneratorType = 'cookieCutter' | 'fillingMold' | 'stamp' | 'cutterStamp';

export type ApplicationMode = 'basis' | 'expert';

/**
 * Parameterwaarden van een generator (alle waarden in mm). Elke generator
 * bepaalt zelf welke sleutels relevant zijn via zijn `ParamSpec[]`
 * (zie `generators/types.ts`); hier blijft dit een open record zodat
 * cookie cutter/vulvorm (lengte, breedte, hoogte, wanddikte) en de nieuwe
 * stempelgeneratoren (andere sleutels) dezelfde machinerie kunnen delen.
 */
export type ShapeParameters = Record<string, number>;

/** Eén instelbare parameter: grenzen, standaardwaarde en Nederlands label. */
export interface ParamSpec {
  key: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Optioneel groepslabel (bv. "Cookie cutter" / "Stempel" bij Cutter & Stempel). */
  group?: string;
}

export interface Point2 {
  x: number;
  y: number;
}

/**
 * Gesloten polygoon zonder herhaald eindpunt. Binnen de engine is een
 * `Ring` altijd tegen de klok in georiënteerd (positieve oppervlakte).
 */
export type Ring = Point2[];

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Het referentiekader van de SVG (viewBox) in SVG-gebruikerseenheden. */
export interface SVGFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Waar het kader vandaan komt. */
  source: 'viewBox' | 'widthHeight';
}

export type SVGFillRule = 'nonzero' | 'evenodd';

/** Eén subpad zoals het uit de SVG komt, nog met echte curves. */
export interface SVGSubPath {
  curves: Curve<Vector2>[];
  /** Expliciet gesloten met `Z` of een gesloten basisvorm. */
  closed: boolean;
}

/** Een gevulde SVG-vorm (één element) in SVG-gebruikerseenheden. */
export interface SVGShape {
  subPaths: SVGSubPath[];
  fillRule: SVGFillRule;
  /** Id's van de clipPaths die op deze vorm van toepassing zijn. */
  clipIds: string[];
  /** Naam van het oorspronkelijke element (voor foutmeldingen). */
  elementName: string;
}

/** Resultaat van het veilig inlezen van een SVG-bestand. */
export interface SVGGeometry {
  frame: SVGFrame;
  shapes: SVGShape[];
  /** Geometrie per clipPath-id. */
  clipRegions: Record<string, SVGShape[]>;
  /** Niet-fatale opmerkingen voor de gebruiker (Nederlands). */
  notices: string[];
}

/** Doelafmetingen van het volledige SVG-kader in mm. */
export interface FrameSizeMm {
  length: number;
  width: number;
}

/** Eén gevalideerde, geschaalde en gecentreerde buitencontour in mm. */
export interface ValidatedContour {
  /** Buitencontour, tegen de klok in, gecentreerd rond (0, 0). */
  outer: Ring;
  /** Afmetingen van de contour zelf (mm). */
  widthMm: number;
  heightMm: number;
  areaMm2: number;
  /** Het fysieke kader (mm) waarin de contour geplaatst was. */
  frameMm: FrameSizeMm;
  /**
   * Verschuiving die gebruikt is bij het centreren:
   * positie in het kader = punt in `outer` + `centerOffset`.
   */
  centerOffset: Point2;
  notices: string[];
}

/** Soort oppervlak, gebruikt voor kleuren in de 3D-preview. */
export const FaceTag = {
  Outer: 0,
  Inner: 1,
  Cap: 2,
} as const;
export type FaceTag = (typeof FaceTag)[keyof typeof FaceTag];

/** Geïndexeerde driehoeksmesh in mm, Z = 0 is de onderkant. */
export interface MeshData {
  /** x, y, z per vertex. */
  positions: Float64Array;
  /** Drie vertex-indices per driehoek, tegen de klok in gezien van buitenaf. */
  indices: Uint32Array;
  /** Eén FaceTag per driehoek. */
  faceTags: Uint8Array;
}

export interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
}

export interface MeshReport {
  valid: boolean;
  problems: string[];
  vertexCount: number;
  triangleCount: number;
  /** Volume in mm³ (positief bij correcte oriëntatie). */
  volumeMm3: number;
  bounds: Bounds3;
  /** Aantal samenhangende delen. */
  components: number;
  /** Aantal randen dat niet precies bij twee driehoeken hoort. */
  nonManifoldEdges: number;
  /** Aantal randen waarvan de buren tegengesteld georiënteerd zijn. */
  inconsistentEdges: number;
  degenerateTriangles: number;
}

export type GeometryErrorCode =
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE'
  | 'SVG_PARSE'
  | 'SVG_UNSAFE'
  | 'SVG_EXTERNAL_REFERENCE'
  | 'SVG_RASTER_IMAGE'
  | 'SVG_TEXT'
  | 'SVG_UNSUPPORTED'
  | 'SVG_TOO_COMPLEX'
  | 'SVG_NO_FRAME'
  | 'SVG_EMPTY'
  | 'SVG_STROKE_ONLY'
  | 'SVG_OPEN_CONTOUR'
  | 'SVG_MULTIPLE_SHAPES'
  | 'INVALID_PARAMETERS'
  | 'SHAPE_TOO_NARROW'
  | 'FLARE_INVALID'
  | 'TRIANGULATION_FAILED'
  | 'MESH_INVALID'
  | 'NO_OUTER_SELECTED'
  | 'CONTOUR_RELIEF_INVALID'
  | 'DETAIL_INVALID'
  | 'HANDLE_INVALID'
  | 'STAMP_FIT_INVALID';

/** Gestructureerde fout met een korte Nederlandse melding. */
export interface GeometryValidationError {
  code: GeometryErrorCode;
  message: string;
  details?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: GeometryValidationError };

export interface GenerationResult {
  generator: GeneratorType;
  parameters: ShapeParameters;
  mesh: MeshData;
  report: MeshReport;
  contour: ValidatedContour;
  notices: string[];
}

/** Resultaat van Cutter & Stempel: twee onafhankelijke, gevalideerde modellen. */
export interface ComboGenerationResult {
  generator: GeneratorType;
  parameters: ShapeParameters;
  cutter: { mesh: MeshData; report: MeshReport };
  stamp: { mesh: MeshData; report: MeshReport };
  contour: ValidatedContour;
  notices: string[];
}

/* ------------------------------------------------------------------ */
/* Universele SVG-padselectie (meerdere vectorpaden + open lijnen)    */
/* ------------------------------------------------------------------ */

/** Rol die de gebruiker aan één geselecteerd vectorpad toekent. */
export type PathRole = 'outer' | 'detail' | 'ignore';

/** Eén selecteerbaar vectorpad (subpad) uit de SVG, met een gesampelde polylijn in mm. */
export interface SvgPathCandidate {
  /** Stabiele id binnen één SVG-bestand, bv. "2:0". */
  id: string;
  shapeIndex: number;
  elementName: string;
  /** Had het element een vulling in de SVG (hint voor automatische roltoewijzing). */
  filled: boolean;
  /** Expliciet gesloten (Z) of begin/eind liggen praktisch op elkaar. */
  closed: boolean;
  /** Gesampelde polylijn in mm, nog NIET gecentreerd (zelfde kadertransformatie als de contour). */
  ring: Point2[];
  areaMm2: number;
  lengthMm: number;
  bounds: Bounds2;
  suggestedRole: PathRole;
}

/** Eén detaillijn, uitgelijnd met de gekozen buitencontour (mm, gecentreerd). */
export interface DetailLine {
  ring: Point2[];
  closed: boolean;
}

/** Resultaat van de padselectie: gekozen buitencontour + bijpassende details. */
export interface PathSelection {
  candidates: SvgPathCandidate[];
  /** candidate.id -> rol. */
  roles: Record<string, PathRole>;
  /** Of de selectie automatisch en ondubbelzinnig bepaald kon worden. */
  unambiguous: boolean;
}
