import { afterEach, expect, it, vi } from 'vitest';
import { post } from './api';

const session = vi.hoisted(() => ({ token: 'expired', refresh: vi.fn(async () => { session.token = 'fresh'; return 'fresh'; }) }));
vi.mock('./config', () => ({
  API_BASE_URL: 'https://api.example.test/v1',
  isApiMisconfigured: () => false,
  isLoopbackUrl: () => false,
  isProdBuild: () => false,
}));
vi.mock('./secure-storage', () => ({ enforceSecureOrigin: vi.fn() }));
vi.mock('./session-store', () => ({
  getSessionAccessToken: () => session.token,
  useSessionStore: { getState: () => ({ refreshNow: session.refresh }) },
}));
afterEach(() => { vi.unstubAllGlobals(); });

it('retries multipart recordings after refresh while preserving the browser boundary', async () => {
  const form = new FormData();
  form.append('audio', new Blob(['recording'], { type: 'audio/webm' }), 'speaking.webm');
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SESSION_EXPIRED' } }), { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { saved: true } })));
  vi.stubGlobal('fetch', fetcher);
  await expect(post('/mock/attempts/42/speaking/7', form, { timeoutMs: 60_000 })).resolves.toEqual({ saved: true });
  expect(session.refresh).toHaveBeenCalledOnce();
  const initial = fetcher.mock.calls[0][1];
  const retry = fetcher.mock.calls[1][1];
  expect(initial.body).toBe(form);
  expect(retry.body).toBe(form);
  expect(initial.headers).not.toHaveProperty('Content-Type');
  expect(retry.headers.Authorization).toBe('Bearer fresh');
});
