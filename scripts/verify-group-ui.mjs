import { chromium, expect } from "@playwright/test";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const web = new URL(process.env.BW_DESKTOP_URL ?? "http://localhost:1422");
const api = new URL(process.env.BW_API_URL ?? "http://127.0.0.1:3103/v1/");
if (![web, api].every(url => loopback.has(url.hostname) && url.protocol === "http:")) {
  throw new Error("Use a disposable local Bestway backend and Vite server.");
}

const phone = process.env.BW_TEACHER_PHONE;
const password = process.env.BW_TEACHER_PASSWORD;
if (!phone || !password) throw new Error("Set the disposable local teacher credentials.");

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, headless:true });
  try {
    const page = await browser.newPage();
    await page.goto(web.href);
    await page.getByRole('button', {name:'Sign in manually'}).click();
    await page.getByRole('textbox', {name:'Phone number'}).fill(phone);
    await page.getByLabel('Password', {exact:true}).fill(password);
    await page.getByRole('button', {name:'Sign in', exact:true}).click();
    await page.getByRole('button', {name:/Groups & Results/}).first().click();
    await expect(page.getByRole('heading',{name:'Guruhlar va natijalar'})).toBeVisible();
    await page.getByRole('button',{name:'Yangi guruh yaratish'}).click();
    const name = 'Local Stage 01 ' + Date.now();
    const field = page.getByRole('textbox',{name:'Guruh nomi'});
    await field.fill(name);
    await page.locator('form select').selectOption('thu');
    const groups = new URL('groups', api).href;
    await page.route(groups, async route => {
      if (route.request().method() === 'POST') await route.abort();
      else await route.continue();
    });
    await page.getByRole('button',{name:'Saqlash',exact:true}).click();
    await expect(page.locator('form [role=alert]')).toBeVisible();
    await expect(field).toHaveValue(name);
    await expect(page.locator('form select')).toHaveValue('thu');
    await expect(page.getByRole('option',{name})).toHaveCount(0);
    console.log('PASS simulated transport failure leaves form values and creates no displayed group');
    await page.unroute(groups);
    const response = page.waitForResponse(res => res.url()===groups && res.request().method()==='POST');
    await page.getByRole('button',{name:'Saqlash',exact:true}).click();
    const created = await response;
    expect(created.status()).toBe(201);
    const body = await created.json();
    expect(body.data.schedule[0].day).toBe('thu');
    await expect(page.getByRole('option',{name})).toBeAttached();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    console.log('PASS actual Django/PostgreSQL 201 and saved schedule are visible in desktop Vite');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
