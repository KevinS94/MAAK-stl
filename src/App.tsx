import { useCallback, useMemo, useRef, useState } from 'react';
import { DownloadButton } from './components/DownloadButton';
import { GenerateButton } from './components/GenerateButton';
import { GeneratorTabs } from './components/GeneratorTabs';
import { Header } from './components/Header';
import { HelpDialog } from './components/HelpDialog';
import { ModeToggle } from './components/ModeToggle';
import { ParameterPanel, type ParameterDraft } from './components/ParameterPanel';
import { Preview3D } from './components/Preview3D';
import { SVGUploader, type FileStatus } from './components/SVGUploader';
import { BASIC_FRAME_MM, DEFAULT_PARAMETERS, PARAMETER_LIMITS } from './config/defaults';
import { buildContour } from './engine/contourProcessing';
import { toResult } from './engine/errors';
import { generateModel } from './engine/pipeline';
import { exportBinaryStl, stlFileName } from './engine/stlExporter';
import { parseSvg } from './engine/svgParser';
import { frameSizeFor } from './engine/svgScaling';
import { validateSvgFile } from './engine/svgValidation';
import type {
  ApplicationMode,
  GenerationResult,
  GeneratorType,
  GeometryValidationError,
  SVGGeometry,
  ShapeParameters,
} from './engine/types';
import { GENERATORS, getGenerator } from './generators';

type GenerationState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'success'; result: GenerationResult; fileName: string }
  | { status: 'error'; error: GeometryValidationError };

const PARAM_KEYS: (keyof ShapeParameters)[] = ['length', 'width', 'height', 'wallThickness'];

function toDraft(p: ShapeParameters): ParameterDraft {
  return {
    length: String(p.length),
    width: String(p.width),
    height: String(p.height),
    wallThickness: String(p.wallThickness),
  };
}

function initialDrafts(): Record<GeneratorType, ParameterDraft> {
  return {
    cookieCutter: toDraft(DEFAULT_PARAMETERS.cookieCutter),
    fillingMold: toDraft(DEFAULT_PARAMETERS.fillingMold),
  };
}

function parseDraft(draft: ParameterDraft, generator: GeneratorType) {
  const limits = PARAMETER_LIMITS[generator];
  const errors: Partial<Record<keyof ShapeParameters, string>> = {};
  const values = {} as ShapeParameters;
  for (const key of PARAM_KEYS) {
    const raw = draft[key].trim().replace(',', '.');
    const n = raw === '' ? NaN : Number(raw);
    const { min, max } = limits[key];
    if (!Number.isFinite(n)) errors[key] = 'Vul een getal in.';
    else if (n < min || n > max) errors[key] = `Kies een waarde tussen ${min} en ${max} mm.`;
    values[key] = n;
  }
  return { values, errors, valid: Object.keys(errors).length === 0 };
}

export default function App() {
  const [generator, setGenerator] = useState<GeneratorType>('cookieCutter');
  const [mode, setMode] = useState<ApplicationMode>('basis');
  const [drafts, setDrafts] = useState(initialDrafts);
  const [file, setFile] = useState<FileStatus>({ status: 'empty' });
  const [geometry, setGeometry] = useState<SVGGeometry | null>(null);
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });
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

  // 2D-preview van de contour, op de schaal die bij Start gebruikt wordt.
  const preview = useMemo(() => {
    if (!geometry) return null;
    const frame = frameSizeFor(paramsValid ? mode : 'basis', paramsValid ? params : activeGenerator.defaults);
    return buildContour(geometry, frame);
  }, [geometry, mode, params, paramsValid, activeGenerator]);

  const handleFile = useCallback(
    async (f: File) => {
      invalidate();
      const id = requestRef.current;
      setGeometry(null);
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
      const parsedSvg = parseSvg(text);
      // Controleer meteen of er één bruikbare contour in zit (op het basiskader).
      const contour = parsedSvg.ok ? buildContour(parsedSvg.value, BASIC_FRAME_MM) : parsedSvg;
      if (id !== requestRef.current) return;
      if (!parsedSvg.ok || !contour.ok) {
        const error = !parsedSvg.ok ? parsedSvg.error : !contour.ok ? contour.error : null;
        if (error) setFile({ status: 'invalid', name: f.name, error });
        return;
      }
      setGeometry(parsedSvg.value);
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
    setGeometry(null);
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
  const changeParam = (key: keyof ShapeParameters, value: string) => {
    invalidate();
    setDrafts((d) => ({ ...d, [generator]: { ...d[generator], [key]: value } }));
  };

  const previewError = preview && !preview.ok ? preview.error : null;
  const canStart = Boolean(geometry) && file.status === 'valid' && paramsValid && !previewError;

  const start = () => {
    if (!geometry || !canStart) return;
    const id = ++requestRef.current;
    const snapshot = { geometry, generator, mode, params: { ...params }, fileName: file.status === 'valid' ? file.name : 'vorm.svg' };
    setGeneration({ status: 'generating' });
    // Even wachten zodat de knopstatus zichtbaar wordt; de berekening zelf is synchroon.
    window.setTimeout(() => {
      if (id !== requestRef.current) return;
      const result = generateModel(snapshot.geometry, snapshot.generator, snapshot.mode, snapshot.params);
      if (id !== requestRef.current) return;
      setGeneration(
        result.ok
          ? { status: 'success', result: result.value, fileName: stlFileName(snapshot.generator, snapshot.fileName) }
          : { status: 'error', error: result.error },
      );
    }, 30);
  };

  const download = () => {
    if (generation.status !== 'success' || !generation.result.report.valid) return;
    const buffer = exportBinaryStl(generation.result.mesh);
    const blob = new Blob([buffer], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generation.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const busy = generation.status === 'generating';
  const result = generation.status === 'success' ? generation.result : null;
  const dims = result
    ? result.report.bounds.max.map((v, i) => v - result.report.bounds.min[i])
    : null;

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

            {mode === 'expert' && (
              <ParameterPanel
                draft={drafts[generator]}
                limits={activeGenerator.limits}
                errors={parsed.errors}
                disabled={busy}
                onChange={changeParam}
              />
            )}
            {mode === 'basis' && (
              <p className="basis-summary">
                Automatische instellingen: kader 100 × 100 mm · hoogte {activeGenerator.defaults.height} mm · wanddikte{' '}
                {String(activeGenerator.defaults.wallThickness).replace('.', ',')} mm
              </p>
            )}

            <div className="actions">
              <GenerateButton busy={busy} disabled={!canStart} onClick={start} />
            </div>

            {generation.status === 'error' && (
              <p className="status status--error status--block" role="alert">
                {generation.error.message}
              </p>
            )}

            {result && dims && (
              <section className="result" aria-label="Resultaat">
                <Preview3D mesh={result.mesh} />
                <div className="result__footer">
                  <p className="status status--ok">
                    Model klaar · {fmtMm(dims[0])} × {fmtMm(dims[1])} × {fmtMm(dims[2])} mm
                  </p>
                  <DownloadButton fileName={generation.status === 'success' ? generation.fileName : ''} onDownload={download} />
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
