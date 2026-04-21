import { SearchX, RefreshCw, ExternalLink } from 'lucide-react';

interface Props {
  onRetry: () => void;
}

export default function EmptyState({ onRetry }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center animate-fade-up">
      {/* Icono con halo */}
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center">
          <SearchX size={36} className="text-slate-400" strokeWidth={1.5} />
        </div>
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-400 rounded-full border-2 border-white flex items-center justify-center">
          <span className="text-white text-[10px] font-bold">!</span>
        </div>
      </div>

      <h2 className="text-lg font-bold text-slate-800 mb-2">
        Sin resultados por el momento
      </h2>
      <p className="text-sm text-slate-500 max-w-sm leading-relaxed mb-6">
        El BOCM no ha devuelto anuncios para las palabras clave actuales, o la estructura
        de la web ha cambiado. Revisa la consola del backend para ver los logs del scraper.
      </p>

      {/* Sugerencias */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left max-w-sm w-full mb-6 space-y-2">
        <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Posibles causas</p>
        <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
          <li>El BOCM ha modificado su HTML — actualiza los selectores en <code className="bg-amber-100 px-1 rounded font-mono">bocm.ts</code></li>
          <li>El servidor del BOCM está caído o bloquea el acceso</li>
          <li>No hay resoluciones recientes con esas palabras clave</li>
        </ul>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
        >
          <RefreshCw size={14} />
          Reintentar
        </button>
        <a
          href="https://www.bocm.es/buscador-bocm"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
        >
          <ExternalLink size={14} />
          Abrir BOCM
        </a>
      </div>
    </div>
  );
}
