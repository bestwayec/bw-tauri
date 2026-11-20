import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

test('IndexedDB keeps queued vocabulary progress across Chromium process restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bestway-vocabulary-'));
  const origin = 'http://127.0.0.1:1421';
  const options = { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH };
  let context = await chromium.launchPersistentContext(directory, options);
  try {
    let page = await context.newPage();
    await page.goto(origin);
    await page.getByRole('button', { name: 'Sign in manually' }).click();
    await page.getByRole('textbox', { name: 'Phone number' }).fill('+998900000010');
    await page.getByLabel('Password', { exact: true }).fill('Student123!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Exams/ }).first()).toBeVisible();

    const recorded = await page.evaluate(async () => {
      const statePath = '/src/lib/session-store.ts';
      const vocabularyPath = '/src/lib/offline-vocabulary.ts';
      const storagePath = '/src/lib/offline-store.ts';
      const { useSessionStore } = await import(statePath);
      const storage = await import(storagePath);
      const vocabulary = await import(vocabularyPath);
      const account = useSessionStore.getState().profile.id;
      const operations = await Promise.all([
        vocabulary.enqueueFlashcardMutation(account, 'restart-fixture', { wordId: 'one', status: 'known', lastWordId: 'one' }),
        vocabulary.enqueueFlashcardMutation(account, 'restart-fixture', { wordId: 'two', status: 'practice', lastWordId: 'two' }),
      ]);
      return { account, backend: storage.offlineStoreBackend(), ids: operations.map(({ opId }: { opId: string }) => opId) };
    });
    expect(recorded.backend).toBe('indexeddb');
    await context.close();

    context = await chromium.launchPersistentContext(directory, options);
    await context.route('http://127.0.0.1:3102/v1/**', (route) => route.abort());
    page = await context.newPage();
    await page.goto(origin);
    await expect(page.getByRole('button', { name: /^Exams/ }).first()).toBeVisible();
    const recovered = await page.evaluate(async ({ account }) => {
      const vocabularyPath = '/src/lib/offline-vocabulary.ts';
      const vocabulary = await import(vocabularyPath);
      const progress = await vocabulary.getOfflineProgress(account, 'restart-fixture');
      const queued = await vocabulary.getPendingMutations(account, 'restart-fixture');
      const anotherAccount = await vocabulary.getPendingMutations('different-account', 'restart-fixture');
      return { progress, queued: queued.map(({ opId }: { opId: string }) => opId), anotherAccount };
    }, recorded);
    expect(recovered.queued.sort()).toEqual(recorded.ids.sort());
    expect(recovered.progress.familiarity).toEqual({ one: 'known', two: 'practice' });
    expect(recovered.anotherAccount).toEqual([]);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
