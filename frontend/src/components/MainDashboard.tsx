import { useState, useEffect, useRef } from 'react';
import {
  BarChart2, Activity, TrendingUp, Zap, RefreshCw,
  ChevronRight, AlertTriangle,
} from 'lucide-react';
import { getStats, syncFarmacias } from '../api/farmacias';
import type { StatsResponse } from '../api/farmacias';
import { COMUNIDADES } from './Sidebar';

// ─── Tipos internos ───────────────────────────────────────────────────────────

type EstadoScraper = 'online' | 'error' | 'sin-datos';

interface ComunidadMeta {
  key:       string;
  code:      string;
  name:      string;
  color:     string;
  disponible: boolean;
}

interface CCAAprocesada {
  comunidad: string;
  total:     number;
  code?:     string;
  name?:     string;
  color?:    string;
}

interface ScraperProcesado {
  comunidad: string;
  estado:    EstadoScraper;
  detalle:   string;
  code?:     string;
  name?:     string;
  color?:    string;
  total?:    number;
}

interface ActividadProcesada {
  comunidad:      string;
  fuente:         string;
  tipo_operacion: string;
  fecha:          string;
  adjudicatario:  string | null;
  municipio:      string;
  code?:          string;
  name?:          string;
  color?:         string;
  tipoLabel:      string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function comunidadInfo(key: string): ComunidadMeta | null {
  return (COMUNIDADES as ComunidadMeta[]).find(c => c.key === key) ?? null;
}

function estadoScraper(ultimaFecha: string | null): EstadoScraper {
  if (!ultimaFecha) return 'sin-datos';
  const dias = Math.floor((Date.now() - new Date(ultimaFecha).getTime()) / 86_400_000);
  if (dias > 60) return 'sin-datos';
  if (dias > 30) return 'error';
  return 'online';
}

function labelEstado(estado: EstadoScraper, ultimaFecha: string | null): string {
  if (estado === 'sin-datos') return 'Sin datos';
  if (estado === 'error')     return 'Desactualizado';
  const dias = Math.floor((Date.now() - new Date(ultimaFecha!).getTime()) / 86_400_000);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  return `Hace ${dias}d`;
}

const TIPO_LABELS: Record<string, string> = {
  apertura:    'Apertura',
  transmision: 'Transmisión',
  cierre:      'Cierre',
  otro:        'Resolución',
};

const TIPO_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  Apertura:    { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0' },
  Transmisión: { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
  Cierre:      { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
  Resolución:  { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' },
};

const ESTADO_DOT: Record<EstadoScraper, { bg: string; glow: string; label: string }> = {
  online:      { bg: '#10b981', glow: 'rgba(16,185,129,0.20)',  label: 'Online'    },
  error:       { bg: '#f97316', glow: 'rgba(249,115,22,0.20)',  label: 'Antiguo'   },
  'sin-datos': { bg: '#cbd5e1', glow: 'rgba(203,213,225,0.30)', label: 'Sin datos' },
};

// ─── MainDashboard ────────────────────────────────────────────────────────────

interface MainDashboardProps {
  onForzarScraping?: () => Promise<void>;
}

export default function MainDashboard({ onForzarScraping }: MainDashboardProps) {
  const [stats, setStats]             = useState<StatsResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [filtroMeses, setFiltroMeses] = useState(12);
  const [scraping, setScraping]       = useState(false);
  const [syncMsg, setSyncMsg]         = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const cargarStats = async (meses: number) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    try {
      const data = await getStats(meses, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setStats(data);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message ?? 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargarStats(filtroMeses); }, [filtroMeses]);

  const handleScraping = async () => {
    setScraping(true);
    setSyncMsg(null);
    try {
      if (onForzarScraping) {
        await onForzarScraping();
      } else {
        await syncFarmacias();
      }
      setSyncMsg('Scraping completado');
      await cargarStats(filtroMeses);
    } catch {
      setSyncMsg('Error al sincronizar');
    } finally {
      setTimeout(() => setScraping(false), 1500);
    }
  };

  // ── Datos derivados ──────────────────────────────────────────
  const totalResoluciones = stats?.totalResoluciones ?? 0;
  const variacionMes      = stats?.variacionMes      ?? 0;

  const topComunidad: (CCAAprocesada & ComunidadMeta) | null = (() => {
    if (!stats?.porComunidad?.length) return null;
    const top  = stats.porComunidad[0];
    const info = comunidadInfo(top.comunidad);
    if (!info) return null;
    return { ...top, ...info };
  })();

  const ccaaData: CCAAprocesada[] = (stats?.porComunidad ?? [])
    .map(p => ({ ...p, ...(comunidadInfo(p.comunidad) ?? {}) }))
    .filter(p => p.total > 0);

  const maxTotal = Math.max(...ccaaData.map(c => c.total), 1);

  const scrapersData: ScraperProcesado[] = (stats?.scraperStatus ?? []).map(s => {
    const info   = comunidadInfo(s.comunidad);
    const estado = estadoScraper(s.ultima_fecha);
    return {
      ...s,
      ...(info ?? {}),
      estado,
      detalle: labelEstado(estado, s.ultima_fecha),
    };
  });

  const scrapersOnline = scrapersData.filter(s => s.estado === 'online').length;

  const actividadData: ActividadProcesada[] = (stats?.actividadReciente ?? []).map(a => {
    const info = comunidadInfo(a.comunidad);
    return {
      ...a,
      ...(info ?? {}),
      tipoLabel: TIPO_LABELS[a.tipo_operacion] ?? 'Resolución',
    };
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[15px] font-bold text-slate-900 leading-none">
            Dashboard Global — Resumen de actividad
          </h1>
          <p className="text-[11px] text-slate-400 mt-1">
            Todas las comunidades autónomas ·{' '}
            {new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {syncMsg && !scraping && (
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {syncMsg}
            </span>
          )}
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            {[3, 6, 12].map(m => (
              <button
                key={m}
                onClick={() => setFiltroMeses(m)}
                className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                  filtroMeses === m
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {m === 12 ? '1 año' : `${m}m`}
              </button>
            ))}
          </div>
          <button
            onClick={handleScraping}
            disabled={scraping || loading}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white text-[13px] font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {scraping ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
            {scraping ? 'Sincronizando...' : 'Forzar Scraping Global'}
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

        {error && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 animate-fade-up">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
            <div>
              <p className="font-semibold">No se pudieron cargar las estadísticas</p>
              <p className="text-amber-700 text-[13px] mt-0.5">{error}</p>
              <button
                onClick={() => cargarStats(filtroMeses)}
                className="mt-1.5 text-[12px] font-semibold underline"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {/* Fila 1 — KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            loading={loading}
            icon={<BarChart2 size={18} />}
            titulo="Total Resoluciones"
            valor={totalResoluciones.toLocaleString('es-ES')}
            extra={variacionMes > 0 ? `+${variacionMes} este mes` : 'Sin datos este mes'}
            extraPositivo={variacionMes > 0}
            accentColor="#10b981"
          />
          <KpiCard
            loading={loading}
            icon={<TrendingUp size={18} />}
            titulo="Comunidad más activa"
            valor={topComunidad?.name ?? '—'}
            extra={topComunidad ? `${topComunidad.total} resoluciones` : 'Sin datos'}
            badge={topComunidad ? { label: topComunidad.code, color: topComunidad.color } : null}
            accentColor={topComunidad?.color ?? '#3b82f6'}
          />
          <KpiCard
            loading={loading}
            icon={<Activity size={18} />}
            titulo="Scrapers con datos"
            valor={scrapersData.length ? `${scrapersOnline}/${scrapersData.length}` : '—'}
            extra={
              !scrapersData.length                              ? 'Sin sincronizar aún'    :
              scrapersOnline === scrapersData.length            ? 'Todos actualizados'     :
              `${scrapersData.length - scrapersOnline} sin actualizar`
            }
            extraPositivo={scrapersData.length > 0 && scrapersOnline === scrapersData.length}
            accentColor={
              !scrapersData.length                                   ? '#94a3b8' :
              scrapersOnline >= scrapersData.length * 0.75 ? '#10b981' : '#f97316'
            }
          />
        </div>

        {/* Fila 2 — Gráfico + Scrapers */}
        <div className="grid grid-cols-3 gap-4 items-start">
          <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-[13px] font-bold text-slate-800">
                  Resoluciones por Comunidad Autónoma
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Últimos {filtroMeses === 12 ? '12 meses' : `${filtroMeses} meses`} · datos reales
                </p>
              </div>
              <span className="text-[11px] text-slate-400 font-mono-data">
                {totalResoluciones.toLocaleString('es-ES')} total
              </span>
            </div>
            {loading
              ? <BarChartSkeleton />
              : ccaaData.length > 0
                ? <BarChartCCAA data={ccaaData} maxTotal={maxTotal} />
                : <p className="text-[12px] text-slate-400 py-8 text-center">
                    Sin datos — lanza el scraping para poblar el dashboard
                  </p>
            }
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-bold text-slate-800">Estado de Scrapers</h2>
              {scrapersData.length > 0 && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  scrapersOnline === scrapersData.length
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}>
                  {scrapersOnline}/{scrapersData.length}
                </span>
              )}
            </div>
            {loading
              ? <div className="space-y-3">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="h-8 bg-slate-100 rounded-lg animate-shimmer" />
                  ))}
                </div>
              : scrapersData.length > 0
                ? <ul className="space-y-2.5">
                    {scrapersData.map(s => <ScraperRow key={s.comunidad} scraper={s} />)}
                  </ul>
                : <p className="text-[12px] text-slate-400 py-6 text-center">Sin datos aún</p>
            }
          </div>
        </div>

        {/* Fila 3 — Actividad reciente */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[13px] font-bold text-slate-800">Actividad Reciente</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Últimas resoluciones a nivel nacional
              </p>
            </div>
            <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
              Top 5 <ChevronRight size={11} />
            </span>
          </div>
          {loading
            ? <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-10 bg-slate-100 rounded-lg animate-shimmer" />
                ))}
              </div>
            : actividadData.length > 0
              ? <div className="divide-y divide-slate-100">
                  {actividadData.map((item, i) => (
                    <ActividadRow key={i} item={item} index={i} />
                  ))}
                </div>
              : <p className="text-[12px] text-slate-400 py-8 text-center">
                  Sin actividad reciente — realiza un scraping para ver datos
                </p>
          }
        </div>

      </main>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

interface KpiCardProps {
  loading:        boolean;
  icon:           React.ReactNode;
  titulo:         string;
  valor:          string;
  extra?:         string;
  extraPositivo?: boolean;
  badge?:         { label: string; color: string } | null;
  accentColor:    string;
}

function KpiCard({ loading, icon, titulo, valor, extra, extraPositivo, badge, accentColor }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 relative overflow-hidden animate-fade-up">
      <div
        className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full"
        style={{ background: accentColor }}
      />
      <div className="pl-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            {titulo}
          </span>
          <span style={{ color: accentColor }}>{icon}</span>
        </div>
        {loading ? (
          <div className="space-y-2">
            <div className="h-6 bg-slate-100 rounded animate-shimmer w-2/3" />
            <div className="h-3 bg-slate-100 rounded animate-shimmer w-1/2" />
          </div>
        ) : (
          <>
            <div className="flex items-end gap-2 flex-wrap">
              <span className="text-[22px] font-bold text-slate-900 font-mono-data leading-none">
                {valor}
              </span>
              {badge && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono-data mb-0.5"
                  style={{ background: `${badge.color}18`, color: badge.color }}
                >
                  {badge.label}
                </span>
              )}
            </div>
            {extra && (
              <p className={`text-[11px] mt-1.5 font-medium ${
                extraPositivo === true  ? 'text-emerald-600' :
                extraPositivo === false ? 'text-rose-500'    : 'text-slate-500'
              }`}>
                {extraPositivo === true && '↑ '}{extra}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BarChartCCAA({ data, maxTotal }: { data: CCAAprocesada[]; maxTotal: number }) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 120);
    return () => clearTimeout(t);
  }, [data]);

  return (
    <div className="space-y-2.5">
      {data.map((ccaa, i) => {
        const pct = Math.round((ccaa.total / maxTotal) * 100);
        return (
          <div key={ccaa.comunidad} className="flex items-center gap-3">
            <span
              className="text-[10px] font-mono-data font-bold w-11 text-right shrink-0"
              style={{ color: ccaa.color ?? '#94a3b8' }}
            >
              {ccaa.code ?? ccaa.comunidad.toUpperCase().slice(0, 4)}
            </span>
            <div className="flex-1 h-6 bg-slate-50 rounded-md overflow-hidden">
              <div
                className="h-full rounded-md"
                style={{
                  width: animated ? `${pct}%` : '0%',
                  background: `${ccaa.color ?? '#10b981'}35`,
                  borderRight: `2px solid ${ccaa.color ?? '#10b981'}`,
                  transition: `width 600ms cubic-bezier(0.4,0,0.2,1) ${i * 40}ms`,
                }}
              />
            </div>
            <span className="text-[12px] font-bold font-mono-data text-slate-700 w-8 text-right shrink-0">
              {ccaa.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BarChartSkeleton() {
  return (
    <div className="space-y-2.5">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-11 h-4 bg-slate-100 rounded animate-shimmer shrink-0" />
          <div className="flex-1 h-6 bg-slate-100 rounded animate-shimmer" style={{ animationDelay: `${i * 60}ms` }} />
          <div className="w-6 h-4 bg-slate-100 rounded animate-shimmer shrink-0" />
        </div>
      ))}
    </div>
  );
}

function ScraperRow({ scraper }: { scraper: ScraperProcesado }) {
  const { estado, code, name, color, detalle, comunidad } = scraper;
  const dot = ESTADO_DOT[estado] ?? ESTADO_DOT['sin-datos'];

  return (
    <li className="flex items-center gap-2.5">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: dot.bg, boxShadow: `0 0 0 3px ${dot.glow}` }}
      />
      <span
        className="text-[10px] font-bold font-mono-data px-1.5 py-0.5 rounded w-[50px] text-center shrink-0"
        style={{ background: `${color ?? '#94a3b8'}18`, color: color ?? '#94a3b8' }}
      >
        {code ?? comunidad.toUpperCase().slice(0, 4)}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-slate-700 truncate">{name ?? comunidad}</p>
        <p className="text-[10px] text-slate-400 truncate">{detalle}</p>
      </div>
      <span className="text-[10px] font-semibold shrink-0" style={{ color: dot.bg }}>
        {dot.label}
      </span>
    </li>
  );
}

function ActividadRow({ item, index }: { item: ActividadProcesada; index: number }) {
  const { tipoLabel, fecha, adjudicatario, municipio, code, color, fuente } = item;
  const ts           = TIPO_STYLES[tipoLabel] ?? TIPO_STYLES['Resolución'];
  const displayCode  = code ?? fuente ?? '—';
  const displayColor = color ?? '#94a3b8';

  return (
    <div
      className="flex items-center gap-3 py-3 animate-fade-up"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <span
        className="text-[10px] font-bold font-mono-data px-2 py-1 rounded w-[56px] text-center shrink-0"
        style={{ background: `${displayColor}18`, color: displayColor }}
      >
        {displayCode}
      </span>
      <span
        className="text-[11px] font-semibold px-2 py-0.5 rounded border shrink-0 w-[82px] text-center"
        style={{ background: ts.bg, color: ts.text, borderColor: ts.border }}
      >
        {tipoLabel}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-slate-800 truncate">
          {adjudicatario || municipio || 'Sin datos'}
        </p>
        <p className="text-[10px] text-slate-400">{municipio}</p>
      </div>
      <span className="text-[11px] text-slate-400 font-mono-data shrink-0 hidden sm:block">
        {fecha}
      </span>
    </div>
  );
}
