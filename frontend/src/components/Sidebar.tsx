import { LayoutDashboard, Search, Map, Activity, Building2, X } from 'lucide-react';

export type ComunidadKey =
  | 'madrid' | 'canarias' | 'andalucia' | 'cataluna'
  | 'valencia' | 'paisvasco' | 'galicia' | 'aragon'
  | 'castillayleon' | 'murcia' | 'asturias' | 'navarra'
  | 'extremadura' | 'cantabria' | 'larioja' | 'baleares';
export type VistaKey = 'dashboard' | 'comunidad' | 'buscador' | 'mapa' | 'directorio';

export interface ComunidadEntry {
  key: ComunidadKey;
  code: string;
  name: string;
  color: string;
  disponible: boolean;
}

export const COMUNIDADES: ComunidadEntry[] = [
  { key: 'madrid',        code: 'BOCM',  name: 'Madrid',          color: '#f43f5e', disponible: true  },
  { key: 'canarias',      code: 'BOC',   name: 'Canarias',        color: '#f59e0b', disponible: true  },
  { key: 'andalucia',     code: 'BOJA',  name: 'Andalucía',       color: '#10b981', disponible: true  },
  { key: 'cataluna',      code: 'DOGC',  name: 'Cataluña',        color: '#8b5cf6', disponible: true  },
  { key: 'valencia',      code: 'DOCV',  name: 'Valencia',        color: '#3b82f6', disponible: true  },
  { key: 'paisvasco',     code: 'BOPV',  name: 'País Vasco',      color: '#06b6d4', disponible: true  },
  { key: 'galicia',       code: 'DOG',   name: 'Galicia',         color: '#84cc16', disponible: true  },
  { key: 'aragon',        code: 'BOA',   name: 'Aragón',          color: '#f97316', disponible: true  },
  { key: 'castillayleon', code: 'BOCYL', name: 'Castilla y León', color: '#a78bfa', disponible: true  },
  { key: 'murcia',        code: 'BORM',  name: 'Murcia',          color: '#fb7185', disponible: true  },
  { key: 'asturias',      code: 'BOPA',  name: 'Asturias',        color: '#34d399', disponible: true  },
  { key: 'navarra',       code: 'BON',   name: 'Navarra',         color: '#fbbf24', disponible: true  },
  { key: 'extremadura',  code: 'DOE',   name: 'Extremadura',     color: '#65a30d', disponible: true  },
  { key: 'cantabria',    code: 'BOC-C', name: 'Cantabria',       color: '#0284c7', disponible: true  },
  { key: 'larioja',      code: 'BOR',   name: 'La Rioja',        color: '#be185d', disponible: true  },
  { key: 'baleares',     code: 'BOIB',  name: 'Baleares',        color: '#1d4ed8', disponible: true  },
];

interface NavItem {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  vista?: VistaKey;
}

const NAV_ITEMS: NavItem[] = [
  { icon: <LayoutDashboard size={17} />, label: 'Dashboard',  vista: 'dashboard'  },
  { icon: <Building2 size={17} />,       label: 'Directorio', vista: 'directorio' },
  { icon: <Search size={17} />,          label: 'Buscador',   vista: 'buscador'   },
  { icon: <Map size={17} />,             label: 'Mapa',       vista: 'mapa'       },
];

interface Props {
  comunidadActiva:   ComunidadKey;
  onComunidadChange: (key: ComunidadKey) => void;
  vistaActiva:       VistaKey;
  onVistaChange:     (vista: VistaKey) => void;
  isOpen:            boolean;
  onClose:           () => void;
}

export default function Sidebar({ comunidadActiva, onComunidadChange, vistaActiva, onVistaChange, isOpen, onClose }: Props) {
  const handleVista = (vista: VistaKey) => {
    onVistaChange(vista);
    onClose();
  };

  const handleComunidad = (key: ComunidadKey) => {
    onComunidadChange(key);
    onClose();
  };

  return (
    <aside
      style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)' }}
      className={[
        'w-[240px] shrink-0 h-full flex flex-col',
        // Móvil: posición fija, desliza desde la izquierda
        'fixed md:relative inset-y-0 left-0 z-50',
        'transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      ].join(' ')}
    >
      {/* Logo + botón cerrar (móvil) */}
      <div className="px-5 pt-6 pb-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <Activity size={16} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm tracking-tight leading-none">Farmalitics</p>
            <p className="text-slate-500 text-[11px] mt-0.5 font-mono-data">v1.0 · beta</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="md:hidden text-slate-500 hover:text-slate-200 transition-colors p-1 rounded"
          aria-label="Cerrar menú"
        >
          <X size={16} />
        </button>
      </div>

      {/* Nav principal — solo visual en esta fase */}
      <nav className="px-3 pt-4 flex-1 overflow-y-auto">
        <p className="text-slate-600 text-[10px] font-semibold uppercase tracking-widest px-2 mb-2">
          Navegación
        </p>
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = item.vista !== undefined && item.vista === vistaActiva;
            const isDisabled = item.vista === undefined;
            return (
              <li key={item.label}>
                <button
                  onClick={() => item.vista && handleVista(item.vista)}
                  disabled={isDisabled}
                  title={isDisabled ? 'Próximamente' : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                    isActive
                      ? 'bg-accent/10 text-accent'
                      : isDisabled
                      ? 'text-slate-600 cursor-not-allowed opacity-50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  {item.badge && (
                    <span className="bg-accent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {item.badge}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* CC.AA. — funcionales */}
        <p className="text-slate-600 text-[10px] font-semibold uppercase tracking-widest px-2 mt-6 mb-2">
          Comunidades
        </p>
        <ul className="space-y-0.5">
          {COMUNIDADES.map((ca) => {
            const isActive = ca.key === comunidadActiva;
            return (
              <li key={ca.key}>
                <button
                  onClick={() => ca.disponible && handleComunidad(ca.key)}
                  disabled={!ca.disponible}
                  title={ca.disponible ? `Ver BOC de ${ca.name}` : 'Próximamente'}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left
                    ${isActive
                      ? 'bg-white/8 text-slate-200 ring-1 ring-white/10'
                      : ca.disponible
                      ? 'text-slate-400 hover:text-slate-200 hover:bg-white/5 cursor-pointer'
                      : 'text-slate-600 cursor-not-allowed opacity-60'
                    }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0 transition-all"
                    style={{
                      background: isActive ? ca.color : ca.disponible ? ca.color : '#334155',
                      boxShadow: isActive ? `0 0 6px ${ca.color}99` : 'none',
                    }}
                  />
                  <span className="flex-1">{ca.name}</span>
                  {ca.disponible ? (
                    <span
                      className="font-mono-data text-[10px]"
                      style={{ color: isActive ? ca.color : '#475569' }}
                    >
                      {ca.code}
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-600 font-medium uppercase tracking-wide">
                      pronto
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

    </aside>
  );
}
