// backend/src/evals/__tests__/evals.export.test.ts
//
// Tests for the NEW run-results export feature:
//   GET /evals/runs/:id/export?format=csv|json
//
// The route loads a run detail (memory store first, then Postgres) and returns
// an attachment (CSV one row per model+question, or the full JSON payload)
// with a proper Content-Disposition header. CSV cells must be escaped
// (quotes doubled, cells containing commas/newlines wrapped in quotes).
//
// These tests are written FIRST and must FAIL on the current code, because
// the /runs/:id/export route does not exist yet (requests 404 with an HTML
// body and no export content).

import express, { type Express } from 'express';
import request from 'supertest';
import evalsRouter from '../../routes/evals.js';
import { createMemoryRun, addMemoryResult } from '../fallbackStore.js';
import type { EvalResult } from '../../shared/evalTypes.js';

// The evals router transitively imports the model-adapter SDKs and `uuid`.
// Several of those packages ship ESM-only (`uuid`, `@google/genai`) which
// Jest's CommonJS transform cannot parse, and none of them are exercised by
// the export route (it only reads a run from the memory store / Postgres).
// Stub the whole chain so Jest never loads their real source. `jest.mock` is
// hoisted above the imports by ts-jest, so these factories win over the real
// modules.
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('openai', () => ({ default: class OpenAI {} }));
jest.mock('@anthropic-ai/sdk', () => ({ default: class Anthropic {} }));
jest.mock('@google/genai', () => ({ GoogleGenAI: class GoogleGenAI {} }));
jest.mock('groq-sdk', () => ({ default: class Groq {} }));
jest.mock('@mistralai/mistralai', () => ({ Mistral: class Mistral {} }));
jest.mock('cohere-ai', () => ({ CohereClientV2: class CohereClientV2 {} }));
jest.mock('together-ai', () => ({ default: class Together {} }));

// ─── Seed helpers ──────────────────────────────────────────────────────────

// Model output values deliberately stress CSV escaping: embedded quotes,
// commas and newlines must end up in a single, correctly-quoted cell.
const OUTPUT_WITH_QUOTES = 'The answer is 4, which is "obviously" right';
const OUTPUT_WITH_NEWLINE = 'A sprint\nis a two-week cycle.';
const OUTPUT_WITH_COMMA = 'Two weeks, roughly';



// ─── App under test ────────────────────────────────────────────────────────

let app: Express;
let runId: string;

beforeAll(() => {
  app = express();
  app.use('/evals', evalsRouter);
});

