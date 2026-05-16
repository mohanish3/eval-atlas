/**
 * Sample research run: creates 10 eval items, saves as an eval set,
 * then starts an Auto Research loop.
 *
 * Usage:
 *   node sample-research-run.js
 *
 * Prerequisites:
 *   - Backend running on http://localhost:3000
 *   - OPENAI_API_KEY set in backend/.env (for research model)
 *   - MOCK_ENABLED=true in backend/.env works for target model
 */

const BASE = 'http://localhost:3000';
const HEADERS = { 'Content-Type': 'application/json' };

const EVAL_ITEMS = [
  { id: 'q1', question: 'What is the capital of France?', type: 'open_ended', correct_answer: 'Paris', match_type: 'contains', category: 'geography' },
  { id: 'q2', question: 'What is 12 × 12?', type: 'open_ended', correct_answer: '144', match_type: 'contains', category: 'math' },
  { id: 'q3', question: 'Which planet is closest to the Sun?', type: 'multiple_choice', choices: { A: 'Venus', B: 'Mercury', C: 'Mars', D: 'Earth' }, correct_answer: 'B', category: 'science' },
  { id: 'q4', question: 'Who wrote Romeo and Juliet?', type: 'open_ended', correct_answer: 'Shakespeare', match_type: 'contains', category: 'literature' },
  { id: 'q5', question: 'What is the square root of 64?', type: 'open_ended', correct_answer: '8', match_type: 'contains', category: 'math' },
  { id: 'q6', question: 'What is the chemical symbol for water?', type: 'multiple_choice', choices: { A: 'H2O', B: 'CO2', C: 'NaCl', D: 'O2' }, correct_answer: 'A', category: 'science' },
  { id: 'q7', question: 'In which year did World War II end?', type: 'open_ended', correct_answer: '1945', match_type: 'contains', category: 'history' },
  { id: 'q8', question: 'What is the largest ocean on Earth?', type: 'multiple_choice', choices: { A: 'Atlantic', B: 'Indian', C: 'Arctic', D: 'Pacific' }, correct_answer: 'D', category: 'geography' },
  { id: 'q9', question: 'What is 7 factorial (7!)?', type: 'open_ended', correct_answer: '5040', match_type: 'contains', category: 'math' },
  { id: 'q10', question: 'Which element has atomic number 1?', type: 'multiple_choice', choices: { A: 'Helium', B: 'Oxygen', C: 'Hydrogen', D: 'Carbon' }, correct_answer: 'C', category: 'science' },
];

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`POST ${path} failed: ${JSON.stringify(json)}`);
  return json;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  const json = await res.json();
  if (!res.ok) throw new Error(`GET ${path} failed: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  console.log('=== Auto Research Sample Run ===\n');

  // 1. Create eval set
  console.log('1. Creating eval set with 10 items…');
  const evalSet = await post('/api/evals/sets', {
    name: 'Sample Research Set',
    description: 'Mixed knowledge eval set for auto research demo',
    tags: ['sample', 'research'],
    items: EVAL_ITEMS.map(item => ({ ...item, origin: 'human' })),
  });
  console.log(`   Created eval set: ${evalSet.id} (${evalSet.items.length} items)\n`);

  // 2. Start research run
  // Target model: mock (always available)
  // Research model: openai gpt-4o-mini (requires OPENAI_API_KEY)
  //   → change to { provider: 'mock', modelId: 'mock-model' } for fully offline demo
  console.log('2. Starting research run…');
  console.log('   Target model: mock/mock-model');
  console.log('   Research model: openai/gpt-4o-mini\n');

  const research = await post('/api/evals/prompt-research', {
    name: 'Sample Research Run — 10 evals',
    evalSetId: evalSet.id,
    basePrompt: 'You are a helpful assistant. Answer questions accurately.',
    targetModel: { provider: 'mock', modelId: 'mock-model' },
    researchModel: { provider: 'openai', modelId: 'gpt-4o-mini' },
    maxIterations: 3,
    candidateCountPerIteration: 1,
    holdoutEnabled: true,
    earlyStopK: 3,
    maxTokens: 256,
    consentAcknowledged: true,
  });

  console.log(`   Research run queued: ${research.researchRunId}`);
  console.log(`   Storage: ${research.storageMode}\n`);

  // 3. Poll for completion
  console.log('3. Polling for completion (every 5s)…\n');
  const runId = research.researchRunId;
  let done = false;
  let attempts = 0;

  while (!done && attempts < 60) {
    await new Promise((r) => setTimeout(r, 5000));
    attempts++;

    const detail = await get(`/api/evals/prompt-research/${runId}`);
    const trialCount = detail.trials?.length ?? 0;
    process.stdout.write(`\r   Status: ${detail.status} | Trials: ${trialCount} | Best accuracy: ${detail.best_accuracy != null ? (detail.best_accuracy * 100).toFixed(1) + '%' : '—'}   `);

    if (['completed', 'failed', 'stopped'].includes(detail.status)) {
      done = true;
      console.log('\n');

      console.log('=== Results ===');
      console.log(`Status: ${detail.status}`);
      console.log(`Baseline accuracy: ${detail.baseline_accuracy != null ? (detail.baseline_accuracy * 100).toFixed(1) + '%' : '—'}`);
      console.log(`Best accuracy:     ${detail.best_accuracy != null ? (detail.best_accuracy * 100).toFixed(1) + '%' : '—'}`);
      if (detail.baseline_accuracy != null && detail.best_accuracy != null) {
        const delta = detail.best_accuracy - detail.baseline_accuracy;
        console.log(`Delta:             ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`);
      }
      console.log(`\nTrials:`);
      for (const t of detail.trials ?? []) {
        const iter = t.iteration === 0 ? 'base' : `iter ${t.iteration}`;
        const acc = t.overall_accuracy != null ? (t.overall_accuracy * 100).toFixed(1) + '%' : '—';
        console.log(`  [${iter}] ${t.status.padEnd(7)} accuracy=${acc}  ${t.mutation_summary ?? ''}`);
      }
      if (detail.best_prompt) {
        console.log('\nBest prompt found:');
        console.log('─'.repeat(50));
        console.log(detail.best_prompt);
        console.log('─'.repeat(50));
      }
      console.log(`\nView at: http://localhost:5173/evals/research/${runId}`);
    }
  }

  if (!done) {
    console.log('\nTimed out. Research still running. Check:');
    console.log(`  http://localhost:5173/evals/research/${runId}`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
