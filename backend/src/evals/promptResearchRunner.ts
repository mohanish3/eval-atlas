import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { scoreAnswer } from './scorer.js';
import { broadcast, cleanup } from './sseManager.js';
import { saveResearchTrial, updateResearchRunStatus } from './promptResearchStore.js';
import { openaiAdapter } from './adapters/openai.js';
import { anthropicAdapter } from './adapters/anthropic.js';
import { geminiAdapter } from './adapters/gemini.js';
import { groqAdapter } from './adapters/groq.js';
import { mistralAdapter } from './adapters/mistral.js';
import { cohereAdapter } from './adapters/cohere.js';
import { togetherAdapter } from './adapters/togetherai.js';
import { localAdapter } from './adapters/local.js';
import { ollamaAdapter } from './adapters/ollama.js';
import { mockAdapter } from './adapters/mock.js';
import { isHostedProvider } from './researchBudget.js';
import type { EvalItem, ModelSpec, StorageMode, TrialStatus } from '../shared/evalTypes.js';
import type { ModelAdapter } from './adapters/types.js';

interface TrialResult {
  accuracy: number;
  correctCount: number;
  totalCount: number;
  avgLatencyMs: number;
  totalTokens: number;
  errorCount: number;
  failedItems: Array<{ item: EvalItem; modelOutput: string | null }>;
}

export interface ResearchRunConfig {
  researchRunId: string;
  evalItems: EvalItem[];
  basePrompt: string;
  targetModel: ModelSpec;
  researchModelProvider: string;
  researchModelId: string;
  maxIterations: number;
  candidateCountPerIteration: number;
  holdoutEnabled: boolean;
  earlyStopK: number;
  maxTokens: number;
  maxTokenBudget: number | null;
  researchSpec: string;
  storageMode: StorageMode;
}

const RESEARCH_CALL_TOKEN_ESTIMATE = 3_000;

function getAdapter(model: ModelSpec): ModelAdapter {
  switch (model.provider) {
    case 'openai': return openaiAdapter;
    case 'anthropic': return anthropicAdapter;
    case 'gemini': return geminiAdapter;
    case 'groq': return groqAdapter;
    case 'mistral': return mistralAdapter;
    case 'cohere': return cohereAdapter;
    case 'togetherai': return togetherAdapter;
    case 'local': return localAdapter;
    case 'ollama': return ollamaAdapter;
    case 'mock': return mockAdapter;
    default: throw new Error(`Unknown provider: ${(model as { provider: string }).provider}`);
  }
}

async function runTrialEval(
  evalItems: EvalItem[],
  systemPrompt: string,
  targetModel: ModelSpec,
  maxTokens: number
): Promise<TrialResult> {
  const adapter = getAdapter(targetModel);
  const results: Array<{
    correct: boolean;
    latencyMs: number;
    tokens: number;
    output: string | null;
    item: EvalItem;
  }> = [];

  for (const item of evalItems) {
    try {
      const response = await adapter(targetModel.modelId, {
        systemPrompt,
        question: item.question,
        choices: item.choices,
        maxTokens,
      });
      const isCorrect = scoreAnswer(item, response.rawOutput);
      results.push({ correct: isCorrect, latencyMs: response.latencyMs, tokens: response.tokensUsed, output: response.rawOutput, item });
    } catch {
      results.push({ correct: false, latencyMs: 0, tokens: 0, output: null, item });
    }
  }

  const correctCount = results.filter((r) => r.correct).length;
  const totalCount = results.length;
  const avgLatencyMs = results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, totalCount);
  const totalTokens = results.reduce((s, r) => s + r.tokens, 0);
  const errorCount = results.filter((r) => r.output === null).length;
  const failedItems = results.filter((r) => !r.correct).map((r) => ({ item: r.item, modelOutput: r.output }));

  return { accuracy: totalCount > 0 ? correctCount / totalCount : 0, correctCount, totalCount, avgLatencyMs, totalTokens, errorCount, failedItems };
}

function parseCandidatePrompts(text: string, expectedCount: number): string[] {
  const candidates: string[] = [];
  for (let i = 1; i <= expectedCount; i++) {
    const match = text.match(new RegExp(`<prompt_${i}>([\\s\\S]*?)<\\/prompt_${i}>`));
    if (match) candidates.push(match[1].trim());
  }
  if (candidates.length === 0 && text.trim()) candidates.push(text.trim());
  return candidates;
}

