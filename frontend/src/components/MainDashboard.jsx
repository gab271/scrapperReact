import { useState, useEffect } from 'react';
import {
  BarChart2, Activity, TrendingUp, Zap, RefreshCw, ChevronRight,
} from 'lucide-react';
import { COMUNIDADES } from './Sidebar';

// ─── Mock data — replace with real API calls when backend aggregation is ready ─

const CCAA_TOTALES = [
  { key: 'madrid',        total: 19 },
  { key: 'paisvasco',     total: 15 },
  { key: 'andalucia',     total: 12 },
  { key: 'cataluna',      total: 10 },
  { key: 'canarias',      total:  8 },
  { key: 'galicia',       total:  7 },
  { key: 'aragon',        total:  5 },
  { key: 'murcia',        total:  4 },
  { key: 'castillayleon', total:  3 },
  { key: 'asturias',      total:  3 },
  { key: 'navarra',       total:  2 },
  { key: 'extremadura',   total:  2 },
  { key: 'cantabria',     total:  1 },
  { key: 'larioja',       total:  1 },
  { key: 'valencia',      total:  0 },
  { key: 'baleares',      total:  0 },
];

const SCRAPERS_ESTADO = [
  { key: 'madrid',     estado: 'online',     detalle: 'Última sync: 14 min' },
  { key: 'paisvasco',  estado: 'online',     detalle: 'Última sync: 22 min' },
  { key: 'andalucia',  estado: 'error',      detalle: 'Error: timeout 503'  },
  { key: 'cataluna',   estado: 'sin-datos',  detalle: '0 resultados'        },
  { key: 'valencia',   estado: 'sin-datos',  detalle: '0 resultados'        },
  { key: 'galicia',    estado: 'online',     detalle: 'Última sync: 1h 3m'  },
  { key: 'canarias',   estado: 'online',     detalle: 'Última sync: 45 min' },
  { key: 'murcia',     estado: 'online',     detalle: 'Última sync: 38 min' },
];

const ACTIVIDAD_RECIENTE = [
  {
    id: 1, comunidadKey: 'madrid', tipo: 'Apertura',
    fecha: '25 Abr 2026', adjudicatario: 'Farmacia García López SL', municipio: 'Alcobendas',
  },
  {
    id: 2, comunidadKey: 'paisvasco', tipo: 'Transmisión',
    fecha: '24 Abr 2026', adjudicatario: 'María J. Etxebarria Goikoa', municipio: 'Bilbao',
  },
  {
    id: 3, comunidadKey: 'andalucia', tipo: 'Apertura',
    fecha: '24 Abr 2026', adjudicatario: 'Farmacia Medina Andalucía CB', municipio: 'Sevilla',
  },
  {
    id: 4, comunidadKey: 'madrid', tipo: 'Cierre',
    fecha: '23 Abr 2026', adjudicatario: 'R. Fernández Ruiz', municipio: 'Móstoles',
  },
  {
    id: 5, comunidadKey: 'galicia', tipo: 'Transmisión',
    fecha: '23 Abr 2026', adjudicatario: 'Farmacia Otero Vázquez', municipio: 'Vigo',
  },
];

