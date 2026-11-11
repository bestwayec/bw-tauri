import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync('.github/workflows/release-android.yml', 'utf8');
const match = workflow.match(/      - name: Sign APK[^\n]*\n[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name:)/);
assert.ok(match, 'Android signing step must exist');
const script = match[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
const keys = ['KEYSTORE_B64', 'KEYSTORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD'];

function run(overrides, signerExit = 0) {
  const temp = mkdtempSync(join(tmpdir(), 'android-signing-test-'));
  try {
    writeFileSync(join(temp, 'apksigner'), `#!/bin/sh\ntouch "$RUNNER_TEMP/signer-called"\nexit ${signerExit}\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${temp}:${process.env.PATH}`, RUNNER_TEMP: temp,
      KEYSTORE_B64: Buffer.from('synthetic test key').toString('base64'), KEYSTORE_PASSWORD: 'dummy', KEY_ALIAS: 'dummy', KEY_PASSWORD: 'dummy', ...overrides };
    const result = spawnSync('bash', ['-eo', 'pipefail', '-c', script], { env, cwd: temp, encoding: 'utf8' });
    return { status: result.status, called: existsSync(join(temp, 'signer-called')), keyRemains: existsSync(join(temp, 'release.keystore')) };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

test('each missing secret stops before signing without producing a key', () => {
  for (const key of keys) {
    const result = run({ [key]: '' });
    assert.notEqual(result.status, 0, key);
    assert.equal(result.called, false, key);
    assert.equal(result.keyRemains, false, key);
  }
  assert.doesNotMatch(script, /keytool|genkeypair/);
});

test('temporary key file is removed even when signing fails', () => {
  const result = run({}, 1);
  assert.notEqual(result.status, 0);
  assert.equal(result.called, true);
  assert.equal(result.keyRemains, false);
});

test('invalid base64 stops before signing and removes the partial file', () => {
  const result = run({ KEYSTORE_B64: 'not-valid-base64!' });
  assert.notEqual(result.status, 0);
  assert.equal(result.called, false);
  assert.equal(result.keyRemains, false);
});

test('configured signing step cleans up after success', () => {
  const result = run({});
  assert.equal(result.status, 0);
  assert.equal(result.called, true);
  assert.equal(result.keyRemains, false);
});
