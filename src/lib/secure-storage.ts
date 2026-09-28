/**
 * Encrypted at-rest storage for Tauri localStorage (AES-GCM 256 + PBKDF2).
 *
 * - AES-GCM 256 via `crypto.subtle` for encryption/decryption.
 * - Key derived via PBKDF2 (120,000 iterations, SHA-256) from a per-device
 *   secret (`deviceId` from session.ts) combined with a random per-value salt
 *   generated once via `crypto.getRandomValues` and persisted alongside the
 *   ciphertext (never derivable from source code alone).
 * - Storage format: `enc:v2:<salt_b64>:<iv_b64>:<ciphertext_b64>`
 *   (salt 16B, IV 12B, ciphertext includes 16B GCM tag).
 * - Async API (`secureGetItemAsync`/`secureSetItemAsync`) is the source of
 *   truth. Sync `secureGetItem`/`secureSetItem` shims are cache-only and
 *   deprecated — they never perform crypto and never fall back to XOR.
 * - Migration: on first async read, legacy `enc:v1:` (XOR) values are
 *   decrypted with the old method and immediately re-encrypted to v2;
 *   raw plaintext values are read once then re-encrypted to v2. Silent,
 *   one-time per key, no user-visible change.
 * - Fail-safe: when `crypto.subtle` is unavailable, values are kept in
 *   memory only (with a clear warning). NEVER falls back to plaintext or XOR
 *   on disk.
 *
 * Callers must use the async API (`api.ts`, `oauth.ts`). Sync hot paths
 * should use the in-memory cache populated by `initSecureSession()` /
 * `setSession()` rather than reading disk synchronously.
 */

const PREFIX_V1 = "enc:v1:";
const PREFIX_V2 = "enc:v2:";
const PBKDF2_ITERATIONS = 120_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_VERSION_TAG = "uz.bestway.exam::v2";

// ---------------------------------------------------------------------------
// In-memory cache (sync hot-path + subtle-unavailable fallback)
// ---------------------------------------------------------------------------
const memoryCache = new Map<string, string | null>();
let warnedNoSubtle = false;

function warnNoSubtleOnce(): void {
  if (warnedNoSubtle) return;
  warnedNoSubtle = true;
  try {
    console.warn(
      "[security] crypto.subtle unavailable — keeping values in memory only (no disk persistence). Session will not survive reload.",
    );
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------
export function isSecureCryptoAvailable(): boolean {
  try {
    return (
      typeof crypto !== "undefined" &&
      typeof crypto.subtle !== "undefined" &&
      typeof crypto.getRandomValues === "function" &&
      typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined"
    );
  } catch {
    return false;
  }
}

export function getCryptoStatus(): { available: boolean; reason: string } {
  try {
    if (typeof crypto === "undefined") return { available: false, reason: "no-crypto" };
    if (typeof crypto.subtle === "undefined")
      return { available: false, reason: "no-subtle (insecure context?)" };
    if (typeof crypto.getRandomValues !== "function")
      return { available: false, reason: "no-getRandomValues" };
    return { available: true, reason: "ok" };
  } catch {
    return { available: false, reason: "unavailable" };
  }
}

function readDeviceId(): string {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem("bestway_device_id") ?? "";
    }
  } catch {
    /* ignore */
  }
  return "";
}

// ---------------------------------------------------------------------------
// Base64 helpers (chunked to avoid spread stack overflow on large buffers)
// ---------------------------------------------------------------------------
function toB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    let s = "";
    for (let j = 0; j < slice.length; j++) s += String.fromCharCode(slice[j]);
    bin += s;
  }
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Legacy v1 reader (XOR, read-only, for migration only — NEVER write v1)
// ---------------------------------------------------------------------------
const LEGACY_SALT = "uz.bestway.exam::v1";

function legacyDeriveKeyBytes(deviceId: string): Uint8Array {
  const seed = `${deviceId}::${LEGACY_SALT}`;
  const out = new Uint8Array(32);
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = h >>> 0;
  for (let i = 0; i < 32; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x = x >>> 0;
    out[i] = x & 0xff;
    x = (x + seed.charCodeAt(i % seed.length) * 131) >>> 0;
  }
  return out;
}

function legacyXorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

function legacyStableKey(): Uint8Array {
  return legacyDeriveKeyBytes("uz.bestway.exam::stable-v1");
}

