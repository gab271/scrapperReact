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

export function exportarCSVTodos(): void {
  const url = `${API_BASE}/farmacias/export`;
  const a   = document.createElement('a');
  a.href    = url;
  a.download = 'farmalitics_export.csv';
  a.click();
}
