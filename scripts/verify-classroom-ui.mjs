import { chromium, expect } from "@playwright/test";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const webUrl = new URL(process.env.BW_WEB_URL ?? "http://localhost:3007");
const desktopUrl = new URL(process.env.BW_DESKTOP_URL ?? "http://localhost:1423");
if (![webUrl, desktopUrl].every(url => loopback.has(url.hostname) && url.protocol === "http:")) {
  throw new Error("Use a disposable local Bestway backend and Vite server.");
}
const phone = process.env.BW_TEACHER_PHONE;
const password = process.env.BW_TEACHER_PASSWORD;
const studentName = process.env.BW_STUDENT_NAME;
if (!phone || !password || !studentName) throw new Error("Provide synthetic teacher credentials and the name of a disposable student.");

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, headless:true });
  try {
    const desktop = await browser.newPage();
    await desktop.goto(desktopUrl.href);
    await desktop.getByRole('button', {name:'Sign in manually'}).click();
    await desktop.getByRole('textbox', {name:'Phone number'}).fill(phone);
    await desktop.getByLabel('Password', {exact:true}).fill(password);
    await desktop.getByRole('button', {name:'Sign in', exact:true}).click();
    await desktop.getByRole('button', {name:/Groups & Results/}).first().click();
    await desktop.getByRole('button',{name:'Yangi guruh yaratish'}).click();
    const name = 'Local Stage 02 ' + Date.now();
    await desktop.getByRole('textbox',{name:'Guruh nomi',exact:true}).fill(name);
    const create = desktop.waitForResponse(r => r.url().endsWith('/v1/groups') && r.request().method()==='POST');
    await desktop.getByRole('button',{name:'Saqlash',exact:true}).click();
    const response = await create;
    expect(response.status()).toBe(201);
    const group = (await response.json()).data;
    const roster = desktop.getByRole('region',{name:'Guruh ish maydoni'}).locator('section').first();
    await roster.getByRole('textbox',{name:'Qo‘shish uchun o‘quvchi qidiring'}).fill(studentName);
    await roster.getByRole('button',{name:'Qidirish'}).click();
    await roster.getByRole('button',{name:'Qo‘shish',exact:true}).click();
    await expect(roster.getByRole('button',{name:'Olib tashlash',exact:true})).toBeVisible();
    const attendance = desktop.locator('section').filter({has: desktop.getByRole('heading',{name:'Davomat',exact:true})}).last();
    await attendance.locator('select').first().selectOption({label:studentName});
    await attendance.locator('select').nth(1).selectOption('late');
    await attendance.getByRole('button',{name:'Davomatni saqlash'}).click();
    await expect(attendance.getByText(studentName + ' · Kechikdi')).toBeVisible();
    const title = 'Desktop classroom task ' + Date.now();
    await desktop.getByRole('textbox',{name:'Vazifa nomi',exact:true}).fill(title);
    await desktop.getByRole('button',{name:'Vazifa berish',exact:true}).click();
    await expect(desktop.getByText(title,{exact:false})).toBeVisible();
    console.log('PASS desktop create, enroll, mark late, and publish a classroom task over real HTTP');
    const web = await browser.newPage();
    await web.goto(new URL('/en/login', webUrl).href);
    await web.locator('#phone').fill(phone);
    await web.locator('#password').fill(password);
    await web.locator('form button[type=submit]').click();
    await web.waitForURL(/teacher|dashboard/);
    await web.goto(new URL('/en/groups/' + encodeURIComponent(group.id), webUrl).href);
    await expect(web.getByText(title,{exact:true})).toBeVisible({timeout:60000});
    await expect(web.getByText(studentName,{exact:true}).first()).toBeVisible();
    const title2 = 'Website classroom task ' + Date.now();
    await web.getByRole('textbox',{name:'Task title',exact:true}).fill(title2);
    await web.getByRole('button',{name:'Assign task',exact:true}).click();
    await expect(web.getByText(title2,{exact:true})).toBeVisible();
    await desktop.reload();
    await desktop.getByRole('button', {name:/Groups & Results/}).first().click();
    await desktop.getByRole('combobox').first().selectOption(group.id);
    await expect(desktop.getByText(title2,{exact:false})).toBeVisible();
    const updatedRoster = desktop.getByRole('region',{name:'Guruh ish maydoni'}).locator('section').first();
    await updatedRoster.getByRole('button',{name:'Olib tashlash',exact:true}).click();
    await updatedRoster.getByRole('button',{name:'Olib tashlashni tasdiqlash'}).click();
    await expect(updatedRoster.getByRole('button',{name:'Olib tashlash',exact:true})).toHaveCount(0);
    console.log('PASS website and desktop show the same persisted group and tasks, desktop removes confirmed membership');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
