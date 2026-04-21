// Extrae titular saliente y entrante de texto de boletines oficiales españoles.
// Cubre los patrones habituales de BOCM, BOC, BOJA, DOGC, DOCV, BOPV, DOG, BOA.

export interface PersonasExtraidas {
  titular_saliente: string | null;
  titular_entrante: string | null;
}

// Trata los tratamientos honoríficos españoles en boletines
const T = '(?:D\\.|Dña\\.|D\\/ña\\.|Don|Doña|dona)';

// Nombre: entre 5 y 55 caracteres hasta la primera coma o punto
const NOMBRE = `(${T}\\s+[^,.]{5,55})`;

// Patrones para el titular que SALE (vende / transmite / cesa)
const PATRONES_SALIENTE: RegExp[] = [
  // "de la que es titular D. Juan Pérez García"
  new RegExp(`de (?:la|el) que es titular\\s+${NOMBRE}`, 'i'),
  // "titular D. Juan Pérez García"  (más genérico, va al final)
  new RegExp(`\\btitular\\s+${NOMBRE}`, 'i'),
  // "titularidad de D. Juan Pérez García"
  new RegExp(`titularidad de\\s+${NOMBRE}`, 'i'),
  // "cuya titular es D. ..."
  new RegExp(`cuya titular(?:idad)? es\\s+${NOMBRE}`, 'i'),
  // Cataluña/DOGC: "titular de la qual és" / "del qual és"
  new RegExp(`(?:de la qual|del qual) (?:és|es) titular\\s+${NOMBRE}`, 'i'),
];

// Patrones para el titular que ENTRA (compra / abre / adquiere)
const PATRONES_ENTRANTE: RegExp[] = [
  // "a favor de D. / Dña."  — el más frecuente
  new RegExp(`a favor de\\s+${NOMBRE}`, 'i'),
  // "adjudicada a D."
  new RegExp(`adjudicada a\\s+${NOMBRE}`, 'i'),
  // "se autoriza a D. / se concede a / se otorga a"
  new RegExp(`se (?:autoriza|concede|otorga) a\\s+${NOMBRE}`, 'i'),
  // Apertura simple: "autoriza a D."
  new RegExp(`\\bautoriza a\\s+${NOMBRE}`, 'i'),
  // País Vasco/BOPV: "eskualdatzen zaio" → no aplica; usar genérico
  // Galicia/DOG: "en favor de D."
  new RegExp(`en favor de\\s+${NOMBRE}`, 'i'),
];

function primerCoincidencia(texto: string, patrones: RegExp[]): string | null {
  for (const patron of patrones) {
    const m = patron.exec(texto);
    if (m?.[1]) {
      return limpiarNombre(m[1]);
    }
  }
  return null;
}

// Elimina el tratamiento (D., Dña., Don, Doña) y espacios sobrantes
function limpiarNombre(raw: string): string {
  return raw
    .replace(/^(?:D\.|Dña\.|D\/ña\.|Don|Doña|dona)\s*/i, '')
    .replace(/[,.]$/, '')
    .trim();
}

export function parsePersons(titulo: string, textoResumen: string): PersonasExtraidas {
  // Combinar ambos campos para maximizar la cobertura
  const texto = `${titulo} ${textoResumen}`;

  return {
    titular_saliente: primerCoincidencia(texto, PATRONES_SALIENTE),
    titular_entrante: primerCoincidencia(texto, PATRONES_ENTRANTE),
  };
}
