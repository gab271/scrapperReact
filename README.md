# Farmalitics

Monitorización de anuncios de compraventa, cambio de titularidad y apertura/cierre de farmacias publicados en los **Boletines Oficiales de las 16 Comunidades Autónomas** de España.

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js 18 + Express + TypeScript |
| Scraping | Axios + Cheerio + Puppeteer |
| Base de datos | SQLite (better-sqlite3) |
| Frontend | React 18 + Vite + TypeScript + TailwindCSS |
| Mapa | react-leaflet + react-leaflet-cluster |

## Requisitos

- Node.js 18 o superior
- npm 9 o superior

## Instalación

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd scrapperAppReact

# 2. Instalar dependencias del backend
cd backend
npm install

# 3. Instalar dependencias del frontend
cd ../frontend
npm install
```

## Variables de entorno

```bash
# Backend
cp backend/.env.example backend/.env

# Frontend (solo necesario en producción)
cp frontend/.env.example frontend/.env
```

Edita `backend/.env` si quieres cambiar el puerto o el timeout de los scrapers.

## Desarrollo

Abre **dos terminales**:

```bash
# Terminal 1 — backend (puerto 3000)
cd backend
npm run dev

# Terminal 2 — frontend (puerto 5173)
cd frontend
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173) en el navegador.

## Producción

```bash
# Compilar backend
cd backend
npm run build
npm start

# Compilar frontend
cd frontend
npm run build
npm run preview   # o sirve dist/ con Nginx
```

## Comunidades Autónomas cubiertas

| CC.AA. | Boletín | Estado |
|--------|---------|--------|
| Madrid | BOCM | ✅ |
| Andalucía | BOJA | ✅ |
| Cataluña | DOGC | ✅ |
| Comunitat Valenciana | DOCV | ✅ |
| País Vasco | BOPV | ✅ |
| Galicia | DOG | ✅ |
| Aragón | BOA | ✅ |
| Castilla y León | BOCYL | ✅ |
| Región de Murcia | BORM | ✅ |
| Asturias | BOPA | ✅ |
| Navarra | BON | ✅ |
| Extremadura | DOE | ✅ |
| Cantabria | BOC-C | ✅ |
| La Rioja | BOR | ✅ |
| Illes Balears | BOIB | ✅ |
| Canarias | BOC | ✅ |

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/farmacias/:comunidad` | Anuncios de una CC.AA. (desde DB o scraper on-demand) |
| GET | `/api/farmacias/stats` | Estadísticas globales |
| GET | `/api/farmacias/export` | Exportar todo a CSV |
| GET | `/api/farmacias/:comunidad/export` | Exportar una CC.AA. a CSV |
| POST | `/api/farmacias/sync` | Ejecutar todos los scrapers |
| POST | `/api/farmacias/sync/:comunidad` | Ejecutar scraper de una CC.AA. |
| GET | `/api/directorio/:comunidad` | Directorio de farmacias (OpenStreetMap) |
| POST | `/api/directorio/sync/:comunidad` | Sincronizar directorio desde Overpass API |

El parámetro `comunidad` acepta: `madrid`, `andalucia`, `cataluna`, `valencia`, `euskadi`, `galicia`, `aragon`, `castillayleon`, `murcia`, `asturias`, `navarra`, `extremadura`, `cantabria`, `larioja`, `baleares`, `canarias`.

Query params opcionales en `/api/farmacias/:comunidad`: `?meses=3|6|12` (por defecto 12).

## Estructura del proyecto

```
scrapperAppReact/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Entrada Express
│   │   ├── scheduler.ts          # Sync nocturno (3:00 UTC)
│   │   ├── db/
│   │   │   ├── database.ts       # Inicialización SQLite
│   │   │   ├── anunciosService.ts
│   │   │   └── directorioService.ts
│   │   ├── routes/
│   │   │   ├── farmacias.routes.ts
│   │   │   ├── sync.routes.ts
│   │   │   └── directorio.routes.ts
│   │   ├── scrapers/
│   │   │   ├── index.ts          # Registro de scrapers
│   │   │   ├── types.ts          # Interfaz IScraper
│   │   │   └── *.ts              # Un archivo por CC.AA.
│   │   └── utils/
│   │       ├── parsePersons.ts
│   │       └── parsearFechaISO.ts
│   ├── .env.example
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.tsx
    │   ├── api/farmacias.ts
    │   ├── types/farmacia.ts
    │   ├── components/
    │   │   ├── Sidebar.tsx
    │   │   ├── MainDashboard.jsx
    │   │   ├── Buscador.tsx
    │   │   ├── Mapa.tsx
    │   │   ├── Directorio.tsx
    │   │   └── ResultCard.tsx
    │   └── utils/geocodificar.ts
    ├── .env.example
    └── package.json
```

## Sync automático

El backend ejecuta todos los scrapers cada noche a las **3:00 UTC** de forma automática al arrancar. También se puede lanzar manualmente desde el dashboard o mediante `POST /api/farmacias/sync`.
