/**
 * Centrale configuratie van MAAK! Shape to STL.
 *
 * Alle standaardwaarden voor Basismodus, de grenzen voor Expertmodus en de
 * interne geometrie-instellingen staan hier op één plek. Pas ze hier aan;
 * de rest van de applicatie leest ze uitsluitend uit dit bestand.
 */
import type { GeneratorType, ParamSpec, ShapeParameters } from '../engine/types';

/** Het referentiekader (Canva-frame) in Basismodus, in millimeter. */
export const BASIC_FRAME_MM = { length: 100, width: 100 } as const;

/** Standaardwaarden van een lijst parameters, als `ShapeParameters`. */
export function defaultsFromParams(specs: ParamSpec[]): ShapeParameters {
  return Object.fromEntries(specs.map((s) => [s.key, s.default]));
}

/* ------------------------------------------------------------------ */
/* Cookie cutter                                                       */
/* ------------------------------------------------------------------ */

export const COOKIE_CUTTER_PARAMS: ParamSpec[] = [
  { key: 'length', label: 'Lengte', hint: 'Breedte van het volledige SVG-kader (X)', min: 20, max: 300, step: 1, default: BASIC_FRAME_MM.length },
  { key: 'width', label: 'Breedte', hint: 'Hoogte van het volledige SVG-kader (Y)', min: 20, max: 300, step: 1, default: BASIC_FRAME_MM.width },
  { key: 'height', label: 'Hoogte', hint: 'Totale hoogte van het object', min: 6, max: 60, step: 0.5, default: 15 },
  { key: 'wallThickness', label: 'Wanddikte', hint: 'Dikte van de wand', min: 0.4, max: 5, step: 0.1, default: 1.2 },
];

export const COOKIE_CUTTER_DEFAULTS: ShapeParameters = defaultsFromParams(COOKIE_CUTTER_PARAMS);

/** Interne waarden die niet in de interface instelbaar zijn. */
export const COOKIE_CUTTER_INTERNAL = {
  /** Hoeveel de drukrand bovenaan naar buiten uitsteekt (mm). */
  flareWidth: 2,
  /** Hoogte van de verbredingszone bovenaan (mm). */
  flareHeight: 3,
  /** Minimale hoogte van de verticale snijwand onder de verbreding (mm). */
  minCuttingWallHeight: 2,
  /**
   * De verbreding wordt opgebouwd uit fijne horizontale trappen van
   * maximaal deze hoogte (mm). Dit ligt onder een normale laaghoogte van
   * een FDM-printer, zodat de overgang na het slicen glad verloopt.
   */
  flareStepHeight: 0.15,
} as const;

/* ------------------------------------------------------------------ */
/* Vulvorm                                                             */
/* ------------------------------------------------------------------ */

export const FILLING_MOLD_PARAMS: ParamSpec[] = [
  { key: 'length', label: 'Lengte', hint: 'Breedte van het volledige SVG-kader (X)', min: 20, max: 300, step: 1, default: BASIC_FRAME_MM.length },
  { key: 'width', label: 'Breedte', hint: 'Hoogte van het volledige SVG-kader (Y)', min: 20, max: 300, step: 1, default: BASIC_FRAME_MM.width },
  { key: 'height', label: 'Hoogte', hint: 'Totale hoogte van het object', min: 4, max: 100, step: 0.5, default: 20 },
  { key: 'wallThickness', label: 'Wanddikte', hint: 'Dikte van de wand', min: 0.8, max: 10, step: 0.1, default: 2 },
];

export const FILLING_MOLD_DEFAULTS: ShapeParameters = defaultsFromParams(FILLING_MOLD_PARAMS);

export const FILLING_MOLD_INTERNAL = {
  /** Dikte van de gesloten bodem (mm). */
  floorThickness: 2,
  /** Minimale diepte van de uitsparing boven de bodem (mm). */
  minCavityDepth: 1,
} as const;

/* ------------------------------------------------------------------ */
/* Stempel (zelfstandig)                                               */
/* ------------------------------------------------------------------ */

