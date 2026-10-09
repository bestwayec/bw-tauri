import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function requireHttps(env, name, api = false) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required for a desktop release`);
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host.startsWith('127.') || host === '0.0.0.0' ||
      (api && url.pathname.replace(/\/+$/, '') !== '/v1')) {
    throw new Error(`${name} must be a remote HTTPS URL${api ? ' ending in /v1' : ''} without credentials, query or fragment`);
  }
}

export function validateRelease(env, versions) {
  requireHttps(env, 'VITE_API_URL', true);
  requireHttps(env, 'VITE_WEB_URL');
  const mode = env.DESKTOP_RELEASE_MODE || 'manual_installer';
  if (!['manual_installer', 'signed_updater'].includes(mode)) {
    throw new Error('DESKTOP_RELEASE_MODE must be manual_installer or signed_updater');
  }
  if (mode === 'signed_updater' && !env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
    throw new Error('TAURI_SIGNING_PRIVATE_KEY is required for signed updater artifacts');
  }
  const { packageVersion, tauriVersion, cargoVersion } = versions;
  if (!packageVersion || packageVersion !== tauriVersion || packageVersion !== cargoVersion ||
      env.GITHUB_REF_NAME !== `bestway-app-v${packageVersion}`) {
    throw new Error('Release tag and package, Tauri and Cargo versions must match');
  }
  return {
    mode,
    includeUpdaterJson: mode === 'signed_updater',
    args: mode === 'manual_installer' ? '--config src-tauri/tauri.manual-installer.conf.json' : '',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)?.[1];
  const release = validateRelease(process.env, {
    packageVersion: pkg.version, tauriVersion: tauri.version, cargoVersion: cargo,
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,
      `mode=${release.mode}\nincludeUpdaterJson=${release.includeUpdaterJson}\nargs=${release.args}\n`);
  }
  console.log(`Desktop release configuration validated (${release.mode})`);
}
