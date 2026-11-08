import type { ParameterLimits } from '../config/defaults';
import type { GeneratorType, MeshData, Result, ShapeParameters, ValidatedContour } from '../engine/types';

/**
 * Een generator zet een gevalideerde contour en vier parameters om naar
 * een gesloten mesh, of naar een gestructureerde fout.
 *
 * Een nieuwe generator toevoegen = een object dat deze interface
 * implementeert registreren in `generators/index.ts`.
 */
export interface ShapeGenerator {
  id: GeneratorType;
  /** Naam in de tabs. */
  label: string;
  /** Titel boven de kaart. */
  title: string;
  /** Korte uitleg onder de titel. */
  description: string;
  defaults: ShapeParameters;
  limits: ParameterLimits;
  generate(contour: ValidatedContour, params: ShapeParameters): Result<MeshData>;
}