async function callResearchModel(
  currentPrompt: string,
  failedItems: Array<{ item: EvalItem; modelOutput: string | null }>,
  provider: string,
  modelId: string,
  researchSpec: string,
  candidateCount: number
): Promise<{ candidates: string[]; tokensUsed: number }> {
  const failureText = failedItems.slice(0, 10).map((f, i) => [
    `  Failure ${i + 1}:`,
    `  Question: ${f.item.question}`,
    `  Model output: ${f.modelOutput ?? '(error)'}`,
    `  Expected: ${f.item.correct_answer}`,
  ].join('\n')).join('\n\n');

  const tagExamples = Array.from({ length: candidateCount }, (_, i) =>
    `<prompt_${i + 1}>\n[improved prompt here]\n</prompt_${i + 1}>`
  ).join('\n');

  const userMessage = `Current system prompt:
<current_prompt>
${currentPrompt}
</current_prompt>

Task context:
${researchSpec}

The model failed on these questions:
<failures>
${failureText || '  (No failures — prompt may already be optimal)'}
</failures>

Provide exactly ${candidateCount} improved system prompt version(s). Address the failure patterns. Return ONLY XML-wrapped prompts:

${tagExamples}`;

  if (provider === 'openai') {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: 'You are a prompt optimization expert. Improve AI system prompts to maximize task accuracy.' },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2000,
      temperature: 0.7,
    });
    const tokensUsed = res.usage?.total_tokens ?? RESEARCH_CALL_TOKEN_ESTIMATE;
    return {
      candidates: parseCandidatePrompts(res.choices[0]?.message?.content ?? '', candidateCount),
      tokensUsed,
    };
  }

  if (provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: modelId,
      max_tokens: 2000,
      system: 'You are a prompt optimization expert. Improve AI system prompts to maximize task accuracy.',
      messages: [{ role: 'user', content: userMessage }],
    });
    const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    const tokensUsed = res.usage.input_tokens + res.usage.output_tokens;
    return {
      candidates: parseCandidatePrompts(text, candidateCount),
      tokensUsed,
    };
  }

  if (provider === 'mock') {
    // For testing: return prompt variations without calling external API
    const variants = [
      `${currentPrompt}\n\nAnswer concisely. For multiple choice, respond with only the answer letter (A, B, C, or D).`,
      `${currentPrompt}\n\nBe precise and accurate. For multiple choice questions, state only the correct letter.`,
      `You are an expert assistant. ${currentPrompt} Always provide clear, accurate answers.`,
    ];
    return {
      candidates: Array.from({ length: candidateCount }, (_, i) => variants[i % variants.length]),
      tokensUsed: 0,
    };
  }

  // Fallback: minor tweak
  return {
    candidates: [`${currentPrompt}\n\nAnswer accurately and concisely.`],
    tokensUsed: RESEARCH_CALL_TOKEN_ESTIMATE,
  };
}

function splitEvalSet(items: EvalItem[]): { search: EvalItem[]; holdout: EvalItem[] } {
  const holdoutCount = Math.max(1, Math.round(items.length * 0.2));
  return {
    search: items.slice(0, items.length - holdoutCount),
    holdout: items.slice(items.length - holdoutCount),
  };
}

