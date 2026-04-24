import { useState, useEffect } from 'react';
import { Search, X, AlertTriangle, Database } from 'lucide-react';
import { getFarmaciasPorComunidad } from '../api/farmacias';
import { AnuncioFarmacia } from '../types/farmacia';
import ResultCard from './ResultCard';
import { SkeletonGrid } from './SkeletonCard';
import { COMUNIDADES } from './Sidebar';

export default function Buscador() {
  const [anuncios, setAnuncios] = useState<AnuncioFarmacia[]>([]);
  const [query, setQuery]       = useState('');
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

  const filtrados = query.trim()
    ? anuncios.filter(a => {
        const q = query.toLowerCase();
        return (
          a.titulo.toLowerCase().includes(q) ||
          a.municipio.toLowerCase().includes(q) ||
          a.texto_resumen.toLowerCase().includes(q)
        );
      })
    : anuncios;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-bold text-slate-900 leading-none">Buscador</h1>
            <p className="text-[11px] text-slate-400 mt-1">
              Busca en todas las resoluciones de farmacias disponibles
            </p>
          </div>
          {!loading && !error && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-full">
              <Database size={11} />
              {anuncios.length} resoluciones
            </span>
          )}
        </div>
      </header>

      {/* Search bar */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 shrink-0">
        <div className="relative max-w-2xl">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por título, municipio o resumen…"
            className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all placeholder:text-slate-400"
            disabled={loading}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="Limpiar búsqueda"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {!loading && !error && (
          <p className="text-[11px] text-slate-400 mt-2">
            {query
              ? `${filtrados.length} resultado${filtrados.length !== 1 ? 's' : ''} para "${query}"`
              : 'Escribe para filtrar por título, municipio o resumen'}
          </p>
        )}
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        {/* Error de red */}
        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
              <AlertTriangle size={28} className="text-red-400" strokeWidth={1.5} />
            </div>
            <p className="font-bold text-slate-800">No se pudo conectar al backend</p>
            <p className="text-sm text-slate-500 mt-1">{error}</p>
          </div>
        )}

        {/* Skeleton */}
        {loading && <SkeletonGrid count={9} />}

        {/* Sin resultados de búsqueda */}
        {!loading && !error && filtrados.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <Search size={28} className="text-slate-400" strokeWidth={1.5} />
            </div>
            <p className="font-bold text-slate-800">Sin resultados</p>
            <p className="text-sm text-slate-500 mt-1">
              {query
                ? `No hay resoluciones que contengan "${query}"`
                : 'No hay resoluciones disponibles en este momento'}
            </p>
            {query && (
              <button
                onClick={() => setQuery('')}
                className="mt-4 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        )}

        {/* Grid de resultados */}
        {!loading && !error && filtrados.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtrados.map((anuncio, i) => (
              <ResultCard key={`${anuncio.titulo}-${i}`} anuncio={anuncio} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
