import type { KeyboardEvent } from 'react';
import type { GeneratorType } from '../engine/types';
import type { AnyGenerator } from '../generators';

interface GeneratorTabsProps {
  generators: readonly AnyGenerator[];
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
  if (id === 'cookieCutter') {
    return (
      <svg className="tabs__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 20.5s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (id === 'fillingMold') {
    return (
      <svg className="tabs__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8h16v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M4 8c0-1.1 3.6-2 8-2s8 .9 8 2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (id === 'stamp') {
    return (
      <svg className="tabs__icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="13" width="14" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 13v-3a3 3 0 0 1 6 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 10V4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="tabs__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 16s-5-3.1-5-6.9A3 3 0 0 1 9 7a3 3 0 0 1 5 1.9c0 3.8-5 7.1-5 7.1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <rect x="13" y="13" width="8" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 13v-2a2 2 0 0 1 4 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
