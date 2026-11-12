import type { ParamSpec, ShapeParameters } from '../engine/types';

export type ParameterDraft = Record<string, string>;

interface ParameterPanelProps {
  specs: ParamSpec[];
  draft: ParameterDraft;
  errors: Partial<Record<string, string>>;
  disabled?: boolean;
  onChange: (key: string, value: string) => void;
}

function Fields({
  specs,
  draft,
  errors,
  onChange,
}: Pick<ParameterPanelProps, 'draft' | 'errors' | 'onChange'> & { specs: ParamSpec[] }) {
  return (
    <>
      {specs.map((spec) => {
        const err = errors[spec.key];
        const id = `param-${spec.key}`;
        return (
          <div key={spec.key} className={`params__field${err ? ' has-error' : ''}`}>
            <label htmlFor={id} className="params__label">
              {spec.label} <span className="params__unit">(mm)</span>
            </label>
            <div className="params__input-wrap">
              <input
                id={id}
                className="params__input"
                type="number"
                inputMode="decimal"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={draft[spec.key] ?? ''}
                aria-invalid={Boolean(err)}
                aria-describedby={`${id}-hint`}
                onChange={(e) => onChange(spec.key, e.target.value)}
              />
              <span className="params__suffix" aria-hidden="true">
                mm
              </span>
            </div>
            <p id={`${id}-hint`} className={err ? 'params__error' : 'params__hint'}>
              {err ?? `${spec.hint} · ${spec.min}–${spec.max}`}
            </p>
          </div>
        );
      })}
    </>
  );
}

/** Toont de Expertparameters van een generator; groepeert ze als meerdere `group`-labels voorkomen (Cutter & Stempel). */
export function ParameterPanel({ specs, draft, errors, disabled, onChange }: ParameterPanelProps) {
  const groups = Array.from(new Set(specs.map((s) => s.group).filter((g): g is string => Boolean(g))));

  if (groups.length === 0) {
    return (
      <fieldset className="params" disabled={disabled}>
        <legend className="visually-hidden">Expertinstellingen</legend>
        <Fields specs={specs} draft={draft} errors={errors} onChange={onChange} />
      </fieldset>
    );
  }

  return (
    <div className="params-groups">
      {groups.map((group) => (
        <fieldset key={group} className="params params-group" disabled={disabled}>
          <legend className="params-group__legend">{group}</legend>
          <Fields specs={specs.filter((s) => s.group === group)} draft={draft} errors={errors} onChange={onChange} />
        </fieldset>
      ))}
    </div>
  );
}

export function draftFromDefaults(defaults: ShapeParameters): ParameterDraft {
  return Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, String(v)]));
}