export async function runResearch(config: ResearchRunConfig): Promise<void> {
  const {
    researchRunId,
    evalItems,
    basePrompt,
    targetModel,
    researchModelProvider,
    researchModelId,
    maxIterations,
    candidateCountPerIteration,
    holdoutEnabled,
    earlyStopK,
    maxTokens,
    maxTokenBudget,
    researchSpec,
    storageMode,
  } = config;

  let baselineResult!: TrialResult;
  let tokensConsumed = 0;
  let stoppedReason: 'early_stop' | 'budget' | 'token_budget' = 'budget';

  const overBudget = () => maxTokenBudget != null && tokensConsumed >= maxTokenBudget;

  const recordTokens = (delta: number): boolean => {
    tokensConsumed += delta;
    return overBudget();
  };

  const finishForBudget = async (bestPrompt: string, bestAccuracy: number) => {
    stoppedReason = 'token_budget';
    await updateResearchRunStatus(researchRunId, storageMode, 'stopped', {
      bestPrompt,
      baselineAccuracy: baselineResult.accuracy,
      bestAccuracy,
      completedAt: new Date(),
    });
    broadcast(researchRunId, 'research_completed', {
      researchRunId,
      bestPrompt,
      baselineAccuracy: baselineResult.accuracy,
      bestAccuracy,
      delta: bestAccuracy - baselineResult.accuracy,
      holdoutAccuracy: null,
      stoppedReason,
      tokensConsumed,
      maxTokenBudget,
    });
    cleanup(researchRunId);
  };

  try {
    await updateResearchRunStatus(researchRunId, storageMode, 'running');

    const { search: searchItems, holdout: holdoutItems } = holdoutEnabled
      ? splitEvalSet(evalItems)
      : { search: evalItems, holdout: [] };

    // ─── Baseline (iteration 0) ───────────────────────────────────────────────
    const baselineTrialId = uuidv4();
    broadcast(researchRunId, 'trial_started', {
      researchRunId, trialId: baselineTrialId, iteration: 0, candidatePrompt: basePrompt,
    });

    try {
      baselineResult = await runTrialEval(searchItems, basePrompt, targetModel, maxTokens);
    } catch (err) {
      await updateResearchRunStatus(researchRunId, storageMode, 'failed');
      broadcast(researchRunId, 'error', {
        researchRunId, trialId: null, code: 'BASELINE_FAILED',
        message: err instanceof Error ? err.message : String(err), retryable: false,
      });
      cleanup(researchRunId);
      return;
    }

    const baselineTrial = await saveResearchTrial({
      id: baselineTrialId,
      research_run_id: researchRunId,
      iteration: 0,
      candidate_prompt: basePrompt,
      mutation_summary: 'Baseline — original prompt',
      status: 'keep' as TrialStatus,
      overall_accuracy: baselineResult.accuracy,
      latency_ms_avg: baselineResult.avgLatencyMs,
      tokens_used_total: baselineResult.totalTokens,
      runtime_error_count: baselineResult.errorCount,
      target_run_snapshot: { correctCount: baselineResult.correctCount, totalCount: baselineResult.totalCount },
    }, storageMode);

    broadcast(researchRunId, 'trial_completed', {
      researchRunId, trialId: baselineTrial.id, iteration: 0, status: 'keep',
      overallAccuracy: baselineResult.accuracy, latencyMsAvg: baselineResult.avgLatencyMs,
      tokensUsedTotal: baselineResult.totalTokens, mutationSummary: 'Baseline — original prompt',
    });

    if (recordTokens(baselineResult.totalTokens)) {
      await finishForBudget(basePrompt, baselineResult.accuracy);
      return;
    }

    let bestPrompt = basePrompt;
    let bestAccuracy = baselineResult.accuracy;
    let currentFailedItems = baselineResult.failedItems;
    let consecutiveNoImprove = 0;

    // ─── Iteration loop ───────────────────────────────────────────────────────
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (overBudget()) {
        await finishForBudget(bestPrompt, bestAccuracy);
        return;
      }

      if (consecutiveNoImprove >= earlyStopK) {
        console.log(`[research:${researchRunId}] Early stop at iteration ${iteration}`);
        stoppedReason = 'early_stop';
        break;
      }

      let candidates: string[];
      try {
        const researchResult = await callResearchModel(
          bestPrompt, currentFailedItems, researchModelProvider, researchModelId,
          researchSpec, candidateCountPerIteration
        );
        candidates = researchResult.candidates;
        if (isHostedProvider(researchModelProvider) && recordTokens(researchResult.tokensUsed)) {
          await finishForBudget(bestPrompt, bestAccuracy);
          return;
        }
      } catch (firstErr) {
        try {
          const researchResult = await callResearchModel(
            bestPrompt, currentFailedItems, researchModelProvider, researchModelId,
            researchSpec, candidateCountPerIteration
          );
          candidates = researchResult.candidates;
          if (isHostedProvider(researchModelProvider) && recordTokens(researchResult.tokensUsed)) {
            await finishForBudget(bestPrompt, bestAccuracy);
            return;
          }
        } catch (retryErr) {
          const crashTrial = await saveResearchTrial({
            research_run_id: researchRunId, iteration,
            candidate_prompt: bestPrompt,
            mutation_summary: `Research model failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
            status: 'crash', overall_accuracy: null, latency_ms_avg: null,
            tokens_used_total: null, runtime_error_count: null, target_run_snapshot: {},
          }, storageMode);
          broadcast(researchRunId, 'trial_completed', {
            researchRunId, trialId: crashTrial.id, iteration, status: 'crash',
            overallAccuracy: null, latencyMsAvg: null, tokensUsedTotal: null,
            mutationSummary: crashTrial.mutation_summary,
          });
          consecutiveNoImprove++;
          continue;
        }
      }

      let iterationImproved = false;

      for (const candidatePrompt of candidates) {
        const trialId = uuidv4();
        broadcast(researchRunId, 'trial_started', { researchRunId, trialId, iteration, candidatePrompt });

        let trialResult: TrialResult;
        let trialStatus: TrialStatus;
        let mutationSummary: string;

        try {
          trialResult = await runTrialEval(searchItems, candidatePrompt, targetModel, maxTokens);

          if (trialResult.accuracy > bestAccuracy) {
            trialStatus = 'keep';
            mutationSummary = `Accuracy ${(bestAccuracy * 100).toFixed(1)}% → ${(trialResult.accuracy * 100).toFixed(1)}%`;
            bestPrompt = candidatePrompt;
            bestAccuracy = trialResult.accuracy;
            currentFailedItems = trialResult.failedItems;
            iterationImproved = true;
          } else {
            trialStatus = 'discard';
            mutationSummary = `No improvement (${(trialResult.accuracy * 100).toFixed(1)}% vs best ${(bestAccuracy * 100).toFixed(1)}%)`;
          }
        } catch (err) {
          trialResult = { accuracy: 0, correctCount: 0, totalCount: 0, avgLatencyMs: 0, totalTokens: 0, errorCount: 1, failedItems: [] };
          trialStatus = 'crash';
          mutationSummary = `Eval failed: ${err instanceof Error ? err.message : String(err)}`;
        }

        const savedTrial = await saveResearchTrial({
          id: trialId,
          research_run_id: researchRunId, iteration, candidate_prompt: candidatePrompt,
          mutation_summary: mutationSummary, status: trialStatus,
          overall_accuracy: trialStatus !== 'crash' ? trialResult.accuracy : null,
          latency_ms_avg: trialStatus !== 'crash' ? trialResult.avgLatencyMs : null,
          tokens_used_total: trialStatus !== 'crash' ? trialResult.totalTokens : null,
          runtime_error_count: trialStatus !== 'crash' ? trialResult.errorCount : null,
          target_run_snapshot: trialStatus !== 'crash'
            ? { correctCount: trialResult.correctCount, totalCount: trialResult.totalCount }
            : {},
        }, storageMode);

        broadcast(researchRunId, 'trial_completed', {
          researchRunId, trialId: savedTrial.id, iteration, status: trialStatus,
          overallAccuracy: savedTrial.overall_accuracy, latencyMsAvg: savedTrial.latency_ms_avg,
          tokensUsedTotal: savedTrial.tokens_used_total, mutationSummary,
        });

        if (trialStatus !== 'crash' && recordTokens(trialResult.totalTokens)) {
          await finishForBudget(bestPrompt, bestAccuracy);
          return;
        }
      }

      consecutiveNoImprove = iterationImproved ? 0 : consecutiveNoImprove + 1;
    }

    // ─── Holdout verification ─────────────────────────────────────────────────
    let holdoutAccuracy: number | null = null;
    if (holdoutEnabled && holdoutItems.length > 0 && bestPrompt !== basePrompt && !overBudget()) {
      try {
        const holdoutResult = await runTrialEval(holdoutItems, bestPrompt, targetModel, maxTokens);
        holdoutAccuracy = holdoutResult.accuracy;
        if (recordTokens(holdoutResult.totalTokens)) {
          await finishForBudget(bestPrompt, bestAccuracy);
          return;
        }
      } catch {
        holdoutAccuracy = null;
      }
    }

    await updateResearchRunStatus(researchRunId, storageMode, 'completed', {
      bestPrompt,
      baselineAccuracy: baselineResult.accuracy,
      bestAccuracy,
      completedAt: new Date(),
    });

    broadcast(researchRunId, 'research_completed', {
      researchRunId,
      bestPrompt,
      baselineAccuracy: baselineResult.accuracy,
      bestAccuracy,
      delta: bestAccuracy - baselineResult.accuracy,
      holdoutAccuracy,
      stoppedReason,
      tokensConsumed,
      maxTokenBudget,
    });
  } catch (err) {
    console.error(`[research:${researchRunId}] Fatal error:`, err);
    await updateResearchRunStatus(researchRunId, storageMode, 'failed').catch(() => {});
    broadcast(researchRunId, 'error', {
      researchRunId, trialId: null, code: 'FATAL',
      message: err instanceof Error ? err.message : String(err), retryable: false,
    });
  } finally {
    cleanup(researchRunId);
  }
}
