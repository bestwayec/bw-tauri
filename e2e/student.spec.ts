import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in manually' }).click();
  await page.getByRole('textbox', { name: 'Phone number' }).fill('+998900000010');
  await page.getByLabel('Password', { exact: true }).fill('Student123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Exams/ }).first()).toBeVisible();
}

test('student password login stores no plaintext credentials and survives reload and a network outage', async ({ page, context }) => {
  await signIn(page);
  const storage = await page.evaluate(() => ({
    accessEncrypted: localStorage.getItem('bestway.accessToken')?.startsWith('enc:v2:'),
    refreshEncrypted: localStorage.getItem('bestway.refreshToken')?.startsWith('enc:v2:'),
  }));
  expect(storage).toEqual({ accessEncrypted: true, refreshEncrypted: true });
  await page.reload();
  await expect(page.getByRole('button', { name: /^Exams/ }).first()).toBeVisible();
  await context.setOffline(true);
  // The running app must keep the restored identity through a network outage.
  await expect(page.getByRole('button', { name: /^Exams/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  await context.setOffline(false);
});

test('a writing draft survives an API outage and restart, and finalization waits for upload', async ({ page }) => {
  const acknowledgedAnswers: Array<{ response?: string }> = [];
  page.on('response', response => {
    if (response.ok() && /\/mock\/attempts\/[^/]+\/answers?$/.test(response.url())) {
      const body = response.request().postDataJSON();
      acknowledgedAnswers.push(...(body.answers ?? [body]));
    }
  });
  await page.addInitScript(() => {
    Object.assign(window, { cameraRequests: 0 });
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints.video) (window as unknown as { cameraRequests: number }).cameraRequests++;
      throw new DOMException('Synthetic camera refusal', 'NotAllowedError');
    };
  });
  await signIn(page);
  await page.getByRole('button', { name: /^Exams/ }).first().click();
  await page.getByRole('button', { name: /Switch to IELTS/ }).click();
  await expect(page.getByText('Mock Server Full Test', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Start →', exact: true }).last().click();
  await page.getByRole('button', { name: /Writing Only/ }).click();
  await page.getByRole('button', { name: 'Continue without camera' }).click();
  const editor = page.getByRole('textbox', { name: /Answer for question/ }).first();
  await expect(editor).toBeVisible();
  const cameras = await page.evaluate(() => (window as unknown as { cameraRequests: number }).cameraRequests);
  await page.clock.install();
  await page.clock.fastForward(16 * 60 * 1000);
  expect(await page.evaluate(() => (window as unknown as { cameraRequests: number }).cameraRequests)).toBe(cameras);
  await page.clock.resume();

  await page.route('http://127.0.0.1:3102/v1/**', route => route.abort());
  const draft = 'My complete writing answer must survive the network outage and restart.';
  await editor.fill(draft);
  await page.reload();
  await page.getByRole('button', { name: /Davom ettirish \(Resume\)/ }).click();
  await page.getByRole('button', { name: 'Continue without camera' }).click();
  await expect(editor).toHaveValue(draft);
  await page.getByRole('button', { name: /^Question 2,/ }).click();
  await page.getByRole('button', { name: 'Submit Writing', exact: true }).click();
  await page.getByRole('dialog', { name: 'Submit section' }).getByRole('button', { name: 'Submit Writing', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByText('submitted ✓', { exact: true })).toHaveCount(0);

  await page.unroute('http://127.0.0.1:3102/v1/**');
  await page.getByRole('button', { name: 'Submit Writing', exact: true }).click();
  const acknowledgement = page.waitForResponse(response => /\/mock\/attempts\/[^/]+\/submit$/.test(response.url()) && response.ok());
  await page.getByRole('dialog', { name: 'Submit section' }).getByRole('button', { name: 'Submit Writing', exact: true }).click();
  await acknowledgement;
  expect(acknowledgedAnswers.some(answer => answer.response === draft)).toBe(true);
  await expect(page.getByText('submitted ✓', { exact: true })).toBeVisible();
});
