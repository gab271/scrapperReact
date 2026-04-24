// Contrato de datos que devuelve cualquier scraper de boletin oficial
export interface AnuncioFarmacia {
  titulo: string;
  fecha: string;
  municipio: string;
  enlace_pdf: string;
  texto_resumen: string;
  comunidad: string;
  fuente: string; // "BOCM", "BOJA", "DOGC", etc.
  // Personas y datos extraídos del texto completo del anuncio (null si no detectado)
  titular_saliente?: string | null;
  titular_entrante?: string | null;
  email?: string | null;
  nombre_farmacia?: string | null;
  direccion_farmacia?: string | null;
  texto_completo?: string;
}

export interface ScraperResult {
  comunidad: string;
  total: number;
  anuncios: AnuncioFarmacia[];
  timestamp: string;
  duracion_ms: number;
  advertencias?: string[];
}

// Interfaz que TODOS los scrapers de CC.AA. deben implementar.
// Añadir Andalucia (BOJA), Cataluña (DOGC), etc. implementando esto.
export interface IScraper {
  readonly nombre: string;       // "BOCM"
  readonly comunidad: string;    // "Madrid"
  readonly keywords: string[];
  scrape(): Promise<ScraperResult>;
}

export class ScraperError extends Error {
  constructor(
    message: string,
    public readonly comunidad: string,
    public readonly causa?: unknown
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}
