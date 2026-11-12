import type { DetailLine, GeneratorType, MeshData, ParamSpec, Result, ShapeParameters, ValidatedContour } from '../engine/types';

/**
 * Een generator zet een gevalideerde contour, de geselecteerde stempeldetails
 * (leeg voor cookie cutter/vulvorm) en parameters om naar een gesloten mesh,
 * of naar een gestructureerde fout.
 *
 * Een nieuwe generator toevoegen = een object dat deze interface
 * implementeert registreren in `generators/index.ts`.
 */
export interface ShapeGenerator {
  id: GeneratorType;
  kind: 'single';
  /** Naam in de tabs. */
  label: string;
  /** Titel boven de kaart. */
  title: string;
  /** Korte uitleg onder de titel. */
  description: string;
  defaults: ShapeParameters;
  /** Instelbare parameters in Expertmodus (grenzen, standaardwaarde, label). */
  params: ParamSpec[];
  /** Gebruikt deze generator stempeldetails (rol "Stempeldetail") uit de SVG-selector? */
  usesDetails: boolean;
  generate(contour: ValidatedContour, details: DetailLine[], params: ShapeParameters): Result<MeshData>;
}

/** Resultaat van Cutter & Stempel: twee onafhankelijke STL's. */
export interface ComboResult {
  cutter: MeshData;
  stamp: MeshData;
}

/** Generator die twee afzonderlijke modellen oplevert (Cutter & Stempel). */
export interface ComboGenerator {
  id: GeneratorType;
  kind: 'combo';
  label: string;
  title: string;
  description: string;
  defaults: ShapeParameters;
  params: ParamSpec[];
  usesDetails: true;
  /** `details` zijn de geselecteerde stempeldetails, al uitgelijnd met `contour`. */
  generate(contour: ValidatedContour, details: DetailLine[], params: ShapeParameters): Result<ComboResult>;
}

export type AnyGenerator = ShapeGenerator | ComboGenerator;
