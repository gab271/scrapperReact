import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, '../../farmalitics.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
    console.log(`[DB] SQLite inicializado en ${DB_PATH}`);
  }
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anuncios (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      fuente            TEXT    NOT NULL,
      comunidad         TEXT    NOT NULL,
      titulo            TEXT    NOT NULL,
      fecha             TEXT    NOT NULL,
      municipio         TEXT    NOT NULL,
      enlace_pdf        TEXT    NOT NULL UNIQUE,
      texto_resumen     TEXT    NOT NULL,
      tipo_operacion    TEXT    NOT NULL DEFAULT '',
      titular_saliente  TEXT,
      titular_entrante  TEXT,
      creado_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_anuncios_comunidad ON anuncios(comunidad);
    CREATE INDEX IF NOT EXISTS idx_anuncios_fuente    ON anuncios(fuente);
    CREATE INDEX IF NOT EXISTS idx_anuncios_fecha     ON anuncios(fecha DESC);
  `);

  // Migración: añadir columnas si la tabla ya existía sin ellas
  migrateAddColumn(db, 'anuncios', 'titular_saliente',  'TEXT');
  migrateAddColumn(db, 'anuncios', 'titular_entrante',  'TEXT');
  migrateAddColumn(db, 'anuncios', 'email',             'TEXT');
  migrateAddColumn(db, 'anuncios', 'nombre_farmacia',   'TEXT');
  migrateAddColumn(db, 'anuncios', 'direccion_farmacia','TEXT');
  migrateAddColumn(db, 'anuncios', 'texto_completo',    'TEXT');
  migrateAddColumn(db, 'anuncios', 'fecha_iso',         'TEXT');

  // Índice para filtrado por fecha ISO
  db.exec(`CREATE INDEX IF NOT EXISTS idx_anuncios_fecha_iso ON anuncios(fecha_iso DESC);`);

  // ── Directorio de farmacias (OpenStreetMap) ──────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS directorio_farmacias (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      comunidad      TEXT NOT NULL,
      nombre         TEXT NOT NULL,
      direccion      TEXT,
      municipio      TEXT,
      provincia      TEXT,
      telefono       TEXT,
      email          TEXT,
      horario        TEXT,
      lat            REAL,
      lon            REAL,
      osm_id         TEXT UNIQUE,
      actualizado_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_directorio_comunidad ON directorio_farmacias(comunidad);
    CREATE INDEX IF NOT EXISTS idx_directorio_municipio ON directorio_farmacias(municipio);
    CREATE INDEX IF NOT EXISTS idx_directorio_nombre    ON directorio_farmacias(nombre);
  `);
}

function migrateAddColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[DB] Migración: columna "${column}" añadida a "${table}"`);
  }
}
