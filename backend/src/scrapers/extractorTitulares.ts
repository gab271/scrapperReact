import { AnuncioFarmacia } from './types';

const HON = '(?:D\\.?|Dña\\.?|Don|Doña)';
const NOMBRE = `${HON}\\s+([A-ZÁÉÍÓÚÑÜÀ][a-záéíóúñüàA-ZÁÉÍÓÚÑÜÀ]+(?:\\s+[A-ZÁÉÍÓÚÑÜÀ][a-záéíóúñüàA-ZÁÉÍÓÚÑÜÀ]+){1,3})`;

const RE_SALIENTE = [
  // "transmisión de la oficina de farmacia de D. Nombre a"
  new RegExp(
    `(?:transmisi[oó]n|traslado|cambio\\s+de\\s+titular(?:idad)?)\\s+de\\s+(?:la\\s+)?(?:oficina\\s+de\\s+farmacia\\s+)?(?:de\\s+)?${NOMBRE}`,
    'i',
  ),
  // "de D. Nombre a D./Dña."
  new RegExp(`de\\s+${NOMBRE}\\s+(?:a|en\\s+favor\\s+de)\\s+${HON}`, 'i'),
  // etiqueta explícita
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

const RE_EMAIL = /[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}/;

export function extraerTitulares(
  texto: string,
): Pick<AnuncioFarmacia, 'titular_saliente' | 'titular_entrante' | 'email'> {
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

  const emailMatch = texto.match(RE_EMAIL);
  const email = emailMatch ? emailMatch[0] : null;

  return { titular_saliente, titular_entrante, email };
}
