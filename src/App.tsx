import { useCallback, useMemo, useRef, useState } from 'react';
import { DownloadButton } from './components/DownloadButton';
import { GenerateButton } from './components/GenerateButton';
import { GeneratorTabs } from './components/GeneratorTabs';
import { Header } from './components/Header';
import { HelpDialog } from './components/HelpDialog';
import { ModeToggle } from './components/ModeToggle';
import { draftFromDefaults, isParamDisabled, ParameterPanel, type ParameterDraft } from './components/ParameterPanel';
import { PathSelector } from './components/PathSelector';
import { Preview3D } from './components/Preview3D';
import { SVGUploader, type FileStatus } from './components/SVGUploader';
import { BASIC_FRAME_MM, DEFAULT_PARAMETERS, PARAMS_BY_GENERATOR } from './config/defaults';
import { toResult } from './engine/errors';
import { generateFromSelection } from './engine/pipeline';
import { comboStlFileNames, exportBinaryStl, stlFileName } from './engine/stlExporter';
import type { SvgScene } from './engine/svgParser';
import {
  buildSelection,
  extractPathCandidates,
  hasGroupedShapes,
  importSvg,
  transferRoles,
  type Granularity,
} from './engine/svgPaths';
import { frameSizeFor } from './engine/svgScaling';
import { validateSvgFile } from './engine/svgValidation';
import type {
  ApplicationMode,
  Bounds3,
  ComboGenerationResult,
  GenerationResult,
  GeneratorType,
  GeometryValidationError,
  PathRole,
  Result,
  ShapeParameters,
  SvgPathCandidate,
  ValidatedContour,
} from './engine/types';
import { GENERATORS, getGenerator, type AnyGenerator } from './generators';

type GenerationState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'success'; result: GenerationResult; fileName: string }
  | { status: 'successCombo'; result: ComboGenerationResult; fileNames: { cutter: string; stamp: string } }
  | { status: 'error'; error: GeometryValidationError };

/** Geïmporteerde SVG (stap A) + de rolkeuze van de gebruiker (stap B). */
interface SvgState {
  scene: SvgScene;
  granularity: Granularity;
  roles: Record<string, PathRole>;
}

function initialDrafts(): Record<GeneratorType, ParameterDraft> {
  return {
    cookieCutter: draftFromDefaults(DEFAULT_PARAMETERS.cookieCutter),
    fillingMold: draftFromDefaults(DEFAULT_PARAMETERS.fillingMold),
    stamp: draftFromDefaults(DEFAULT_PARAMETERS.stamp),
    cutterStamp: draftFromDefaults(DEFAULT_PARAMETERS.cutterStamp),
  };
}

function parseDraft(draft: ParameterDraft, generator: GeneratorType) {
  const specs = PARAMS_BY_GENERATOR[generator];
  const errors: Partial<Record<string, string>> = {};
  const values: ShapeParameters = {};
  for (const spec of specs) {
    const raw = (draft[spec.key] ?? '').trim().replace(',', '.');
    const n = raw === '' ? NaN : Number(raw);
    if (isParamDisabled(spec, draft)) {
      // Uitgeschakeld veld: wordt niet gebruikt, mag Start dus niet blokkeren.
      values[spec.key] = Number.isFinite(n) && n >= spec.min && n <= spec.max ? n : spec.default;
      continue;
    }
    if (!Number.isFinite(n)) errors[spec.key] = 'Vul een getal in.';
    else if (n < spec.min || n > spec.max) errors[spec.key] = `Kies een waarde tussen ${spec.min} en ${spec.max} mm.`;
    values[spec.key] = n;
  }
  return { values, errors, valid: Object.keys(errors).length === 0 };
}

function basisSummary(gen: AnyGenerator): string {
  const extra = gen.params
    .filter((p) => p.key !== 'length' && p.key !== 'width')
    .map((p) => `${p.label.toLowerCase()} ${fmtMm(p.default)} mm`)
    .join(' · ');
  return `Automatische instellingen: kader 100 × 100 mm${extra ? ' · ' + extra : ''}`;
}

