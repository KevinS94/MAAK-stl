import { useRef, useState, type DragEvent } from 'react';
import type { GeometryValidationError, ValidatedContour } from '../engine/types';

export type FileStatus =
  | { status: 'empty' }
  | { status: 'processing'; name: string }
  | { status: 'valid'; name: string }
  | { status: 'invalid'; name: string; error: GeometryValidationError };

interface SVGUploaderProps {
  file: FileStatus;
  /** Contour voor de 2D-preview (op de schaal die gebruikt zal worden). */
  preview: ValidatedContour | null;
  previewError: GeometryValidationError | null;
  disabled?: boolean;
  onFile: (file: File) => void;
  onExample: (name: string) => void;
  onClear: () => void;
}

const EXAMPLES = [
  { file: 'heart', label: 'Hart' },
  { file: 'star', label: 'Ster' },
  { file: 'circle', label: 'Cirkel' },
  { file: 'square', label: 'Vierkant' },
];

export function SVGUploader({ file, preview, previewError, disabled, onFile, onExample, onClear }: SVGUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = () => inputRef.current?.click();
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !disabled) onFile(f);
  };

  const hasFile = file.status !== 'empty';
  const error = file.status === 'invalid' ? file.error : previewError;

  return (
    <section className="uploader" aria-label="SVG-bestand">
      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}${hasFile ? ' has-file' : ''}${error ? ' has-error' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="visually-hidden"
          aria-label="Kies een SVG-bestand"
          data-testid="file-input"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />

        {!hasFile && (
          <button type="button" className="dropzone__empty" onClick={pick} disabled={disabled}>
            <UploadIcon />
            <span className="dropzone__title">Upload je SVG-bestand</span>
            <span className="dropzone__hint">Sleep je bestand hierheen of klik om te kiezen</span>
            <span className="dropzone__meta">SVG · één gesloten vorm · Canva-frame van 100 × 100 mm</span>
          </button>
        )}

        {hasFile && (
          <div className="dropzone__file">
            <div className="shape-preview" aria-hidden={!preview}>
              {preview && !error ? (
                <ContourPreview contour={preview} />
              ) : (
                <div className="shape-preview__placeholder">
                  {file.status === 'processing' ? <span className="spinner" /> : <span>SVG</span>}
                </div>
              )}
            </div>
            <div className="dropzone__details">
              <p className="dropzone__filename" title={file.name}>
                {file.name}
              </p>
              {file.status === 'processing' && <p className="status status--muted">Bestand wordt verwerkt…</p>}
              {file.status === 'valid' && !error && preview && (
                <p className="status status--ok">
                  <CheckIcon /> SVG geldig · vorm ≈ {fmt(preview.widthMm)} × {fmt(preview.heightMm)} mm
                </p>
              )}
              {error && (
                <p className="status status--error" role="alert">
                  {error.message}
                </p>
              )}
              {file.status === 'valid' && !error && preview && preview.notices.length > 0 && (
                <ul className="notices">
                  {preview.notices.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <div className="dropzone__actions">
                <button type="button" className="link-button" onClick={pick} disabled={disabled}>
                  Ander bestand kiezen
                </button>
                <button type="button" className="link-button link-button--muted" onClick={onClear} disabled={disabled}>
                  Opnieuw beginnen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {!hasFile && (
        <p className="examples">
          Geen bestand bij de hand? Probeer een voorbeeld:{' '}
          {EXAMPLES.map((ex, i) => (
            <span key={ex.file}>
              <button type="button" className="link-button" onClick={() => onExample(ex.file)} disabled={disabled}>
                {ex.label}
              </button>
              {i < EXAMPLES.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function fmt(n: number): string {
  return n.toLocaleString('nl-BE', { maximumFractionDigits: n < 10 ? 1 : 0 });
}

/** Tekent de berekende contour in het kader. Gebruikt enkel berekende getallen, nooit de originele SVG-code. */
function ContourPreview({ contour }: { contour: ValidatedContour }) {
  const { frameMm, centerOffset } = contour;
  const d =
    contour.outer
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x + centerOffset.x).toFixed(3)} ${(frameMm.width - (p.y + centerOffset.y)).toFixed(3)}`)
      .join(' ') + ' Z';
  const pad = Math.max(frameMm.length, frameMm.width) * 0.04;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${frameMm.length + 2 * pad} ${frameMm.width + 2 * pad}`}
      className="shape-preview__svg"
      role="img"
      aria-label="Voorbeeld van de herkende vorm in het kader"
    >
      <rect x={0} y={0} width={frameMm.length} height={frameMm.width} className="shape-preview__frame" />
      <path d={d} className="shape-preview__shape" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="dropzone__icon" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="6" y="6" width="36" height="36" rx="10" fill="var(--accent-soft)" />
      <path d="M24 31V17m0 0-5.5 5.5M24 17l5.5 5.5" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
