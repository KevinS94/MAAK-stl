import type { GeometryErrorCode, GeometryValidationError, Result } from './types';

/** Interne fout die binnen de engine gegooid en aan de rand omgezet wordt. */
export class GeometryError extends Error {
  readonly code: GeometryErrorCode;
  readonly details?: string;

  constructor(code: GeometryErrorCode, message: string, details?: string) {
    super(message);
    this.name = 'GeometryError';
    this.code = code;
    this.details = details;
  }

  toValidationError(): GeometryValidationError {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function fail(code: GeometryErrorCode, message: string, details?: string): never {
  throw new GeometryError(code, message, details);
}

/** Voert `fn` uit en zet elke fout om naar een gestructureerd resultaat. */
export function toResult<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof GeometryError) return { ok: false, error: err.toValidationError() };
    const details = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        code: 'MESH_INVALID',
        message: 'Er ging iets onverwachts mis bij het verwerken van de vorm.',
        details,
      },
    };
  }
}
