/**
 * Opbouw van gesloten driehoeksmeshes uit verticale wanden en horizontale
 * vlakken. Vertices worden per (ring, hoogte) gedeeld tussen wanden en
 * vlakken, zodat elke rand exact twee driehoeken heeft (manifold) en er geen
 * T-verbindingen ontstaan.
 */
import { triangulatePolygon } from './triangulation';
import { FaceTag, type MeshData, type Ring } from './types';

/** Vertex-indices van één ring op één hoogte. */
export interface RingLevel {
  ring: Ring;
  z: number;
  indices: number[];
}

export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly indices: number[] = [];
  private readonly tags: number[] = [];

  /** Maakt de vertices van `ring` (tegen de klok in) op hoogte `z`. */
  ringLevel(ring: Ring, z: number): RingLevel {
    const start = this.positions.length / 3;
    for (const p of ring) this.positions.push(p.x, p.y, z);
    return { ring, z, indices: ring.map((_, i) => start + i) };
  }

  private tri(a: number, b: number, c: number, tag: FaceTag): void {
    this.indices.push(a, b, c);
    this.tags.push(tag);
  }

  /**
   * Verticale wand tussen twee niveaus van dezelfde ring.
   * `facing = 'out'`: normaal wijst weg van het binnengebied van de ring
   * (buitenwand). `'in'`: normaal wijst naar het binnengebied (wand van een
   * uitsparing).
   */
  wall(lower: RingLevel, upper: RingLevel, facing: 'out' | 'in', tag: FaceTag): void {
    const n = lower.indices.length;
    if (upper.indices.length !== n) throw new Error('Wandniveaus hebben een verschillend aantal punten.');
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0 = lower.indices[i];
      const b0 = lower.indices[j];
      const a1 = upper.indices[i];
      const b1 = upper.indices[j];
      if (facing === 'out') {
        this.tri(a0, b0, b1, tag);
        this.tri(a0, b1, a1, tag);
      } else {
        this.tri(a0, b1, b0, tag);
        this.tri(a0, a1, b1, tag);
      }
    }
  }

  /**
   * Horizontaal vlak begrensd door `outer` met gaten `holes`, allemaal op
   * dezelfde hoogte. `facing = 'up'` geeft een normaal in +Z.
   */
  cap(outer: RingLevel, holes: RingLevel[], facing: 'up' | 'down', tag: FaceTag = FaceTag.Cap): void {
    const tris = triangulatePolygon(
      outer.ring,
      holes.map((h) => h.ring),
    );
    const lookup = [...outer.indices, ...holes.flatMap((h) => h.indices)];
    for (const [a, b, c] of tris) {
      // triangulatePolygon levert tegen de klok in (normaal +Z).
      if (facing === 'up') this.tri(lookup[a], lookup[b], lookup[c], tag);
      else this.tri(lookup[a], lookup[c], lookup[b], tag);
    }
  }

  build(): MeshData {
    return {
      positions: Float64Array.from(this.positions),
      indices: Uint32Array.from(this.indices),
      faceTags: Uint8Array.from(this.tags),
    };
  }
}
