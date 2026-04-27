import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, RefreshCw, Phone, Mail, MapPin, Clock,
  Building2, ChevronLeft, ChevronRight, X, AlertTriangle,
} from 'lucide-react';
import { getDirectorio, syncDirectorio } from '../api/farmacias';
import type { FarmaciaDirectorio } from '../api/farmacias';
import { COMUNIDADES } from './Sidebar';
import type { ComunidadKey } from './Sidebar';

interface Props {
  comunidad: ComunidadKey;
}

const PAGE_SIZE = 48;

export default function Directorio({ comunidad }: Props) {
  const [farmacias, setFarmacias]       = useState<FarmaciaDirectorio[]>([]);
  const [total, setTotal]               = useState(0);
  const [pages, setPages]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [municipios, setMunicipios]     = useState<string[]>([]);
  const [busqueda, setBusqueda]         = useState('');
  const [municipioFiltro, setMunicipioFiltro] = useState('');
  const [loading, setLoading]           = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [syncInfo, setSyncInfo]         = useState<string | null>(null);

  const abortRef       = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const comunidadInfo = COMUNIDADES.find(c => c.key === comunidad);

  const cargar = useCallback(async (q: string, mun: string, p: number) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    try {
      const res = await getDirectorio(
        comunidad,
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
  }, [comunidad]);

  // Resetear al cambiar de comunidad
  useEffect(() => {
    setBusqueda('');
    setMunicipioFiltro('');
    setPage(1);
    setSyncInfo(null);
    cargar('', '', 1);
  }, [comunidad, cargar]);

  const handleBusqueda = (value: string) => {
    setBusqueda(value);
    setPage(1);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => cargar(value, municipioFiltro, 1), 380);
  };

  const handleMunicipio = (value: string) => {
    setMunicipioFiltro(value);
    setPage(1);
    cargar(busqueda, value, 1);
  };

  const handlePage = (p: number) => {
    setPage(p);
    cargar(busqueda, municipioFiltro, p);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncInfo(null);
    setError(null);
    try {
      const res = await syncDirectorio(comunidad);
      setSyncInfo(`${res.total.toLocaleString('es-ES')} farmacias actualizadas`);
      await cargar(busqueda, municipioFiltro, page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al sincronizar con OpenStreetMap');
    } finally {
      setSyncing(false);
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
            {comunidadInfo?.name} · {
              loading && total === 0
                ? 'Cargando directorio…'
                : `${total.toLocaleString('es-ES')} farmacias`
            }
          </p>
        </div>

        <div className="flex items-center gap-3">
          {syncInfo && !syncing && (
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {syncInfo}
            </span>
          )}
          <span className="hidden md:block text-[11px] text-slate-400">
            Fuente: OpenStreetMap
          </span>
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

      {/* ── Barra de búsqueda y filtros ── */}
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-3 shrink-0">
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
            onClick={() => { handleBusqueda(''); setMunicipioFiltro(''); cargar('', '', 1); }}
            className="text-[11px] text-slate-500 hover:text-slate-700 font-medium transition-colors"
          >
            Limpiar filtros
          </button>
        )}

        <span className="ml-auto text-[11px] text-slate-400 shrink-0 font-mono-data">
          {total.toLocaleString('es-ES')} resultado{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Contenido ── */}
      <main className="flex-1 overflow-y-auto px-6 py-5">

        {/* Error */}
        {error && (
          <div className="mb-5 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 animate-fade-up">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
            <div>
              <p className="font-semibold">Error al cargar el directorio</p>
              <p className="text-amber-700 text-[13px] mt-0.5">{error}</p>
              <button
                onClick={() => cargar(busqueda, municipioFiltro, page)}
                className="mt-2 text-[12px] font-semibold text-amber-800 underline"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {/* Skeleton de carga */}
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

        {/* Vacío */}
        {!loading && !error && farmacias.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mb-4">
              <Building2 size={26} className="text-slate-300" strokeWidth={1.5} />
            </div>
            <p className="font-bold text-slate-700">No se encontraron farmacias</p>
            <p className="text-sm text-slate-400 mt-1 max-w-xs">
              {busqueda || municipioFiltro
                ? 'Prueba con otros términos o elimina los filtros'
                : 'Pulsa "Actualizar datos" para descargar el directorio desde OpenStreetMap'}
            </p>
          </div>
        )}

        {/* Grid de tarjetas */}
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

            {/* Paginación */}
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
    </div>
  );
}

// ── Tarjeta de farmacia ───────────────────────────────────────────────────────

interface CardProps {
  farmacia:     FarmaciaDirectorio;
  accentColor?: string;
  index:        number;
}

function FarmaciaCard({ farmacia, accentColor, index }: CardProps) {
  const { nombre, direccion, municipio, provincia, telefono, email, horario } = farmacia;
  const color = accentColor ?? '#10b981';

  const ubicacion = [direccion, municipio, provincia].filter(Boolean).join(', ');

  return (
    <div
      className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition-all animate-fade-up flex flex-col gap-3"
      style={{ animationDelay: `${Math.min(index, 11) * 30}ms` }}
    >
      {/* Cabecera: icono + nombre */}
      <div className="flex items-start gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-[13px] font-bold select-none"
          style={{ background: `${color}18`, color }}
        >
          ✚
        </div>
        <h3 className="text-[13px] font-bold text-slate-800 leading-snug line-clamp-2">
          {nombre}
        </h3>
      </div>

      {/* Datos de contacto */}
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
