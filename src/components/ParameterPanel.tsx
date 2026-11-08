import type { ParameterLimits } from '../config/defaults';
import type { ShapeParameters } from '../engine/types';

export type ParameterDraft = Record<keyof ShapeParameters, string>;

interface ParameterPanelProps {
  draft: ParameterDraft;
  limits: ParameterLimits;
  errors: Partial<Record<keyof ShapeParameters, string>>;
  disabled?: boolean;
  onChange: (key: keyof ShapeParameters, value: string) => void;
}

const FIELDS: { key: keyof ShapeParameters; label: string; hint: string }[] = [
  { key: 'length', label: 'Lengte', hint: 'Breedte van het volledige SVG-kader (X)' },
  { key: 'width', label: 'Breedte', hint: 'Hoogte van het volledige SVG-kader (Y)' },
  { key: 'height', label: 'Hoogte', hint: 'Totale hoogte van het object' },
  { key: 'wallThickness', label: 'Wanddikte', hint: 'Dikte van de wand' },
];

export function ParameterPanel({ draft, limits, errors, disabled, onChange }: ParameterPanelProps) {
  return (
    <fieldset className="params" disabled={disabled}>
      <legend className="visually-hidden">Expertinstellingen</legend>
      {FIELDS.map((f) => {
        const lim = limits[f.key];
        const err = errors[f.key];
        const id = `param-${f.key}`;
        return (
          <div key={f.key} className={`params__field${err ? ' has-error' : ''}`}>
            <label htmlFor={id} className="params__label">
              {f.label} <span className="params__unit">(mm)</span>
            </label>
            <div className="params__input-wrap">
              <input
                id={id}
                className="params__input"
                type="number"
                inputMode="decimal"
                min={lim.min}
                max={lim.max}
                step={lim.step}
                value={draft[f.key]}
                aria-invalid={Boolean(err)}
                aria-describedby={`${id}-hint`}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
              <span className="params__suffix" aria-hidden="true">
                mm
              </span>
            </div>
            <p id={`${id}-hint`} className={err ? 'params__error' : 'params__hint'}>
              {err ?? `${f.hint} · ${lim.min}–${lim.max}`}
            </p>
          </div>
        );
      })}
    </fieldset>
  );
}