export const STAMP_PARAMS: ParamSpec[] = [
  { key: 'length', label: 'Lengte', hint: 'Breedte van het volledige SVG-kader (X)', min: 20, max: 300, step: 1, default: BASIC_FRAME_MM.length },
  { key: 'width', label: 'Breedte', hint: 'Hoogte van het volledige SVG-kader (Y)', min: 20, max: 300, step: 1, default: BASIC_FRAME_MM.width },
  { key: 'detailWidth', label: 'Dikte details', hint: 'Breedte van de verhoogde detaillijnen', min: 0.4, max: 3, step: 0.1, default: 1.0 },
  { key: 'contourWidth', label: 'Dikte contour', hint: 'Breedte van de verhoogde contourlijn', min: 0.4, max: 4, step: 0.1, default: 1.2 },
  { key: 'reliefHeight', label: 'Hoogte reliëf', hint: 'Hoogte van contour en details boven het stempeloppervlak', min: 0.4, max: 4, step: 0.1, default: 1.5 },
  { key: 'handleDiameter', label: 'Diameter handvat', hint: 'Doorsnede van het cilindrische handvat', min: 8, max: 60, step: 1, default: 20 },
  { key: 'handleHeight', label: 'Hoogte handvat', hint: 'Hoogte van het handvat', min: 4, max: 40, step: 1, default: 12 },
  { key: 'insetOffset', label: 'Offset naar binnen', hint: 'Extra speling van de stempelplaat naar binnen', min: 0, max: 3, step: 0.1, default: 0 },
];

export const STAMP_DEFAULTS: ShapeParameters = defaultsFromParams(STAMP_PARAMS);

export const STAMP_INTERNAL = {
  /** Dikte van de stempelplaat (mm); niet instelbaar. */
  plateThicknessMm: 3,
  /** Extra inkeping tussen de plaatrand en de centerlijn van de reliëfcontour (mm), naast de halve contourbreedte. */
  raisedContourInsetMm: 1.0,
  /** Veilige binnenmarge (mm) waarbinnen reliëf (contour + details) mag liggen, t.o.v. de plaatrand. */
  reliefSafetyMarginMm: 1.0,
  /** Veilige marge (mm) rond het handvat t.o.v. de plaatrand. */
  handleSafetyMarginMm: 1.5,
  /** Aantal segmenten waarmee de cilinder van het handvat benaderd wordt. */
  handleSegments: 48,
  /** Reliëfvlekjes kleiner dan dit oppervlak (mm²) worden na het bijsnijden genegeerd. */
  minReliefAreaMm2: 0.3,
  /** Als bijsnijden meer dan deze fractie van het reliëfoppervlak wegneemt, volgt een waarschuwing. */
  reliefClipWarnFraction: 0.1,
} as const;

/* ------------------------------------------------------------------ */
/* Cutter & Stempel                                                    */
/* ------------------------------------------------------------------ */

export const CUTTER_STAMP_PARAMS: ParamSpec[] = [
  { key: 'length', label: 'Lengte', hint: 'Breedte van het volledige SVG-kader (X)', min: 20, max: 300, step: 1, default: BASIC_FRAME_MM.length, group: 'Cookie cutter' },
  { key: 'width', label: 'Breedte', hint: 'Hoogte van het volledige SVG-kader (Y)', min: 20, max: 300, step: 1, default: BASIC_FRAME_MM.width, group: 'Cookie cutter' },
  { key: 'height', label: 'Hoogte', hint: 'Totale hoogte van de cutter', min: 6, max: 60, step: 0.5, default: 15, group: 'Cookie cutter' },
  { key: 'wallThickness', label: 'Wanddikte', hint: 'Dikte van de snijwand', min: 0.4, max: 5, step: 0.1, default: 1.2, group: 'Cookie cutter' },
  { key: 'detailWidth', label: 'Dikte details', hint: 'Breedte van de verhoogde detaillijnen', min: 0.4, max: 3, step: 0.1, default: 1.0, group: 'Stempel' },
  { key: 'contourWidth', label: 'Dikte contour', hint: 'Breedte van de verhoogde contourlijn', min: 0.4, max: 4, step: 0.1, default: 1.2, group: 'Stempel' },
  { key: 'reliefHeight', label: 'Hoogte reliëf', hint: 'Hoogte van contour en details boven het stempeloppervlak', min: 0.4, max: 4, step: 0.1, default: 1.5, group: 'Stempel' },
  { key: 'handleDiameter', label: 'Diameter handvat', hint: 'Doorsnede van het cilindrische handvat', min: 8, max: 60, step: 1, default: 20, group: 'Stempel' },
  { key: 'handleHeight', label: 'Hoogte handvat', hint: 'Hoogte van het handvat', min: 4, max: 40, step: 1, default: 12, group: 'Stempel' },
  { key: 'insetOffset', label: 'Extra speling naar binnen', hint: 'Extra speling van de stempel t.o.v. de binnenzijde van de cutter', min: 0, max: 3, step: 0.1, default: 0.4, group: 'Stempel' },
];

