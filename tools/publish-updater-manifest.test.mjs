import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const tag = 'v1.0.13';
const command = fileURLToPath(new URL('./publish-updater-manifest.mjs', import.meta.url));
const installers = [
  'Bestway.App_1.0.13_x64-setup.exe',
  'Bestway.App_1.0.13_amd64.AppImage',
  'Bestway.App_1.0.13_amd64.deb',
  'Bestway.App_1.0.13_x64.dmg',
  'Bestway.App_1.0.13_aarch64.dmg',
  'Bestway.App_x64.app.tar.gz',
  'Bestway.App_aarch64.app.tar.gz',
];

test('the coordinator leaves the draft untouched when the signed Android artifact is missing', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'bw-publish-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('-c', 'user.name=Release Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'fixture');
  const sha = git('rev-parse', 'HEAD');

  const reads = new Map([
    ['/releases/42', { id: 42, tag_name: tag, draft: true, prerelease: false, target_commitish: sha }],
    [`/git/ref/tags/${tag}`, { object: { sha, type: 'commit' } }],
    ['/releases/42/assets?per_page=100', installers.map((name) => ({ name, size: 10, state: 'uploaded' }))],
  ]);
  const calls = [];
  const prefix = '/repos/example/bestway';
  const server = createServer((request, response) => {
    calls.push([request.method, request.url]);
    const value = reads.get(request.url.slice(prefix.length));
    response.writeHead(request.method === 'GET' && value ? 200 : 500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value ?? {}));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const child = spawn(process.execPath, [command], {
    cwd,
    env: {
      ...process.env,
      GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
      GITHUB_REPOSITORY: 'example/bestway',
      GH_TOKEN: 'synthetic',
      RELEASE_COMMIT: sha,
      RELEASE_ID: '42',
      RELEASE_TAG: tag,
      DESKTOP_RELEASE_MODE: 'signed_updater',
    },
  });
  let error = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { error += chunk; });
  const [status] = await once(child, 'close');
  assert.notEqual(status, 0);
  assert.match(error, /ENOENT.*release-android[/\\]bestway-app\.apk/);
  assert.deepEqual(calls, [...reads.keys()].map((path) => ['GET', prefix + path]));
});
