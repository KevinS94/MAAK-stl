import type { KeyboardEvent } from 'react';
import type { GeneratorType } from '../engine/types';
import type { ShapeGenerator } from '../generators';

interface GeneratorTabsProps {
  generators: readonly ShapeGenerator[];
  active: GeneratorType;
  onChange: (id: GeneratorType) => void;
}

export function GeneratorTabs({ generators, active, onChange }: GeneratorTabsProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = generators.findIndex((g) => g.id === active);
    const next = (i + (e.key === 'ArrowRight' ? 1 : generators.length - 1)) % generators.length;
    onChange(generators[next].id);
    e.preventDefault();
  };

  return (
    <div className="tabs" role="tablist" aria-label="Wat wil je maken?" onKeyDown={onKeyDown}>
      {generators.map((g) => {
        const selected = g.id === active;
        return (
          <button
            key={g.id}
            type="button"
            role="tab"
            id={`tab-${g.id}`}
            aria-selected={selected}
            aria-controls="generator-panel"
            tabIndex={selected ? 0 : -1}
            className={`tabs__tab${selected ? ' is-active' : ''}`}
            onClick={() => onChange(g.id)}
          >
            <GeneratorIcon id={g.id} />
            {g.label}
          </button>
        );
      })}
    </div>
  );
}

function GeneratorIcon({ id }: { id: GeneratorType }) {
  return id === 'cookieCutter' ? (
    <svg className="tabs__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 20.5s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg className="tabs__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8h16v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 8c0-1.1 3.6-2 8-2s8 .9 8 2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