function decV1(stored: string): string | null {
  if (!stored.startsWith(PREFIX_V1)) return null;
  try {
    const key = legacyStableKey();
    const b64 = stored.slice(PREFIX_V1.length);
    const bytes = fromB64(b64);
    const plain = legacyXorBytes(bytes, key);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AES-GCM v2 (real encryption)
// ---------------------------------------------------------------------------
async function deriveAesKey(deviceId: string, salt: Uint8Array): Promise<CryptoKey | null> {
  try {
    const password = `${deviceId}::${KEY_VERSION_TAG}`;
    const baseKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    // Copy salt into a fresh ArrayBuffer-backed Uint8Array: subtle requires
    // BufferSource with a resizable-safe ArrayBuffer (subarray views can fail).
    const saltCopy = new Uint8Array(salt.length);
    saltCopy.set(salt);
    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltCopy as unknown as BufferSource,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } catch {
    return null;
  }
}

async function encV2(plain: string): Promise<string | null> {
  try {
    if (typeof crypto?.subtle === "undefined" || typeof crypto?.getRandomValues !== "function")
      return null;
    const deviceId = readDeviceId();
    if (!deviceId) return null;
    const salt = new Uint8Array(SALT_BYTES);
    const iv = new Uint8Array(IV_BYTES);
    crypto.getRandomValues(salt);
    crypto.getRandomValues(iv);
    const key = await deriveAesKey(deviceId, salt);
    if (!key) return null;
    const data = new TextEncoder().encode(plain);
    // Copy into fresh buffers for subtle (see deriveAesKey note).
    const ivCopy = new Uint8Array(iv.length);
    ivCopy.set(iv);
    const dataCopy = new Uint8Array(data.length);
    dataCopy.set(data);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: ivCopy as unknown as BufferSource },
        key,
        dataCopy as unknown as BufferSource,
      ),
    );
    return `${PREFIX_V2}${toB64(salt)}:${toB64(iv)}:${toB64(ct)}`;
  } catch {
    return null;
  }
}

async function decV2(stored: string): Promise<string | null> {
  try {
    if (typeof crypto?.subtle === "undefined") return null;
    const deviceId = readDeviceId();
    if (!deviceId) return null;
    const body = stored.slice(PREFIX_V2.length);
    const parts = body.split(":");
    if (parts.length !== 3) return null;
    const [saltB64, ivB64, ctB64] = parts;
    if (!saltB64 || !ivB64 || !ctB64) return null;
    const salt = fromB64(saltB64);
    const iv = fromB64(ivB64);
    const ct = fromB64(ctB64);
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ct.length === 0) return null;
    const key = await deriveAesKey(deviceId, salt);
    if (!key) return null;
    const ivCopy = new Uint8Array(iv.length);
    ivCopy.set(iv);
    const ctCopy = new Uint8Array(ct.length);
    ctCopy.set(ct);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivCopy as unknown as BufferSource },
      key,
      ctCopy as unknown as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    // Wrong deviceId/salt, tampered data, or unavailable subtle → treat as missing.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Async storage API (source of truth)
