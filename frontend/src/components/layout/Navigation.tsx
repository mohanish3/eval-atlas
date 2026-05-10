// frontend/src/components/layout/Navigation.tsx
import { Link, useLocation } from 'react-router-dom';
import { FlaskConical, Radar, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Navigation() {
  const location = useLocation();

  const navItems = [
    { path: '/evals', label: 'Eval Runs', icon: FlaskConical },
  ];

  return (
    <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-slate-950/65 px-4 py-5 backdrop-blur-xl lg:block">
      <div className="flex h-full flex-col gap-6">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500">
            Workspace
          </p>
          <h2 className="mt-3 text-lg font-semibold text-slate-100">Evaluation cockpit</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Launch benchmark runs, inspect drift, and compare local versus API-backed models in one place.
          </p>
        </div>

        <nav className="flex flex-col gap-2">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            Surfaces
          </p>
      {navItems.map((item) => {
        const isActive = location.pathname.startsWith(item.path);
        const Icon = item.icon;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              'group flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all text-sm font-medium',
              isActive
                ? 'border-cyan-400/25 bg-gradient-to-r from-cyan-400/15 to-indigo-400/10 text-slate-50 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]'
                : 'border-white/5 bg-white/[0.02] text-slate-400 hover:border-white/10 hover:bg-white/[0.05] hover:text-slate-100'
            )}
          >
            <span className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-colors',
              isActive
                ? 'border-cyan-400/20 bg-cyan-300/10 text-cyan-200'
                : 'border-white/10 bg-white/[0.03] text-slate-400 group-hover:text-slate-100'
            )}>
              <Icon className="h-4 w-4 shrink-0" />
            </span>
            <span className="flex flex-1 flex-col">
              <span>{item.label}</span>
              <span className="text-[11px] font-normal text-slate-500 group-hover:text-slate-400">
                Track run health and inspect outputs
              </span>
            </span>
            {isActive && (
              <span className="ml-auto h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.8)] animate-fade-in" />
            )}
          </Link>
        );
      })}
        </nav>

        <div className="mt-auto grid gap-3">
          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/8 p-4">
            <div className="flex items-center gap-2 text-emerald-200">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.22em]">Stable path</span>
            </div>
            <p className="mt-2 text-sm text-emerald-100/90">Use local GPU-backed models for repeatable latency checks.</p>
          </div>
          <div className="rounded-2xl border border-orange-400/15 bg-orange-400/8 p-4">
            <div className="flex items-center gap-2 text-orange-200">
              <Radar className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.22em]">Signal</span>
            </div>
            <p className="mt-2 text-sm text-orange-100/90">Compare accuracy, latency, and token cost side-by-side once results land.</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
