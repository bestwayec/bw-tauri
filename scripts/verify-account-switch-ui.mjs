import { chromium, expect } from "@playwright/test";

const web = new URL(process.env.BW_WEB_URL ?? "http://localhost:3007");
const desktop = new URL(process.env.BW_DESKTOP_URL ?? "http://localhost:1423");
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (![web, desktop].every(url => url.protocol === "http:" && loopback.has(url.hostname))) {
  throw new Error("Use local test services");
}
const { BW_TEACHER_PHONE: teacher, BW_STUDENT_PHONE: student, BW_TEST_PASSWORD: password } = process.env;
if (!teacher || !student || !password) throw new Error("Provide synthetic account credentials");

async function webLogin(page, phone, reauth = false) {
  await page.goto(new URL("/en/login" + (reauth ? "?reauth=1" : ""), web).href, { waitUntil: "domcontentloaded" });
  await page.locator("#phone").fill(phone);
  await page.locator("#password").fill(password);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/teacher|dashboard/);
}

async function desktopLogin(page, phone) {
  await page.goto(desktop.href, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in manually" }).click();
  await page.getByRole("textbox", { name: "Phone number" }).fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === "/v1/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  return login;
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, headless: true });
try {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  await webLogin(first, teacher);
  const name = "Local account switch " + Date.now();
  const response = await first.request.post(new URL("/api/backend/groups", web).href, { data: { name } });
  expect(response.status()).toBe(201);
  const group = (await response.json()).data;
  const url = new URL("/en/groups/" + group.id, web).href;
  await first.goto(url);
  await expect(first.getByRole("heading", { name, exact: true })).toBeVisible();
  const reload = first.waitForEvent("framenavigated", { predicate: frame => frame === first.mainFrame() });
  await webLogin(second, student, true);
  await reload;
  await expect(first.getByRole("heading", { name, exact: true })).toHaveCount(0);
  expect((await first.request.get(new URL("/api/backend/groups/" + group.id, web).href)).status()).toBe(403);
  console.log("PASS shared-cookie website tab clears teacher group after a real student login");

  const nativeFrontend = await browser.newPage();
  await desktopLogin(nativeFrontend, teacher);
  await nativeFrontend.getByRole("button", { name: /Groups & Results/ }).first().click();
  await nativeFrontend.getByRole("combobox").first().selectOption(group.id);
  await expect(nativeFrontend.getByRole("heading", { name, exact: true })).toBeVisible();
  await nativeFrontend.getByRole("button", { name: /^Settings/ }).first().click();
  nativeFrontend.once("dialog", dialog => dialog.accept());
  await nativeFrontend.getByRole("button", { name: /Log out|Sign out/i }).click();
  await expect(nativeFrontend.getByRole("button", { name: "Sign in manually" })).toBeVisible();
  await desktopLogin(nativeFrontend, student);
  await nativeFrontend.getByRole("button", { name: /Vocabulary/ }).first().click();
  await expect(nativeFrontend.getByRole("heading", { name: "Assigned vocabulary" })).toBeVisible();
  await expect(nativeFrontend.getByRole("button", { name: /Groups & Results/ })).toHaveCount(0);
  await expect(nativeFrontend.getByText(name, { exact: true })).toHaveCount(0);
  console.log("PASS desktop teacher → student account switch clears teacher data and navigation");

  const revokedDevice = await browser.newPage();
  const login = await desktopLogin(revokedDevice, teacher);
  const loginUrl = new URL(login.url());
  if (!loopback.has(loginUrl.hostname)) throw new Error("Revocation fixture requires the local API");
  const { refreshToken } = (await login.json()).data;
  await revokedDevice.getByRole("button", { name: /Groups & Results/ }).first().click();
  await revokedDevice.getByRole("combobox").first().selectOption(group.id);
  await expect(revokedDevice.getByRole("heading", { name, exact: true })).toBeVisible();
  const revocation = await browser.newContext();
  expect((await revocation.request.post(new URL("logout-refresh", loginUrl).href, { data: { refreshToken } })).status()).toBe(200);
  await revokedDevice.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(revokedDevice.getByRole("button", { name: "Sign in manually" })).toBeVisible();
  await expect(revokedDevice.getByRole("heading", { name, exact: true })).toHaveCount(0);
  await expect(nativeFrontend.getByRole("heading", { name: "Assigned vocabulary" })).toBeVisible();
  console.log("PASS server-revoked desktop removes cached teacher data on focus without affecting the other account");
} finally {
  await browser.close();
}