// ---------------------------------------------------------------------------
function diskGet(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function diskSet(key: string, value: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function diskRemove(key: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export async function secureGetItemAsync(key: string): Promise<string | null> {
  try {
    if (memoryCache.has(key)) return memoryCache.get(key) ?? null;
    const raw = diskGet(key);
    if (raw == null) return null;
    if (raw.startsWith(PREFIX_V2)) {
      const dec = await decV2(raw);
      if (dec !== null) {
        memoryCache.set(key, dec);
        return dec;
      }
      // Corrupt/tampered or wrong device — treat as missing and clear.
      diskRemove(key);
      memoryCache.delete(key);
      return null;
    }
    if (raw.startsWith(PREFIX_V1)) {
      const dec = decV1(raw);
      if (dec === null) {
        diskRemove(key);
        memoryCache.delete(key);
        return null;
      }
      memoryCache.set(key, dec);
      // Migrate to v2 (best-effort, silent).
      try {
        const reEnc = await encV2(dec);
        if (reEnc) diskSet(key, reEnc);
        else if (!isSecureCryptoAvailable()) {
          // Memory-only session: leave legacy bytes alone rather than
          // destroying them; memory has the plaintext for this run.
        } else {
          diskSet(key, (await encV2(dec)) ?? raw);
        }
      } catch {
        /* migration failure is non-fatal */
      }
      // Ensure the value on disk is v2 when crypto is available.
      try {
        const check = diskGet(key);
        if (check && check.startsWith(PREFIX_V1) && isSecureCryptoAvailable()) {
          const retry = await encV2(dec);
          if (retry) diskSet(key, retry);
        }
      } catch {
        /* ignore */
      }
      return dec;
    }
    // Legacy plaintext — read once, then re-encrypt to v2.
    if (raw.length > 0) {
      memoryCache.set(key, raw);
      try {
        if (isSecureCryptoAvailable()) {
          const reEnc = await encV2(raw);
          if (reEnc) diskSet(key, reEnc);
        }
      } catch {
        /* ignore migration failure */
      }
    }
    return raw;
  } catch {
    return null;
  }
}

export async function secureSetItemAsync(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) {
      memoryCache.delete(key);
      diskRemove(key);
      return;
    }
    memoryCache.set(key, value);
    if (typeof localStorage === "undefined") return;
    if (!isSecureCryptoAvailable() || !readDeviceId()) {
      warnNoSubtleOnce();
      // Fail safe: keep in memory only. Remove any disk entry so no
      // plaintext or weak ciphertext lingers from a previous session.
      diskRemove(key);
      return;
    }
    const enc = await encV2(value);
    if (!enc) {
      warnNoSubtleOnce();
      diskRemove(key);
      return;
    }
    const ok = diskSet(key, enc);
    if (!ok) {
      // Quota / private mode — keep memory, warn, do NOT write plaintext.
      try {
        console.warn("[security] secure storage quota exceeded — keeping value in memory only.");
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* never throw from storage */
  }
}

export async function secureRemoveItemAsync(key: string): Promise<void> {
  try {
    memoryCache.delete(key);
    diskRemove(key);
  } catch {
    /* ignore */
  }
}

/** Sync in-memory read for hot paths. Populate via init/secureGetItemAsync first. */
export function getMemoryCached(key: string): string | null {
  return memoryCache.get(key) ?? null;
}

export function primeMemoryCache(key: string, value: string | null): void {
  if (value === null) memoryCache.delete(key);
  else memoryCache.set(key, value);
}

export function clearMemoryCache(): void {
  memoryCache.clear();
}

// ---------------------------------------------------------------------------
// Deprecated sync shims (cache-only — never touch disk crypto, never XOR)
// ---------------------------------------------------------------------------
/**
 * @deprecated Use `secureGetItemAsync` + in-memory cache instead. This shim
 * returns only the in-memory value (populated by a prior async read/write)
 * and never performs disk decryption, so it cannot leak weak crypto.
 */
export function secureGetItem(key: string): string | null {
  return memoryCache.get(key) ?? null;
}

/**
 * @deprecated Use `secureSetItemAsync` instead. Updates memory immediately
 * and schedules a real async AES-GCM persist (fire-and-forget). Never writes
 * XOR or plaintext.
 */
export function secureSetItem(key: string, value: string | null): void {
  if (value === null) {
    memoryCache.delete(key);
    void secureRemoveItemAsync(key);
    return;
  }
  memoryCache.set(key, value);
  void secureSetItemAsync(key, value);
}

/** @deprecated Use `secureRemoveItemAsync` instead (cache + disk). */
export function secureRemoveItem(key: string): void {
  memoryCache.delete(key);
  void secureRemoveItemAsync(key);
}

// ---------------------------------------------------------------------------
// URL allowlist helpers
// ---------------------------------------------------------------------------
/**
 * Returns true for safe `openUrl` targets:
 * - `https://` any host (no credentials, no javascript:/data:/file:),
 * - `http://localhost` or `http://127.0.0.1` (dev only),
 * - `tauri://localhost` / `http://tauri.localhost` are never passed to opener.
 */
export function isSafeHttpUrl(url: string): boolean {
  const s = url.trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("blob:")
  )
    return false;
  try {
    const u = new URL(s);
    const proto = u.protocol.toLowerCase();
    if (proto === "https:") {
      if (u.username || u.password) return false;
      return true;
    }
    if (proto === "http:") {
      const host = u.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        if (u.username || u.password) return false;
        return true;
      }
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

let warnedInsecure = false;

/**
 * Warn once if API base is cleartext outside loopback/tauri.
 * Does not throw in dev to preserve `npm run dev`.
 */
export function enforceSecureOrigin(apiBaseUrl: string): void {
  if (warnedInsecure) return;
  try {
    const u = new URL(apiBaseUrl);
    if (u.protocol === "http:") {
      const host = u.hostname.toLowerCase();
      const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
      const isTauri = host === "tauri.localhost";
      if (!isLoopback && !isTauri) {
        warnedInsecure = true;
        console.warn(
          `[security] API base is http:// outside loopback (${apiBaseUrl}). Use https:// in production to prevent credential theft.`,
        );
      }
    }
    if (apiBaseUrl.toLowerCase().startsWith("javascript:") || apiBaseUrl.toLowerCase().startsWith("data:")) {
      warnedInsecure = true;
      console.warn(`[security] API base looks unsafe: ${apiBaseUrl}`);
    }
  } catch {
    /* ignore malformed — resolveBaseUrl already sanitizes */
  }
}
