import { useState } from 'react';
import type { Granularity } from '../engine/svgPaths';
import type { FrameSizeMm, PathRole, Point2, SvgPathCandidate } from '../engine/types';

interface PathSelectorProps {
  candidates: SvgPathCandidate[];
  roles: Record<string, PathRole>;
  frame: FrameSizeMm;
  granularity: Granularity;
  /** Is er iets gegroepeerd, zodat "afzonderlijke onderdelen" zinvol is? */
  canSplit: boolean;
  disabled?: boolean;
  onChange: (roles: Record<string, PathRole>) => void;
  onGranularity: (g: Granularity) => void;
}

const ROLE_LABEL: Record<PathRole, string> = {
  outer: 'Buitencontour',
  detail: 'Stempeldetail',
  ignore: 'Negeren',
};

const ROLE_COLOR: Record<PathRole, string> = {
  outer: '#2563c7',
  detail: '#1c1c1e',
  ignore: '#c8c8cc',
};

const CYCLE: Record<PathRole, PathRole> = { outer: 'detail', detail: 'ignore', ignore: 'outer' };

function ringData(ring: readonly Point2[], frame: FrameSizeMm, close: boolean): string {
  if (ring.length === 0) return '';
  const d = ring.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${(frame.width - p.y).toFixed(3)}`).join(' ');
  return close ? `${d} Z` : d;
}

function pathData(c: SvgPathCandidate, frame: FrameSizeMm): string {
  if (c.kind === 'region' && c.region) {
    return [...c.region.outers, ...c.region.holes].map((r) => ringData(r, frame, true)).join(' ');
  }
  return ringData(c.ring, frame, c.closed);
}

/** Korte, begrijpelijke omschrijving van een onderdeel voor de lijst. */
export function describeCandidate(c: SvgPathCandidate): string {
  if (c.kind === 'line') return c.closed ? 'Gesloten lijn' : 'Open lijn';
  const holes = c.region?.holes.length ?? 0;
  const base = holes > 0 ? 'Getekende rand (band met binnenruimte)' : 'Gevulde vorm';
  return c.memberIds.length > 1 ? `${base} · ${c.memberIds.length} stukken` : base;
}

export function PathSelector({
  candidates,
  roles,
  frame,
  granularity,
  canSplit,
  disabled,
  onChange,
  onGranularity,
}: PathSelectorProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const pad = Math.max(frame.length, frame.width) * 0.04;
  const roleOf = (c: SvgPathCandidate) => roles[c.id] ?? c.suggestedRole;
  const setRole = (id: string, role: PathRole) => {
    if (disabled) return;
    onChange({ ...roles, [id]: role });
  };
  const cycle = (c: SvgPathCandidate) => setRole(c.id, CYCLE[roleOf(c)]);

  // Tekenvolgorde: grote vlakken eerst, zodat kleinere vormen en lijnen erbovenop klikbaar blijven.
  const drawOrder = [...candidates].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'region' ? -1 : 1;
    return b.silhouetteAreaMm2 - a.silhouetteAreaMm2;
  });
  const numbered = new Map(candidates.map((c, i) => [c.id, i + 1]));

  return (
    <section className="path-selector" aria-label="Vormen en rollen">
      <p className="path-selector__hint">
        Klik een vorm om zijn rol te wisselen: buitencontour (blauw) · stempeldetail (donker) · negeren (lichtgrijs). Een
        getekende rand als buitencontour wordt een volle vorm.
      </p>
      <div className="path-selector__body">
        <svg
          viewBox={`${-pad} ${-pad} ${frame.length + 2 * pad} ${frame.width + 2 * pad}`}
          className="path-selector__svg"
          role="img"
          aria-label="Alle vormen en lijnen in deze SVG, klikbaar per rol"
        >
          <rect x={0} y={0} width={frame.length} height={frame.width} className="shape-preview__frame" />
          {drawOrder.map((c) => {
            const role = roleOf(c);
            const isRegion = c.kind === 'region';
            return (
              <path
                key={c.id}
                data-candidate={c.id}
                data-role={role}
                d={pathData(c, frame)}
                fill={isRegion ? ROLE_COLOR[role] : 'none'}
                fillRule="evenodd"
                fillOpacity={isRegion ? (role === 'outer' ? 0.55 : 0.9) : undefined}
                stroke={hovered === c.id ? '#f26b1d' : ROLE_COLOR[role]}
                strokeWidth={isRegion ? (hovered === c.id ? 0.8 : 0.3) : role === 'outer' ? 1.6 : 1}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="path-selector__path"
                onClick={() => cycle(c)}
                onMouseEnter={() => setHovered(c.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${numbered.get(c.id)}. ${describeCandidate(c)}: ${ROLE_LABEL[role]}`}</title>
              </path>
            );
          })}
        </svg>
        <ul className="path-selector__list">
          {candidates.map((c) => {
            const role = roleOf(c);
            const label = `${numbered.get(c.id)}. ${describeCandidate(c)}`;
            return (
              <li
                key={c.id}
                className={`path-selector__item${hovered === c.id ? ' is-hovered' : ''}`}
                onMouseEnter={() => setHovered(c.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="path-selector__swatch" style={{ background: ROLE_COLOR[role] }} aria-hidden="true" />
                <span className="path-selector__name">{label}</span>
                <select
                  className="path-selector__role"
                  aria-label={`Rol van ${label}`}
                  value={role}
                  disabled={disabled}
                  onChange={(e) => setRole(c.id, e.target.value as PathRole)}
                >
                  {(['outer', 'detail', 'ignore'] as const).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>
      {(canSplit || granularity === 'elements') && (
        <button
          type="button"
          className="link-button path-selector__granularity"
          disabled={disabled}
          onClick={() => onGranularity(granularity === 'shapes' ? 'elements' : 'shapes')}
        >
          {granularity === 'shapes' ? 'Toon afzonderlijke onderdelen' : 'Groepeer tot zichtbare vormen'}
        </button>
      )}
    </section>
  );
}
