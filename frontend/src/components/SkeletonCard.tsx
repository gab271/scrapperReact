export default function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-5 flex flex-col gap-3 overflow-hidden">
      {/* Badge + header */}
      <div className="flex items-start justify-between gap-3">
        <div className="h-4 bg-slate-100 rounded-md w-3/4 animate-pulse" />
        <div className="h-5 w-14 bg-slate-100 rounded-full animate-pulse shrink-0" />
      </div>

      {/* Meta row */}
      <div className="flex gap-3">
        <div className="h-3 bg-slate-100 rounded w-24 animate-pulse" />
        <div className="h-3 bg-slate-100 rounded w-20 animate-pulse" />
      </div>

      {/* Body lines */}
      <div className="space-y-2 pt-1">
        <div className="h-3 bg-slate-100 rounded w-full animate-pulse" />
        <div className="h-3 bg-slate-100 rounded w-5/6 animate-pulse" />
        <div className="h-3 bg-slate-100 rounded w-4/6 animate-pulse" />
      </div>

      {/* CTA */}
      <div className="h-8 bg-slate-100 rounded-lg w-36 animate-pulse mt-1" />
    </div>
  );
}

export function SkeletonGrid({ count = 9 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ animationDelay: `${i * 60}ms` }} className="animate-fade-up">
          <SkeletonCard />
        </div>
      ))}
    </div>
  );
}
