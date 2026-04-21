// Registro central de scrapers. Añadir nueva CC.AA.: implementar IScraper + registrar aquí.

import { IScraper } from './types';
import { bocmScraper } from './bocm';
import { bocScraper } from './bocScraper';
import { bojaScraper } from './bojaScraper';
import { dogcScraper } from './dogcScraper';
import { docvScraper } from './docvScraper';
import { bopvScraper } from './bopvScraper';
import { dogScraper } from './dogScraper';
import { boaScraper } from './boaScraper';

export const scrapers: Record<string, IScraper> = {
  madrid:    bocmScraper,   // BOCM — Boletín Oficial de la Comunidad de Madrid
  canarias:  bocScraper,    // BOC  — Boletín Oficial de Canarias
  andalucia: bojaScraper,   // BOJA — Boletín Oficial de la Junta de Andalucía
  cataluna:  dogcScraper,   // DOGC — Diari Oficial de la Generalitat de Catalunya
  valencia:  docvScraper,   // DOCV — Diari Oficial de la Comunitat Valenciana
  paisvasco: bopvScraper,   // BOPV — Boletín Oficial del País Vasco / EHAA
  galicia:   dogScraper,    // DOG  — Diario Oficial de Galicia
  aragon:    boaScraper,    // BOA  — Boletín Oficial de Aragón
};

export { bocmScraper, bocScraper, bojaScraper, dogcScraper, docvScraper, bopvScraper, dogScraper, boaScraper };
export * from './types';
