import { readFileSync } from 'node:fs';

function requireHttps(name, api = false) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for a desktop release`);
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host.startsWith('127.') || host === '0.0.0.0' ||
      (api && url.pathname.replace(/\/+$/, '') !== '/v1')) {
    throw new Error(`${name} must be a remote HTTPS URL${api ? ' ending in /v1' : ''} without credentials, query or fragment`);
  }
}

requireHttps('VITE_API_URL', true);
requireHttps('VITE_WEB_URL');
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('TAURI_SIGNING_PRIVATE_KEY is required for signed updater artifacts');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)?.[1];
if (pkg.version !== tauri.version || pkg.version !== cargo || process.env.GITHUB_REF_NAME !== `bestway-app-v${pkg.version}`) {
  throw new Error('Release tag and package, Tauri and Cargo versions must match');
}
console.log('Desktop release configuration validated');
