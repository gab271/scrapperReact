import { getDb } from './database';

export interface FarmaciaDirectorio {
  id?:        number;
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
  osm_id?:    string | null;
}

export interface DirectorioQuery {
  comunidad:  string;
  busqueda?:  string;
  municipio?: string;
  page?:      number;
  limit?:     number;
}

export function saveFarmaciasDirectorio(farmacias: FarmaciaDirectorio[]): number {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO directorio_farmacias
      (comunidad, nombre, direccion, municipio, provincia, telefono, email, horario, lat, lon, osm_id, actualizado_at)
    VALUES
      (@comunidad, @nombre, @direccion, @municipio, @provincia, @telefono, @email, @horario, @lat, @lon, @osm_id, CURRENT_TIMESTAMP)
  `);

  const insertMany = db.transaction((items: FarmaciaDirectorio[]) => {
    let count = 0;
    for (const f of items) {
      const result = insert.run(f);
      count += result.changes;
    }
    return count;
  });

  return insertMany(farmacias) as number;
}

// ── Enriquecimiento con datos de boletines ─────────────────────────────────────

interface AnuncioEnriquecimiento {
  nombre_farmacia:    string;
  municipio:          string | null;
  email:              string | null;
  direccion_farmacia: string | null;
}

function normNombre(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^farmacia\s+/i, '')
    .trim();
}

function nombresSimilares(a: string, b: string): boolean {
  const na = normNombre(a);
  const nb = normNombre(b);
  if (!na || !nb || na.length < 3 || nb.length < 3) return false;
  return na.includes(nb) || nb.includes(na);
}

function enrichirConAnuncios(
  farmacias: FarmaciaDirectorio[],
  comunidad: string,
): FarmaciaDirectorio[] {
  const db = getDb();

  // Extraemos solo los anuncios con datos útiles (email o dirección)
  const fuentes = db.prepare(`
    SELECT nombre_farmacia, municipio, email, direccion_farmacia
    FROM   anuncios
    WHERE  comunidad = ?
      AND  nombre_farmacia IS NOT NULL AND nombre_farmacia != ''
      AND  (email IS NOT NULL OR direccion_farmacia IS NOT NULL)
    GROUP  BY nombre_farmacia, municipio
  `).all(comunidad) as AnuncioEnriquecimiento[];

  if (fuentes.length === 0) return farmacias;

  return farmacias.map(f => {
    if (f.email && f.direccion) return f; // ya completa, no tocar

    const match = fuentes.find(a =>
      nombresSimilares(f.nombre, a.nombre_farmacia) &&
      (!a.municipio || !f.municipio ||
        normNombre(a.municipio) === normNombre(f.municipio)),
    );

    if (!match) return f;

    return {
      ...f,
      email:    f.email    ?? match.email              ?? null,
      direccion: f.direccion ?? match.direccion_farmacia ?? null,
    };
  });
}

export function getFarmaciasDirectorio({ comunidad, busqueda, municipio, page = 1, limit = 50 }: DirectorioQuery): {
  farmacias: FarmaciaDirectorio[];
  total:     number;
  pages:     number;
} {
  const db     = getDb();
  const offset = (page - 1) * limit;

  let where       = 'WHERE comunidad = ?';
  const params: unknown[] = [comunidad];

  if (busqueda) {
    where += " AND (nombre LIKE ? OR COALESCE(direccion,'') LIKE ? OR COALESCE(municipio,'') LIKE ?)";
    const term = `%${busqueda}%`;
    params.push(term, term, term);
  }

  if (municipio) {
    where += ' AND municipio = ?';
    params.push(municipio);
  }

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM directorio_farmacias ${where}`)
      .get(params) as { count: number }
  ).count;

  const farmacias = db.prepare(`
    SELECT id, comunidad, nombre, direccion, municipio, provincia, telefono, email, horario, lat, lon
    FROM directorio_farmacias
    ${where}
    ORDER BY nombre ASC
    LIMIT ? OFFSET ?
  `).all([...params, limit, offset]) as FarmaciaDirectorio[];

  // Enriquecer con email/dirección de los boletines donde falte
  const enriquecidas = enrichirConAnuncios(farmacias, comunidad);

  return { farmacias: enriquecidas, total, pages: Math.ceil(total / limit) };
}

export function getMunicipiosDirectorio(comunidad: string): string[] {
  const db = getDb();
  return (
    db.prepare(`
      SELECT DISTINCT municipio FROM directorio_farmacias
      WHERE comunidad = ? AND municipio IS NOT NULL AND municipio != ''
      ORDER BY municipio ASC
    `).all(comunidad) as { municipio: string }[]
  ).map(r => r.municipio);
}

export function countDirectorioByComunidad(comunidad: string): number {
  const db = getDb();
  return (
    db.prepare('SELECT COUNT(*) as count FROM directorio_farmacias WHERE comunidad = ?')
      .get(comunidad) as { count: number }
  ).count;
}
