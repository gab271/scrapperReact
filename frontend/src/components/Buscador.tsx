import { useState, useRef, useCallback, useMemo } from 'react';
import {
  Search, X, AlertTriangle, Database, ChevronLeft, ChevronRight, RefreshCw,
} from 'lucide-react';
import { getFarmaciasPorComunidad } from '../api/farmacias';
import { AnuncioFarmacia } from '../types/farmacia';
import ResultCard from './ResultCard';
import { SkeletonGrid } from './SkeletonCard';
import { COMUNIDADES } from './Sidebar';

const PAGE_SIZE = 24;
const MIN_QUERY  = 2;

export default function Buscador() {
  const [anuncios, setAnuncios] = useState<AnuncioFarmacia[]>([]);
  const [query, setQuery]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [page, setPage]         = useState(1);

  // loadedRef evita re-fetches innecesarios mientras los datos están en caché
  const loadedRef = useRef(false);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef  = useRef<AbortController | null>(null);

  const fetchTodo = useCallback(async () => {
    if (loadedRef.current) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setAnuncios([]);
    try {
      const resultados = await Promise.all(
        COMUNIDADES.filter(c => c.disponible).map(c =>
          getFarmaciasPorComunidad(c.key, ctrl.signal),
        ),
      );
      if (ctrl.signal.aborted) return;
      setAnuncios(resultados.flatMap(r => r.anuncios));
      loadedRef.current = true;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Error de conexión con el backend');
    } finally {
      setLoading(false);
    }
  }, []);

  const refrescarDatos = useCallback(() => {
    loadedRef.current = false;
    fetchTodo();
  }, [fetchTodo]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setPage(1);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value.trim().length < MIN_QUERY) return;
    timerRef.current = setTimeout(fetchTodo, 350);
  };

  const filtrados = useMemo(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];
    const lower = q.toLowerCase();
    return anuncios.filter(a =>
      a.titulo.toLowerCase().includes(lower) ||
      (a.municipio ?? '').toLowerCase().includes(lower) ||
      (a.texto_resumen ?? '').toLowerCase().includes(lower),
    );
  }, [anuncios, query]);

  const totalPaginas = Math.ceil(filtrados.length / PAGE_SIZE);
  const paginaActual = filtrados.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hayBusqueda  = query.trim().length >= MIN_QUERY;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-bold text-slate-900 leading-none">Buscador</h1>
            <p className="text-[11px] text-slate-400 mt-1">
              {loading
                ? 'Cargando resoluciones de todas las CC.AA.…'
                : 'Busca en todas las resoluciones disponibles'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {loadedRef.current && !loading && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-full">
                <Database size={11} />
                {anuncios.length.toLocaleString('es-ES')} en caché
              </span>
            )}
            {loadedRef.current && !loading && (
              <button
                onClick={refrescarDatos}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-full transition-colors"
                title="Volver a cargar todos los boletines"
              >
                <RefreshCw size={11} />
                Refrescar
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Barra de búsqueda ── */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 shrink-0">
        <div className="relative max-w-2xl">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Buscar por título, municipio o resumen…"
            className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all placeholder:text-slate-400"
          />
          {query && (
            <button
              onClick={() => { handleQueryChange(''); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="Limpiar búsqueda"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <p className="text-[11px] text-slate-400 mt-2">
          {loading && hayBusqueda
            ? 'Cargando datos de 16 comunidades autónomas…'
            : hayBusqueda && !loading
            ? `${filtrados.length} resultado${filtrados.length !== 1 ? 's' : ''} para "${query.trim()}"${totalPaginas > 1 ? ` · pág. ${page}/${totalPaginas}` : ''}`
            : 'Escribe al menos 2 caracteres para buscar en todos los boletines'}
        </p>
      </div>

      {/* ── Contenido ── */}
      <main className="flex-1 overflow-y-auto px-6 py-6">

        {/* Prompt inicial */}
        {!hayBusqueda && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mb-4">
              <Search size={26} className="text-emerald-400" strokeWidth={1.5} />
            </div>
            <p className="font-bold text-slate-700">Busca en todas las CC.AA.</p>
            <p className="text-sm text-slate-400 mt-1 max-w-xs">
              Escribe el nombre de un municipio, un titular o el tipo de operación
            </p>
          </div>
        )}

        {/* Error de red */}
        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
              <AlertTriangle size={28} className="text-red-400" strokeWidth={1.5} />
            </div>
            <p className="font-bold text-slate-800">No se pudo conectar al backend</p>
            <p className="text-sm text-slate-500 mt-1">{error}</p>
            <button
              onClick={refrescarDatos}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700"
            >
              <RefreshCw size={14} /> Reintentar
            </button>
          </div>
        )}

        {/* Skeleton mientras carga */}
        {loading && <SkeletonGrid count={9} />}

        {/* Sin resultados */}
        {hayBusqueda && !loading && !error && filtrados.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <Search size={28} className="text-slate-400" strokeWidth={1.5} />
            </div>
            <p className="font-bold text-slate-800">Sin resultados</p>
            <p className="text-sm text-slate-500 mt-1">
              No hay resoluciones que contengan &ldquo;{query.trim()}&rdquo;
            </p>
            <button
              onClick={() => { handleQueryChange(''); setPage(1); }}
              className="mt-4 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
            >
              Limpiar búsqueda
            </button>
          </div>
        )}

        {/* Grid de resultados */}
        {hayBusqueda && !loading && !error && paginaActual.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginaActual.map((anuncio, i) => (
                <ResultCard key={`${anuncio.titulo}-${(page - 1) * PAGE_SIZE + i}`} anuncio={anuncio} index={i} />
              ))}
            </div>

            {/* Paginación */}
            {totalPaginas > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8 pb-4">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={13} /> Anterior
                </button>
                <span className="text-[12px] text-slate-500 font-mono px-3">
                  {page} / {totalPaginas}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPaginas, p + 1))}
                  disabled={page === totalPaginas}
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
