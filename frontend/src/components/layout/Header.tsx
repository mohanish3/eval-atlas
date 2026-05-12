import { Cpu, Database, FlaskConical, Moon, Sun, TableProperties } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface HeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export default function Header({ theme, onToggleTheme }: HeaderProps) {
  const location = useLocation();
  const links = [
    { to: '/evals', label: 'Runs', icon: FlaskConical, exact: true },
    { to: '/evals/sets', label: 'Eval Sets', icon: TableProperties },
    { to: '/evals/config', label: 'Config', icon: Database },
  ];

  return (
    <header className={cn(
      'sticky top-0 z-40 border-b backdrop-blur-xl transition-colors',
      theme === 'dark'
        ? 'border-white/10 bg-slate-950/75'
        : 'border-slate-200/80 bg-white/75'
    )}>
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-4">
          <div className={cn(
            'flex h-11 w-11 items-center justify-center rounded-2xl border bg-gradient-to-br shadow-[0_0_30px_rgba(34,211,238,0.15)] transition-colors',
            theme === 'dark'
              ? 'border-cyan-400/20 from-cyan-400/20 via-sky-500/15 to-orange-400/20'
              : 'border-cyan-500/25 from-cyan-100 via-sky-100 to-orange-100'
          )}>
            <Cpu className={cn('h-5 w-5', theme === 'dark' ? 'text-cyan-200' : 'text-cyan-700')} />
          </div>
          <div>
            <h1 className={cn(
              'text-sm font-semibold uppercase tracking-[0.28em]',
              theme === 'dark' ? 'text-slate-100' : 'text-slate-900'
            )}>Eval Atlas</h1>
            <p className={cn(
              'mt-1 text-xs',
              theme === 'dark' ? 'text-slate-400' : 'text-slate-600'
            )}>Evaluation command center for cloud and local model runs</p>
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
                      ? theme === 'dark'
                        ? 'border-cyan-400/25 bg-cyan-300/10 text-cyan-100'
                        : 'border-cyan-500/30 bg-cyan-50 text-cyan-800'
                      : theme === 'dark'
                        ? 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-slate-100'
                        : 'border-slate-200 bg-white/80 text-slate-600 hover:border-slate-300 hover:text-slate-900'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
            <button
              type="button"
              role="switch"
              onClick={onToggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-checked={theme === 'dark'}
              className={cn(
                'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                theme === 'dark'
                  ? 'border-cyan-400/25 bg-cyan-400/20'
                  : 'border-amber-300/60 bg-amber-100'
              )}
            >
              <span
                className={cn(
                  'absolute left-1 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-transform',
                  theme === 'dark'
                    ? 'translate-x-6 border-cyan-400/20 bg-slate-950 text-cyan-100'
                    : 'translate-x-0 border-amber-300/60 bg-white text-amber-700'
                )}
              >
                {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
              </span>
            </button>
        </div>
      </div>
    </header>
  );
}
