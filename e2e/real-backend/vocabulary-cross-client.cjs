// Usage: local Django on 127.0.0.1:3001 (seed_local_dev), website on :3000, `VITE_API_URL=http://127.0.0.1:3001/v1 npx vite --port 1421`;
// then `node e2e/real-backend/vocabulary-cross-client.cjs <screenshot-dir>`. Not part of the mock Playwright suite.
// Cross-client vocabulary acceptance on a real local Django + PostgreSQL (synthetic accounts).
const { chromium } = require('playwright');
const OUT = process.argv[2];
const PW = 'LocalDev-2026!';
const WORDS = [['harvest', 'hosil'], ['journey', 'sayohat'], ['brave', 'jasur']];
const log = (k, v) => console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
(async () => {
  const b = await chromium.launch();
  // Website teacher creates + assigns
  const t = await (await b.newContext()).newPage();
  await t.goto('http://localhost:3000/en/login', { waitUntil: 'networkidle' });
  await t.fill('input[name="phone"]', '+998900000003'); await t.fill('input[name="password"]', PW);
  await Promise.all([t.waitForURL(/dashboard/), t.click('form button[type="submit"]')]);
  const web = (p, o = {}) => t.request.fetch('http://localhost:3000/api/backend' + p, o);
  const group = (await (await web('/groups')).json()).data[0];
  const stamp = Date.now();
  const set = (await (await web('/v1/vocabulary/sets', { method: 'POST', data: { title: `Acceptance ${stamp}`, level: 'B1', isPublic: false, words: WORDS.map(([english, uzbek]) => ({ english, uzbek })) } })).json()).data;
  const assignment = (await (await web(`/groups/${group.id}/assignments`, { method: 'POST', data: { title: `Acceptance ${stamp}`, vocabulary_set_id: set.id, deadline: new Date(Date.now() + 86400000).toISOString(), min_pass_percent: 60 } })).json()).data;
  log('teacher created and assigned', Boolean(set.id && assignment.id));

  // Desktop student: persistent context = same IndexedDB across "restarts"
  const dir = require('fs').mkdtempSync(require('os').tmpdir() + '/bw-vocab-');
  let ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1366, height: 860 } });
  let s = await ctx.newPage();
  await s.goto('http://127.0.0.1:1421');
  await s.getByRole('button', { name: 'Sign in manually' }).click();
  await s.getByRole('textbox', { name: 'Phone number' }).fill('+998900000010');
  await s.getByLabel('Password', { exact: true }).fill(PW);
  await s.getByRole('button', { name: 'Sign in', exact: true }).click();
  await s.getByText(`Acceptance ${stamp}`).first().waitFor({ timeout: 20000 });
  await s.locator('li', { hasText: `Acceptance ${stamp}` }).getByRole('button', { name: /Lug‘atni o‘rganish/ }).click();
  await s.getByRole('button', { name: /Oflayn saqlash|Save offline/ }).click();
  await s.getByText(/Oflayn tayyor|Offline ready/).waitFor({ timeout: 15000 });
  log('downloaded for offline', true);
  const token = await s.evaluate(async () => (await import('/src/lib/session-store.ts')).useSessionStore.getState().accessToken);
  const api = (p, o = {}) => s.request.fetch('http://127.0.0.1:3001' + p, { ...o, headers: { Authorization: `Bearer ${token}` } });
  const before = await (await api(`/v1/student/assignments/${assignment.id}/vocabulary/flashcards`)).json();

  // Offline: mark the current card known
  const cutApi = (c) => c.route('http://127.0.0.1:3001/**', (r) => r.abort('internetdisconnected'));
  await cutApi(ctx);
  const front = await s.locator('button[aria-pressed]').first().innerText();
  await s.getByRole('button', { name: /Bilaman|I know it/ }).click();
  await s.getByText(/kutilmoqda|pending/).first().waitFor({ timeout: 10000 });
  log('offline change queued', true);
  // Restart while offline
  await ctx.close();
  ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1366, height: 860 } });
  await cutApi(ctx);
  s = await ctx.newPage();
  await s.goto('http://127.0.0.1:1421');
  const pending = await s.evaluate(async ({ id }) => {
    const { useSessionStore } = await import('/src/lib/session-store.ts');
    for (let i = 0; i < 50 && useSessionStore.getState().status === 'booting'; i++) await new Promise(r => setTimeout(r, 100));
    const user = useSessionStore.getState().profile?.id;
    const v = await import('/src/lib/offline-vocabulary.ts');
    return { status: useSessionStore.getState().status, pending: (await v.getPendingMutations(user, id)).length, snapshot: Boolean(await v.getOfflineSnapshot(user, id)) };
  }, { id: assignment.id });
  log('after offline restart (browser storage; Rust keyring not involved)', pending);
  // Reconnect and sync
  await ctx.unroute('http://127.0.0.1:3001/**');
  const synced = await s.evaluate(async ({ id }) => {
    const { useSessionStore } = await import('/src/lib/session-store.ts');
    const user = useSessionStore.getState().profile?.id;
    const v = await import('/src/lib/offline-vocabulary.ts');
    const first = await v.syncOfflineFlashcards(user, id);
    const replay = await v.syncOfflineFlashcards(user, id);
    return { first, replay, pending: (await v.getPendingMutations(user, id)).length };
  }, { id: assignment.id });
  log('sync result', synced);
  const token2 = await s.evaluate(async () => (await import('/src/lib/session-store.ts')).useSessionStore.getState().accessToken);
  const after = await (await s.request.get(`http://127.0.0.1:3001/v1/student/assignments/${assignment.id}/vocabulary/flashcards`, { headers: { Authorization: `Bearer ${token2}` } })).json();
  const knownWord = WORDS.find(([en]) => front.includes(en));
  log('server revision before/after', [before.data?.serverRevision, after.data?.serverRevision]);
  log('server familiarity after sync', after.data?.familiarity);
  log('front card was', knownWord?.[0]);

  // Complete a quiz on desktop (English -> Uzbek)
  await s.goto('http://127.0.0.1:1421');
  await s.getByText(`Acceptance ${stamp}`).first().waitFor({ timeout: 20000 });
  await s.locator('li', { hasText: `Acceptance ${stamp}` }).getByRole('button', { name: /Lug‘atni o‘rganish/ }).click();
  await s.getByRole('button', { name: /Inglizcha → o‘zbekcha|English → Uzbek/ }).click();
  for (let i = 0; i < WORDS.length; i++) {
    const prompt = (await s.locator('legend').first().innerText()).trim();
    const pair = WORDS.find(([en, uz]) => prompt.includes(en) || prompt.includes(uz));
    const answer = prompt.includes(pair[0]) ? pair[1] : pair[0];
    const radio = s.getByRole('radio', { name: answer });
    if (await radio.count()) await radio.check(); else await s.getByRole('textbox').last().fill(answer);
    if (i < WORDS.length - 1) await s.getByRole('button', { name: /Keyingi savol|Next question/ }).click();
  }
  await s.getByRole('button', { name: /Javoblarni yuborish|Submit answers/ }).click();
  await s.getByText(/Lug‘at natijasi|Vocabulary result/).first().waitFor({ timeout: 15000 });
  const desktopScore = await s.locator('section[aria-label] p').first().innerText();
  log('desktop result', desktopScore);
  await s.screenshot({ path: `${OUT}/desktop-vocab-result.png` });

  // Teacher sees the same official score on the website API and via the desktop client path (same endpoint)
  const webReport = (await (await web(`/groups/${group.id}/assignments/${assignment.id}/vocabulary-results`)).json()).data;
  const row = webReport.students.find((r) => r.name === 'Local Student');
  log('teacher web report', { completed: webReport.completedCount, percentage: row?.percentage });
  const tLogin = await (await s.request.post('http://127.0.0.1:3001/v1/auth/login', { data: { phone: '+998900000003', password: PW } })).json();
  const deskReport = (await (await s.request.get(`http://127.0.0.1:3001/v1/groups/${group.id}/assignments/${assignment.id}/vocabulary-results`, { headers: { Authorization: `Bearer ${tLogin.data.accessToken}` } })).json()).data;
  log('teacher desktop-client report', { completed: deskReport.completedCount, percentage: deskReport.students.find((r) => r.name === 'Local Student')?.percentage });
  await ctx.close(); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n')[0]); process.exit(1); });