function fmtDims(bounds: Bounds3): string {
  return `${fmtMm(bounds.max[0] - bounds.min[0])} × ${fmtMm(bounds.max[1] - bounds.min[1])} × ${fmtMm(bounds.max[2] - bounds.min[2])} mm`;
}

export default function App() {
  const [generator, setGenerator] = useState<GeneratorType>('cookieCutter');
  const [mode, setMode] = useState<ApplicationMode>('basis');
  const [drafts, setDrafts] = useState(initialDrafts);
  const [file, setFile] = useState<FileStatus>({ status: 'empty' });
  const [svg, setSvg] = useState<SvgState | null>(null);
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });
  const [comboView, setComboView] = useState<'cutter' | 'stamp'>('cutter');
  const [helpOpen, setHelpOpen] = useState(false);
  /** Elke nieuwe aanvraag krijgt een nummer; verouderde resultaten worden genegeerd. */
  const requestRef = useRef(0);

  const activeGenerator = getGenerator(generator);
  const parsed = useMemo(() => parseDraft(drafts[generator], generator), [drafts, generator]);
  const params: ShapeParameters = mode === 'basis' ? activeGenerator.defaults : parsed.values;
  const paramsValid = mode === 'basis' || parsed.valid;

  const invalidate = useCallback(() => {
    requestRef.current++;
    setGeneration({ status: 'idle' });
  }, []);

  const frame = frameSizeFor(paramsValid ? mode : 'basis', paramsValid ? params : activeGenerator.defaults);
  const selectionFrame = useMemo(() => ({ length: frame.length, width: frame.width }), [frame.length, frame.width]);

  // Stap B: alle selecteerbare vormen/lijnen op de schaal die bij Start gebruikt wordt.
  const candidatesResult = useMemo<Result<SvgPathCandidate[]> | null>(
    () => (svg ? toResult(() => extractPathCandidates(svg.scene, selectionFrame, svg.granularity)) : null),
    [svg, selectionFrame],
  );
  const candidates = candidatesResult?.ok ? candidatesResult.value : null;

  // Stap C: generatorvalidatie van de gekozen buitencontour (ook voor de 2D-preview).
  const preview = useMemo((): Result<ValidatedContour> | null => {
    if (!svg || !candidatesResult) return null;
    if (!candidatesResult.ok) return candidatesResult;
    const sel = buildSelection(candidatesResult.value, svg.roles, selectionFrame, svg.scene.notices);
    return sel.ok ? { ok: true, value: sel.value.contour } : sel;
  }, [svg, candidatesResult, selectionFrame]);

  const handleFile = useCallback(
    async (f: File) => {
      invalidate();
      const id = requestRef.current;
      setSvg(null);
      setFile({ status: 'processing', name: f.name });
      const check = toResult(() => validateSvgFile(f));
      if (!check.ok) {
        setFile({ status: 'invalid', name: f.name, error: check.error });
        return;
      }
      let text: string;
      try {
        text = await f.text();
      } catch {
        setFile({
          status: 'invalid',
          name: f.name,
          error: { code: 'SVG_PARSE', message: 'Het bestand kon niet gelezen worden.' },
        });
        return;
      }
      if (id !== requestRef.current) return;

      // Stap A + B: inlezen en alle zichtbare geometrie herkennen. Meerdere losse
      // vormen of open lijnen zijn hier nooit een fout; de gebruiker kiest de rollen
      // en pas daarna wordt de gekozen buitencontour gevalideerd (stap C).
      const imported = importSvg(text, BASIC_FRAME_MM);
      if (id !== requestRef.current) return;
      if (!imported.ok) {
        setFile({ status: 'invalid', name: f.name, error: imported.error });
        return;
      }
      setSvg({ scene: imported.value.scene, granularity: 'shapes', roles: imported.value.roles });
      setFile({ status: 'valid', name: f.name });
    },
    [invalidate],
  );

  const handleExample = useCallback(
    async (name: string) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}examples/${name}.svg`);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        await handleFile(new File([blob], `${name === 'heart' ? 'hart' : name === 'star' ? 'ster' : name === 'circle' ? 'cirkel' : 'vierkant'}.svg`, { type: 'image/svg+xml' }));
      } catch {
        setFile({
          status: 'invalid',
          name: `${name}.svg`,
          error: { code: 'SVG_PARSE', message: 'Het voorbeeldbestand kon niet geladen worden.' },
        });
      }
    },
    [handleFile],
  );

  const clearFile = useCallback(() => {
    invalidate();
    setSvg(null);
    setFile({ status: 'empty' });
  }, [invalidate]);

  const changeGenerator = (id: GeneratorType) => {
    if (id === generator) return;
    invalidate();
    setGenerator(id);
  };
  const changeMode = (m: ApplicationMode) => {
    if (m === mode) return;
    invalidate();
    setMode(m);
  };
  const changeParam = (key: string, value: string) => {
    invalidate();
    setDrafts((d) => ({ ...d, [generator]: { ...d[generator], [key]: value } }));
  };
  const changeRoles = (roles: Record<string, PathRole>) => {
    invalidate();
    setSvg((s) => (s ? { ...s, roles } : s));
  };
  const changeGranularity = (granularity: Granularity) => {
    if (!svg || !candidates || granularity === svg.granularity) return;
    const next = toResult(() => extractPathCandidates(svg.scene, selectionFrame, granularity));
    if (!next.ok) return;
    invalidate();
    // De keuze van de gebruiker blijft behouden: onderdelen erven de rol van hun vorm (en omgekeerd).
    setSvg({ ...svg, granularity, roles: transferRoles(candidates, svg.roles, next.value) });
  };

  const previewError = preview && !preview.ok ? preview.error : null;
  const canStart = Boolean(svg) && file.status === 'valid' && paramsValid && !previewError;

  const start = () => {
    if (!canStart) return;
    const id = ++requestRef.current;
    const snapshot = {
      generator,
      mode,
      params: { ...params },
      fileName: file.status === 'valid' ? file.name : 'vorm.svg',
      svg,
    };
    setGeneration({ status: 'generating' });
    // Even wachten zodat de knopstatus zichtbaar wordt; de berekening zelf is synchroon.
    window.setTimeout(() => {
      if (id !== requestRef.current) return;

      if (!snapshot.svg) return;
      // Elke generator volgt dezelfde keten: rollen -> gevalideerde contour + details -> mesh.
      const frame = frameSizeFor(snapshot.mode, snapshot.params);
      const { scene, granularity, roles } = snapshot.svg;
      const found = toResult(() => extractPathCandidates(scene, frame, granularity));
      const selection = found.ok ? buildSelection(found.value, roles, frame, scene.notices) : found;
      const result: Result<GenerationResult | ComboGenerationResult> = selection.ok
        ? generateFromSelection(selection.value.contour, selection.value.details, snapshot.generator, snapshot.params)
        : selection;
      if (id !== requestRef.current) return;

      if (!result.ok) {
        setGeneration({ status: 'error', error: result.error });
        return;
      }
      if ('cutter' in result.value) {
        setComboView('cutter');
        setGeneration({ status: 'successCombo', result: result.value, fileNames: comboStlFileNames(snapshot.fileName) });
      } else {
        setGeneration({ status: 'success', result: result.value, fileName: stlFileName(snapshot.generator, snapshot.fileName) });
      }
    }, 30);
  };

  function triggerDownload(buffer: ArrayBuffer, fileName: string) {
    const blob = new Blob([buffer], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const downloadSingle = () => {
    if (generation.status !== 'success' || !generation.result.report.valid) return;
    triggerDownload(exportBinaryStl(generation.result.mesh), generation.fileName);
  };
  const downloadCombo = (which: 'cutter' | 'stamp') => {
    if (generation.status !== 'successCombo') return;
    const sub = generation.result[which];
    if (!sub.report.valid) return;
    triggerDownload(exportBinaryStl(sub.mesh), generation.fileNames[which]);
  };

  const busy = generation.status === 'generating';

  return (
    <div className="app">
      <Header onHelp={() => setHelpOpen(true)} />
      <main className="main">
        <div className="card">
          <GeneratorTabs generators={GENERATORS} active={generator} onChange={changeGenerator} />

          <div id="generator-panel" role="tabpanel" aria-labelledby={`tab-${generator}`} className="card__body">
            <div className="card__heading">
              <div>
                <h1 className="card__title">{activeGenerator.title}</h1>
                <p className="card__subtitle">{activeGenerator.description}</p>
              </div>
              <ModeToggle mode={mode} onChange={changeMode} />
            </div>

            <SVGUploader
              file={file}
              preview={preview && preview.ok ? preview.value : null}
              previewError={previewError}
              disabled={busy}
              onFile={handleFile}
              onExample={handleExample}
              onClear={clearFile}
            />

            {svg && candidates && (candidates.length > 1 || svg.granularity === 'elements') && (
              <PathSelector
                candidates={candidates}
                roles={svg.roles}
                frame={selectionFrame}
                granularity={svg.granularity}
                canSplit={hasGroupedShapes(candidates)}
                disabled={busy}
                onChange={changeRoles}
                onGranularity={changeGranularity}
              />
            )}

            {mode === 'expert' && (
              <ParameterPanel specs={activeGenerator.params} draft={drafts[generator]} errors={parsed.errors} disabled={busy} onChange={changeParam} />
            )}
            {mode === 'basis' && <p className="basis-summary">{basisSummary(activeGenerator)}</p>}

            <div className="actions">
              <GenerateButton busy={busy} disabled={!canStart} onClick={start} />
            </div>

            {generation.status === 'error' && (
              <p className="status status--error status--block" role="alert">
                {generation.error.message}
              </p>
            )}

            {generation.status === 'success' && (
              <section className="result" aria-label="Resultaat">
                <Preview3D mesh={generation.result.mesh} />
                <div className="result__footer">
                  <p className="status status--ok">Model klaar · {fmtDims(generation.result.report.bounds)}</p>
                  <DownloadButton fileName={generation.fileName} onDownload={downloadSingle} />
                </div>
              </section>
            )}

            {generation.status === 'successCombo' && (
              <section className="result" aria-label="Resultaat">
                <div className="model-switch" role="radiogroup" aria-label="Te bekijken model">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={comboView === 'cutter'}
                    className={`model-switch__option${comboView === 'cutter' ? ' is-active' : ''}`}
                    onClick={() => setComboView('cutter')}
                  >
                    Cookie cutter
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={comboView === 'stamp'}
                    className={`model-switch__option${comboView === 'stamp' ? ' is-active' : ''}`}
                    onClick={() => setComboView('stamp')}
                  >
                    Stempel
                  </button>
                </div>
                <Preview3D mesh={generation.result[comboView].mesh} />
                <div className="result__footer">
                  <p className="status status--ok">Model klaar · {fmtDims(generation.result[comboView].report.bounds)}</p>
                  <div className="result__downloads">
                    <DownloadButton fileName={generation.fileNames.cutter} onDownload={() => downloadCombo('cutter')} />
                    <DownloadButton fileName={generation.fileNames.stamp} onDownload={() => downloadCombo('stamp')} />
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
        <p className="footnote">Je bestand blijft op je eigen toestel: alles wordt in je browser berekend.</p>
      </main>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function fmtMm(n: number): string {
  return n.toLocaleString('nl-BE', { maximumFractionDigits: 1 });
}
