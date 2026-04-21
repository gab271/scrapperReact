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
  migrateAddColumn(db, 'anuncios', 'titular_saliente', 'TEXT');
  migrateAddColumn(db, 'anuncios', 'titular_entrante', 'TEXT');
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
