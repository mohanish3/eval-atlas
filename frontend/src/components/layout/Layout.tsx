import { ReactNode, useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEvalStore } from '../../store/useEvalStore';
import Header from './Header';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { error, setError } = useEvalStore();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') {
      return 'dark';
    }

    const storedTheme = window.localStorage.getItem('eval-atlas-theme');
    if (storedTheme === 'light' || storedTheme === 'dark') {
      return storedTheme;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    const { body } = document;

    root.classList.remove('light', 'dark');
    body.classList.remove('light', 'dark');
    root.classList.add(theme);
    body.classList.add(theme);
    root.dataset.theme = theme;
    body.dataset.theme = theme;
    window.localStorage.setItem('eval-atlas-theme', theme);

    return () => {
      root.classList.remove('light', 'dark');
      body.classList.remove('light', 'dark');
      delete root.dataset.theme;
      delete body.dataset.theme;
    };
  }, [theme]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className={cn(
          'absolute inset-x-0 top-[-18rem] h-[34rem]',
          theme === 'dark'
            ? 'bg-[radial-gradient(circle_at_top,rgba(97,210,255,0.18),transparent_48%),radial-gradient(circle_at_30%_25%,rgba(255,122,89,0.16),transparent_28%),radial-gradient(circle_at_72%_18%,rgba(84,109,255,0.22),transparent_30%)]'
            : 'bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_46%),radial-gradient(circle_at_30%_22%,rgba(251,146,60,0.14),transparent_24%),radial-gradient(circle_at_72%_18%,rgba(59,130,246,0.12),transparent_28%)]'
        )} />
        <div className={cn(
          'absolute inset-0 [background-size:72px_72px]',
          theme === 'dark'
            ? 'opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)]'
            : 'opacity-50 [background-image:linear-gradient(rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px)]'
        )} />
        <div className={cn(
          'absolute inset-0',
          theme === 'dark'
            ? 'bg-[linear-gradient(180deg,transparent,rgba(2,6,23,0.48)_35%,rgba(2,6,23,0.9))]'
            : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.2),rgba(248,250,252,0.74)_40%,rgba(241,245,249,0.96))]'
        )} />
      </div>

      <div className="relative flex min-h-screen flex-col">
        <Header theme={theme} onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))} />
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-hidden relative">
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="absolute left-4 right-4 top-4 z-50 flex items-center justify-between gap-4 rounded-2xl border border-amber-400/30 bg-amber-300/12 px-4 py-4 text-amber-100 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl animate-slide-down"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-300/30 bg-amber-200/10">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="min-w-0 text-sm font-medium">{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="rounded-xl p-2 text-amber-100/80 transition-colors hover:bg-white/10 hover:text-amber-50 focus:outline-none"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        {children}
          </main>
        </div>
      </div>
    </div>
  );
}
