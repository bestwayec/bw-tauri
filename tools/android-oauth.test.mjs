import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

// Helper: base64url RFC 7636 S256 code challenge
function computeCodeChallenge(verifier) {
  const hash = createHash('sha256').update(verifier, 'ascii').digest();
  return hash.toString('base64url');
}

/**
 * State store simulating Android SharedPreferences (persistent across process recreation).
 */
class SimulatedSharedPreferences {
  constructor(initialData = {}) {
    this.storage = new Map(Object.entries(initialData));
  }

  getString(key, def = null) {
    return this.storage.has(key) ? String(this.storage.get(key)) : def;
  }

  getLong(key, def = 0) {
    return this.storage.has(key) ? Number(this.storage.get(key)) : def;
  }

  contains(key) {
    return this.storage.has(key);
  }

  edit() {
    const pendingWrites = new Map(this.storage);
    return {
      putString: (k, v) => { pendingWrites.set(k, v); return this.edit; },
      putLong: (k, v) => { pendingWrites.set(k, v); return this.edit; },
      remove: (k) => { pendingWrites.delete(k); return this.edit; },
      clear: () => { pendingWrites.clear(); return this.edit; },
      apply: () => { this.storage = pendingWrites; },
    };
  }

  snapshot() {
    return Object.fromEntries(this.storage);
  }
}

/**
 * Android WebView CookieManager simulation.
 */
class SimulatedCookieManager {
  constructor() {
    this.cookies = new Map(); // url -> Map(cookieName, cookieValue)
  }

