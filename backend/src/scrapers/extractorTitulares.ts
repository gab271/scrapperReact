import { AnuncioFarmacia } from './types';

const HON = '(?:D\\.?|Dña\\.?|Don|Doña)';
const NOMBRE = `${HON}\\s+([A-ZÁÉÍÓÚÑÜÀ][a-záéíóúñüàA-ZÁÉÍÓÚÑÜÀ]+(?:\\s+[A-ZÁÉÍÓÚÑÜÀ][a-záéíóúñüàA-ZÁÉÍÓÚÑÜÀ]+){1,3})`;

const RE_SALIENTE = [
  // "farmacéutica doña Ana García ha solicitado transmisión de la farmacia de la que es titular"
  new RegExp(`farmac[eé]utic[ao]\\s+${NOMBRE}\\s+ha\\s+solicitado`, 'i'),
  // "de la que es/era titular doña X" / "cuya titular es doña X"
  new RegExp(`(?:de\\s+la\\s+que\\s+es|cuya\\s+titular(?:idad)?\\s+es)\\s+titular\\s+${NOMBRE}`, 'i'),
  // "transmisión de la oficina de farmacia de doña X"
  new RegExp(
    `(?:transmisi[oó]n|traslado|cambio\\s+de\\s+titular(?:idad)?)\\s+de\\s+(?:la\\s+)?(?:oficina\\s+de\\s+farmacia\\s+)?(?:de\\s+)?${NOMBRE}`,
    'i',
  ),
  new RegExp(`de\\s+${NOMBRE}\\s+(?:a|en\\s+favor\\s+de)\\s+${HON}`, 'i'),
  new RegExp(`titular\\s+saliente[:\\s]+${NOMBRE}`, 'i'),
];

const RE_ENTRANTE = [
  new RegExp(`a\\s+favor\\s+de\\s+${NOMBRE}`, 'i'),
  new RegExp(`adjudicad[ao]\\s+a\\s+${NOMBRE}`, 'i'),
  new RegExp(`concedid[ao]\\s+a\\s+${NOMBRE}`, 'i'),
  new RegExp(`autorizada?\\s+a\\s+${NOMBRE}`, 'i'),
  new RegExp(
    `apertura\\s+(?:de\\s+)?(?:la\\s+)?(?:oficina\\s+de\\s+farmacia\\s+)?(?:solicitada\\s+)?(?:por|a)\\s+${NOMBRE}`,
    'i',
  ),
  new RegExp(`titular\\s+entrante[:\\s]+${NOMBRE}`, 'i'),
];

// Dirección de la farmacia: requiere contexto "farmacia/titular" cercano para evitar
// capturar direcciones de la Consejería, Subdirección u otras oficinas administrativas.
const RE_DIRECCION = [
  // "farmacia sita en calle X nº N" — contexto explícito de farmacia
  /(?:farmacia|oficina)\s+(?:\w+\s+){0,4}sita?\s+en\s+(?:la\s+)?((?:calle|avenida|avda?\.?|plaza|paseo|carretera|camino|ronda|vía|travesía)\s+[^,.\n]{5,60}(?:[,\s]+(?:n[uú]mero|n[oº°]\.?|num\.?)\s*[\d\w-]+)?)/i,
  // "con domicilio en calle X" — solo cuando no va precedido de "Consejería/Subdirección"
  /(?<!(?:Consejería|Subdirección|sede|Dirección General)[^.]{0,60})(?:con\s+domicilio\s+en\s+)((?:calle|avenida|avda?\.?|plaza|paseo|carretera)\s+[^,.\n]{5,60})/i,
  // "ubicada en calle X"
  /(?:farmacia|oficina)\s+(?:\w+\s+){0,4}ubicada?\s+en\s+(?:la\s+)?((?:calle|avenida|avda?\.?|plaza|paseo|carretera|camino)\s+[^,.\n]{5,60})/i,
];

// Nombre de farmacia: "denominada X", "Farmacia X" como nombre propio
const RE_NOMBRE_FARMACIA = [
  /(?:farmacia|oficina\s+de\s+farmacia)\s+denominada\s+"?([A-ZÁÉÍÓÚÑ][^".\n]{3,50})"?/i,
  /(?:farmacia|oficina\s+de\s+farmacia)\s+"([A-ZÁÉÍÓÚÑ][^".\n]{3,50})"/i,
  // "Farmacia Apellido" sin comillas al inicio de frase
  /^Farmacia\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ]+)?)/m,
];

const RE_EMAIL = /[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}/;

type Extraido = Pick<
  AnuncioFarmacia,
  'titular_saliente' | 'titular_entrante' | 'email' | 'nombre_farmacia' | 'direccion_farmacia'
>;

export function extraerTitulares(texto: string): Extraido {
  let titular_saliente: string | null = null;
  for (const re of RE_SALIENTE) {
    const m = texto.match(re);
    if (m?.[1]) { titular_saliente = m[1].trim(); break; }
  }

  let titular_entrante: string | null = null;
  for (const re of RE_ENTRANTE) {
    const m = texto.match(re);
    if (m?.[1]) { titular_entrante = m[1].trim(); break; }
  }

  let direccion_farmacia: string | null = null;
  for (const re of RE_DIRECCION) {
    const m = texto.match(re);
    if (m?.[1]) { direccion_farmacia = m[1].replace(/\s+/g, ' ').trim(); break; }
  }

  let nombre_farmacia: string | null = null;
  for (const re of RE_NOMBRE_FARMACIA) {
    const m = texto.match(re);
    if (m?.[1]) { nombre_farmacia = m[1].trim(); break; }
  }

  const emailMatch = texto.match(RE_EMAIL);
  const email = emailMatch ? emailMatch[0] : null;

  return { titular_saliente, titular_entrante, email, nombre_farmacia, direccion_farmacia };
}
