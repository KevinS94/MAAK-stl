import type { ApplicationMode } from '../engine/types';

interface ModeToggleProps {
  mode: ApplicationMode;
  onChange: (mode: ApplicationMode) => void;
}

const OPTIONS: { value: ApplicationMode; label: string }[] = [
  { value: 'basis', label: 'Basis' },
  { value: 'expert', label: 'Expert' },
];

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="mode-toggle" role="radiogroup" aria-label="Modus">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={mode === o.value}
          className={`mode-toggle__option${mode === o.value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
