import { ExternalLink, MapPin, Calendar, FileText, UserMinus, UserPlus, Building2, Mail } from 'lucide-react';
import { AnuncioFarmacia } from '../types/farmacia';

interface Props {
  anuncio: AnuncioFarmacia;
  index: number;
}

type BadgeVariant = 'apertura' | 'titular' | 'cierre' | 'transmision' | 'default';

const BADGE_STYLES: Record<BadgeVariant, { bg: string; text: string; dot: string; label: string }> = {
  apertura:    { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500',    label: 'Apertura' },
  titular:     { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Cambio titular' },
  cierre:      { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500',     label: 'Cierre' },
  transmision: { bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500',  label: 'Transmisión' },
  default:     { bg: 'bg-slate-100',  text: 'text-slate-600',   dot: 'bg-slate-400',   label: 'Resolución' },
};

function clasificar(titulo: string): BadgeVariant {
  const t = titulo.toLowerCase();
  if (/cierre/.test(t))              return 'cierre';
  if (/apertura/.test(t))            return 'apertura';
  if (/transmis/.test(t))            return 'transmision';
  if (/titular|titularidad/.test(t)) return 'titular';
  return 'default';
}

export default function ResultCard({ anuncio, index }: Props) {
  const {
    titulo, fecha, municipio, enlace_pdf, texto_resumen,
    titular_saliente, titular_entrante,
    nombre_farmacia, direccion_farmacia, email,
  } = anuncio;

  const variant = clasificar(titulo);
  const badge   = BADGE_STYLES[variant];
  const tienePersonas = titular_saliente || titular_entrante;
  const tieneDetalle  = nombre_farmacia || direccion_farmacia || email;

  return (
    <article
      className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col overflow-hidden animate-fade-up"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Franja de color superior */}
      <div className={`h-1 w-full ${
        variant === 'apertura'    ? 'bg-blue-500' :
        variant === 'titular'     ? 'bg-emerald-500' :
        variant === 'cierre'      ? 'bg-red-500' :
        variant === 'transmision' ? 'bg-violet-500' :
        'bg-slate-200'
      }`} />

      <div className="p-5 flex flex-col gap-3 flex-1">

        {/* Badge + fuente */}
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
            {badge.label}
          </span>
          <span className="text-[11px] font-mono-data text-slate-400 uppercase tracking-wider">
            {anuncio.fuente}
          </span>
        </div>

        {/* Título */}
        <h3 className="text-[13px] font-semibold text-slate-800 leading-snug line-clamp-3">
          {titulo}
        </h3>

        {/* Meta: fecha y municipio */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <Calendar size={11} className="shrink-0" />
            {fecha}
          </span>
          <span className="flex items-center gap-1">
            <MapPin size={11} className="shrink-0" />
            {municipio}
          </span>
        </div>

        {/* Resumen */}
        {texto_resumen && (
          <p className="text-[12px] text-slate-500 leading-relaxed line-clamp-2 flex-1">
            {texto_resumen.replace(/^[–-]\s*/, '')}
          </p>
        )}

        {/* Titulares */}
        {tienePersonas && (
          <div className="flex flex-col gap-1.5 py-2.5 px-3 bg-slate-50 rounded-lg text-[11px]">
            {titular_saliente && (
              <span className="flex items-center gap-2 text-rose-600">
                <UserMinus size={12} className="shrink-0" />
                <span className="font-medium truncate">{titular_saliente}</span>
              </span>
            )}
            {titular_entrante && (
              <span className="flex items-center gap-2 text-emerald-600">
                <UserPlus size={12} className="shrink-0" />
                <span className="font-medium truncate">{titular_entrante}</span>
              </span>
            )}
          </div>
        )}

        {/* Datos de la farmacia */}
        {tieneDetalle && (
          <div className="flex flex-col gap-1.5 py-2.5 px-3 bg-blue-50 rounded-lg text-[11px]">
            {nombre_farmacia && (
              <span className="flex items-center gap-2 text-blue-700">
                <Building2 size={12} className="shrink-0" />
                <span className="font-medium truncate">{nombre_farmacia}</span>
              </span>
            )}
            {direccion_farmacia && (
              <span className="flex items-center gap-2 text-blue-600">
                <MapPin size={12} className="shrink-0" />
                <span className="truncate">{direccion_farmacia}</span>
              </span>
            )}
            {email && (
              <a
                href={`mailto:${email}`}
                className="flex items-center gap-2 text-blue-600 hover:text-blue-800 transition-colors"
              >
                <Mail size={12} className="shrink-0" />
                <span className="truncate">{email}</span>
              </a>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="mt-auto pt-2 border-t border-slate-50">
          {enlace_pdf ? (
            <a
              href={enlace_pdf}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[12px] font-semibold text-slate-700 bg-slate-50 hover:bg-accent hover:text-white px-3 py-1.5 rounded-lg transition-colors duration-150 group"
            >
              <FileText size={13} className="shrink-0" />
              Ver PDF oficial
              <ExternalLink size={11} className="ml-auto opacity-50 group-hover:opacity-100" />
            </a>
          ) : (
            <span className="text-[11px] text-slate-400 italic">PDF no disponible</span>
          )}
        </div>
      </div>
    </article>
  );
}