  setCookie(url, cookieString) {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    if (!this.cookies.has(domain)) {
      this.cookies.set(domain, new Map());
    }
    const [nameVal] = cookieString.split(';');
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx !== -1) {
      const name = nameVal.slice(0, eqIdx).trim();
      const value = nameVal.slice(eqIdx + 1).trim();
      this.cookies.get(domain).set(name, value);
    }
  }

  getCookie(url) {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const domainCookies = this.cookies.get(domain);
    if (!domainCookies || domainCookies.size === 0) return null;
    return Array.from(domainCookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  removeAllCookies() {
    this.cookies.clear();
  }
}

/**
 * Full state machine simulating Android MainActivity + OAuthSecurityManager.
 */
class AndroidOAuthClient {
  constructor(sharedPrefs = new SimulatedSharedPreferences()) {
    this.prefs = sharedPrefs;
    this.cookieManager = new SimulatedCookieManager();
    this.localStorage = new Map();
    this.sessionStorage = new Map();
    this.STATE_TTL_MS = 5 * 60 * 1000;
  }

  getOrCreateDeviceId() {
    let deviceId = this.prefs.getString('oauth_device_id');
    if (!deviceId) {
      deviceId = `android-${randomBytes(16).toString('hex')}`;
      const editor = this.prefs.edit();
      editor.putString('oauth_device_id', deviceId);
      editor.apply();
    }
    return deviceId;
  }

  createPendingLogin(now = Date.now()) {
    const state = randomBytes(16).toString('hex');
    const verifier = randomBytes(32).toString('hex');
    const deviceId = this.getOrCreateDeviceId();

    const editor = this.prefs.edit();
    editor.putString('oauth_pending_state', state);
    editor.putString('oauth_pending_verifier', verifier);
    editor.putLong('oauth_created_at', now);
    editor.apply();

    return { state, verifier, deviceId, createdAt: now };
  }

  buildAuthorizeUrl(provider = null, now = Date.now()) {
    const session = this.createPendingLogin(now);
    const challenge = computeCodeChallenge(session.verifier);

    const desktopParams = new URLSearchParams({
      device: 'android',
      state: session.state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      redirect: 'bestwayapp://auth/callback',
    });

    const nextPath = `/oauth/desktop?${desktopParams.toString()}`;
    const authUrl = new URL('https://bestwayec.uz/login');
    authUrl.searchParams.set('next', nextPath);
    authUrl.searchParams.set('platform', 'mobile_app');
    if (provider) {
      authUrl.searchParams.set('provider', provider);
    }

    return { authUrl: authUrl.toString(), session, challenge };
  }

  validateAndConsumeState(state, now = Date.now()) {
    if (!state) return null;

    const storedState = this.prefs.getString('oauth_pending_state');
    const storedVerifier = this.prefs.getString('oauth_pending_verifier');
    const storedCreatedAt = this.prefs.getLong('oauth_created_at', 0);
    const deviceId = this.getOrCreateDeviceId();

    // Always clear immediately to prevent replay attacks
    this.clearOAuthState();

    if (!storedState || !storedVerifier) return null;
    if (storedState !== state) return null;
    if (now - storedCreatedAt > this.STATE_TTL_MS) return null;

    return {
      state: storedState,
      verifier: storedVerifier,
      deviceId,
      createdAt: storedCreatedAt,
    };
  }

  clearOAuthState() {
    const editor = this.prefs.edit();
    editor.remove('oauth_pending_state');
    editor.remove('oauth_pending_verifier');
    editor.remove('oauth_created_at');
    editor.apply();
  }

  async handleDeepLink(callbackUrl, exchangeServer, now = Date.now()) {
    const url = new URL(callbackUrl);
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');

    const pending = this.validateAndConsumeState(state, now);
    if (!pending) {
      return { success: false, error: 'INVALID_OR_EXPIRED_STATE' };
    }

    if (!code) {
      return { success: false, error: 'MISSING_AUTHORIZATION_CODE' };
    }

    // Perform one-time code exchange using verifier
    const exchangeResult = await exchangeServer.exchangeCode({
      code,
      verifier: pending.verifier,
      deviceId: pending.deviceId,
    });

    if (!exchangeResult.success) {
      return { success: false, error: exchangeResult.error };
    }

    const { accessToken } = exchangeResult;
    this.cookieManager.setCookie(
      'https://bestwayec.uz',
      `token=${accessToken}; path=/; max-age=2592000; Secure; SameSite=Lax`
    );
    this.cookieManager.setCookie(
      'https://bestwayec.uz',
      `access_token=${accessToken}; path=/; max-age=2592000; Secure; SameSite=Lax`
    );
    this.cookieManager.setCookie(
      'https://bestwayec.uz',
      'bw_mobile_app=1; path=/; max-age=31536000; Secure; SameSite=Lax'
    );
    this.cookieManager.setCookie(
      'https://api.bestwayec.uz',
      `token=${accessToken}; path=/; max-age=2592000; Secure; SameSite=Lax`
    );

    return { success: true, user: exchangeResult.user, accessToken };
  }

  handleLogout() {
    this.cookieManager.removeAllCookies();
    this.clearOAuthState();
    this.localStorage.clear();
    this.sessionStorage.clear();
  }
}

/**
 * Simulated backend server with /v1/auth/desktop/exchange.
 */
class MockBackendServer {
  constructor() {
    this.issuedCodes = new Map(); // code -> { codeChallenge, user }
    this.exchangeCallCount = 0;
  }

  issueCode(codeChallenge, user = { id: 'u1', name: 'Komiljon' }) {
    const code = `auth_code_${randomBytes(12).toString('hex')}`;
    this.issuedCodes.set(code, { codeChallenge, user });
    return code;
  }

  async exchangeCode({ code, verifier, deviceId }) {
    this.exchangeCallCount++;
    const record = this.issuedCodes.get(code);
    if (!record) {
      return { success: false, status: 400, error: 'INVALID_DESKTOP_CODE' };
    }

    // Verify PKCE S256 code challenge
    const expectedChallenge = computeCodeChallenge(verifier);
    if (expectedChallenge !== record.codeChallenge) {
      return { success: false, status: 400, error: 'INVALID_VERIFIER' };
    }

    // Single-use code consumption
    this.issuedCodes.delete(code);

    return {
      success: true,
      status: 200,
      user: record.user,
      accessToken: `jwt_access_${randomBytes(16).toString('hex')}`,
      refreshToken: `jwt_refresh_${randomBytes(16).toString('hex')}`,
    };
  }
}

// ---------------------------------------------------------------------------
// TEST MATRIX: AUTHENTICATION STATE MACHINE BEHAVIORAL TESTS
// ---------------------------------------------------------------------------

test('Behavioral 1: Full end-to-end OAuth PKCE login flow', async () => {
  const client = new AndroidOAuthClient();
  const server = new MockBackendServer();

  // 1. Initiate login
  const { authUrl, session, challenge } = client.buildAuthorizeUrl('google');
  assert.ok(authUrl.startsWith('https://bestwayec.uz/login'), 'Auth URL targets login');
  assert.ok(decodeURIComponent(authUrl).includes(`code_challenge=${challenge}`), 'Includes generated challenge');
  assert.ok(decodeURIComponent(authUrl).includes('code_challenge_method=S256'), 'Specifies S256');

  // 2. Server generates authorization code matching challenge
  const code = server.issueCode(challenge, { id: 'student-99', name: 'Ali' });

  // 3. User approves; deep-link callback arrives at client
  const callbackUri = `bestwayapp://auth/callback?code=${code}&state=${session.state}`;
  const result = await client.handleDeepLink(callbackUri, server);

  assert.ok(result.success, 'Login must succeed');
  assert.strictEqual(result.user.id, 'student-99');
  assert.ok(result.accessToken.startsWith('jwt_access_'), 'Access token issued');

  // 4. Verify secure session establishment in CookieManager
  const cookies = client.cookieManager.getCookie('https://bestwayec.uz');
  assert.ok(cookies.includes(`token=${result.accessToken}`), 'Session cookie set on web domain');
  assert.ok(cookies.includes('bw_mobile_app=1'), 'Mobile app flag set');
  assert.strictEqual(server.exchangeCallCount, 1, 'Exchange endpoint called exactly once');
});

test('Behavioral 2: Invalid State CSRF rejection (fail-closed, 0 network requests)', async () => {
  const client = new AndroidOAuthClient();
  const server = new MockBackendServer();

  const { challenge } = client.buildAuthorizeUrl();
  const code = server.issueCode(challenge);

  // Attacker crafts callback with mismatched state
  const forgedCallback = `bestwayapp://auth/callback?code=${code}&state=forged_unsolicited_state`;
  const result = await client.handleDeepLink(forgedCallback, server);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'INVALID_OR_EXPIRED_STATE');
  assert.strictEqual(server.exchangeCallCount, 0, 'Zero requests made to backend on invalid state');
  assert.strictEqual(client.cookieManager.getCookie('https://bestwayec.uz'), null, 'No cookies set');
});

