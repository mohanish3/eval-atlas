import { Cpu, Database, FlaskConical, TableProperties } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

export default function Header() {
  const location = useLocation();
  const links = [
    { to: '/evals', label: 'Runs', icon: FlaskConical, exact: true },
    { to: '/evals/sets', label: 'Eval Sets', icon: TableProperties },
    { to: '/evals/config', label: 'Config', icon: Database },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/20 via-sky-500/15 to-orange-400/20 shadow-[0_0_30px_rgba(34,211,238,0.15)]">
            <Cpu className="h-5 w-5 text-cyan-200" />
          </div>
          <div>
            <h1 className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-100">Eval Atlas</h1>
            <p className="mt-1 text-xs text-slate-400">Evaluation command center for cloud and local model runs</p>
          </div>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <nav className="flex flex-wrap gap-2">
            {links.map((link) => {
              const active = link.exact ? location.pathname === link.to : location.pathname.startsWith(link.to);
              const Icon = link.icon;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition-colors',
                    active
                      ? 'border-cyan-400/25 bg-cyan-300/10 text-cyan-100'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-slate-100'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="hidden text-right md:block">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Dark workspace</p>
            <p className="mt-1 text-xs text-slate-400">Focused on live evals, local runtimes, and readable comparisons</p>
          </div>
        </div>
      </div>
    </header>
  );
}
