import { ApiResponse } from '../types/farmacia';
import type { ComunidadKey } from '../components/Sidebar';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export async function getFarmaciasPorComunidad(
  comunidad: ComunidadKey,
  signal?: AbortSignal
): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE}/farmacias/${comunidad}`, { signal });
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
