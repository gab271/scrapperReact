import { ApiResponse } from '../types/farmacia';
import type { ComunidadKey } from '../components/Sidebar';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export async function getFarmaciasPorComunidad(
  comunidad: ComunidadKey,
  signal?: AbortSignal,
  meses?: number,
): Promise<ApiResponse> {
  const params = meses ? `?meses=${meses}` : '';
  const response = await fetch(`${API_BASE}/farmacias/${comunidad}${params}`, { signal });
  if (!response.ok) {
    throw new Error(`Error del servidor: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<ApiResponse>;
}

export interface SyncResponse {
  ok:           boolean;
  duracion_ms:  number;
  total_nuevos: number;
  timestamp:    string;
  resultados:   Record<string, { total: number; nuevos: number; error?: string }>;
}

export async function syncFarmacias(signal?: AbortSignal): Promise<SyncResponse> {
  const response = await fetch(`${API_BASE}/farmacias/sync`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Error del servidor: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<SyncResponse>;
}

export const getFarmaciasMadrid   = () => getFarmaciasPorComunidad('madrid');
export const getFarmaciasCanarias = () => getFarmaciasPorComunidad('canarias');

export function exportarCSV(comunidad: ComunidadKey): void {
  const url = `${API_BASE}/farmacias/${comunidad}/export`;
  const a   = document.createElement('a');
  a.href    = url;
  a.download = `farmalitics_${comunidad}.csv`;
  a.click();
}

// ── Stats globales ────────────────────────────────────────────────────────────

export interface StatsResponse {
  ok:                boolean;
  totalResoluciones: number;
  variacionMes:      number;
  porComunidad:      { comunidad: string; total: number }[];
  scraperStatus:     { comunidad: string; ultima_fecha: string | null; total: number }[];
  actividadReciente: {
    comunidad:      string;
    fuente:         string;
    tipo_operacion: string;
    fecha:          string;
    adjudicatario:  string | null;
    municipio:      string;
  }[];
  timestamp: string;
}

export async function getStats(meses = 12, signal?: AbortSignal): Promise<StatsResponse> {
  const response = await fetch(`${API_BASE}/farmacias/stats?meses=${meses}`, { signal });
  if (!response.ok) throw new Error(`Error del servidor: ${response.status}`);
  return response.json() as Promise<StatsResponse>;
}

// ── Directorio de farmacias (OpenStreetMap) ───────────────────────────────────

export interface FarmaciaDirectorio {
  id:         number;
  comunidad:  string;
  nombre:     string;
  direccion?: string | null;
  municipio?: string | null;
  provincia?: string | null;
  telefono?:  string | null;
  email?:     string | null;
  horario?:   string | null;
  lat?:       number | null;
  lon?:       number | null;
}

export interface DirectorioResponse {
  ok:          boolean;
  comunidad:   string;
  farmacias:   FarmaciaDirectorio[];
  total:       number;
  pages:       number;
  municipios:  string[];
  duracion_ms: number;
  timestamp:   string;
  error?:      string;
}

export async function getDirectorio(
  comunidad: ComunidadKey,
  options?: { busqueda?: string; municipio?: string; page?: number; limit?: number },
  signal?: AbortSignal,
): Promise<DirectorioResponse> {
  const params = new URLSearchParams();
  if (options?.busqueda)  params.set('busqueda',  options.busqueda);
  if (options?.municipio) params.set('municipio', options.municipio);
  if (options?.page)      params.set('page',      String(options.page));
  if (options?.limit)     params.set('limit',     String(options.limit));

  const qs       = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/directorio/${comunidad}${qs}`, { signal });
  if (!response.ok) throw new Error(`Error del servidor: ${response.status} ${response.statusText}`);
  return response.json() as Promise<DirectorioResponse>;
}

export async function syncDirectorio(
  comunidad: ComunidadKey,
  signal?: AbortSignal,
): Promise<{ ok: boolean; total: number; nuevas: number; duracion_ms: number }> {
  const response = await fetch(`${API_BASE}/directorio/sync/${comunidad}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`Error del servidor: ${response.status} ${response.statusText}`);
  return response.json();
}

export function exportarCSVTodos(): void {
  const url = `${API_BASE}/farmacias/export`;
  const a   = document.createElement('a');
  a.href    = url;
  a.download = 'farmalitics_export.csv';
  a.click();
}
