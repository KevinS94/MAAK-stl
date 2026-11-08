/**
 * Volledige verwerkingsketen: SVG-geometrie + parameters -> gevalideerde mesh.
 * Wordt gebruikt door de UI en door de tests, zodat beide exact dezelfde
 * code doorlopen.
 */
import { getGenerator } from '../generators';
import { buildContour } from './contourProcessing';
import { validateMesh } from './meshValidation';
import { frameSizeFor } from './svgScaling';
import type { ApplicationMode, GenerationResult, GeneratorType, Result, SVGGeometry, ShapeParameters } from './types';

export function generateModel(
  geometry: SVGGeometry,
  generatorId: GeneratorType,
  mode: ApplicationMode,
  params: ShapeParameters,
): Result<GenerationResult> {
  const generator = getGenerator(generatorId);
  const contourResult = buildContour(geometry, frameSizeFor(mode, params));
  if (!contourResult.ok) return contourResult;
  const contour = contourResult.value;

  const meshResult = generator.generate(contour, params);
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
