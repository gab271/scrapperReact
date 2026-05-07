import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getFarmaciasPorComunidad } from '../api/farmacias';
import { AnuncioFarmacia } from '../types/farmacia';
import { geocodificar } from '../utils/geocodificar';
import { MapPin, AlertTriangle } from 'lucide-react';
import { COMUNIDADES } from './Sidebar';

const FALLBACK: [number, number] = [40.4637, -3.7492];

function esFallback(c: [number, number]) {
  return c[0] === FALLBACK[0] && c[1] === FALLBACK[1];
}

function crearIcono(count: number, desconocido = false): L.DivIcon {
  const bg = desconocido ? '#94a3b8' : count > 1 ? '#f59e0b' : '#10b981';
  return L.divIcon({
    html: `<div style="
      background:${bg};color:white;width:32px;height:32px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:12px;font-weight:700;border:2.5px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.25);font-family:system-ui,sans-serif;
    ">${count}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
    className: '',
  });
}

function derivarTipo(titulo: string): { label: string; color: string } {
  const t = titulo.toLowerCase();
  if (t.includes('transmis') || t.includes('titularidad') || t.includes('cambio'))
    return { label: 'Transmisión', color: '#f59e0b' };
  if (t.includes('apertura') || t.includes('nueva') || t.includes('apertur'))
    return { label: 'Apertura', color: '#10b981' };
  if (t.includes('cierr') || t.includes('baja') || t.includes('clausur'))
    return { label: 'Cierre', color: '#ef4444' };
  return { label: 'Otro', color: '#94a3b8' };
}

function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length === 0) return;
    const bounds = L.latLngBounds(coords.map(([lat, lng]) => [lat, lng]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function PopupContent({ municipio, lista }: { municipio: string; lista: AnuncioFarmacia[] }) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{municipio}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>
          {lista.length} anuncio{lista.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {lista.map((a, i) => {
          const tipo = derivarTipo(a.titulo);
          return (
            <div
              key={i}
              style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none', paddingTop: i > 0 ? 10 : 0 }}
            >
              {/* Tipo + fecha + fuente */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{
                  background: tipo.color + '22',
                  color: tipo.color,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                }}>
                  {tipo.label}
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{a.fecha} · {a.fuente}</span>
              </div>

              {/* Título */}
              <p style={{ fontSize: 12, fontWeight: 600, color: '#334155', margin: '0 0 5px 0', lineHeight: 1.4 }}>
                {a.titulo}
              </p>

              {/* Datos de la farmacia */}
              {a.nombre_farmacia && (
                <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 2px 0' }}>
                  <span style={{ fontWeight: 600 }}>Farmacia:</span> {a.nombre_farmacia}
                </p>
              )}
              {a.direccion_farmacia && (
                <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 2px 0' }}>
                  <span style={{ fontWeight: 600 }}>Dirección:</span> {a.direccion_farmacia}
                </p>
              )}

              {/* Titulares */}
              {a.titular_saliente && (
                <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 2px 0' }}>
                  <span style={{ fontWeight: 600, color: '#ef4444' }}>Sale: </span>
                  {a.titular_saliente}
                </p>
              )}
              {a.titular_entrante && (
                <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 2px 0' }}>
                  <span style={{ fontWeight: 600, color: '#10b981' }}>Entra: </span>
                  {a.titular_entrante}
                </p>
              )}

              {/* Resumen */}
              {a.texto_resumen && (
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0', lineHeight: 1.4 }}>
                  {a.texto_resumen.length > 130
                    ? a.texto_resumen.slice(0, 130) + '…'
                    : a.texto_resumen}
                </p>
              )}

              {/* PDF */}
              {a.enlace_pdf && (
                <a
                  href={a.enlace_pdf}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#10b981',
                    textDecoration: 'none',
                    marginTop: 4,
                  }}
                >
                  Ver PDF oficial
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Mapa() {
  const [anuncios, setAnuncios] = useState<AnuncioFarmacia[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    async function cargarTodo() {
      setLoading(true);
      setError(null);
      try {
        const resultados = await Promise.all(
          COMUNIDADES.filter(c => c.disponible).map(c => getFarmaciasPorComunidad(c.key)),
        );
        setAnuncios(resultados.flatMap(r => r.anuncios));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error de conexión con el backend');
      } finally {
        setLoading(false);
      }
    }
    cargarTodo();
  }, []);

  const marcadores = useMemo(() => {
    const grupos: Record<string, AnuncioFarmacia[]> = {};
    anuncios.forEach(a => {
      const clave = a.municipio?.trim() || 'Desconocido';
      if (!grupos[clave]) grupos[clave] = [];
      grupos[clave].push(a);
    });
    return Object.entries(grupos).map(([municipio, lista]) => {
      const coords = geocodificar(municipio);
      return { municipio, lista, coords, desconocido: esFallback(coords) };
    });
  }, [anuncios]);

  const coordsReales = useMemo(
    () => marcadores.filter(m => !m.desconocido).map(m => m.coords),
    [marcadores],
  );

  const totalMunicipios = marcadores.length;
  const sinUbicar = marcadores.filter(m => m.desconocido).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-bold text-slate-900 leading-none">Mapa de farmacias</h1>
            <p className="text-[11px] text-slate-400 mt-1">
              {loading
                ? 'Cargando datos…'
                : `${anuncios.length} resoluciones · ${totalMunicipios} municipios${sinUbicar > 0 ? ` · ${sinUbicar} sin ubicar` : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-emerald-500" /> 1 anuncio
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-amber-500" /> Varios
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-slate-400" /> Sin ubicar
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin size={11} /> OpenStreetMap
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 z-[1000]">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-slate-500">Cargando datos del mapa…</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 z-[1000]">
            <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
              <AlertTriangle size={28} className="text-red-400" strokeWidth={1.5} />
            </div>
            <p className="font-bold text-slate-800">No se pudo conectar al backend</p>
            <p className="text-sm text-slate-500 mt-1">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <MapContainer
            center={FALLBACK}
            zoom={6}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            <FitBounds coords={coordsReales} />
            <MarkerClusterGroup chunkedLoading>
              {marcadores.map(({ municipio, lista, coords, desconocido }) => (
                <Marker
                  key={municipio}
                  position={coords}
                  icon={crearIcono(lista.length, desconocido)}
                  opacity={desconocido ? 0.5 : 1}
                >
                  <Popup maxWidth={320} minWidth={260}>
                    <PopupContent municipio={municipio} lista={lista} />
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>
        )}
      </div>
    </div>
  );
}
