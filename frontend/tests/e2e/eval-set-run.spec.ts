import { test, expect } from '@playwright/test';

type ModelsResponse = {
  apiProviders: Array<{
    provider: string;
    configured: boolean;
    defaultModel: string;
    models: string[];
  }>;
};

type RunDetailResponse = {
  run: {
    id: string;
    name: string;
    status: string;
  };
  results: Array<{
    is_correct: boolean;
    error_type: string | null;
  }>;
};

function pickOpenAIModel(models: string[], fallback: string): string {
  const preferred = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', fallback];
  return preferred.find((model) => models.includes(model)) ?? models[0] ?? fallback;
}

test.describe('eval set creation + eval run', () => {
  test.setTimeout(180_000);

  test('creates eval set in UI and completes OpenAI run', async ({ page, browserName, request }) => {
    test.skip(browserName !== 'chromium', 'Real provider E2E runs only once.');
    test.skip(!process.env.OPENAI_API_KEY, 'OPENAI_API_KEY required for real-provider E2E.');

    const modelsResponse = await request.get('http://localhost:3000/api/evals/models');
    expect(modelsResponse.ok()).toBeTruthy();
    const models = await modelsResponse.json() as ModelsResponse;
    const openAI = models.apiProviders.find((provider) => provider.provider === 'openai');
    expect(openAI?.configured).toBeTruthy();

    const modelId = pickOpenAIModel(openAI?.models ?? [], openAI?.defaultModel ?? 'gpt-4o');
    const stamp = Date.now();
    const evalSetName = `pw-e2e-eval-set-${stamp}`;
    const runName = `pw-e2e-run-${stamp}`;

    await page.goto('/evals/builder/new');

    await page.getByPlaceholder('e.g. retail-support-regression-set').fill(evalSetName);
    await page.getByPlaceholder('What this eval set is measuring').fill('Playwright E2E coverage for authored eval creation and run launch.');
    await page.getByPlaceholder('Optional default instructions to reuse when launching runs').fill(
      'Return only single capital letter that matches best answer.'
    );

    const firstRow = page.locator('tbody tr').first();
    await firstRow.locator('input').nth(1).fill('capital-france');
    await firstRow.locator('textarea').first().fill('Which option names capital of France?');
    await firstRow.locator('input').nth(2).fill('Paris');
    await firstRow.locator('input').nth(3).fill('Berlin');
    await firstRow.locator('input').nth(4).fill('Madrid');
    await firstRow.locator('input').nth(5).fill('Rome');
    await firstRow.locator('select').nth(1).selectOption('A');
    await firstRow.locator('input').last().fill('geography');

    await page.getByPlaceholder('e.g. retail-support-ui-set run').fill(runName);
    await page.locator('input[type="range"]').evaluate((element) => {
      const input = element as HTMLInputElement;
      input.value = '32';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const openAIButton = page.getByRole('button', { name: /^openai$/i }).first();
    const openAICard = page.locator('div.rounded-2xl.border.p-3').filter({ has: openAIButton }).first();
    await openAICard.locator('select').selectOption(modelId);
    await openAIButton.click();

    const startRunButton = page.getByRole('button', { name: 'Start run with this eval set' });
    await expect(startRunButton).toBeEnabled();
    await startRunButton.click();

    await page.waitForURL(/\/evals\/[^/]+$/);
    const runId = page.url().split('/').pop();
    expect(runId).toBeTruthy();

    const evalSetsResponse = await request.get('http://localhost:3000/api/evals/sets');
    expect(evalSetsResponse.ok()).toBeTruthy();
    const evalSets = await evalSetsResponse.json() as Array<{ name: string }>;
    expect(evalSets.some((evalSet) => evalSet.name === evalSetName)).toBeTruthy();

    await expect.poll(async () => {
      const runResponse = await request.get(`http://localhost:3000/api/evals/runs/${runId}`);
      if (!runResponse.ok()) {
        return `http-${runResponse.status()}`;
      }
      const payload = await runResponse.json() as RunDetailResponse;
      return payload.run.status;
    }, {
      timeout: 120_000,
      intervals: [1_000, 2_000, 5_000],
    }).toBe('completed');

    await page.reload();

    await expect(page.getByText(runName)).toBeVisible();
    await expect(page.getByText('completed')).toBeVisible();
    await expect(page.getByText('1 result received')).toBeVisible();
    await expect(page.getByText('Dataset')).toBeVisible();
    await expect(page.getByText('capital-france')).toBeVisible();
    await expect(page.getByText('Which option names capital of France?')).toBeVisible();
    await expect(page.getByText('Accuracy', { exact: true })).toBeVisible();
    await expect(page.getByText('100%').first()).toBeVisible();

    const finalRunResponse = await request.get(`http://localhost:3000/api/evals/runs/${runId}`);
    expect(finalRunResponse.ok()).toBeTruthy();
    const finalRun = await finalRunResponse.json() as RunDetailResponse;
    expect(finalRun.results).toHaveLength(1);
    expect(finalRun.results[0].error_type).toBeNull();
    expect(finalRun.results[0].is_correct).toBeTruthy();
  });
});