test('Behavioral 3: Expired State rejection (> 5 minutes TTL)', async () => {
  const client = new AndroidOAuthClient();
  const server = new MockBackendServer();

  const t0 = 1000000;
  const { session, challenge } = client.buildAuthorizeUrl(null, t0);
  const code = server.issueCode(challenge);

  // Callback arrives 5 minutes and 1 millisecond later
  const tExpired = t0 + 5 * 60 * 1000 + 1;
  const callback = `bestwayapp://auth/callback?code=${code}&state=${session.state}`;
  const result = await client.handleDeepLink(callback, server, tExpired);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'INVALID_OR_EXPIRED_STATE');
  assert.strictEqual(server.exchangeCallCount, 0, 'Zero requests on expired state');
});

test('Behavioral 4: Replay attack prevention (single-use state consumption)', async () => {
  const client = new AndroidOAuthClient();
  const server = new MockBackendServer();

  const { session, challenge } = client.buildAuthorizeUrl();
  const code = server.issueCode(challenge);
  const callback = `bestwayapp://auth/callback?code=${code}&state=${session.state}`;

  // First consumption: succeeds
  const first = await client.handleDeepLink(callback, server);
  assert.ok(first.success, 'First attempt succeeds');

  // Replay attempt: must fail because state was wiped on first validation
  const replay = await client.handleDeepLink(callback, server);
  assert.strictEqual(replay.success, false, 'Replay attempt must be rejected');
  assert.strictEqual(replay.error, 'INVALID_OR_EXPIRED_STATE');
  assert.strictEqual(server.exchangeCallCount, 1, 'Exchange endpoint not called on replay');
});

