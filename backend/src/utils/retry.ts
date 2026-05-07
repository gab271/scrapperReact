import { AxiosError } from 'axios';

function esCandidatoRetry(err: unknown): boolean {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    if (status === undefined) return true; // sin respuesta — error de red
    if (status === 429) return true;        // rate-limited
    if (status >= 500) return true;         // error del servidor
    return false;                           // error cliente 4xx — no reintentar
  }
  return true; // timeout, ECONNRESET, ENOTFOUND, etc.
}

function backoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter      = Math.random() * 400; // ±200 ms de jitter
  return Math.min(exponential + jitter, maxMs);
}

/**
 * Envuelve cualquier función async con backoff exponencial y reintentos.
 * Solo reintenta en errores de red, 429 y 5xx; los errores 4xx se propagan de inmediato.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?:  number;  // intentos adicionales tras el primero (default: 2)
    baseDelayMs?: number;  // retraso base en ms (default: 1 000)
    maxDelayMs?:  number;  // techo del retraso (default: 30 000)
    label?:       string;  // nombre para el log
  } = {},
): Promise<T> {
  const {
    maxRetries  = 2,
    baseDelayMs = 1_000,
    maxDelayMs  = 30_000,
    label       = 'scraper',
  } = options;

  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const esUltimo = attempt === maxRetries;
      if (esUltimo || !esCandidatoRetry(err)) throw err;

      const delay = backoffMs(attempt, baseDelayMs, maxDelayMs);
      const msg   = err instanceof Error ? err.message : String(err);
      console.warn(
        `[retry] ${label} intento ${attempt + 1}/${maxRetries} fallido (${msg})` +
        ` — reintentando en ${Math.round(delay)} ms`,
      );
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastErr;
}
