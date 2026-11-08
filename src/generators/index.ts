import type { GeneratorType } from '../engine/types';
import { cookieCutterGenerator } from './cookieCutter';
import { fillingMoldGenerator } from './fillingMold';
import type { ShapeGenerator } from './types';

/** Register van alle generators, in de volgorde van de tabs. */
export const GENERATORS: readonly ShapeGenerator[] = [cookieCutterGenerator, fillingMoldGenerator];

export function getGenerator(id: GeneratorType): ShapeGenerator {
  const g = GENERATORS.find((x) => x.id === id);
  if (!g) throw new Error(`Onbekende generator: ${id}`);
  return g;
}

export type { ShapeGenerator } from './types';
