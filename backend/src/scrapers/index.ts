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
import { bocylScraper } from './bocylScraper';
import { bormScraper } from './bormScraper';
import { bopaScraper } from './bopaScraper';
import { bonScraper } from './bonScraper';

export const scrapers: Record<string, IScraper> = {
  madrid:           bocmScraper,   // BOCM — Boletín Oficial de la Comunidad de Madrid
  canarias:         bocScraper,    // BOC  — Boletín Oficial de Canarias
  andalucia:        bojaScraper,   // BOJA — Boletín Oficial de la Junta de Andalucía
  cataluna:         dogcScraper,   // DOGC — Diari Oficial de la Generalitat de Catalunya
  valencia:         docvScraper,   // DOCV — Diari Oficial de la Comunitat Valenciana
  paisvasco:        bopvScraper,   // BOPV — Boletín Oficial del País Vasco / EHAA
  galicia:          dogScraper,    // DOG  — Diario Oficial de Galicia
  aragon:           boaScraper,    // BOA  — Boletín Oficial de Aragón
  castillayleon:    bocylScraper,  // BOCYL — Boletín Oficial de Castilla y León
  murcia:           bormScraper,   // BORM — Boletín Oficial de la Región de Murcia
  asturias:         bopaScraper,   // BOPA — Boletín Oficial del Principado de Asturias
  navarra:          bonScraper,    // BON  — Boletín Oficial de Navarra
};

export {
  bocmScraper, bocScraper, bojaScraper, dogcScraper, docvScraper,
  bopvScraper, dogScraper, boaScraper,
  bocylScraper, bormScraper, bopaScraper, bonScraper,
};
export * from './types';
