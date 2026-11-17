import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainActivity = readFileSync('android/app/src/main/java/uz/bestwayec/app/MainActivity.kt', 'utf8');
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const buildGradle = readFileSync('android/app/build.gradle', 'utf8');

test('P0-1: AndroidBridge does not expose access or refresh tokens to JavaScript', () => {
  // Never expose refresh tokens or raw access tokens via @JavascriptInterface
  assert.ok(!mainActivity.includes('fun getRefreshToken'), 'getRefreshToken must not exist in AndroidBridge');
  assert.ok(!mainActivity.includes('fun getAuthToken'), 'getAuthToken must not exist in AndroidBridge');
  assert.ok(!mainActivity.includes('auth_prefs'), 'auth_prefs shared preferences must be eliminated');

  // Verify only benign metadata methods exist on AndroidBridge
  const bridgeMatch = mainActivity.match(/class AndroidBridge[\s\S]*?\{([\s\S]*?)\n    \}/);
  assert.ok(bridgeMatch, 'AndroidBridge class must be defined');
  const bridgeBody = bridgeMatch[1];
  assert.ok(bridgeBody.includes('fun isMobileApp'), 'AndroidBridge must provide isMobileApp');
  assert.ok(bridgeBody.includes('fun getVersion'), 'AndroidBridge must provide getVersion');
  assert.ok(bridgeBody.includes('isTrustedOrigin'), 'AndroidBridge methods must verify trusted origin');
});

test('P0-2: Token duplication across localStorage, cookies and SharedPreferences is eliminated', () => {
  // onPageFinished must not inject tokens into localStorage
  assert.ok(!mainActivity.includes("localStorage.setItem('token'"), 'Must not inject token into localStorage in onPageFinished');
  assert.ok(!mainActivity.includes("localStorage.setItem('access_token'"), 'Must not inject access_token into localStorage in onPageFinished');

  // Must not duplicate token across multiple cookie names
  assert.ok(!mainActivity.includes('bw_access_token='), 'Must not duplicate token as bw_access_token cookie');
  assert.ok(!mainActivity.includes('bw_refresh_token='), 'Must not write refresh tokens into cookies');
});

test('P0-3: OAuth authorization code deep-link requires strict state CSRF validation', () => {
  assert.ok(mainActivity.includes('OAuthSecurityManager'), 'OAuthSecurityManager must be defined');
  assert.ok(mainActivity.includes('validateAndConsumeState'), 'Must call validateAndConsumeState on callback');
  assert.ok(mainActivity.includes('STATE_TTL_MS'), 'Must enforce TTL on pending OAuth state');

  // Deep link handler must reject invalid or missing state
  const deepLinkMatch = mainActivity.match(/private fun handleDeepLink[\s\S]*?\{([\s\S]*?)\n    \}/);
  assert.ok(deepLinkMatch, 'handleDeepLink must exist');
  const deepLinkBody = deepLinkMatch[1];
  assert.ok(deepLinkBody.includes('OAuthSecurityManager.validateAndConsumeState(state)'), 'Deep link handler must validate state');
  assert.ok(deepLinkBody.includes('appendQueryParameter("auth_code", code)'), 'Must safely pass authorization code');
});

test('P0-4: WebView navigation is strictly locked to trusted HTTPS origins', () => {
  assert.ok(mainActivity.includes('TRUSTED_HOSTS = setOf("bestwayec.uz", "api.bestwayec.uz")'), 'Trusted hosts must be strictly bestwayec.uz and api.bestwayec.uz');
  assert.ok(mainActivity.includes('scheme == "https"'), 'isTrustedOrigin must require HTTPS scheme');

  // handleUrl must route untrusted external domains outside privileged WebView
  const handleUrlMatch = mainActivity.match(/private fun handleUrl[\s\S]*?\{([\s\S]*?)\n    \}/);
  assert.ok(handleUrlMatch, 'handleUrl must exist');
  const handleUrlBody = handleUrlMatch[1];
  assert.ok(handleUrlBody.includes('openCustomTabOrBrowser(uri)'), 'External links must open in Custom Tab / browser');
  assert.ok(handleUrlBody.includes('TRUSTED_HOSTS.contains(host)'), 'Must check host against TRUSTED_HOSTS');
});

test('P0-5: Hardware permission requests validate origin and allow only explicit audio/video resources', () => {
  const permMatch = mainActivity.match(/override fun onPermissionRequest[\s\S]*?\{([\s\S]*?)\n            \}/);
  assert.ok(permMatch, 'onPermissionRequest must exist');
  const permBody = permMatch[1];

  // Must check origin
  assert.ok(permBody.includes('isTrustedOrigin(origin)'), 'Permission request must validate origin');
  assert.ok(permBody.includes('request.deny()'), 'Must call request.deny() for untrusted origins');

  // Must not have open fallbacks granting unknown resources
  assert.ok(!permBody.includes('else -> grantedResources.add'), 'Must not grant arbitrary resources in fallback');
  assert.ok(!mainActivity.includes('else -> grantedResources.add(res)'), 'permissionLauncher must not grant unknown resources');
});

test('P0-6: Logout clears session cookies, storage and pending OAuth state without zombie re-injection', () => {
  assert.ok(mainActivity.includes('private fun handleLogout()'), 'handleLogout must be defined');
  const logoutMatch = mainActivity.match(/private fun handleLogout\(\)[\s\S]*?\{([\s\S]*?)\n    \}/);
  assert.ok(logoutMatch, 'handleLogout implementation must exist');
  const logoutBody = logoutMatch[1];
  assert.ok(logoutBody.includes('removeAllCookies'), 'Must clear cookies on logout');
  assert.ok(logoutBody.includes('OAuthSecurityManager.clear()'), 'Must clear OAuth state on logout');
  assert.ok(logoutBody.includes('localStorage.clear()'), 'Must clear localStorage on logout');
});

test('P0-7: AndroidManifest and build.gradle enforce security requirements', () => {
  assert.ok(manifest.includes('android:usesCleartextTraffic="false"'), 'Cleartext traffic must be disabled');
  assert.ok(manifest.includes('android:allowBackup="false"'), 'Application backup must be disabled');
  assert.ok(buildGradle.includes('minSdk 24'), 'minSdkVersion must be at least 24');
  assert.ok(buildGradle.includes('targetSdk 34'), 'targetSdk must be 34');
});
