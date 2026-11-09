import type { FrameSizeMm, PathRole, SvgPathCandidate } from '../engine/types';

interface PathSelectorProps {
  candidates: SvgPathCandidate[];
  roles: Record<string, PathRole>;
  frame: FrameSizeMm;
  disabled?: boolean;
  onChange: (roles: Record<string, PathRole>) => void;
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

/** Zet `id` op `role`; als `role` "outer" is, wordt elke andere "outer" gedemoveerd naar "detail". */
function setRole(roles: Record<string, PathRole>, id: string, role: PathRole): Record<string, PathRole> {
  const next = { ...roles };
  if (role === 'outer') {
    for (const key of Object.keys(next)) if (next[key] === 'outer' && key !== id) next[key] = 'detail';
  }
  next[id] = role;
  return next;
}

function pathData(candidate: SvgPathCandidate, frame: FrameSizeMm): string {
  const pts = candidate.ring;
  if (pts.length === 0) return '';
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${(frame.width - p.y).toFixed(3)}`).join(' ');
  return candidate.closed ? `${d} Z` : d;
}

export function PathSelector({ candidates, roles, frame, disabled, onChange }: PathSelectorProps) {
  const pad = Math.max(frame.length, frame.width) * 0.04;
  const cycle = (id: string) => {
    if (disabled) return;
    const role = roles[id] ?? 'ignore';
    onChange(setRole(roles, id, CYCLE[role]));
  };

  return (
    <section className="path-selector" aria-label="Vectorpaden en rollen">
      <p className="path-selector__hint">
        Klik een pad om zijn rol te wisselen: buitencontour (blauw) · stempeldetail (zwart) · negeren (lichtgrijs).
      </p>
      <div className="path-selector__body">
        <svg
          viewBox={`${-pad} ${-pad} ${frame.length + 2 * pad} ${frame.width + 2 * pad}`}
          className="path-selector__svg"
          role="img"
          aria-label="Alle vectorpaden in deze SVG, klikbaar per rol"
        >
          <rect x={0} y={0} width={frame.length} height={frame.width} className="shape-preview__frame" />
          {candidates.map((c) => {
            const role = roles[c.id] ?? c.suggestedRole;
            return (
              <path
                key={c.id}
                d={pathData(c, frame)}
                fill="none"
                stroke={ROLE_COLOR[role]}
                strokeWidth={role === 'outer' ? 1.6 : 1}
                strokeLinecap="round"
                className="path-selector__path"
                onClick={() => cycle(c.id)}
              />
            );
          })}
        </svg>
        <ul className="path-selector__list">
          {candidates.map((c) => {
            const role = roles[c.id] ?? c.suggestedRole;
            return (
              <li key={c.id} className="path-selector__item">
                <span className="path-selector__swatch" style={{ background: ROLE_COLOR[role] }} aria-hidden="true" />
                <span className="path-selector__name">
                  {c.elementName} {c.closed ? '(gesloten)' : '(open)'}
                </span>
                <button
                  type="button"
                  className="link-button path-selector__role"
                  disabled={disabled}
                  onClick={() => cycle(c.id)}
                >
                  {ROLE_LABEL[role]}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
