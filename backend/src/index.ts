import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { getDb } from './db/database';
import farmaciasRouter from './routes/farmacias.routes';
import syncRouter      from './routes/sync.routes';
import directorioRouter from './routes/directorio.routes';

const app  = express();
const PORT = Number(process.env.PORT) || 3000;

// ── Base de datos — inicializar al arrancar ──────────────────
getDb();

// ── Middlewares ──────────────────────────────────────────────
app.use(express.json());

app.use(
  cors({
    origin: (origin, callback) => {
      const permitidos = [
        'http://localhost:5173',
        'http://localhost:4173',
        'http://127.0.0.1:5173',
      ];
      if (!origin || permitidos.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origen no permitido — ${origin}`));
      }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  })
);

// ── Rutas ────────────────────────────────────────────────────
// El orden importa: /sync debe registrarse antes que /:comunidad
app.use('/api/farmacias/sync', syncRouter);
app.use('/api/farmacias',      farmaciasRouter);
app.use('/api/directorio',     directorioRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ── Arranque ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      Farmalitics Backend — Arrancando    ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Puerto  : http://localhost:${PORT}           ║`);
  console.log(`║  GET     : /api/farmacias/:comunidad      ║`);
  console.log(`║  POST    : /api/farmacias/sync            ║`);
  console.log(`║  Health  : /api/health                    ║`);
  console.log('╚══════════════════════════════════════════╝');
});
