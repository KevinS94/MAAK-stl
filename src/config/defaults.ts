/**
 * Centrale configuratie van MAAK! Shape to STL.
 *
 * Alle standaardwaarden voor Basismodus, de grenzen voor Expertmodus en de
 * interne geometrie-instellingen staan hier op één plek. Pas ze hier aan;
 * de rest van de applicatie leest ze uitsluitend uit dit bestand.
 */
import type { GeneratorType, ShapeParameters } from '../engine/types';

/** Het referentiekader (Canva-frame) in Basismodus, in millimeter. */
export const BASIC_FRAME_MM = { length: 100, width: 100 } as const;

export interface NumericLimit {
  min: number;
  max: number;
  step: number;
}

export interface ParameterLimits {
  length: NumericLimit;
  width: NumericLimit;
  height: NumericLimit;
  wallThickness: NumericLimit;
}

/* ------------------------------------------------------------------ */
/* Cookie cutter                                                       */
/* ------------------------------------------------------------------ */

export const COOKIE_CUTTER_DEFAULTS: ShapeParameters = {
  length: BASIC_FRAME_MM.length,
  width: BASIC_FRAME_MM.width,
  height: 15,
  wallThickness: 1.2,
};

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

export const COOKIE_CUTTER_LIMITS: ParameterLimits = {
  length: { min: 20, max: 300, step: 1 },
  width: { min: 20, max: 300, step: 1 },
  height: { min: 6, max: 60, step: 0.5 },
  wallThickness: { min: 0.4, max: 5, step: 0.1 },
};

/* ------------------------------------------------------------------ */
/* Vulvorm                                                             */
/* ------------------------------------------------------------------ */

export const FILLING_MOLD_DEFAULTS: ShapeParameters = {
  length: BASIC_FRAME_MM.length,
  width: BASIC_FRAME_MM.width,
  height: 20,
  wallThickness: 2,
};

export const FILLING_MOLD_INTERNAL = {
  /** Dikte van de gesloten bodem (mm). */
  floorThickness: 2,
  /** Minimale diepte van de uitsparing boven de bodem (mm). */
  minCavityDepth: 1,
} as const;

export const FILLING_MOLD_LIMITS: ParameterLimits = {
  length: { min: 20, max: 300, step: 1 },
  width: { min: 20, max: 300, step: 1 },
  height: { min: 4, max: 100, step: 0.5 },
  wallThickness: { min: 0.8, max: 10, step: 0.1 },
};

export const DEFAULT_PARAMETERS: Record<GeneratorType, ShapeParameters> = {
  cookieCutter: COOKIE_CUTTER_DEFAULTS,
  fillingMold: FILLING_MOLD_DEFAULTS,
};

export const PARAMETER_LIMITS: Record<GeneratorType, ParameterLimits> = {
  cookieCutter: COOKIE_CUTTER_LIMITS,
  fillingMold: FILLING_MOLD_LIMITS,
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
