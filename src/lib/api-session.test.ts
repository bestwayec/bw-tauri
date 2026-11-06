import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { login, post, setSession, getAccessTokenCached } from './api';
import { useSessionStore } from './session-store';
import { secureGetItemAsync, secureSetItemAsync } from './secure-storage';
import { exchangeCode } from './oauth';
import { isTauriRuntime, rustAuthRefresh, rustSessionClear, rustSessionGet, rustSessionSet } from './tauri-session';

vi.mock('./tauri-session', () => ({
  isTauriRuntime: vi.fn(() => true),
  rustSessionGet: vi.fn(async () => null),
  rustSessionSet: vi.fn(async () => undefined),
  rustSessionUpdateProfile: vi.fn(async () => undefined),
  rustSessionClear: vi.fn(async () => undefined),
  rustAuthRefresh: vi.fn(async () => 'fresh'),
  rustAuthLogout: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauriRuntime).mockReturnValue(true);
  vi.mocked(rustAuthRefresh).mockResolvedValue('fresh');
  vi.mocked(rustSessionGet).mockResolvedValue(null);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  useSessionStore.setState({ accessToken: null, status: 'logged-out', profile: null });
});
afterEach(() => vi.unstubAllGlobals());
const expired = () => new Response(JSON.stringify({ error: { code: 'TOKEN_EXPIRED' } }), { status: 401 });

it('login and OAuth session writes use Rust without plaintext browser copies', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: {
    accessToken: 'access', refreshToken: 'refresh', user: { id: 'student', role: 'student' },
  } }))));
  await login('901234567', 'password');
  expect(rustSessionSet).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'access', refresh_token: 'refresh' }), false);
  await setSession('oauth-access', 'oauth-refresh');
  await exchangeCode('code', 'verifier', 'device');
  expect(localStorage.getItem('bestway.accessToken')).toBeNull();
  expect(localStorage.getItem('bestway.refreshToken')).toBeNull();
});

it.each(['HTTP_TIMEOUT: unavailable', 'HTTP_500', 'REFRESH_IN_PROGRESS'])('a transient refresh failure preserves the session: %s', async (error) => {
  await setSession('old', 'refresh');
  vi.mocked(rustAuthRefresh).mockRejectedValue(error);
  vi.stubGlobal('fetch', vi.fn(async () => expired()));
  await expect(post('/tests/attempts/1/answers', {})).rejects.toMatchObject({ status: 401 });
  expect(getAccessTokenCached()).toBe('old');
  expect(rustSessionClear).not.toHaveBeenCalled();
});

it('parallel 401 responses share one rotation and preserve request bodies', async () => {
  await setSession('old', 'refresh');
  vi.mocked(rustAuthRefresh).mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    return 'fresh';
  });
  const fetcher = vi.fn(async (_url, init) => init.headers.Authorization === 'Bearer old'
    ? expired() : new Response(JSON.stringify({ data: { saved: true } })));
  vi.stubGlobal('fetch', fetcher);
  const results = await Promise.all(Array.from({ length: 10 }, () => post('/tests/attempts/1/answers', { response: 'A' })));
  expect(results).toEqual(Array(10).fill({ saved: true }));
  expect(rustAuthRefresh).toHaveBeenCalledOnce();
});

it('normalizes auth paths before deciding to refresh and respects explicit anonymous requests', async () => {
  await setSession('old', 'refresh');
  vi.stubGlobal('fetch', vi.fn(async () => expired()));
  await expect(post('/api/v1/auth/login', {})).rejects.toMatchObject({ status: 401 });
  await expect(post('/public', {}, { token: null })).rejects.toMatchObject({ status: 401 });
  expect(rustAuthRefresh).not.toHaveBeenCalled();
});

it('never restores a raw legacy token through the synchronous credential getter', () => {
  localStorage.setItem('bestway.accessToken', 'stale-plaintext');
  expect(getAccessTokenCached()).toBeNull();
});

it('a completed refresh cannot resurrect a locally wiped session', async () => {
  await setSession('old', 'refresh');
  let resolve!: (token: string) => void;
  vi.mocked(rustAuthRefresh).mockImplementation(() => new Promise(r => { resolve = r; }));
  const refreshing = useSessionStore.getState().refreshNow();
  await useSessionStore.getState().wipeLocal();
  resolve('fresh');
  await expect(refreshing).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(useSessionStore.getState().status).toBe('logged-out');
  expect(getAccessTokenCached()).toBeNull();
});

it('echoes the backend session signature only to the matching mock attempt', async () => {
  const signature = 'a'.repeat(64);
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { attemptId: 'signed-attempt', sessionSignature: signature } })))
    .mockImplementation(async () => new Response(JSON.stringify({ data: { saved: true } })));
  vi.stubGlobal('fetch', fetcher);
  await post('/mock/exams/1/start', {});
  await post('/mock/attempts/signed-attempt/answers', { answers: [] });
  await post('/mock/attempts/different-attempt/submit', {});
  expect(fetcher.mock.calls[1][1].headers['X-Attempt-Signature']).toBe(signature);
  expect(fetcher.mock.calls[2][1].headers).not.toHaveProperty('X-Attempt-Signature');
});

it('removes legacy plaintext copies after successfully loading the native session', async () => {
  localStorage.setItem('bestway.accessToken', 'legacy-access');
  localStorage.setItem('bestway.refreshToken', 'legacy-refresh');
  vi.mocked(rustSessionGet).mockResolvedValue({ access_token: 'native', device_id: 'device', profile_json: null });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await useSessionStore.getState().initialize();
  expect(getAccessTokenCached()).toBe('native');
  expect(localStorage.getItem('bestway.accessToken')).toBeNull();
  expect(localStorage.getItem('bestway.refreshToken')).toBeNull();
});

it('preserves legacy credentials when native migration fails', async () => {
  await secureSetItemAsync('bestway.accessToken', 'legacy-access');
  await secureSetItemAsync('bestway.refreshToken', 'legacy-refresh');
  vi.mocked(rustSessionSet).mockRejectedValueOnce(new Error('disk full'));
  await useSessionStore.getState().initialize();
  expect(await secureGetItemAsync('bestway.refreshToken')).toBe('legacy-refresh');
});

it('browser logout uses refresh-family revocation without an access token', async () => {
  vi.mocked(isTauriRuntime).mockReturnValue(false);
  await setSession('access', 'refresh');
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: { loggedOut: true } })));
  vi.stubGlobal('fetch', fetcher);
  await useSessionStore.getState().logout();
  expect(fetcher.mock.calls[0][0]).toMatch(/\/auth\/logout-refresh$/);
  expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({ refreshToken: 'refresh' });
  expect(await secureGetItemAsync('bestway.refreshToken')).toBeNull();
  expect(getAccessTokenCached()).toBeNull();
});

it('explicitly clearing the profile cannot retain another account identity', async () => {
  await setSession('a', 'ra', { id: 'previous-user', role: 'admin' });
  await setSession('b', 'rb', null);
  expect(useSessionStore.getState().profile).toBeNull();
});

it('does not publish a successful login before durable token storage acknowledges it', async () => {
  let acknowledge!: () => void;
  vi.mocked(rustSessionSet).mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
  const saving = setSession('new-access', 'new-refresh');
  expect(useSessionStore.getState().status).toBe('logged-out');
  expect(getAccessTokenCached()).toBeNull();
  acknowledge();
  await saving;
  expect(getAccessTokenCached()).toBe('new-access');
});
