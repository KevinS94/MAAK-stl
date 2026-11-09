/**
 * Volledige verwerkingsketen: SVG-geometrie + parameters -> gevalideerde mesh.
 * Wordt gebruikt door de UI en door de tests, zodat beide exact dezelfde
 * code doorlopen.
 */
import { getGenerator, isComboGenerator } from '../generators';
import { buildContour } from './contourProcessing';
import { fail, toResult } from './errors';
import { validateMesh } from './meshValidation';
import { frameSizeFor } from './svgScaling';
import type {
  ApplicationMode,
  ComboGenerationResult,
  DetailLine,
  GenerationResult,
  GeneratorType,
  MeshData,
  Result,
  SVGGeometry,
  ShapeParameters,
  ValidatedContour,
} from './types';

function validateOrFail(mesh: MeshData, label: string) {
  const report = validateMesh(mesh);
  if (!report.valid || !(Math.abs(report.bounds.min[2]) < 1e-6)) {
    fail(
      'MESH_INVALID',
      `Het ${label} voldoet niet aan de kwaliteitscontrole en wordt niet geëxporteerd. Probeer een eenvoudigere vorm.`,
      report.problems.join(' '),
    );
  }
  return report;
}

/**
 * Legacy keten voor cookie cutter en vulvorm: één SVG-vorm -> één contour ->
 * één mesh. Blijft ongewijzigd voor bestaande aanroepers/tests.
 */
export function generateModel(
  geometry: SVGGeometry,
  generatorId: GeneratorType,
  mode: ApplicationMode,
  params: ShapeParameters,
): Result<GenerationResult> {
  const generator = getGenerator(generatorId);
  if (isComboGenerator(generator)) {
    return { ok: false, error: { code: 'MESH_INVALID', message: 'Deze generator levert twee modellen op en kan niet via generateModel gebruikt worden.' } };
  }
  const contourResult = buildContour(geometry, frameSizeFor(mode, params));
  if (!contourResult.ok) return contourResult;
  const contour = contourResult.value;

  const meshResult = generator.generate(contour, [], params);
  if (!meshResult.ok) return meshResult;
  const mesh = meshResult.value;

  const report = validateMesh(mesh);
  const zOk = Math.abs(report.bounds.min[2]) < 1e-6 && Math.abs(report.bounds.max[2] - params.height) < 1e-6;
  if (!report.valid || !zOk) {
    return {
      ok: false,
      error: {
        code: 'MESH_INVALID',
        message: 'Het 3D-model voldoet niet aan de kwaliteitscontrole en wordt niet geëxporteerd. Probeer een eenvoudigere vorm.',
        details: [...report.problems, zOk ? '' : 'Onverwachte hoogte.'].filter(Boolean).join(' '),
      },
    };
  }
  return {
    ok: true,
    value: { generator: generatorId, parameters: { ...params }, mesh, report, contour, notices: contour.notices },
  };
}

/**
 * Keten voor de universele padselectie (stempel en cutter & stempel, maar
 * ook cookie cutter/vulvorm als de gebruiker de selector gebruikt):
 * contour en details zijn al bepaald (zie `engine/svgPaths.ts`).
 */
export function generateFromSelection(
  contour: ValidatedContour,
  details: DetailLine[],
  generatorId: GeneratorType,
  params: ShapeParameters,
): Result<GenerationResult | ComboGenerationResult> {
  const generator = getGenerator(generatorId);
  if (isComboGenerator(generator)) {
    const result = generator.generate(contour, details, params);
    if (!result.ok) return result;
    const validated = toResult(() => ({
      cutter: { mesh: result.value.cutter, report: validateOrFail(result.value.cutter, 'cutter-model') },
      stamp: { mesh: result.value.stamp, report: validateOrFail(result.value.stamp, 'stempel-model') },
    }));
    if (!validated.ok) return validated;
    return {
      ok: true,
      value: {
        generator: generatorId,
        parameters: { ...params },
        cutter: validated.value.cutter,
        stamp: validated.value.stamp,
        contour,
        notices: contour.notices,
      },
    };
  }
  const result = generator.generate(contour, details, params);
  if (!result.ok) return result;
  const validated = toResult(() => validateOrFail(result.value, 'model'));
  if (!validated.ok) return validated;
  return {
    ok: true,
    value: {
      generator: generatorId,
      parameters: { ...params },
      mesh: result.value,
      report: validated.value,
      contour,
      notices: contour.notices,
    },
  };
}
