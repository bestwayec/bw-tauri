import { useEffect, useRef, useState } from "react";
import { clearSession, login } from "@/lib/api";
import {
  buildAuthorizeUrl,
  clearBrowserLoginState,
  listenDeepLink,
  listenSingleInstance,
  newBrowserLoginState,
  openInBrowser,
  parseAuthCallbackUrl,
  parseManualCallbackInput,
  exchangeCode,
  readBrowserLoginState,
  readInitialDeepLink,
  type BrowserLoginState,
} from "@/lib/oauth";

type Props = {
  onLogin: (student: { id: string; name: string | null; phone: string | null }) => void;
};

type Busy = "idle" | "browser" | "password" | "exchange";

export default function Login({ onLogin }: Props) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<BrowserLoginState | null>(null);
  // Presentation-only view state: OAuth-first, manual form hidden until asked.
  const [mode, setMode] = useState<"oauth" | "manual">("oauth");
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  // Brute-force throttle: 3 fails -> 30s cooldown (UI only, backend still authoritative).
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [, setNowTick] = useState(0);
  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (cooldownUntil == null) return;
    if (Date.now() >= cooldownUntil) {
      setCooldownUntil(null);
      setFailedAttempts(0);
      return;
    }
    const id = window.setInterval(() => {
      if (Date.now() >= (cooldownUntil ?? 0)) {
        setCooldownUntil(null);
        setFailedAttempts(0);
        window.clearInterval(id);
      } else {
        setNowTick((t) => t + 1);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  async function copyAuthorize() {
    if (!authorizeUrl) return;
    try {
      await navigator.clipboard?.writeText(authorizeUrl);
    } catch {
      return;
    }
    setCopied(true);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  const pendingRef = useRef<BrowserLoginState | null>(null);
  const onLoginRef = useRef(onLogin);
  useEffect(() => {
    onLoginRef.current = onLogin;
  }, [onLogin]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  async function handleCallback(url: string, s: BrowserLoginState | null) {
    const p = parseAuthCallbackUrl(url);
    if (p.error && !p.code) {
      setError(p.error);
      setBusy("idle");
      return;
    }
    if (!s) {
      setError("Login session expired. Start browser login again.");
      setBusy("idle");
      return;
    }
    // CSRF check is mandatory on EVERY callback path — no exceptions.
    if (!p.state || p.state !== s.state) {
      setError("State mismatch — possible CSRF. Start again.");
      setBusy("idle");
      return;
    }
    if (p.error && !p.code) {
      setError(p.error);
      setBusy("idle");
      return;
    }
    if (!p.code) {
      setError(p.error ?? "No code in callback URL.");
      setBusy("idle");
      return;
    }
    setBusy("exchange");
    setError(null);
    try {
      const session = await exchangeCode(p.code, s.verifier, s.deviceId);
      await clearBrowserLoginState();
      // Fail-closed role gate: missing role must NOT pass.
      const role = String((session.user as { role?: unknown } | undefined)?.role ?? "");
      if (role !== "student") {
        await clearSession();
        setError("This app is for students only.");
        setBusy("idle");
        return;
      }
      const id = (session.user?.id as string | undefined) ?? null;
      if (!id) {
        await clearSession();
        setError("Sign-in failed. Please try again.");
        setBusy("idle");
        return;
      }
      const name =
        typeof (session.user as unknown as { name?: unknown })?.name === "string"
          ? ((session.user as unknown as { name: string }).name as string)
          : null;
      const phone =
        typeof (session.user as unknown as { phone?: unknown })?.phone === "string"
          ? ((session.user as unknown as { phone: string }).phone as string)
          : null;
      onLoginRef.current({ id, name, phone });
    } catch (e) {
      setError(friendlyExchangeError(e));
      setBusy("idle");
    }
  }

  // Catch deep links: cold-start (app launched by URL) + live events
  // + Windows/Linux second-instance forwards (see src-tauri/src/main.rs).
  useEffect(() => {
    let dead = false;
    const unlistens: Array<() => void> = [];
    const seen = new Set<string>();
    const handleOnce = (url: string, s: BrowserLoginState | null) => {
      if (seen.has(url)) return;
      seen.add(url);
      void handleCallback(url, s);
    };
    void readInitialDeepLink().then(async (urls) => {
      if (dead) return;
      for (const hit of urls) handleOnce(hit, pendingRef.current ?? (await readBrowserLoginState()));
    });
    const onUrl = (url: string) => {
      void (async () => handleOnce(url, pendingRef.current ?? (await readBrowserLoginState())))();
    };
    listenDeepLink(onUrl)
      .then((u) => {
        if (dead) u();
        else unlistens.push(u);
      })
      .catch(() => {
        if (!dead) setError("Deep-link plugin unavailable — use the manual paste below.");
      });
    // Second-instance argv forwarded by Rust as `single-instance` event.
    listenSingleInstance(onUrl)
      .then((u) => {
        if (dead) u();
        else unlistens.push(u);
      })
      .catch(() => {
        /* event plugin always present in Tauri; ignore outside Tauri */
      });
    // Don't hang forever on "Waiting for browser login…" — hint at manual paste.
    const timer = window.setTimeout(() => {
      if (!dead) {
        // Only nudge; the listeners stay alive until Cancel.
        setError((prev) => prev ?? "Still waiting — if the browser didn't return, paste the callback URL or code below.");
      }
    }, 120_000);
    return () => {
      dead = true;
      window.clearTimeout(timer);
      for (const u of unlistens) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once deep-link wiring; handleCallback refs are stable via pendingRef/onLoginRef
  }, []);

  async function handleBrowser() {
    setBusy("browser");
    setError(null);
    setAuthorizeUrl(null);
    // Build state + URL FIRST so an opener failure never loses the link.
    // The old code threw the URL away inside startBrowserLogin() and fell
    // back to idle with "copy the link below" but no link shown.
    let s: BrowserLoginState;
    let url: string;
    try {
      s = await newBrowserLoginState();
      url = await buildAuthorizeUrl(s);
    } catch {
      setError("Could not create the login link. Check connection and try again.");
      setBusy("idle");
      return;
    }
    // Sync ref immediately — a fast deep link may arrive before re-render.
    pendingRef.current = s;
    setPending(s);
    setAuthorizeUrl(url);
    // busy stays "browser" until the callback (or cancel) resolves it —
    // even when auto-open fails, so the copy/paste fallback stays visible.
    try {
      await openInBrowser(url);
    } catch {
      setError("Could not open the system browser automatically. Copy the login link below manually.");
    }
  }

  function cancelBrowser() {
    void clearBrowserLoginState();
    pendingRef.current = null;
    setPending(null);
    setAuthorizeUrl(null);
    setManualUrl("");
    setError(null);
    setBusy("idle");
  }

  async function handleManualUrl(e: React.FormEvent) {
    e.preventDefault();
    const s = pendingRef.current ?? (await readBrowserLoginState());
    const raw = manualUrl.trim();
    if (!raw) {
      setError("Paste the full callback URL or code from the browser first.");
      return;
    }
    if (!s) {
      setError("Login session expired. Start browser login again.");
      return;
    }
    // Accept FULL callback URL (preferred) or RAW code (web "copy code" fallback).
    const parsed = parseManualCallbackInput(raw, s);
    if (parsed.error && !parsed.code) {
      setError(parsed.error);
      return;
    }
    const url =
      raw.includes("://") || raw.toLowerCase().startsWith("bestway-exam:")
        ? raw
        : `bestway-exam://auth/callback?code=${encodeURIComponent(parsed.code!)}&state=${encodeURIComponent(parsed.state!)}`;
    await handleCallback(url, s);
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    if (cooldownUntil != null && Date.now() < cooldownUntil) {
      const sec = Math.ceil((cooldownUntil - Date.now()) / 1000);
      setError(`Too many attempts. Try again in ${sec}s.`);
      return;
    }
    // Normalize like web (login-form.tsx): strip spaces so
    // "+998 90 123 45 67" matches stored "+998901234567".
    const normalizedPhone = phone.replace(/\s/g, "");
    if (!normalizedPhone || !password) {
      setError("Enter phone number and password.");
      return;
    }
    setBusy("password");
    setError(null);
    try {
      const session = await login(normalizedPhone, password);
      setFailedAttempts(0);
      setCooldownUntil(null);
      // Fail-closed: missing/unknown role must NOT default to student.
      const role = String(session.user?.role ?? "");
      if (role !== "student") {
        await clearSession();
        setError("This app is for students only.");
        setBusy("idle");
        return;
      }
      if (!session.user?.id) {
        await clearSession();
        setError("Sign-in failed. Please try again.");
        setBusy("idle");
        return;
      }
      onLogin({ id: session.user.id, name: session.user.name ?? null, phone: session.user.phone ?? null });
    } catch (err) {
      const nextFails = failedAttempts + 1;
      setFailedAttempts(nextFails);
      if (nextFails >= 3) {
        setCooldownUntil(Date.now() + 30_000);
      }
      const apiErr = err as { code?: string; message?: string } | null;
      const msg =
        typeof apiErr?.message === "string" && apiErr.message
          ? apiErr.code
            ? `${apiErr.message} (${apiErr.code})`
            : apiErr.message
          : err instanceof Error
            ? err.message
            : "Login failed. Check phone/password.";
      setError(nextFails >= 3 ? `${msg} — cooldown 30s after 3 fails.` : msg);
      setBusy("idle");
    }
  }

  // OAuth flow is active (a browser round-trip is in flight or finishing).
  const oauthActive = busy === "browser" || busy === "exchange";
  const pwBusy = busy === "password" || busy === "exchange";
  const inCooldown = cooldownUntil != null && Date.now() < cooldownUntil;
  const cooldownSec = inCooldown ? Math.ceil((cooldownUntil! - Date.now()) / 1000) : 0;

  return (
    <section className="mx-auto w-full max-w-[440px]">
      <div className="card rounded-3xl p-8 shadow-[0_24px_80px_rgba(0,0,0,0.55)] sm:p-10">
        {/* Brand header */}
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-lg font-black text-black shadow-[0_0_28px_rgba(56,199,101,0.5)]">
            B
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[19px] font-bold tracking-tight text-white">Bestway Exam</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">
              Student lockdown client
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-white/35">
            <Icon size={13}>
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
              <path d="m9 12 2 2 4-4" />
            </Icon>
            Secure Access
          </div>
        </div>

        {mode === "oauth" ? (
          <div key="oauth" className="animate-view">
            <h2 className="mt-10 text-[32px] font-bold leading-[1.15] tracking-tight text-white">
              Log in <span className="text-emerald-400">to&nbsp;continue</span>
            </h2>
            <p className="mt-2 text-sm text-white/50">Open the link in your browser to sign in.</p>

            {oauthActive ? (
              <div className="mt-6">
                {busy === "exchange" ? (
                  <p className="flex items-center gap-2.5 text-[13px] font-medium text-emerald-300" role="status">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-400/15 ring-1 ring-emerald-400/40">
                      <Icon size={12}>
                        <path d="M20 6 9 17l-5-5" />
                      </Icon>
                    </span>
                    Login successful
                  </p>
                ) : (
                  <p className="flex items-center gap-2.5 text-[13px] text-white/60" role="status">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                    {authorizeUrl ? "Continue in your browser" : "Waiting for browser…"}
                  </p>
                )}

                {authorizeUrl && (
                  <>
                    <div className="mt-3 flex h-[54px] items-center gap-2.5 rounded-2xl border border-white/10 bg-black/50 pl-3.5 pr-2 transition focus-within:border-emerald-400/60 hover:border-white/20">
                      <span className="shrink-0 text-white/35">
                        <Icon>
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </Icon>
                      </span>
                      <input
                        readOnly
                        value={authorizeUrl}
                        onFocus={(e) => e.target.select()}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="Login link"
                        className="min-w-0 flex-1 truncate bg-transparent font-mono text-xs text-emerald-200/90 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void copyAuthorize()}
                        title={copied ? "Copied" : "Copy link"}
                        aria-label={copied ? "Copied" : "Copy login link"}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white/50 transition hover:bg-white/5 hover:text-white"
                      >
                        {copied ? (
                          <span className="text-emerald-300">
                            <Icon>
                              <path d="M20 6 9 17l-5-5" />
                            </Icon>
                          </span>
                        ) : (
                          <Icon>
                            <rect width="14" height="14" x="8" y="8" rx="2" />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                          </Icon>
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        // Never a plain <a href>: navigating the kiosk webview to an
                        // external origin would load untrusted content with IPC access.
                        // Route via the opener plugin (system browser, allowlisted).
                        void openInBrowser(authorizeUrl).catch(() => {
                          setError("Could not open the system browser automatically. Copy the login link above manually.");
                        });
                      }}
                      className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-300/90 transition hover:text-emerald-200"
                    >
                      Open login link
                      <Icon size={13}>
                        <path d="M15 3h6v6" />
                        <path d="M10 14 21 3" />
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      </Icon>
                    </button>
                  </>
                )}

                {error && <InlineError message={error} />}

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-white/40 transition hover:text-white/70">
                    Trouble? Paste a code instead
                  </summary>
                  <form onSubmit={handleManualUrl} className="mt-2 flex gap-2">
                    <input
                      value={manualUrl}
                      onChange={(e) => setManualUrl(e.target.value)}
                      placeholder="bestway-exam://auth/callback?code=… or paste code"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Callback URL or code"
                      className="field min-w-0 flex-1 rounded-xl px-3.5 py-2 font-mono text-xs"
                    />
                    <button
                      type="submit"
                      className="btn-ghost shrink-0 rounded-xl px-3.5 py-2 text-xs font-medium text-white"
                    >
                      Verify
                    </button>
                  </form>
                </details>

                <button
                  type="button"
                  onClick={cancelBrowser}
                  className="mt-4 w-full text-center text-xs text-white/40 transition hover:text-white/70"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-6">
                <button
                  onClick={handleBrowser}
                  disabled={busy !== "idle"}
                  className="btn-brand flex h-[54px] w-full items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold disabled:opacity-60"
                >
                  <Icon size={17}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </Icon>
                  Continue in browser
                  <Icon size={16}>
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </Icon>
                </button>
                {error && <InlineError message={error} />}
              </div>
            )}

            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode("manual");
                }}
                className="text-[13px] font-medium text-white/45 transition hover:text-emerald-300"
              >
                Sign in manually →
              </button>
            </div>
          </div>
        ) : (
          <div key="manual" className="animate-view">
            <button
              type="button"
              onClick={() => {
                if (pwBusy) return;
                setError(null);
                setMode("oauth");
              }}
              className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-white/45 transition hover:text-white"
            >
              <Icon size={15}>
                <path d="m12 19-7-7 7-7" />
                <path d="M19 12H5" />
              </Icon>
              Back
            </button>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white">Login manually</h2>
            <p className="mt-1.5 text-sm text-white/50">Enter your account details.</p>

            <form onSubmit={handlePassword} className="mt-6 space-y-3">
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35">
                  <Icon>
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                  </Icon>
                </span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+998 __ ___ __ __"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-label="Phone number"
                  disabled={pwBusy}
                  className="field h-[52px] w-full rounded-xl pl-10 pr-4 text-[15px] disabled:opacity-60"
                />
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35">
                  <Icon>
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </Icon>
                </span>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  aria-label="Password"
                  disabled={pwBusy}
                  className="field h-[52px] w-full rounded-xl pl-10 pr-12 text-[15px] disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  title={showPw ? "Hide password" : "Show password"}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  aria-pressed={showPw}
                  className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-white/40 transition hover:bg-white/5 hover:text-white"
                >
                  {showPw ? (
                    <Icon>
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" x2="22" y1="2" y2="22" />
                    </Icon>
                  ) : (
                    <Icon>
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </Icon>
                  )}
                </button>
              </div>

              {error && <InlineError message={error} />}

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={pwBusy || inCooldown}
                  className="btn-brand flex h-[52px] w-full items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold disabled:opacity-60"
                >
                  {pwBusy ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin rounded-full border-2 border-black/25 border-t-black"
                      />
                      Signing in…
                    </>
                  ) : inCooldown ? (
                    <>Try again in {cooldownSec}s</>
                  ) : (
                    <>
                      Sign in
                      <Icon size={16}>
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </Icon>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-white/30">
        <Icon size={12}>
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </Icon>
        Your connection is secure.
      </p>
    </section>
  );
}

function Icon({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-xs leading-relaxed text-red-300"
    >
      <span className="mt-px shrink-0">
        <Icon size={14}>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </Icon>
      </span>
      <span>{message}</span>
    </p>
  );
}

function friendlyExchangeError(e: unknown): string {
  const code =
    typeof e === "object" && e !== null
      ? ((e as { code?: unknown }).code as string | undefined)
      : undefined;
  const message =
    typeof e === "object" && e !== null
      ? ((e as { message?: unknown }).message as string | undefined)
      : undefined;
  const status =
    typeof e === "object" && e !== null
      ? ((e as { status?: unknown }).status as number | undefined)
      : undefined;
  if (status === 404 || code === "HTTP_404") {
    return "Browser sign-in is unavailable right now. Please sign in with phone and password instead.";
  }
  if (code === "INVALID_DESKTOP_CODE") return "Invalid code. Start browser login again.";
  if (code === "INVALID_REDIRECT") return "App/Server redirect mismatch. Update both to bestway-exam://auth/callback.";
  if (code === "DESKTOP_CODE_EXPIRED") return "Code expired (5 min). Start browser login again.";
  if (code === "DESKTOP_CODE_USED") return "Code already used. Start browser login again.";
  if (code === "DEVICE_MISMATCH") return "Code was created for another device. Start again on this device.";
  if (code === "INVALID_VERIFIER") return "Security check failed. Start browser login again.";
  if (code === "NOT_A_STUDENT") return "This app is for students only.";
  if (code === "USER_DEACTIVATED") return "Account blocked. Contact administration.";
  if (typeof message === "string" && message && code) return `${message} (${code})`;
  if (e instanceof Error && e.message) return e.message;
  return "Code exchange failed. Check connection and try again.";
}