export const CUTTER_STAMP_DEFAULTS: ShapeParameters = defaultsFromParams(CUTTER_STAMP_PARAMS);

export const PARAMS_BY_GENERATOR: Record<GeneratorType, ParamSpec[]> = {
  cookieCutter: COOKIE_CUTTER_PARAMS,
  fillingMold: FILLING_MOLD_PARAMS,
  stamp: STAMP_PARAMS,
  cutterStamp: CUTTER_STAMP_PARAMS,
};

export const DEFAULT_PARAMETERS: Record<GeneratorType, ShapeParameters> = {
  cookieCutter: COOKIE_CUTTER_DEFAULTS,
  fillingMold: FILLING_MOLD_DEFAULTS,
  stamp: STAMP_DEFAULTS,
  cutterStamp: CUTTER_STAMP_DEFAULTS,
};

/* ------------------------------------------------------------------ */
/* SVG-invoer en veiligheid                                            */
/* ------------------------------------------------------------------ */

export const SVG_LIMITS = {
  /** Maximale bestandsgrootte in bytes (2 MB). */
  maxFileBytes: 2 * 1024 * 1024,
  /** Maximaal aantal XML-elementen (na het uitvouwen van <use>). */
  maxElements: 5000,
  /** Maximale totale lengte van alle path-data (tekens). */
  maxPathDataLength: 1_000_000,
  /** Maximaal aantal punten na het omzetten van curves naar polygonen. */
  maxPoints: 80_000,
  /** Maximaal aantal <use>-verwijzingen dat uitgevouwen wordt. */
  maxUseExpansions: 500,
} as const;

/* ------------------------------------------------------------------ */
/* Geometrie                                                           */
/* ------------------------------------------------------------------ */

export const GEOMETRY = {
  /** Maximale lengte (mm) van één lijnstukje bij het benaderen van curves. */
  maxCurveSegmentMm: 0.25,
  /** Minimaal en maximaal aantal lijnstukjes per curve. */
  minCurveSegments: 4,
  maxCurveSegments: 720,
  /** Punten die minder dan dit (mm) van de rechte lijn afwijken, vervallen. */
  simplifyToleranceMm: 0.004,
  /** Aantal decimalen (mm) waarmee Clipper2 rekent: 4 = 0,1 µm. */
  clipperPrecision: 4,
  /** Maximale afwijking (mm) van afgeronde hoeken bij offsets. */
  arcToleranceMm: 0.01,
  /** Losse vlekjes kleiner dan dit oppervlak (mm²) worden als ruis genegeerd. */
  minIslandAreaMm2: 0.5,
  /** Een vorm die minstens deze fractie van het kader bedekt, geldt als achtergrond. */
  backgroundCoverage: 0.98,
  /** Open subpaden waarvan begin en einde dichter liggen dan deze fractie van het kader, worden als gesloten beschouwd. */
  closeToleranceFraction: 0.005,
  /** Kleinste toegestane afstand (mm) tussen twee punten van één contour. */
  minPointDistanceMm: 0.002,
} as const;
