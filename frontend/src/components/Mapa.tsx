import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getFarmaciasPorComunidad } from '../api/farmacias';
import { AnuncioFarmacia } from '../types/farmacia';
import { geocodificar } from '../utils/geocodificar';
import { MapPin, AlertTriangle } from 'lucide-react';

// DivIcon personalizado — evita el problema de rutas de imágenes con Vite
function crearIcono(count: number): L.DivIcon {
  const bg = count > 1 ? '#f59e0b' : '#10b981';
  return L.divIcon({
    html: `<div style="
      background:${bg};
      color:white;
      width:32px;
      height:32px;
      border-radius:50%;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:12px;
      font-weight:700;
      border:2.5px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.25);
      font-family:system-ui,sans-serif;
    ">${count}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
    className: '',
  });
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
        const [resMadrid, resCanarias, resAndalucia, resCataluna] = await Promise.all([
          getFarmaciasPorComunidad('madrid'),
          getFarmaciasPorComunidad('canarias'),
          getFarmaciasPorComunidad('andalucia'),
          getFarmaciasPorComunidad('cataluna'),
        ]);
        setAnuncios([
          ...resMadrid.anuncios,
          ...resCanarias.anuncios,
          ...resAndalucia.anuncios,
          ...resCataluna.anuncios,
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error de conexión con el backend');
      } finally {
        setLoading(false);
      }
    }
    cargarTodo();
  }, []);

  // Agrupar por municipio para mostrar un marcador por zona
  const porMunicipio = useMemo(() => {
    const grupos: Record<string, AnuncioFarmacia[]> = {};
    anuncios.forEach(a => {
      const clave = a.municipio?.trim() || 'Desconocido';
      if (!grupos[clave]) grupos[clave] = [];
      grupos[clave].push(a);
    });
    return grupos;
  }, [anuncios]);

  const totalMunicipios = Object.keys(porMunicipio).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-bold text-slate-900 leading-none">Mapa de farmacias</h1>
            <p className="text-[11px] text-slate-400 mt-1">
              {loading
                ? 'Cargando datos…'
                : `${anuncios.length} resoluciones en ${totalMunicipios} municipio${totalMunicipios !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-emerald-500" />
              1 anuncio
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-amber-500" />
              Varios
            </span>
            <span className="flex items-center gap-1">
              <MapPin size={11} />
              OpenStreetMap
            </span>
          </div>
        </div>
      </header>

      {/* Mapa */}
      <div className="flex-1 relative">
        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 z-[1000]">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-slate-500">Cargando datos del mapa…</p>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 z-[1000]">
            <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
              <AlertTriangle size={28} className="text-red-400" strokeWidth={1.5} />
            </div>
            <p className="font-bold text-slate-800">No se pudo conectar al backend</p>
            <p className="text-sm text-slate-500 mt-1">{error}</p>
          </div>
        )}

        {/* MapContainer siempre montado para evitar re-renders */}
        {!loading && !error && (
          <MapContainer
            center={[40.4637, -3.7492]}
            zoom={6}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />

            {Object.entries(porMunicipio).map(([municipio, lista]) => {
              const coords = geocodificar(municipio);
              return (
                <Marker key={municipio} position={coords} icon={crearIcono(lista.length)}>
                  <Popup maxWidth={300} minWidth={220}>
                    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
                      {/* Cabecera del popup */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>
                          {municipio}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>
                          {lista.length} anuncio{lista.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Lista de anuncios */}
                      <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {lista.map((a, i) => (
                          <div
                            key={i}
                            style={{
                              borderTop: i > 0 ? '1px solid #f1f5f9' : 'none',
                              paddingTop: i > 0 ? 8 : 0,
                            }}
                          >
                            <p style={{ fontSize: 12, fontWeight: 600, color: '#334155', margin: '0 0 2px 0', lineHeight: 1.4 }}>
                              {a.titulo.length > 80 ? a.titulo.slice(0, 80) + '…' : a.titulo}
                            </p>
                            <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 4px 0' }}>
                              {a.fecha} · {a.fuente}
                            </p>
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
                        ))}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        )}
      </div>
    </div>
  );
}
