import { useState } from 'react';
import { X } from 'lucide-react';
import type { AvailableModels, ModelSpec } from '../../services/api';
import { cn } from '../../lib/utils';

const PROVIDER_ACCENT: Record<string, string> = {
  openai: 'text-emerald-300',
  anthropic: 'text-orange-300',
  gemini: 'text-blue-300',
  groq: 'text-fuchsia-300',
  mistral: 'text-amber-300',
  cohere: 'text-teal-300',
  togetherai: 'text-pink-300',
  local: 'text-slate-200',
  ollama: 'text-indigo-300',
  mock: 'text-zinc-300',
};

interface ProviderEntry {
  id: string;
  models: string[];
  configured: boolean;
}

function buildProviders(availableModels: AvailableModels): ProviderEntry[] {
  const entries: ProviderEntry[] = availableModels.apiProviders.map((p) => ({
    id: p.provider,
    models: p.models.length > 0 ? p.models : [p.defaultModel],
    configured: p.configured,
  }));
  if (availableModels.ollamaModels.length > 0) {
    entries.push({ id: 'ollama', models: availableModels.ollamaModels.map((m) => m.id), configured: true });
  }
  if (availableModels.localModels.length > 0) {
    entries.push({ id: 'local', models: availableModels.localModels.map((m) => m.id), configured: true });
  }
  return entries;
}

export function ModelSelector({
  availableModels,
  selectedModels,
  onChange,
  singleSelect = false,
}: {
  availableModels: AvailableModels;
  selectedModels: ModelSpec[];
  onChange: (models: ModelSpec[]) => void;
  singleSelect?: boolean;
}) {
  const providers = buildProviders(availableModels);

  const initProvider =
    singleSelect && selectedModels.length > 0
      ? selectedModels[0].provider
      : providers[0]?.id ?? '';

  const initProviderEntry = providers.find((p) => p.id === initProvider);
  const initModel =
    singleSelect && selectedModels.length > 0 && selectedModels[0].provider === initProvider
      ? selectedModels[0].modelId
      : initProviderEntry?.models[0] ?? '';

  const [activeProvider, setActiveProvider] = useState(initProvider);
  const [activeModel, setActiveModel] = useState(initModel);

  const currentEntry = providers.find((p) => p.id === activeProvider);
  const isConfigured = currentEntry?.configured ?? false;

  function handleProviderChange(provider: string) {
    const entry = providers.find((p) => p.id === provider);
    const firstModel = entry?.models[0] ?? '';
    setActiveProvider(provider);
    setActiveModel(firstModel);
    if (singleSelect && entry?.configured && firstModel) {
      onChange([{ provider, modelId: firstModel }]);
    }
  }

  function handleModelChange(modelId: string) {
    setActiveModel(modelId);
    if (singleSelect && isConfigured) {
      onChange([{ provider: activeProvider, modelId }]);
    }
  }

  function handleAdd() {
    if (!activeProvider || !activeModel || !isConfigured) return;
    const exists = selectedModels.some(
      (m) => m.provider === activeProvider && m.modelId === activeModel
    );
    if (exists) return;
    onChange([...selectedModels, { provider: activeProvider, modelId: activeModel }]);
  }

  function handleRemove(provider: string, modelId: string) {
    onChange(selectedModels.filter((m) => !(m.provider === provider && m.modelId === modelId)));
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select
          value={activeProvider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100 outline-none"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}{!p.configured ? ' (no key)' : ''}
            </option>
          ))}
        </select>
        <select
          value={activeModel}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={!isConfigured}
          className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100 outline-none disabled:opacity-50"
        >
          {currentEntry?.models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        {!singleSelect && (
          <button
            type="button"
            onClick={handleAdd}
            disabled={!isConfigured || !activeModel}
            className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-slate-200 hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            Add
          </button>
        )}
      </div>

      {!isConfigured && (
        <p className="text-xs text-amber-300/80">No API key configured for {activeProvider}.</p>
      )}

      {singleSelect && selectedModels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span
            className={cn(
              'rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium',
              PROVIDER_ACCENT[selectedModels[0].provider] ?? 'text-slate-200'
            )}
          >
            {selectedModels[0].provider} / {selectedModels[0].modelId}
          </span>
        </div>
      )}

      {!singleSelect && selectedModels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedModels.map((m) => (
            <span
              key={`${m.provider}/${m.modelId}`}
              className={cn(
                'flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium',
                PROVIDER_ACCENT[m.provider] ?? 'text-slate-200'
              )}
            >
              {m.provider} / {m.modelId}
              <button
                type="button"
                onClick={() => handleRemove(m.provider, m.modelId)}
                className="ml-0.5 text-slate-400 hover:text-slate-100 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
