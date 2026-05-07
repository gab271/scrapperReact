import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Search, RefreshCw, Phone, Mail, MapPin, Clock,
  Building2, ChevronLeft, ChevronRight, X, AlertTriangle, List, Map,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getDirectorio, syncDirectorio } from '../api/farmacias';
import type { FarmaciaDirectorio } from '../api/farmacias';
import { COMUNIDADES } from './Sidebar';
import type { ComunidadKey } from './Sidebar';

interface Props {
  comunidad: ComunidadKey;
}

const PAGE_SIZE = 48;

// ── Helpers de mapa ───────────────────────────────────────────────────────────

function crearIconoFarmacia(color: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="
      background:${color};color:white;width:28px;height:28px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:13px;font-weight:700;border:2px solid white;
      box-shadow:0 2px 6px rgba(0,0,0,0.25);font-family:system-ui,sans-serif;
    ">✚</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
    className: '',
  });
}

function FitMapBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!coords.length) return;
    const bounds = L.latLngBounds(coords.map(([lat, lng]) => [lat, lng]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// ── Directorio ────────────────────────────────────────────────────────────────

export default function Directorio({ comunidad: comunidadInicial }: Props) {
  const [comunidadActiva, setComunidadActiva] = useState<ComunidadKey>(comunidadInicial);

  // Estado lista
  const [farmacias, setFarmacias]             = useState<FarmaciaDirectorio[]>([]);
  const [total, setTotal]                     = useState(0);
  const [pages, setPages]                     = useState(0);
  const [page, setPage]                       = useState(1);
  const [municipios, setMunicipios]           = useState<string[]>([]);
  const [busqueda, setBusqueda]               = useState('');
  const [municipioFiltro, setMunicipioFiltro] = useState('');
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  // Estado mapa
  const [vistaDir, setVistaDir]       = useState<'lista' | 'mapa'>('lista');
  const [farmaciasMapa, setFarmaciasMapa] = useState<FarmaciaDirectorio[]>([]);
  const [totalMapa, setTotalMapa]         = useState(0);
  const [cargandoMapa, setCargandoMapa]   = useState(false);

  // Estado sync
  const [syncing, setSyncing]   = useState(false);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  const abortRef       = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const comunidadInfo = COMUNIDADES.find(c => c.key === comunidadActiva);

  const cargar = useCallback(async (com: ComunidadKey, q: string, mun: string, p: number) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await getDirectorio(
        com,
        { busqueda: q || undefined, municipio: mun || undefined, page: p, limit: PAGE_SIZE },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      setFarmacias(res.farmacias);
      setTotal(res.total);
      setPages(res.pages);
      setMunicipios(res.municipios);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Error de conexión con el backend');
    } finally {
      setLoading(false);
    }
  }, []);

  const cargarMapa = useCallback(async (com: ComunidadKey) => {
    setCargandoMapa(true);
    try {
      // Fetch con el límite máximo para obtener el mayor número de farmacias con coords
      const res = await getDirectorio(com, { limit: 200 });
      setFarmaciasMapa(res.farmacias);
      setTotalMapa(res.total);
    } catch {
      // El error se muestra en la vista de mapa
    } finally {
      setCargandoMapa(false);
    }
  }, []);

  // Al cambiar comunidad: resetear todo y recargar
  useEffect(() => {
    setBusqueda('');
    setMunicipioFiltro('');
    setPage(1);
    setSyncInfo(null);
    setFarmacias([]);
    setTotal(0);
    setFarmaciasMapa([]);
    setVistaDir('lista');
    cargar(comunidadActiva, '', '', 1);
  }, [comunidadActiva, cargar]);

  // Sincronizar si el padre cambia la comunidad (clic en el sidebar)
  useEffect(() => {
    setComunidadActiva(comunidadInicial);
  }, [comunidadInicial]);

  const handleBusqueda = (value: string) => {
    setBusqueda(value);
    setPage(1);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => cargar(comunidadActiva, value, municipioFiltro, 1), 380);
  };

  const handleMunicipio = (value: string) => {
    setMunicipioFiltro(value);
    setPage(1);
    cargar(comunidadActiva, busqueda, value, 1);
  };

  const handlePage = (p: number) => {
    setPage(p);
    cargar(comunidadActiva, busqueda, municipioFiltro, p);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncInfo(null);
    setError(null);
    try {
      const res = await syncDirectorio(comunidadActiva);
      setSyncInfo(`${res.total.toLocaleString('es-ES')} farmacias actualizadas`);
      setFarmaciasMapa([]);
      await cargar(comunidadActiva, busqueda, municipioFiltro, page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al sincronizar con OpenStreetMap');
    } finally {
      setSyncing(false);
    }
  };

  const handleSwitchToMapa = () => {
    setVistaDir('mapa');
    if (farmaciasMapa.length === 0 && !cargandoMapa) {
      cargarMapa(comunidadActiva);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-bold text-slate-900 leading-none">
              Directorio de Farmacias
            </h1>
            {comunidadInfo && (
              <span
                className="text-xs font-semibold font-mono-data px-1.5 py-0.5 rounded"
                style={{ background: `${comunidadInfo.color}18`, color: comunidadInfo.color }}
              >
                {comunidadInfo.code}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {comunidadInfo?.name} ·{' '}
            {loading && total === 0
              ? 'Cargando directorio…'
              : `${total.toLocaleString('es-ES')} farmacias`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {syncInfo && !syncing && (
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {syncInfo}
            </span>
          )}
          <span className="hidden md:block text-[11px] text-slate-400">Fuente: OSM</span>
          <button
            onClick={handleSync}
            disabled={syncing || loading}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white text-[13px] font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Actualizando…' : 'Actualizar datos'}
          </button>
        </div>
      </header>

      {/* ── Selector de comunidades ── */}
      <div
        className="bg-white border-b border-slate-100 px-6 py-3 shrink-0 overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="flex gap-2 w-max">
          {COMUNIDADES.map(ca => {
            const isActive = ca.key === comunidadActiva;
            return (
              <button
                key={ca.key}
                onClick={() => setComunidadActiva(ca.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap border transition-all ${
                  isActive
                    ? 'border-transparent text-white shadow-sm scale-[1.02]'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50'
                }`}
                style={isActive ? { background: ca.color } : {}}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: isActive ? 'rgba(255,255,255,0.65)' : ca.color }}
                />
                <span className="font-mono-data tracking-wide">{ca.code}</span>
                <span className="hidden lg:inline text-[10px] opacity-80">{ca.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Barra de búsqueda y vista toggle ── */}
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-3 shrink-0">

        {/* Toggle Lista / Mapa */}
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => setVistaDir('lista')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
              vistaDir === 'lista'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <List size={11} /> Lista
          </button>
          <button
            onClick={handleSwitchToMapa}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
              vistaDir === 'mapa'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Map size={11} /> Mapa
          </button>
        </div>

        {vistaDir === 'lista' && (
          <>
            <div className="relative flex-1 max-w-sm">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={busqueda}
                onChange={e => handleBusqueda(e.target.value)}
                placeholder="Buscar por nombre, dirección…"
                className="w-full pl-8 pr-7 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors placeholder:text-slate-400"
              />
              {busqueda && (
                <button
                  onClick={() => handleBusqueda('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {municipios.length > 0 && (
              <select
                value={municipioFiltro}
                onChange={e => handleMunicipio(e.target.value)}
                className="py-2 pl-3 pr-8 text-[13px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-700 transition-colors"
              >
                <option value="">Todos los municipios</option>
                {municipios.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}

            {(busqueda || municipioFiltro) && (
              <button
                onClick={() => { handleBusqueda(''); handleMunicipio(''); }}
                className="text-[11px] text-slate-500 hover:text-slate-700 font-medium transition-colors"
              >
                Limpiar
              </button>
            )}

            <span className="ml-auto text-[11px] text-slate-400 shrink-0 font-mono-data">
              {total.toLocaleString('es-ES')} resultado{total !== 1 ? 's' : ''}
            </span>
          </>
        )}

        {vistaDir === 'mapa' && !cargandoMapa && farmaciasMapa.length > 0 && (
          <span className="text-[11px] text-slate-400 ml-auto font-mono-data">
            {farmaciasMapa.filter(f => f.lat != null).length} farmacias con coordenadas
            {totalMapa > 200 && ` de ${totalMapa.toLocaleString('es-ES')}`}
          </span>
        )}
      </div>

      {/* ── Contenido ── */}
      {vistaDir === 'lista' ? (
        <main className="flex-1 overflow-y-auto px-6 py-5">

          {error && (
            <div className="mb-5 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 animate-fade-up">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
              <div>
                <p className="font-semibold">Error al cargar el directorio</p>
                <p className="text-amber-700 text-[13px] mt-0.5">{error}</p>
                <button
                  onClick={() => cargar(comunidadActiva, busqueda, municipioFiltro, page)}
                  className="mt-2 text-[12px] font-semibold text-amber-800 underline"
                >
                  Reintentar
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 animate-shimmer shrink-0" />
                    <div className="h-3.5 bg-slate-100 rounded animate-shimmer flex-1" />
                  </div>
                  <div className="h-3 bg-slate-100 rounded animate-shimmer w-4/5" />
                  <div className="h-3 bg-slate-100 rounded animate-shimmer w-1/2" />
                </div>
              ))}
            </div>
          )}

          {!loading && !error && farmacias.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: `${comunidadInfo?.color ?? '#10b981'}12` }}
              >
                <Building2 size={26} style={{ color: comunidadInfo?.color ?? '#10b981' }} strokeWidth={1.5} />
              </div>
              <p className="font-bold text-slate-700">No hay farmacias para {comunidadInfo?.name}</p>
              <p className="text-sm text-slate-400 mt-1 max-w-xs">
                {busqueda || municipioFiltro
                  ? 'Prueba con otros términos o elimina los filtros'
                  : 'Pulsa "Actualizar datos" para descargar desde OpenStreetMap'}
              </p>
            </div>
          )}

          {!loading && farmacias.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {farmacias.map((f, i) => (
                  <FarmaciaCard
                    key={f.id ?? i}
                    farmacia={f}
                    accentColor={comunidadInfo?.color}
                    index={i}
                  />
                ))}
              </div>

              {pages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8 pb-4">
                  <button
                    onClick={() => handlePage(page - 1)}
                    disabled={page === 1}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft size={13} /> Anterior
                  </button>
                  <span className="text-[12px] text-slate-500 font-mono-data px-3">
                    Página {page} de {pages}
                  </span>
                  <button
                    onClick={() => handlePage(page + 1)}
                    disabled={page === pages}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Siguiente <ChevronRight size={13} />
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      ) : (
        <DirectorioMapa
          farmacias={farmaciasMapa}
          cargando={cargandoMapa}
          total={totalMapa}
          accentColor={comunidadInfo?.color ?? '#10b981'}
        />
      )}
    </div>
  );
}

// ── Vista mapa del directorio ─────────────────────────────────────────────────

function DirectorioMapa({
  farmacias, cargando, total, accentColor,
}: {
  farmacias: FarmaciaDirectorio[];
  cargando: boolean;
  total: number;
  accentColor: string;
}) {
  const conCoords = farmacias.filter(f => f.lat != null && f.lon != null);
  const icono     = useMemo(() => crearIconoFarmacia(accentColor), [accentColor]);
  const coords    = useMemo(
    () => conCoords.map(f => [f.lat!, f.lon!] as [number, number]),
    [conCoords],
  );

  if (cargando) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 gap-3">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Cargando farmacias del mapa…</p>
      </div>
    );
  }

  if (!conCoords.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 text-center px-6">
        <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
          <MapPin size={26} className="text-slate-400" strokeWidth={1.5} />
        </div>
        <p className="font-bold text-slate-700">Sin coordenadas disponibles</p>
        <p className="text-sm text-slate-400 mt-1 max-w-xs">
          {farmacias.length > 0
            ? 'Las farmacias de esta comunidad no tienen datos de geolocalización en OpenStreetMap'
            : 'Pulsa "Actualizar datos" para descargar desde OpenStreetMap'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      {total > 200 && (
        <div className="absolute top-3 right-3 z-[1000] bg-white border border-slate-200 text-[11px] text-slate-500 px-2.5 py-1.5 rounded-lg shadow-sm">
          Mostrando {conCoords.length} de {total.toLocaleString('es-ES')} farmacias
        </div>
      )}
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
        <FitMapBounds coords={coords} />
        <MarkerClusterGroup chunkedLoading>
          {conCoords.map(f => (
            <Marker key={f.id} position={[f.lat!, f.lon!]} icon={icono}>
              <Popup maxWidth={260} minWidth={200}>
                <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 12 }}>
                  <p style={{ fontWeight: 700, fontSize: 13, color: '#1e293b', margin: '0 0 6px 0' }}>
                    {f.nombre}
                  </p>
                  {f.direccion && (
                    <p style={{ color: '#64748b', margin: '2px 0' }}>
                      📍 {f.direccion}
                    </p>
                  )}
                  {f.municipio && (
                    <p style={{ color: '#64748b', margin: '2px 0' }}>
                      🏛️ {[f.municipio, f.provincia].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {f.telefono && (
                    <p style={{ color: '#64748b', margin: '4px 0 2px 0' }}>
                      📞{' '}
                      <a href={`tel:${f.telefono}`} style={{ color: accentColor, fontWeight: 600 }}>
                        {f.telefono}
                      </a>
                    </p>
                  )}
                  {f.email && (
                    <p style={{ color: '#64748b', margin: '2px 0' }}>
                      ✉️{' '}
                      <a href={`mailto:${f.email}`} style={{ color: accentColor }}>
                        {f.email}
                      </a>
                    </p>
                  )}
                  {f.horario && (
                    <p style={{ color: '#94a3b8', margin: '4px 0 0 0', fontSize: 11 }}>
                      🕐 {f.horario}
                    </p>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}

// ── Tarjeta de farmacia (vista lista) ─────────────────────────────────────────

function FarmaciaCard({
  farmacia, accentColor, index,
}: {
  farmacia: FarmaciaDirectorio;
  accentColor?: string;
  index: number;
}) {
  const { nombre, direccion, municipio, provincia, telefono, email, horario } = farmacia;
  const color    = accentColor ?? '#10b981';
  const ubicacion = [direccion, municipio, provincia].filter(Boolean).join(', ');

  return (
    <div
      className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition-all animate-fade-up flex flex-col gap-3"
      style={{ animationDelay: `${Math.min(index, 11) * 30}ms` }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-[13px] font-bold select-none"
          style={{ background: `${color}15`, color }}
        >
          ✚
        </div>
        <h3 className="text-[13px] font-bold text-slate-800 leading-snug line-clamp-2">
          {nombre}
        </h3>
      </div>

      <div className="space-y-1.5">
        {ubicacion && (
          <DataRow icon={<MapPin size={11} />}>
            <span className="text-[11px] text-slate-600 leading-snug">{ubicacion}</span>
          </DataRow>
        )}
        {telefono && (
          <DataRow icon={<Phone size={11} />}>
            <a
              href={`tel:${telefono}`}
              className="text-[11px] font-mono-data text-emerald-700 hover:text-emerald-600 hover:underline transition-colors"
            >
              {telefono}
            </a>
          </DataRow>
        )}
        {email && (
          <DataRow icon={<Mail size={11} />}>
            <a
              href={`mailto:${email}`}
              className="text-[11px] text-slate-600 hover:text-emerald-600 hover:underline truncate transition-colors"
            >
              {email}
            </a>
          </DataRow>
        )}
        {horario && (
          <DataRow icon={<Clock size={11} />}>
            <span className="text-[10px] text-slate-400 leading-snug line-clamp-1">{horario}</span>
          </DataRow>
        )}
      </div>
    </div>
  );
}

function DataRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-400 shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