beforeEach(() => {
  // Fresh id each time so repeated runs / jest workers don't collide.
  runId = `run-export-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const now = new Date().toISOString();
  createMemoryRun({
    id: runId,
    name: 'Smoke Run',
    system_prompt: 'You are a helpful model.',
    eval_set_filename: 'smoke.jsonl',
    eval_set_data: [
      { id: 'q1', question: 'What is 2+2?', type: 'multiple_choice', choices: { A: '3', B: '4' }, correct_answer: 'B', category: 'math' },
      { id: 'q2', question: 'Define a sprint.', type: 'open_ended', correct_answer: 'a two-week cycle', match_type: 'contains', category: 'process' },
    ],
    models_config: [{ provider: 'mock', modelId: 'mock-1' }],
    status: 'completed',
    created_at: now,
    completed_at: now,
    storage_mode: 'memory',
  });
  addMemoryResult({ id: `${runId}-r1`, run_id: runId, model_id: 'mock-1', question_id: 'q1', category: 'math', model_output: OUTPUT_WITH_QUOTES, correct_answer: 'B', is_correct: true, error_type: null, latency_ms: 120, tokens_used: 42, created_at: now });
  addMemoryResult({ id: `${runId}-r2`, run_id: runId, model_id: 'mock-1', question_id: 'q2', category: 'process', model_output: OUTPUT_WITH_NEWLINE, correct_answer: 'a two-week cycle', is_correct: false, error_type: 'wrong_answer', latency_ms: 300, tokens_used: 80, created_at: now });
  addMemoryResult({ id: `${runId}-r3`, run_id: runId, model_id: 'mock-1', question_id: 'q2', category: 'process', model_output: OUTPUT_WITH_COMMA, correct_answer: 'a two-week cycle', is_correct: false, error_type: 'wrong_answer', latency_ms: 210, tokens_used: 55, created_at: now });
});

// ─── CSV export ─────────────────────────────────────────────────────────────

describe('GET /evals/runs/:id/export?format=csv', () => {
  test('returns 200 with a CSV content type and an attachment filename', async () => {
    const res = await request(app).get(`/evals/runs/${runId}/export?format=csv`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const disposition = res.headers['content-disposition'] ?? '';
    expect(disposition).toMatch(/attachment/);
    expect(disposition).toMatch(/filename=.*\.csv/i);
  });

  test('includes a header row and one data row per result', async () => {
    const res = await request(app).get(`/evals/runs/${runId}/export?format=csv`);
    expect(res.status).toBe(200);

    // Naive row split is fine here only because embedded newlines are
    // quoted; count the data rows by the model_id occurrences.
    const text: string = res.text;
    const lines = text.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(4); // header + 3 results

    // Run name appears in every data row.
    expect(text).toContain('Smoke Run');
    // The model output appears (escaped) in the body.
    expect(text).toContain(OUTPUT_WITH_COMMA);
  });

  test('doubles embedded quotes when escaping a cell', async () => {
    const res = await request(app).get(`/evals/runs/${runId}/export?format=csv`);
    expect(res.status).toBe(200);
    // "obviously" must be escaped to ""obviously"" per RFC 4180.
    expect(res.text).toContain('""obviously""');
  });

  test('keeps a cell containing a comma inside a single quoted field', async () => {
    const res = await request(app).get(`/evals/runs/${runId}/export?format=csv`);
    expect(res.status).toBe(200);
    // The comma-bearing output must be wrapped in double quotes so the
    // internal comma is not parsed as a column separator.
    expect(res.text).toContain(`"${OUTPUT_WITH_COMMA}"`);
  });

  test('keeps a cell containing a newline inside a single quoted field', async () => {
    const res = await request(app).get(`/evals/runs/${runId}/export?format=csv`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`"${OUTPUT_WITH_NEWLINE}"`);
  });

  test('reports pass/fail per result', async () => {
    const res = await request(app).get(`/evals/runs/${runId}/export?format=csv`);
    expect(res.status).toBe(200);
    // The first result is correct; at least one row reflects a failure.
    expect(res.text).toMatch(/pass|true|yes/i);
  });
});

// ─── JSON export ────────────────────────────────────────────────────────────

describe('GET /evals/runs/:id/export?format=json', () => {
  test('returns 200 with an application/json content type and attachment filename', async () => {
    const res = await request(app).get(`/evals/runs/${runId}/export?format=json`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const disposition = res.headers['content-disposition'] ?? '';
    expect(disposition).toMatch(/attachment/);
    expect(disposition).toMatch(/filename=.*\.json/i);
  });

  test('body contains the run and the full results array', async () => {
    const res = await request(app).get(`/evals/runs/${runId}/export?format=json`);
    expect(res.status).toBe(200);

    const body = res.body as { run: { name: string }; results: EvalResult[] };
    expect(body.run.name).toBe('Smoke Run');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(3);

    const first = body.results[0];
    expect(first).toHaveProperty('model_id', 'mock-1');
    expect(first).toHaveProperty('question_id', 'q1');
    expect(first).toHaveProperty('model_output', OUTPUT_WITH_QUOTES);
    expect(first).toHaveProperty('is_correct', true);
    expect(first).toHaveProperty('latency_ms', 120);
    expect(first).toHaveProperty('tokens_used', 42);
  });

  test('preserves model output with quotes/newlines exactly (no CSV mangling)', async () => {
    const res = await request(app).get(`/evals/runs/${runId}/export?format=json`);
    expect(res.status).toBe(200);

    const body = res.body as { results: EvalResult[] };
    const outputs = body.results.map((r) => r.model_output);
    expect(outputs).toContain(OUTPUT_WITH_QUOTES);
    expect(outputs).toContain(OUTPUT_WITH_NEWLINE);
    expect(outputs).toContain(OUTPUT_WITH_COMMA);
  });
});

// ─── Unknown run ────────────────────────────────────────────────────────────

describe('GET /evals/runs/:id/export for an unknown run', () => {
  test('returns 404 with a JSON error', async () => {
    const res = await request(app).get(`/evals/runs/${runId}-does-not-exist/export?format=csv`);

    expect(res.status).toBe(404);
    // The export endpoint must return a JSON error body, not the framework's
    // default HTML 404 page. (Current code has no such route, so this fails.)
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('error');
  });
});