test('Behavioral 5: Missing or corrupted verifier fails closed', async () => {
  const client = new AndroidOAuthClient();
  const server = new MockBackendServer();

  const { session, challenge } = client.buildAuthorizeUrl();
  const code = server.issueCode(challenge);

  // Corrupt the verifier in storage
  const editor = client.prefs.edit();
  editor.remove('oauth_pending_verifier');
  editor.apply();

  const callback = `bestwayapp://auth/callback?code=${code}&state=${session.state}`;
  const result = await client.handleDeepLink(callback, server);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'INVALID_OR_EXPIRED_STATE');
  assert.strictEqual(server.exchangeCallCount, 0, 'Aborted before network exchange');
});

test('Behavioral 6: Process recreation survival (persisted state & verifier)', async () => {
  // Shared persistent disk storage across processes
  const sharedDisk = new SimulatedSharedPreferences();

  // Process 1 initiates login
  const process1 = new AndroidOAuthClient(sharedDisk);
  const { session, challenge } = process1.buildAuthorizeUrl('google');
  const server = new MockBackendServer();
  const code = server.issueCode(challenge, { id: 'u-persisted', name: 'Student Persisted' });

  // Simulate Android OS killing Process 1 due to low memory while Chrome Custom Tab is active
  // All in-memory references in process1 are abandoned / garbage collected.

  // Process 2 spawns afresh with new memory space, connected to the same persistent storage
  const process2 = new AndroidOAuthClient(sharedDisk);

  // Callback arrives at Process 2
  const callbackUri = `bestwayapp://auth/callback?code=${code}&state=${session.state}`;
  const result = await process2.handleDeepLink(callbackUri, server);

  assert.ok(result.success, 'Process 2 must successfully validate and exchange from persistent store');
  assert.strictEqual(result.user.id, 'u-persisted');
  assert.ok(process2.cookieManager.getCookie('https://bestwayec.uz').includes(result.accessToken));
});

test('Behavioral 7: Secure Logout purges cookies, web storage, and pending state', async () => {
  const client = new AndroidOAuthClient();
  const server = new MockBackendServer();

  // Establish session
  const { session, challenge } = client.buildAuthorizeUrl();
  const code = server.issueCode(challenge);
  await client.handleDeepLink(`bestwayapp://auth/callback?code=${code}&state=${session.state}`, server);

  // Set mock web storage
  client.localStorage.set('theme', 'dark');
  client.sessionStorage.set('activeTab', 'dashboard');

  assert.ok(client.cookieManager.getCookie('https://bestwayec.uz'), 'Cookies present before logout');

  // Trigger logout
  client.handleLogout();

  // Assert complete cleanliness
  assert.strictEqual(client.cookieManager.getCookie('https://bestwayec.uz'), null, 'Cookies wiped');
  assert.strictEqual(client.localStorage.size, 0, 'localStorage wiped');
  assert.strictEqual(client.sessionStorage.size, 0, 'sessionStorage wiped');
  assert.strictEqual(client.prefs.getString('oauth_pending_state'), null, 'Pending state wiped');
});

test('Behavioral 8: Account switching without zombie token leaks', async () => {
  const client = new AndroidOAuthClient();
  const server = new MockBackendServer();

  // 1. User A logs in
  const loginA = client.buildAuthorizeUrl();
  const codeA = server.issueCode(loginA.challenge, { id: 'user-a', name: 'User A' });
  const resultA = await client.handleDeepLink(`bestwayapp://auth/callback?code=${codeA}&state=${loginA.session.state}`, server);
  assert.ok(resultA.success);
  assert.strictEqual(resultA.user.id, 'user-a');

  // 2. User A logs out
  client.handleLogout();
  assert.strictEqual(client.cookieManager.getCookie('https://bestwayec.uz'), null);

  // 3. User B logs in
  const loginB = client.buildAuthorizeUrl();
  const codeB = server.issueCode(loginB.challenge, { id: 'user-b', name: 'User B' });
  const resultB = await client.handleDeepLink(`bestwayapp://auth/callback?code=${codeB}&state=${loginB.session.state}`, server);
  assert.ok(resultB.success);
  assert.strictEqual(resultB.user.id, 'user-b');

  // Verify only User B's token is in cookies, not User A's
  const currentCookies = client.cookieManager.getCookie('https://bestwayec.uz');
  assert.ok(currentCookies.includes(resultB.accessToken), 'User B token present');
  assert.ok(!currentCookies.includes(resultA.accessToken), 'User A token completely absent');
});
