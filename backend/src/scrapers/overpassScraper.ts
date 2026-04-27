import axios from 'axios';
import { FarmaciaDirectorio, saveFarmaciasDirectorio } from '../db/directorioService';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// ISO 3166-2 codes for each autonomous community
const ISO_CODES: Record<string, string> = {
  madrid:        'ES-MD',
  canarias:      'ES-CN',
  andalucia:     'ES-AN',
  cataluna:      'ES-CT',
  valencia:      'ES-VC',
  paisvasco:     'ES-PV',
  galicia:       'ES-GA',
  aragon:        'ES-AR',
  castillayleon: 'ES-CL',
  murcia:        'ES-MU',
  asturias:      'ES-AS',
  navarra:       'ES-NC',
  extremadura:   'ES-EX',
  cantabria:     'ES-CB',
  larioja:       'ES-RI',
  baleares:      'ES-IB',
};

interface OverpassElement {
  type:    'node' | 'way' | 'relation';
  id:      number;
  lat?:    number;
  lon?:    number;
  center?: { lat: number; lon: number };
  tags?:   Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

function buildQuery(isoCode: string): string {
  return (
    `[out:json][timeout:90];\n` +
    `area["ISO3166-2"="${isoCode}"]->.searchArea;\n` +
    `(\n` +
    `  node[amenity=pharmacy](area.searchArea);\n` +
    `  way[amenity=pharmacy](area.searchArea);\n` +
    `);\n` +
    `out center body;`
  );
}

function buildDireccion(tags: Record<string, string>): string | null {
  const street = tags['addr:street'];
  const number = tags['addr:housenumber'];
  const post   = tags['addr:postcode'];

  if (!street) return tags['address'] ?? null;

  let dir = street;
  if (number) dir += `, ${number}`;
  if (post)   dir += ` (${post})`;
  return dir;
}

function getMunicipio(tags: Record<string, string>): string | null {
  return (
    tags['addr:city']         ??
    tags['addr:municipality'] ??
    tags['addr:town']         ??
    tags['addr:village']      ??
    null
  );
}

function getProvincia(tags: Record<string, string>): string | null {
  return tags['addr:province'] ?? tags['addr:state'] ?? null;
}

function normalizePhone(raw?: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  return cleaned || null;
}

function normalizeEmail(raw?: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  return cleaned.includes('@') ? cleaned : null;
}

export async function scrapeDirectorioComunidad(comunidadKey: string): Promise<{
  total:  number;
  nuevas: number;
}> {
  const isoCode = ISO_CODES[comunidadKey];
  if (!isoCode) throw new Error(`Comunidad no soportada en el directorio: ${comunidadKey}`);

  const query = buildQuery(isoCode);

  const response = await axios.post<OverpassResponse>(
    OVERPASS_URL,
    `data=${encodeURIComponent(query)}`,
    {
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'User-Agent':    'Farmalitics/1.0 (educational project)',
        'Accept':        'application/json',
      },
      timeout: 120_000,
    },
  );

  const elements = response.data?.elements ?? [];

  const farmacias: FarmaciaDirectorio[] = elements
    .filter(el => el.tags?.name)
    .map(el => {
      const tags = el.tags ?? {};
      const lat  = el.type === 'node' ? el.lat  : el.center?.lat;
      const lon  = el.type === 'node' ? el.lon  : el.center?.lon;

      return {
        comunidad: comunidadKey,
        nombre:    tags.name,
        direccion: buildDireccion(tags),
        municipio: getMunicipio(tags),
        provincia: getProvincia(tags),
        telefono:  normalizePhone(tags.phone ?? tags['contact:phone']),
        email:     normalizeEmail(tags.email ?? tags['contact:email']),
        horario:   tags.opening_hours ?? null,
        lat:       lat ?? null,
        lon:       lon ?? null,
        osm_id:    `${el.type}/${el.id}`,
      };
    });

  const nuevas = saveFarmaciasDirectorio(farmacias);

  console.log(`[Directorio] ${comunidadKey}: ${farmacias.length} farmacias encontradas, ${nuevas} nuevas/actualizadas`);

  return { total: farmacias.length, nuevas };
}
