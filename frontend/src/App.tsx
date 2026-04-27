import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertTriangle, Clock, Layers, TrendingUp, CloudDownload, FileDown } from 'lucide-react';
import { getFarmaciasPorComunidad, syncFarmacias, exportarCSV } from './api/farmacias';
import { AnuncioFarmacia, EstadoPeticion } from './types/farmacia';
import Sidebar, { ComunidadKey, VistaKey, COMUNIDADES } from './components/Sidebar';
import ResultCard from './components/ResultCard';
import { SkeletonGrid } from './components/SkeletonCard';
import EmptyState from './components/EmptyState';
import Buscador from './components/Buscador';
import Mapa from './components/Mapa';
import MainDashboard from './components/MainDashboard';
import Directorio    from './components/Directorio';

interface Meta {
  total: number;
  duracion_ms: number;
  timestamp: string;
}

export default function App() {
  const [vista, setVista]           = useState<VistaKey>('dashboard');
  const [comunidad, setComunidad]   = useState<ComunidadKey>('madrid');
  const [anuncios, setAnuncios]     = useState<AnuncioFarmacia[]>([]);
  const [estado, setEstado]         = useState<EstadoPeticion>('idle');
  const [error, setError]           = useState<string | null>(null);
  const [meta, setMeta]             = useState<Meta | null>(null);
  const [syncing, setSyncing]       = useState(false);
  const [syncInfo, setSyncInfo]     = useState<string | null>(null);
  const [meses, setMeses]           = useState<number>(12);

  const abortRef = useRef<AbortController | null>(null);

  const cargar = useCallback(async (com: ComunidadKey, m?: number) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setEstado('loading');
    setAnuncios([]);
    setError(null);
    setMeta(null);

    try {
      const res = await getFarmaciasPorComunidad(com, controller.signal, m ?? meses);

      // Si esta petición fue cancelada, ignorar el resultado
      if (controller.signal.aborted) return;

      setAnuncios(res.anuncios);
      setMeta({ total: res.total, duracion_ms: res.duracion_ms, timestamp: res.timestamp });
      if (!res.ok && res.error) setError(res.error);
      setEstado('success');
    } catch (err) {
      if (controller.signal.aborted) return; // petición cancelada — no es un error real
      setError(err instanceof Error ? err.message : 'Error de conexión con el backend');
      setEstado('error');
    }
  }, []);

  useEffect(() => { cargar(comunidad, meses); }, [comunidad, meses, cargar]);

  const handleComunidadChange = (key: ComunidadKey) => {
    setVista('comunidad');
    if (key !== comunidad) setComunidad(key);
    else cargar(key);
  };

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncInfo(null);
    setError(null);
    try {
      const res = await syncFarmacias();
      setSyncInfo(
        `+${res.total_nuevos} anuncios nuevos en ${(res.duracion_ms / 1000).toFixed(1)}s`
      );
      // Refresca la vista actual con datos recién guardados en DB
      await cargar(comunidad);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error durante la sincronización');
    } finally {
      setSyncing(false);
    }
  }, [comunidad, cargar]);

  const comunidadInfo = COMUNIDADES.find(c => c.key === comunidad);
  const nombreBoletin = comunidadInfo?.code ?? comunidad.toUpperCase();
  const nombreRegion  = comunidadInfo?.name ?? comunidad;

  const tiempoTranscurrido = meta
    ? new Date(meta.timestamp).toLocaleString('es-ES', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : null;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar
        comunidadActiva={comunidad}
        onComunidadChange={handleComunidadChange}
        vistaActiva={vista}
        onVistaChange={setVista}
      />

      {/* ── Vistas ── */}
      {vista === 'buscador'  && <Buscador />}
      {vista === 'mapa'      && <Mapa />}
      {vista === 'dashboard'  && <MainDashboard onForzarScraping={handleSync} />}
      {vista === 'directorio' && <Directorio comunidad={comunidad} />}

      {/* ── Dashboard de comunidad ── */}
      {vista === 'comunidad' && <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── Topbar ── */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[15px] font-bold text-slate-900 leading-none">
                Boletín Oficial — {nombreRegion}
              </h1>
              <span
                className="text-xs font-semibold font-mono-data px-1.5 py-0.5 rounded"
                style={{
                  background: `${comunidadInfo?.color}18`,
                  color: comunidadInfo?.color,
                }}
              >
                {nombreBoletin}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Resoluciones de farmacias · {nombreRegion}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {tiempoTranscurrido && estado === 'success' && (
              <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400">
                <Clock size={11} />
                {tiempoTranscurrido}
              </span>
            )}
            {syncInfo && !syncing && (
              <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {syncInfo}
              </span>
            )}
            {/* Selector de rango temporal */}
            <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
              {([3, 6, 12, 0] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMeses(m === 0 ? 999 : m)}
                  className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                    (m === 0 ? meses >= 999 : meses === m)
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {m === 0 ? 'Todo' : m === 12 ? '1 año' : `${m}m`}
                </button>
              ))}
            </div>

            {anuncios.length > 0 && (
              <button
                onClick={() => exportarCSV(comunidad)}
                className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 text-white text-[13px] font-semibold rounded-lg hover:bg-emerald-700 transition-colors"
                title="Exportar datos actuales a CSV"
              >
                <FileDown size={13} />
                Exportar CSV
              </button>
            )}
            <button
              onClick={handleSync}
              disabled={syncing || estado === 'loading'}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white text-[13px] font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncing
                ? <RefreshCw size={13} className="animate-spin" />
                : <CloudDownload size={13} />
              }
              {syncing ? 'Sincronizando boletines…' : 'Actualizar'}
            </button>
          </div>
        </header>

        {/* ── Stats bar ── */}
        {estado === 'success' && meta && (
          <div className="bg-white border-b border-slate-100 px-6 py-2.5 flex items-center gap-6">
            <StatChip icon={<Layers size={12} />}    label="Resoluciones" value={String(meta.total)} highlight />
            <StatChip icon={<TrendingUp size={12} />} label="Duración"     value={`${(meta.duracion_ms / 1000).toFixed(1)}s`} />
            <div className="ml-auto">
              <span
                className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full"
                style={{
                  background: `${comunidadInfo?.color}18`,
                  color: comunidadInfo?.color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: comunidadInfo?.color }}
                />
                {nombreBoletin} online
              </span>
            </div>
          </div>
        )}

        {/* ── Contenido ── */}
        <main className="flex-1 overflow-y-auto px-6 py-6">

          {/* Error banner */}
          {error && (
            <div className="mb-5 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 animate-fade-up">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
              <div>
                <p className="font-semibold">Aviso del scraper</p>
                <p className="text-amber-700 text-[13px] mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Error de red */}
          {estado === 'error' && !anuncios.length && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
                <AlertTriangle size={28} className="text-red-400" strokeWidth={1.5} />
              </div>
              <p className="font-bold text-slate-800">No se pudo conectar al backend</p>
              <p className="text-sm text-slate-500 mt-1 mb-5">
                ¿Está el servidor arrancado en{' '}
                <code className="bg-slate-100 px-1 rounded">localhost:3000</code>?
              </p>
              <button
                onClick={() => cargar(comunidad)}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700"
              >
                <RefreshCw size={14} />
                Reintentar
              </button>
            </div>
          )}

          {/* Skeleton */}
          {estado === 'loading' && <SkeletonGrid count={9} />}

          {/* Empty */}
          {estado === 'success' && anuncios.length === 0 && (
            <EmptyState onRetry={() => cargar(comunidad)} />
          )}

          {/* Grid */}
          {anuncios.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {anuncios.map((anuncio, i) => (
                <ResultCard key={`${anuncio.titulo}-${i}`} anuncio={anuncio} index={i} />
              ))}
            </div>
          )}
        </main>
      </div>}  {/* fin vista comunidad */}
    </div>
  );
}

function StatChip({
  icon, label, value, highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400">{icon}</span>
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-[13px] font-bold font-mono-data ${highlight ? 'text-slate-900' : 'text-slate-600'}`}>
        {value}
      </span>
    </div>
  );
}
