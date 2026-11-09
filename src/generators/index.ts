import type { GeneratorType } from '../engine/types';
import { cookieCutterGenerator } from './cookieCutter';
import { cutterStampGenerator } from './cutterStamp';
import { fillingMoldGenerator } from './fillingMold';
import { stampGenerator } from './stamp';
import type { AnyGenerator, ComboGenerator } from './types';

/** Register van alle generators, in de volgorde van de tabs. */
export const GENERATORS: readonly AnyGenerator[] = [
  cookieCutterGenerator,
  fillingMoldGenerator,
  stampGenerator,
  cutterStampGenerator,
];

export function getGenerator(id: GeneratorType): AnyGenerator {
  const g = GENERATORS.find((x) => x.id === id);
  if (!g) throw new Error(`Onbekende generator: ${id}`);
  return g;
}

export function isComboGenerator(g: AnyGenerator): g is ComboGenerator {
  return g.kind === 'combo';
}

export type { AnyGenerator, ComboGenerator, ComboResult, ShapeGenerator } from './types';
