# Auto Research for Evals PRD

This document defines a product feature for running prompt-improvement loops inside Eval Atlas using the research pattern from [karpathy/autoresearch](https://github.com/karpathy/autoresearch).

## Summary

Karpathy's `autoresearch` pattern is:

- keep evaluation harness fixed
- let agent mutate one research surface
- run short experiments in a loop
- keep improvements, discard regressions
- steer agent through a human-authored `program.md`

Eval Atlas can apply same pattern to prompt optimization instead of model-training optimization.

For any eval run, user should be able to enable `Auto Research`. Eval Atlas then:

1. treats eval set, scorer, model target, and run budget as fixed harness
2. treats prompt package as mutable research surface
3. lets a research model propose prompt variants
4. runs variants against eval
5. keeps best prompt by measured score
6. stores full trial log and final prompt

Feature must support both:

- hosted prompt research and hosted eval models
- local prompt research and local eval models
- mixed mode, where research model and eval target model use different providers

Phase 1 should optimize the run `systemPrompt`, because that already exists in Eval Atlas today. Later phases may optimize richer prompt packages, such as response-format instructions and task wrappers.

---

## Reference Pattern from `karpathy/autoresearch`

From `karpathy/autoresearch`:

- human edits `program.md`
- agent edits one mutable file
- fixed harness measures one ground-truth metric
- every trial is keep/discard based on metric
- loop runs autonomously until budget or manual stop

Mapping to Eval Atlas:

| `autoresearch` | Eval Atlas equivalent |
|---|---|
| `program.md` | prompt research spec authored by user or default template |
| mutable `train.py` | mutable `systemPrompt` candidate |
| fixed `prepare.py` evaluation | fixed eval set + scorer + target model config |
| `val_bpb` | eval score, usually accuracy |
| overnight loop | bounded prompt-optimization loop before or around eval run |

Core product principle: prompt research must not mutate eval answers, scoring rules, or source eval rows during a research run. Only prompt candidate changes.

---

## Problem

Eval Atlas already runs evals across hosted and local models, but prompt iteration still happens outside product:

- user manually rewrites prompt
- user reruns same eval repeatedly
- no systematic keep/discard loop
- no experiment log for why prompt improved
- no built-in path for local prompt research

This creates three gaps:

1. Prompt quality is often as important as model choice, but Eval Atlas only evaluates current prompt state.
2. Teams cannot reproduce prompt iteration history.
3. Users running local models through `AGENT_URL` or `OLLAMA_URL` have no first-class research workflow, even though local prompt iteration is often cheap and privacy-preserving.

---

## Goals

- Make prompt optimization available on every eval run.
- Reuse Karpathy-style autonomous experiment loop for prompt variants.
- Keep evaluation harness fixed during research.
- Support hosted models, local models, and mixed research/eval combinations.
- Persist baseline prompt, candidate prompts, scores, and final promoted prompt.
- Expose enough provenance that users can trust or reject optimized prompts.

## Non-Goals

- Training or fine-tuning models.
- Letting research loop rewrite eval answers or scoring rules.
- Replacing normal one-shot eval runs.
- Building a general agent framework beyond prompt research in Phase 1.
- Automatically mutating authored eval set rows during a prompt research run.

---

## User Stories

1. As a user, I can run an eval exactly as today, or enable `Auto Research` before launch.
2. As a user, I can choose a research model that improves prompt candidates for one or more selected eval target models.
3. As a user, I can run prompt research entirely on local infrastructure.
4. As a user, I can use a hosted research model to improve prompts for a local target model, or vice versa.
5. As a user, I can compare baseline prompt vs best prompt with measured metrics and trial history.
6. As a user, I can save optimized prompt back into an eval set or reuse it on future runs.

---

## Proposed UX

### Entry Point

Add `Auto Research` controls to [frontend/src/pages/EvalsDashboard.tsx](../frontend/src/pages/EvalsDashboard.tsx) run form.

Current run creation already gathers:

- eval file or saved eval set
- `systemPrompt`
- selected models
- max tokens

Extend with:

- `Enable Auto Research`
- `Research model`
- `Research budget`
- `Optimization target`
- `Candidate strategy`
- `Use holdout verification`

### Run Modes

User can choose:

- `Standard run`
- `Run with Auto Research`

If `Run with Auto Research` is enabled, Eval Atlas should create:

1. baseline trial using current `systemPrompt`
2. iterative candidate trials
3. final promoted run with best prompt

### Research Configuration

Suggested fields:

| Field | Type | Notes |
|---|---|---|
| `researchModel` | provider/model pair | may be hosted, `local`, or `ollama` |
| `targetModels` | existing `modelsConfig` | one or more eval targets |
| `budgetMode` | `iterations` or `timebox` | simple first implementation: iterations |
| `maxIterations` | integer | e.g. 5, 10, 20 |
| `candidateCountPerIteration` | integer | e.g. 1-3 |
| `optimizationMetric` | enum | default `accuracy` |
| `sampleSize` | integer or `full` | smaller sample for cheap search, optional |
| `holdoutEnabled` | boolean | default `true` — protect against overfitting; opt-out not opt-in |
| ~~`allowModelSpecificPrompts`~~ | ~~boolean~~ | **Removed from Phase 1.** Phase 1 supports exactly one target model. Per-model prompt branching deferred to Phase 2. |
| `maxTokenBudget` | integer or null | hard cap on total tokens consumed across all trials; required for hosted research |
| `researchModelTemperature` | float | temperature for candidate generation; must be fixed per research run for reproducibility |
| `targetModelSeed` | integer or null | seed for target model calls where provider supports it; needed for score reproducibility |

### Research Results UI

Add result surface in [frontend/src/pages/EvalResults.tsx](../frontend/src/pages/EvalResults.tsx):

- baseline score
- best score
- delta
- best prompt
- trial table
- promote / save prompt action

Each trial row should show:

- trial number
- prompt summary
- target model scope
- score
- latency
- token usage
- status: `keep`, `discard`, `crash`

---

## Product Behavior

### What Gets Optimized

Phase 1 mutable artifact:

- run-level `systemPrompt`

Phase 2 optional mutable artifacts:

- per-model prompt wrapper
- answer-format instructions
- few-shot exemplars derived from approved eval rows

Phase 1 constraint: mutable output must still collapse to plain prompt text so existing adapters in [backend/src/evals/runner.ts](../backend/src/evals/runner.ts) can execute with minimal shape changes.

### What Stays Fixed

During one research session, these must remain immutable:

- eval items
- `correct_answer`
- `match_type`
- scorer behavior
- target model list, unless user explicitly changes scope
- `maxTokens`, unless user explicitly allows response-budget optimization in later phase

This is direct equivalent of `prepare.py` being fixed in `autoresearch`.

### Improvement Rule

Default keep/discard rule:

- keep candidate if primary metric improves
- if tied, prefer lower latency
- if still tied, prefer lower token usage
- if still tied, prefer simpler prompt

Prompt simplicity matters for same reason Karpathy's loop values simpler code. Small gain with bloated prompt should not always win.

**Resolved: Score noise.** Keep candidate only if improvement exceeds a confidence interval. Baseline must be evaluated with enough samples to establish a reliable score distribution. Candidate score must fall outside baseline confidence interval before "keep" is applied. This prevents chasing variance on small eval sets.

**Resolved: "Simpler prompt".** Tie-breaker uses token count. Lower token count wins when accuracy and latency are tied. Enforced consistently across all tie-breaker comparisons.

**Resolved: Tie-breaker ordering.** Accuracy is primary. Latency is secondary. Token count is tertiary. Token preference does not override accuracy. Verbose prompts that score higher always win over shorter prompts that score lower.

---

## Functional Requirements

### 1. Every Eval Run Supports Prompt Research

Any run created through `POST /api/evals/runs` should be able to include optional `autoResearch` config.

If omitted, behavior stays unchanged.

If present, backend performs research loop before marking final run complete.

### 2. Research Model Can Differ from Eval Target Model

Research model proposes prompt candidates.

Eval target model executes candidate prompt and gets scored.

Supported combinations:

- hosted research -> hosted target
- hosted research -> local target
- local research -> local target
- local research -> hosted target

This matters because strongest reasoning model may be hosted, while target deployment model may be local.

### 3. Local Model Support

Local prompt research must work with existing local surfaces already exposed in `GET /api/evals/models`:

- `local` via `AGENT_URL`
- `ollama` via `OLLAMA_URL`

Behavior notes:

- local eval execution should stay sequential, matching current runner behavior for `local` and `ollama`
- research budgets should default lower for local mode because wall-clock cost is higher
- UI should warn that local research may take longer because each candidate requires full eval execution

### 4. Hosted Model Support

Hosted prompt research uses existing provider families already present in Eval Atlas:

- OpenAI
- Anthropic
- Gemini
- Groq
- Mistral
- Cohere
- Together AI

Hosted evaluation can reuse current parallel run behavior for non-local models in [backend/src/evals/runner.ts](../backend/src/evals/runner.ts).

### 5. Trial Logging

Each prompt trial must persist:

- parent research run id
- trial id
- iteration number
- candidate prompt text
- research model used
- target models evaluated
- score summary
- latency summary
- token summary
- status
- rationale or mutation summary

### 6. Final Promotion

At end of research, user should be able to:

- keep baseline prompt
- promote best prompt for this run only
- save best prompt back to eval set default prompt
- duplicate best prompt into a new reusable preset later

---

## Research Loop Design

### Baseline

First trial is always baseline, same as `autoresearch` first run.

Eval Atlas runs selected eval target models using current `systemPrompt` and records:

- overall accuracy
- per-category accuracy
- runtime errors
- latency
- token usage

### Iteration Loop

Loop:

1. Gather failure cases from baseline or current best trial.
2. Build research context:
   - current best prompt
   - failed questions
   - representative correct and incorrect outputs
   - optimization metric
   - prompt research spec
3. Ask research model for one or more revised prompt candidates.
4. Run candidates against eval sample or full eval.
5. Score candidates.
6. Keep best candidate if metric improves.
7. Repeat until iteration or time budget expires.

**Resolved: Early stopping.** Stop after K consecutive iterations without improvement. K is configurable per research run, default `10`. Iteration cap and early-stop both apply; whichever triggers first halts the loop.

**Resolved: Prompt injection surface.** Use explicit user disclosure. Before research run starts, display a disclosure that eval row content (questions, answers, model outputs) will be sent to the research model. User must acknowledge. Additionally, eval row content injected into research context must be clearly delimited (e.g., wrapped in XML-style tags) so research model can distinguish eval data from instructions. Research model output must be validated as plain text before use as a prompt candidate.

**Resolved: Research model failure handling.** On malformed or refused output, retry the research model once with the same context. If retry also fails, mark that iteration as `crash` and continue to next iteration. Do not abort the full research run on a single model failure. Log failure reason in `mutation_summary`.

**Resolved: Trial cancellation and atomicity.** Research runs are resumable. On user stop: baseline is always preserved. Any in-progress trial at stop time is marked `crash` and persisted with whatever partial data was recorded. On resume, loop continues from the next iteration using the current best prompt. Resumed runs share the same `research_run_id` and append new trials to the existing trial log.

### Prompt Research Spec

Karpathy uses `program.md`. Eval Atlas should use same concept, but store it as text on research run.

Example sections:

- goal
- target audience / task framing
- output format rules
- constraints
- mutation guidance
- keep/discard logic

System should ship a default spec, but user can override it.

### Candidate Generation Strategy

Phase 1 strategies:

- `single-best-next`: one revised prompt each iteration
- `beam-small`: generate 2-3 candidates, keep best

Default should be `beam-small` for hosted research, `single-best-next` for local research.

**Note:** `error-focused` strategy (mutate only prompt sections tied to failed categories) requires structured prompt representation and is deferred to Phase 3. It is not a Phase 1 strategy. Including it in Phase 1 contradicts the plain-text `systemPrompt` constraint.

### Verification Against Overfitting

Prompt research can overfit small eval sets. To reduce this risk:

- split eval set into search and holdout partitions (default: enabled, opt-out not opt-in)
- use search partition for candidate loop
- require final best prompt to beat baseline on holdout before promotion

If holdout fails, UI must mark prompt as `unverified improvement`.

**Resolved: Holdout reuse across sessions.** Use holdout burn tracking. Each time an eval set's holdout partition is evaluated in a research run, that burn is recorded on the eval set. UI surfaces burn count to user before subsequent research runs on the same eval set. User sees: "This holdout partition has been evaluated N times. Results may be less reliable." User must explicitly acknowledge before proceeding. No automatic blocking — burn count is informational, user decides.

---

## Metrics

Primary metric:

- `accuracy`

Secondary metrics:

- per-category accuracy
- runtime error rate
- latency
- token usage

Optional future composite metric:

`score = accuracy - latency_penalty - token_penalty - error_penalty`

Phase 1 should keep scoring easy to understand. Default winner logic should stay transparent.

---

## Data Model

Current run storage already captures:

- run metadata
- `system_prompt`
- eval set snapshot
- model config
- per-question results

Feature needs new research entities.

### Suggested Tables

#### `prompt_research_runs`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `eval_run_id` | UUID NULL | final promoted run, if one exists |
| `source_eval_set_id` | UUID NULL | optional link to saved eval set |
| `base_prompt` | TEXT NOT NULL | prompt before optimization |
| `best_prompt` | TEXT NULL | winning prompt |
| `research_spec` | TEXT NOT NULL | `program.md` equivalent |
| `research_model_provider` | TEXT NOT NULL | |
| `research_model_id` | TEXT NOT NULL | |
| `target_models_config` | JSONB NOT NULL | frozen target models |
| `optimization_metric` | TEXT NOT NULL | default `accuracy` |
| `status` | TEXT NOT NULL | `queued`, `running`, `completed`, `failed`, `stopped` |
| `storage_mode` | TEXT NOT NULL | `database` or `memory`; use `database` when DB is available at run start. If DB becomes unavailable mid-run, surface an error to the user — do not silently switch to memory. If a research run was persisted to DB and DB is later unavailable on resume, block resume and show error rather than continuing with incomplete state. |
| `created_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ NULL | |

#### `prompt_research_trials`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `research_run_id` | UUID FK | |
| `iteration` | INTEGER NOT NULL | baseline is 0 |
| `candidate_prompt` | TEXT NOT NULL | |
| `mutation_summary` | TEXT NULL | short rationale |
| `status` | TEXT NOT NULL | `keep`, `discard`, `crash` |
| `overall_accuracy` | NUMERIC NULL | |
| `latency_ms_avg` | NUMERIC NULL | |
| `tokens_used_total` | INTEGER NULL | |
| `runtime_error_count` | INTEGER NULL | |
| `target_run_snapshot` | JSONB NOT NULL | summary needed for UI |
| `created_at` | TIMESTAMPTZ | |

Memory fallback should mirror same API shape in [backend/src/evals/fallbackStore.ts](../backend/src/evals/fallbackStore.ts), even if data is lost on restart.

---

## API Design

Two viable designs.

### Option A: Extend Existing Run API

Extend `POST /api/evals/runs` request payload with:

```json
{
  "systemPrompt": "base prompt",
  "modelsConfig": [{ "provider": "openai", "modelId": "gpt-4o" }],
  "autoResearch": {
    "enabled": true,
    "researchModel": { "provider": "openai", "modelId": "gpt-4o-mini" },
    "maxIterations": 5,
    "candidateCountPerIteration": 2,
    "optimizationMetric": "accuracy",
    "holdoutEnabled": true
  }
}
```

Pros:

- minimal new UX entry point
- eval run remains primary workflow

Cons:

- response lifecycle becomes more complex
- one run id now covers baseline, trials, and promoted final state

### Option B: Add Dedicated Research API

Add:

- `POST /api/evals/prompt-research`
- `GET /api/evals/prompt-research/:id`
- `GET /api/evals/prompt-research/:id/stream`
- `POST /api/evals/prompt-research/:id/promote`

**Resolved: SSE payload spec for `/stream`.** Required event types and payload schemas:

```ts
// trial_started
{ event: "trial_started", data: { researchRunId: string, trialId: string, iteration: number, candidatePrompt: string } }

// trial_completed
{ event: "trial_completed", data: { researchRunId: string, trialId: string, iteration: number, status: "keep" | "discard" | "crash", overallAccuracy: number | null, latencyMsAvg: number | null, tokensUsedTotal: number | null, mutationSummary: string | null } }

// research_completed
{ event: "research_completed", data: { researchRunId: string, bestTrialId: string | null, bestPrompt: string | null, baselineAccuracy: number, bestAccuracy: number | null, delta: number | null, totalTrials: number, stoppedReason: "budget" | "early_stop" | "user_stop" | "error" } }

// error
{ event: "error", data: { researchRunId: string, trialId: string | null, code: string, message: string, retryable: boolean } }
```

Pros:

- cleaner separation
- easier trial-specific SSE events
- easier to rerun or stop research without rerunning final eval

Cons:

- more UI branching

**Decision: Option B.** Dedicated prompt research API with one-click entry from the run form. Option A rejected — single run id covering baseline, trials, and final state makes lifecycle too complex.

---

## Architecture Notes

### Backend

Likely touch points:

- [backend/src/routes/evals.ts](../backend/src/routes/evals.ts)
- [backend/src/evals/runner.ts](../backend/src/evals/runner.ts)
- [backend/src/evals/scorer.ts](../backend/src/evals/scorer.ts)
- [backend/src/evals/fallbackStore.ts](../backend/src/evals/fallbackStore.ts)
- [backend/src/shared/evalTypes.ts](../backend/src/shared/evalTypes.ts)

Recommended separation:

- keep `runner.ts` focused on executing evals for one prompt
- add `promptResearchRunner.ts` to orchestrate loop
- add `promptResearchSchema.ts` for request validation
- add storage helpers for prompt research runs/trials

### Frontend

Likely touch points:

- [frontend/src/pages/EvalsDashboard.tsx](../frontend/src/pages/EvalsDashboard.tsx)
- [frontend/src/pages/EvalResults.tsx](../frontend/src/pages/EvalResults.tsx)
- [frontend/src/services/api.ts](../frontend/src/services/api.ts)

Possible new route later:

- `/evals/research/:id`

Phase 1 can also embed research status inside existing results page if route count should stay low.

---

## Local vs Hosted Implementation

### Hosted Prompt Research

Flow:

1. User picks hosted research model.
2. Backend sends research context to hosted provider.
3. Candidate prompts returned.
4. Existing hosted eval adapters run candidate prompts against target models.
5. Best candidate promoted.

Best for:

- faster iteration
- stronger reasoning models
- multi-candidate beam search

Tradeoff:

- API cost
- prompt contents leave local environment

### Local Prompt Research

Flow:

1. User picks `local` or `ollama` research model.
2. Backend sends same research context through local adapter path.
3. Candidate prompts returned from local model.
4. Candidate prompts evaluated against local or hosted targets.

Best for:

- private datasets
- zero or low marginal token cost
- offline or self-hosted workflows

Tradeoff:

- slower research loop
- weaker local model may produce lower-quality prompt mutations

### Mixed Mode

Most important mixed modes:

- hosted researcher -> local target
- local researcher -> hosted target

First one likely strongest practical default. It lets user improve prompt for private deployment target without forcing target model off local infra.

---

## Guardrails

- Never mutate source eval set during prompt research run.
- Never rewrite `correct_answer`, `choices`, or scoring rules.
- Always record baseline before candidate loop.
- Cap loop by explicit iteration or time budget.
- Enforce `maxTokenBudget` hard cap on all hosted research runs. When cap is hit, abort the current research run immediately, surface a cost warning to the user, and allow the user to retry with a higher budget or promote the current best prompt. Do not continue trials after cap is exceeded.
- Mark crashes and runtime failures separately from wrong answers.
- Store exact winning prompt text used for final score.
- Surface local/hosted privacy boundary clearly in UI.
- **Privacy (required, not optional):** When a hosted research model is selected and eval set contains user-authored questions or answers, display explicit consent gate before research run starts. Consent must be confirmed per-run. This is not an open question — it is a required guardrail.
- **Injection defense:** Eval row content injected into research model context must be clearly delimited or sanitized. Research model output must be validated as plain text before use as a prompt candidate.

---

## Rollout Plan

### Phase 1

- optimize `systemPrompt` only
- one research run for one target model at a time
- dedicated prompt research API
- trial log + best prompt promotion
- support hosted + local research models

### Phase 2

- multi-model optimization objective
- holdout split UI
- prompt presets
- save back to eval set default prompt
- richer candidate mutation strategies

### Phase 3

- optimize structured prompt package, not only plain system prompt
- category-specific prompt branches
- scheduled prompt research on saved eval sets

---

## Success Metrics

- percentage of eval runs using `Auto Research`
- median accuracy improvement vs baseline
- percentage of research runs that beat baseline
- time to best prompt
- prompt promotion rate
- local mode usage vs hosted mode usage

---

## Open Questions

All Phase 1 blockers resolved. Summary of decisions:

1. **[Resolved]** `allowModelSpecificPrompts` removed from Phase 1. Phase 1 = one target model. Multi-model deferred to Phase 2.
2. **[Resolved]** Promoted prompt saves to run data only. Save-to-eval-set deferred to Phase 2.
3. **[Resolved]** Privacy consent gate required before any hosted research run that sees eval data. Implemented as mandatory pre-run disclosure in Guardrails.
4. **[Resolved]** Sample-based search required for large eval sets. Backend must enforce sampling when eval set exceeds a configurable row threshold. Default threshold TBD at implementation.
5. **[Resolved]** Score noise → confidence interval. Keep candidate only if improvement falls outside baseline confidence interval.
6. **[Resolved]** Simpler prompt → token count. Lower tokens wins tie.
7. **[Resolved]** Early-stop → K=10 consecutive non-improving iterations, configurable.
8. **[Resolved]** Research model failure → retry once, then mark iteration `crash`, continue loop.
9. **[Resolved]** Trial cancellation → resumable. Partial trial = `crash`. Baseline always preserved.
10. **[Resolved]** SSE event types and payload schemas defined — see Option B section above.
11. **[Resolved]** `maxTokenBudget` → abort run, surface warning, allow user retry with higher budget or promote current best.

---

## Recommendation

Build prompt research as first-class eval workflow in Eval Atlas, using Karpathy's autoresearch loop as design template:

- fixed eval harness
- mutable prompt surface
- autonomous keep/discard experiment loop
- strong provenance
- local and hosted execution paths

This is high-leverage because Eval Atlas already has:

- canonical eval schema
- scoring
- run persistence
- provider abstraction
- local + hosted model support

Feature should start narrow: optimize `systemPrompt`, log every trial, preserve baseline, and support mixed hosted/local research from day one.
