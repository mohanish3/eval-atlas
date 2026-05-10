import { ReactNode, useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useEvalStore } from '../../store/useEvalStore';
import Header from './Header';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { error, setError } = useEvalStore();

  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
    return () => {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-[-18rem] h-[34rem] bg-[radial-gradient(circle_at_top,rgba(97,210,255,0.18),transparent_48%),radial-gradient(circle_at_30%_25%,rgba(255,122,89,0.16),transparent_28%),radial-gradient(circle_at_72%_18%,rgba(84,109,255,0.22),transparent_30%)]" />
        <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:72px_72px]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(2,6,23,0.48)_35%,rgba(2,6,23,0.9))]" />
      </div>

      <div className="relative flex min-h-screen flex-col">
        <Header />
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
