// Espejo exacto del backend — si cambias ScraperResult allá, actualiza aquí
export interface AnuncioFarmacia {
  titulo: string;
  fecha: string;
  municipio: string;
  enlace_pdf: string;
  texto_resumen: string;
  comunidad: string;
  fuente: string;
  titular_saliente?: string | null;
  titular_entrante?: string | null;
}

export interface ApiResponse {
  ok: boolean;
  comunidad: string;
  total: number;
  anuncios: AnuncioFarmacia[];
  timestamp: string;
  duracion_ms: number;
  error?: string;
  advertencias?: string[];
}

export type EstadoPeticion = 'idle' | 'loading' | 'success' | 'error';
