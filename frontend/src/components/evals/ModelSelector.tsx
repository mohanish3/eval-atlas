import { Check, Cloud, Cpu, Zap } from 'lucide-react';
import type { AvailableModels, ModelSpec } from '../../services/api';
import { cn } from '../../lib/utils';

const PROVIDER_META: Record<string, { icon: typeof Cloud; accent: string; dot: string }> = {
  openai: { icon: Cloud, accent: 'text-emerald-300', dot: 'bg-emerald-400' },
  anthropic: { icon: Cloud, accent: 'text-orange-300', dot: 'bg-orange-400' },
  gemini: { icon: Cloud, accent: 'text-blue-300', dot: 'bg-blue-400' },
  groq: { icon: Zap, accent: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
  mistral: { icon: Cloud, accent: 'text-amber-300', dot: 'bg-amber-400' },
  cohere: { icon: Cloud, accent: 'text-teal-300', dot: 'bg-teal-400' },
  togetherai: { icon: Cloud, accent: 'text-pink-300', dot: 'bg-pink-400' },
  local: { icon: Cpu, accent: 'text-slate-200', dot: 'bg-slate-300' },
  ollama: { icon: Cpu, accent: 'text-indigo-300', dot: 'bg-indigo-400' },
  mock: { icon: Cloud, accent: 'text-zinc-300', dot: 'bg-zinc-400' },
};

function ProviderCard({
  provider,
  selected,
  disabled,
  modelId,
  models,
  onToggle,
  onChange,
}: {
  provider: string;
  selected: boolean;
  disabled?: boolean;
  modelId: string;
  models: string[];
  onToggle: () => void;
  onChange: (next: string) => void;
}) {
  const meta = PROVIDER_META[provider] ?? PROVIDER_META.mock;
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        'rounded-2xl border p-3 transition-all',
        selected ? 'border-cyan-300/30 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.12)]' : 'border-white/10 bg-white/[0.03]',
        disabled && 'opacity-45',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full items-center gap-2 text-left disabled:cursor-not-allowed"
      >
        <Icon className={cn('h-4 w-4', meta.accent)} />
        <span className={cn('flex-1 font-medium capitalize', meta.accent)}>{provider}</span>
        {disabled && <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">no key</span>}
        {selected && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-300 text-slate-950">
            <Check className="h-3 w-3" />
          </span>
        )}
      </button>
      <select
        value={modelId}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-3 h-9 w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 text-xs text-slate-100 outline-none"
      >
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ModelSelector({
  availableModels,
  selectedModels,
  onChange,
}: {
  availableModels: AvailableModels;
  selectedModels: ModelSpec[];
  onChange: (models: ModelSpec[]) => void;
}) {
  const perProviderModel = Object.fromEntries(selectedModels.map((model) => [model.provider, model.modelId]));

  function toggleProvider(provider: string, modelId: string) {
    const exists = selectedModels.some((entry) => entry.provider === provider && entry.modelId === modelId);
    if (exists) {
      onChange(selectedModels.filter((entry) => !(entry.provider === provider && entry.modelId === modelId)));
      return;
    }

    if (provider !== 'local' && provider !== 'ollama') {
      onChange([
        ...selectedModels.filter((entry) => entry.provider !== provider),
        { provider, modelId },
      ]);
      return;
    }

    onChange([...selectedModels, { provider, modelId }]);
  }

  function changeProviderModel(provider: string, modelId: string) {
    const existing = selectedModels.some((entry) => entry.provider === provider);
    if (!existing) {
      return;
    }
    onChange(selectedModels.map((entry) => (entry.provider === provider ? { ...entry, modelId } : entry)));
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Cloud APIs</p>
        <div className="grid gap-3">
          {availableModels.apiProviders.map((provider) => {
            const currentModel = perProviderModel[provider.provider] ?? provider.defaultModel;
            const selected = selectedModels.some((entry) => entry.provider === provider.provider);
            return (
              <ProviderCard
                key={provider.provider}
                provider={provider.provider}
                selected={selected}
                disabled={!provider.configured}
                modelId={currentModel}
                models={provider.models ?? [provider.defaultModel]}
                onToggle={() => toggleProvider(provider.provider, currentModel)}
                onChange={(next) => changeProviderModel(provider.provider, next)}
              />
            );
          })}
        </div>
      </div>

      {availableModels.ollamaModels.length > 0 && (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Ollama</p>
          <div className="grid gap-3">
            {availableModels.ollamaModels.map((model) => {
              const selected = selectedModels.some((entry) => entry.provider === 'ollama' && entry.modelId === model.id);
              return (
                <ProviderCard
                  key={model.id}
                  provider="ollama"
                  selected={selected}
                  modelId={model.id}
                  models={[model.id]}
                  onToggle={() => toggleProvider('ollama', model.id)}
                  onChange={() => undefined}
                />
              );
            })}
          </div>
        </div>
      )}

      {availableModels.localModels.length > 0 && (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Local agent models</p>
          <div className="grid gap-3">
            {availableModels.localModels.map((model) => {
              const selected = selectedModels.some((entry) => entry.provider === 'local' && entry.modelId === model.id);
              return (
                <ProviderCard
                  key={model.id}
                  provider="local"
                  selected={selected}
                  modelId={model.id}
                  models={[model.id]}
                  onToggle={() => toggleProvider('local', model.id)}
                  onChange={() => undefined}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
