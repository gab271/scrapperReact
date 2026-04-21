import { LayoutDashboard, Search, Bell, Map, Settings, FileText, Activity } from 'lucide-react';

export type ComunidadKey =
  | 'madrid' | 'canarias' | 'andalucia' | 'cataluna'
  | 'valencia' | 'paisvasco' | 'galicia' | 'aragon';
export type VistaKey = 'dashboard' | 'buscador' | 'mapa';

export interface ComunidadEntry {
  key: ComunidadKey;
  code: string;
  name: string;
  color: string;
  disponible: boolean;
}

export const COMUNIDADES: ComunidadEntry[] = [
  { key: 'madrid',    code: 'BOCM', name: 'Madrid',      color: '#f43f5e', disponible: true  },
  { key: 'canarias',  code: 'BOC',  name: 'Canarias',    color: '#f59e0b', disponible: true  },
  { key: 'andalucia', code: 'BOJA', name: 'Andalucía',   color: '#10b981', disponible: true  },
  { key: 'cataluna',  code: 'DOGC', name: 'Cataluña',    color: '#8b5cf6', disponible: true  },
  { key: 'valencia',  code: 'DOCV', name: 'Valencia',    color: '#3b82f6', disponible: true  },
  { key: 'paisvasco', code: 'BOPV', name: 'País Vasco',  color: '#06b6d4', disponible: true  },
  { key: 'galicia',   code: 'DOG',  name: 'Galicia',     color: '#84cc16', disponible: true  },
  { key: 'aragon',    code: 'BOA',  name: 'Aragón',      color: '#f97316', disponible: true  },
];

interface NavItem {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  vista?: VistaKey;
}

const NAV_ITEMS: NavItem[] = [
  { icon: <LayoutDashboard size={17} />, label: 'Dashboard', vista: 'dashboard' },
  { icon: <Search size={17} />,          label: 'Buscador',  vista: 'buscador'  },
  { icon: <Bell size={17} />,            label: 'Alertas',   badge: 3           },
  { icon: <Map size={17} />,             label: 'Mapa',      vista: 'mapa'      },
  { icon: <FileText size={17} />,        label: 'Informes'                      },
];

interface Props {
  comunidadActiva: ComunidadKey;
  onComunidadChange: (key: ComunidadKey) => void;
  vistaActiva: VistaKey;
  onVistaChange: (vista: VistaKey) => void;
}

export default function Sidebar({ comunidadActiva, onComunidadChange, vistaActiva, onVistaChange }: Props) {
  return (
    <aside
      style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)' }}
      className="w-[240px] shrink-0 h-full flex flex-col"
    >
      {/* Logo */}
      <div className="px-5 pt-6 pb-5" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <Activity size={16} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm tracking-tight leading-none">Farmalitics</p>
            <p className="text-slate-500 text-[11px] mt-0.5 font-mono-data">v1.0 · beta</p>
          </div>
        </div>
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
                  onClick={() => item.vista && onVistaChange(item.vista)}
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
                  onClick={() => ca.disponible && onComunidadChange(ca.key)}
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

      {/* Footer */}
      <div className="px-3 pb-4 pt-3" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
          <Settings size={16} />
          Configuración
        </button>
      </div>
    </aside>
  );
}