const TIPO_STYLES = {
  Apertura:    { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0' },
  Transmisión: { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
  Cierre:      { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
  Titular:     { bg: '#f5f3ff', text: '#7c3aed', border: '#ddd6fe' },
};

const ESTADO_DOT = {
  online:       { bg: '#10b981', glow: 'rgba(16,185,129,0.20)', label: 'Online'    },
  error:        { bg: '#ef4444', glow: 'rgba(239,68,68,0.20)',  label: 'Error'     },
  'sin-datos':  { bg: '#f97316', glow: 'rgba(249,115,22,0.20)', label: 'Sin datos' },
};

function enrich(arr, keyField = 'key') {
  return arr.map(item => ({
    ...item,
    ...(COMUNIDADES.find(c => c.key === item[keyField]) ?? {}),
  }));
}

// ─── MainDashboard ────────────────────────────────────────────────────────────

export default function MainDashboard({ onForzarScraping }) {
  const [filtroMeses, setFiltroMeses] = useState(3);
  const [scraping, setScraping]       = useState(false);
  const [syncMsg, setSyncMsg]         = useState(null);

  const ccaaData      = enrich(CCAA_TOTALES);
  const scrapersData  = enrich(SCRAPERS_ESTADO);
  const actividadData = enrich(ACTIVIDAD_RECIENTE, 'comunidadKey');

  const totalResoluciones = ccaaData.reduce((s, c) => s + c.total, 0);
  const topComunidad      = [...ccaaData].sort((a, b) => b.total - a.total)[0];
  const scrapersOnline    = scrapersData.filter(s => s.estado === 'online').length;
  const maxTotal          = Math.max(...ccaaData.map(c => c.total), 1);

  const handleScraping = async () => {
    setScraping(true);
    setSyncMsg(null);
    try {
      await onForzarScraping?.();
      setSyncMsg('Scraping completado');
    } catch {
      setSyncMsg('Error al sincronizar');
    } finally {
      setTimeout(() => setScraping(false), 1500);
    }
  };

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
            {new Date().toLocaleDateString('es-ES', {
              day: '2-digit', month: 'long', year: 'numeric',
            })}
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
            disabled={scraping}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white text-[13px] font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {scraping
              ? <RefreshCw size={13} className="animate-spin" />
              : <Zap size={13} />
            }
            {scraping ? 'Sincronizando...' : 'Forzar Scraping Global'}
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

        {/* Fila 1 — KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            icon={<BarChart2 size={18} />}
            titulo="Total Resoluciones"
            valor={String(totalResoluciones)}
            extra="+45 este mes"
            extraPositivo
            accentColor="#10b981"
          />
          <KpiCard
            icon={<TrendingUp size={18} />}
            titulo="Comunidad más activa"
            valor={topComunidad?.name ?? '—'}
            extra={`${topComunidad?.total} resoluciones`}
            badge={{ label: topComunidad?.code, color: topComunidad?.color }}
            accentColor={topComunidad?.color ?? '#3b82f6'}
          />
          <KpiCard
            icon={<Activity size={18} />}
            titulo="Estado del sistema"
            valor={`${scrapersOnline}/${scrapersData.length}`}
            extra={
              scrapersOnline === scrapersData.length
                ? 'Todos operativos'
                : `${scrapersData.length - scrapersOnline} con incidencias`
            }
            extraPositivo={scrapersOnline === scrapersData.length}
            accentColor={scrapersOnline >= scrapersData.length * 0.75 ? '#10b981' : '#f97316'}
          />
        </div>

        {/* Fila 2 — Gráfico + Scrapers */}
        <div className="grid grid-cols-3 gap-4 items-start">

          {/* Bar chart — 2/3 */}
          <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-[13px] font-bold text-slate-800">
                  Resoluciones por Comunidad Autónoma
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Últimos 12 meses · datos simulados</p>
              </div>
              <span className="text-[11px] text-slate-400 font-mono-data">{totalResoluciones} total</span>
            </div>
            <BarChartCCAA data={ccaaData} maxTotal={maxTotal} />
          </div>

          {/* Scraper status — 1/3 */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-bold text-slate-800">Estado de Scrapers</h2>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                scrapersOnline === scrapersData.length
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}>
                {scrapersOnline}/{scrapersData.length} online
              </span>
            </div>
            <ul className="space-y-2.5">
              {scrapersData.map(s => <ScraperRow key={s.key} scraper={s} />)}
            </ul>
          </div>
        </div>

        {/* Fila 3 — Actividad reciente */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[13px] font-bold text-slate-800">Actividad Reciente</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">Últimas resoluciones a nivel nacional</p>
            </div>
            <button className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
              Ver todo <ChevronRight size={11} />
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {actividadData.map((item, i) => (
              <ActividadRow key={item.id} item={item} index={i} />
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ icon, titulo, valor, extra, extraPositivo, badge, accentColor }) {
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
      </div>
    </div>
  );
}

function BarChartCCAA({ data, maxTotal }) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 120);
    return () => clearTimeout(t);
  }, []);

  const visible = data.filter(d => d.total > 0);

  return (
    <div className="space-y-2.5">
      {visible.map((ccaa, i) => {
        const pct = Math.round((ccaa.total / maxTotal) * 100);
        return (
          <div key={ccaa.key} className="flex items-center gap-3">
            <span
              className="text-[10px] font-mono-data font-bold w-11 text-right shrink-0"
              style={{ color: ccaa.color ?? '#94a3b8' }}
            >
              {ccaa.code}
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
            <span className="text-[12px] font-bold font-mono-data text-slate-700 w-6 text-right shrink-0">
              {ccaa.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ScraperRow({ scraper }) {
  const { estado = 'sin-datos', code, name, color, detalle } = scraper;
  const dot = ESTADO_DOT[estado] ?? ESTADO_DOT['sin-datos'];

  return (
    <li className="flex items-center gap-2.5">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: dot.bg, boxShadow: `0 0 0 3px ${dot.glow}` }}
      />
      <span
        className="text-[10px] font-bold font-mono-data px-1.5 py-0.5 rounded w-[50px] text-center shrink-0"
        style={{ background: `${color}18`, color }}
      >
        {code}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-slate-700 truncate">{name}</p>
        <p className="text-[10px] text-slate-400 truncate">{detalle}</p>
      </div>
      <span className="text-[10px] font-semibold shrink-0" style={{ color: dot.bg }}>
        {dot.label}
      </span>
    </li>
  );
}

function ActividadRow({ item, index }) {
  const { tipo, fecha, adjudicatario, municipio, code, color } = item;
  const ts = TIPO_STYLES[tipo] ?? TIPO_STYLES.Apertura;

  return (
    <div
      className="flex items-center gap-3 py-3 animate-fade-up"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <span
        className="text-[10px] font-bold font-mono-data px-2 py-1 rounded w-[56px] text-center shrink-0"
        style={{ background: `${color}18`, color }}
      >
        {code}
      </span>
      <span
        className="text-[11px] font-semibold px-2 py-0.5 rounded border shrink-0 w-[82px] text-center"
        style={{ background: ts.bg, color: ts.text, borderColor: ts.border }}
      >
        {tipo}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-slate-800 truncate">{adjudicatario}</p>
        <p className="text-[10px] text-slate-400">{municipio}</p>
      </div>
      <span className="text-[11px] text-slate-400 font-mono-data shrink-0 hidden sm:block">
        {fecha}
      </span>
    </div>
  );
}
