import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS } from '../src/config/defaults';
import { validateMesh, weldVertices } from '../src/engine/meshValidation';
import { generateModel } from '../src/engine/pipeline';
import { exportBinaryStl, stlFileName } from '../src/engine/stlExporter';
import { parseSvgOrThrow } from '../src/engine/svgParser';
import { triangulatePolygon } from '../src/engine/triangulation';
import type { MeshData } from '../src/engine/types';
import { SVG } from './fixtures';
import { parseBinaryStl } from './helpers';

/** Kubus van 10 mm met naar buiten gerichte driehoeken. */
function cube(offset = 0): MeshData {
  const v = [
    [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
    [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10],
  ].flat().map((x, i) => (i % 3 === 0 ? x + offset : x));
  const f = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ].flat();
  return { positions: Float64Array.from(v), indices: Uint32Array.from(f), faceTags: new Uint8Array(12) };
}

function merge(a: MeshData, b: MeshData): MeshData {
  const n = a.positions.length / 3;
  return {
    positions: Float64Array.from([...a.positions, ...b.positions]),
    indices: Uint32Array.from([...a.indices, ...Array.from(b.indices, (i) => i + n)]),
    faceTags: new Uint8Array(a.faceTags.length + b.faceTags.length),
  };
}

describe('mesh-validatie', () => {
  it('een correcte kubus is geldig met volume 1000 mm³', () => {
    const r = validateMesh(cube());
    expect(r.valid).toBe(true);
    expect(r.volumeMm3).toBeCloseTo(1000, 9);
    expect(r.components).toBe(1);
  });

  it('ontbrekende driehoek → niet gesloten', () => {
    const m = cube();
    const r = validateMesh({ ...m, indices: m.indices.slice(3) });
    expect(r.valid).toBe(false);
    expect(r.nonManifoldEdges).toBeGreaterThan(0);
  });

  it('één omgedraaide driehoek → inconsistente oriëntatie', () => {
    const m = cube();
    const idx = Uint32Array.from(m.indices);
    [idx[1], idx[2]] = [idx[2], idx[1]];
    const r = validateMesh({ ...m, indices: idx });
    expect(r.valid).toBe(false);
    expect(r.inconsistentEdges).toBeGreaterThan(0);
  });

  it('volledig omgekeerde mesh → negatief volume', () => {
    const m = cube();
    const idx = Uint32Array.from(m.indices);
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    const r = validateMesh({ ...m, indices: idx });
    expect(r.valid).toBe(false);
    expect(r.volumeMm3).toBeLessThan(0);
  });

  it('NaN-coördinaten en gedegenereerde driehoeken worden gevonden', () => {
    const m = cube();
    const pos = Float64Array.from(m.positions);
    pos[0] = NaN;
    expect(validateMesh({ ...m, positions: pos }).valid).toBe(false);
    const flat = cube();
    flat.positions[2 * 3] = 10; // vertex 2 op de lijn van 0 en 1 leggen
    flat.positions[2 * 3 + 1] = 0;
    expect(validateMesh(flat).degenerateTriangles).toBeGreaterThan(0);
  });

  it('twee losse delen worden gedetecteerd', () => {
    const r = validateMesh(merge(cube(), cube(20)));
    expect(r.components).toBe(2);
    expect(r.valid).toBe(false);
  });

  it('dubbele (samenvallende) vertices worden samengevoegd zoals in een STL', () => {
    const ids = weldVertices([0, 0, 0, 1e-7, 0, 0, 1, 0, 0], 1e-5);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });
});

describe('triangulatie', () => {
  it('polygoon met gat: oppervlak klopt en elke driehoek is tegen de klok in', () => {
    const outer = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const hole = [{ x: 3, y: 3 }, { x: 3, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 3 }];
    const all = [...outer, ...hole];
    const tris = triangulatePolygon(outer, [hole]);
    let area = 0;
    for (const [a, b, c] of tris) {
      const d = (all[b].x - all[a].x) * (all[c].y - all[a].y) - (all[b].y - all[a].y) * (all[c].x - all[a].x);
      expect(d).toBeGreaterThan(0);
      area += d / 2;
    }
    expect(area).toBeCloseTo(84, 9);
  });

  it('collineaire punten op verschillende ringen geven geen T-verbindingen', () => {
    const outer = [
      { x: -30.1, y: -30 }, { x: -30, y: -30.1 }, { x: 30, y: -30.1 }, { x: 30.1, y: -30 },
      { x: 30.1, y: 30 }, { x: 30, y: 30.1 }, { x: -30, y: 30.1 }, { x: -30.1, y: 30 },
    ];
    const hole = [{ x: -30, y: -30 }, { x: 30, y: -30 }, { x: 30, y: 30 }, { x: -30, y: 30 }];
    expect(() => triangulatePolygon(outer, [hole])).not.toThrow();
  });
});

describe('STL-export', () => {
  for (const gen of ['cookieCutter', 'fillingMold'] as const) {
    it(`${gen}: binary STL is geldig, gesloten en heeft de juiste afmetingen`, () => {
      const r = generateModel(parseSvgOrThrow(SVG.heart), gen, 'basis', DEFAULT_PARAMETERS[gen]);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const buffer = exportBinaryStl(r.value.mesh);
      const { mesh, triangleCount, normals } = parseBinaryStl(buffer);
      expect(buffer.byteLength).toBe(84 + 50 * triangleCount);
      expect(triangleCount).toBe(r.value.report.triangleCount);

      // Zoals een slicer: vertices op exacte float32-positie samenvoegen.
      const report = validateMesh(mesh, { weldTolerance: 1e-6, minTriangleArea: 1e-12 });
      expect(report.problems).toEqual([]);
      expect(report.components).toBe(1);
      expect(report.volumeMm3).toBeCloseTo(r.value.report.volumeMm3, 0);
      expect(report.bounds.min[2]).toBeCloseTo(0, 5);
      expect(report.bounds.max[2]).toBeCloseTo(DEFAULT_PARAMETERS[gen].height, 4);

      // Normalen wijzen in de richting van de driehoekswinding.
      for (let t = 0; t < triangleCount; t += 97) {
        const p = mesh.positions;
        const o = t * 9;
        const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
        const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        expect(cx * normals[t * 3] + cy * normals[t * 3 + 1] + cz * normals[t * 3 + 2]).toBeGreaterThan(0);
      }
    });
  }

  it('bestandsnamen volgen het oorspronkelijke SVG-bestand', () => {
    expect(stlFileName('cookieCutter', 'hart.svg')).toBe('maak-cookie-cutter-hart.stl');
    expect(stlFileName('fillingMold', 'Ster.SVG')).toBe('maak-vulvorm-ster.stl');
    expect(stlFileName('fillingMold', 'Mijn Ontwerp (1) – café.svg')).toBe('maak-vulvorm-mijn-ontwerp-1-cafe.stl');
    expect(stlFileName('cookieCutter', '.svg')).toBe('maak-cookie-cutter-vorm.stl');
  });
});
