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

  return { farmacias, total, pages: Math.ceil(total / limit) };
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
