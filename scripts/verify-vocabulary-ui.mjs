import { chromium, expect } from "@playwright/test";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !loopback.has(url.hostname)) {
    throw new Error("Use a disposable local Bestway API, website and Vite server.");
  }
  return url.href.replace(/\/$/, "");
}
const desktop = localUrl(process.env.BW_DESKTOP_URL ?? "http://localhost:1423");
const web = localUrl(process.env.BW_WEB_URL ?? "http://localhost:3007");
const api = localUrl(process.env.BW_API_URL ?? "http://127.0.0.1:3104/v1");
const teacherPhone = process.env.BW_TEACHER_PHONE;
const studentPhone = process.env.BW_STUDENT_PHONE;
const password = process.env.BW_TEST_PASSWORD;
const studentName = process.env.BW_STUDENT_NAME;
if (!teacherPhone || !studentPhone || !password || !studentName) throw new Error("Provide synthetic local credentials and the student name.");

const pairs = Array.from({length:30}, (_, i) => [`English item ${i+1}`, `Uzbek item ${i+1}`]);
const answerFor = new Map(pairs.flatMap(([en, uz]) => [[en,uz],[uz,en]]));

async function webLogin(page, phone) {
  await page.goto(web + '/en/login');
  await page.locator('#phone').fill(phone);
  await page.locator('#password').fill(password);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(/teacher|dashboard/);
}

async function desktopLogin(page, phone) {
  await page.goto(desktop);
  await page.getByRole('button', {name:'Sign in manually'}).click();
  await page.getByRole('textbox', {name:'Phone number'}).fill(phone);
  await page.getByLabel('Password', {exact:true}).fill(password);
  await page.getByRole('button', {name:'Sign in', exact:true}).click();
}

async function answer(page, questions, resolve, button = 'Submit answers') {
  for (const [i, q] of questions.entries()) {
    await expect(page.getByText(`Question ${i+1} / ${questions.length}`, {exact:true})).toBeVisible();
    const value = resolve(q,i);
    if (q.options.length) await page.getByRole('radio',{name:value,exact:true}).check();
    else await page.getByRole('textbox',{name:'Answer',exact:true}).fill(value);
    if (i+1<questions.length) await page.getByRole('button',{name:'Next question'}).click();
  }
  await page.getByRole('button',{name:button}).click();
}

(async()=>{
  const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,headless:true});
  try {
    const site = await browser.newPage();
    await webLogin(site,teacherPhone);
    const newGroup = await site.request.post(web+'/api/backend/groups',{data:{name:'Local Vocabulary '+Date.now()}});
    expect(newGroup.status()).toBe(201);
    const group = (await newGroup.json()).data;
    const users = (await (await site.request.get(web+'/api/backend/users?role=student&search=Local%20Student%20Two')).json()).data;
    const enrollment = await site.request.post(web+'/api/backend/groups/'+group.id+'/students',{data:{studentId:users.find(u=>u.name===studentName).id}});
    expect(enrollment.status()).toBe(201);
    await site.goto(web+'/en/vocabulary');
    await site.getByRole('button',{name:'New vocabulary set'}).click();
    const collectionTitle = 'Local 30 words '+Date.now();
    await site.locator('#vb-title').fill(collectionTitle);
    await site.getByRole('button',{name:'Smart Paste',exact:true}).click();
    await site.getByRole('textbox',{name:'Smart Paste'}).fill(pairs.map(p=>p.join(' - ')).join('\n'));
    await site.getByRole('button',{name:'Read the text',exact:true}).click();
    await site.getByRole('button',{name:'Add 30 words to the set'}).click();
    await site.getByRole('checkbox',{name:'Visible in the classroom catalog'}).uncheck();
    await site.getByRole('button',{name:'Publish the vocabulary set'}).click();
    await expect(site.getByText(collectionTitle,{exact:true})).toBeVisible({timeout:30000});
    console.log('PASS teacher previews and publishes 30 words through the existing website builder');

    await site.goto(web+'/en/groups/'+group.id);
    await site.getByRole('textbox',{name:'Task title',exact:true}).fill(collectionTitle);
    await site.getByRole('combobox',{name:/Vocabulary collection/}).selectOption({label:collectionTitle+' (30)'});
    await site.getByRole('button',{name:'Assign task',exact:true}).click();
    await expect(site.getByRole('button',{name:'Vocabulary results'})).toBeVisible();

    const learner = await browser.newPage();
    await desktopLogin(learner,studentPhone);
    await learner.getByRole('button',{name:/Vocabulary/}).first().click();
    await expect(learner.getByRole('listitem').filter({hasText:collectionTitle})).toBeVisible();
    await learner.getByRole('listitem').filter({hasText:collectionTitle}).getByRole('button',{name:'Study vocabulary'}).click();
    const flash = learner.getByRole('button',{name:/^English item/}).first();
    await flash.click();
    await expect(learner.getByRole('button',{name:/^Uzbek item/}).first()).toBeVisible();
    const issued = learner.waitForResponse(r => /\/student\/assignments\/[^/]+\/vocabulary$/.test(r.url()) && r.request().method()==='POST');
    await learner.getByRole('button',{name:'Mixed practice',exact:true}).click();
    const session = (await (await issued).json()).data;
    expect(session.questions).toHaveLength(30);
    expect(new Set(session.questions.map(q=>q.type)).size).toBe(3);
    const submit = learner.waitForResponse(r => /\/student\/assignments\/[^/]+\/vocabulary\/submit$/.test(r.url()));
    await answer(learner,session.questions,(q)=>answerFor.get(q.prompt));
    expect((await (await submit).json()).data.score).toBe(30);
    await expect(learner.getByText('30 / 30 · 100%',{exact:true})).toBeVisible();
    console.log('PASS desktop browser flashcards, translation, spelling and real 30/30 server scoring');

    await site.getByRole('button',{name:'Vocabulary results'}).click();
    await expect(site.getByText(studentName+' · 100%',{exact:true})).toBeVisible();
    const teacherDesktop = await browser.newPage();
    await desktopLogin(teacherDesktop,teacherPhone);
    await teacherDesktop.getByRole('button',{name:/Groups & Results/}).first().click();
    await teacherDesktop.getByRole('combobox').first().selectOption(group.id);
    await teacherDesktop.getByRole('button',{name:'Lug‘at natijalari'}).click();
    await expect(teacherDesktop.getByText(studentName+' · 100%',{exact:true})).toBeVisible();
    console.log('PASS website and desktop teacher reports show the same server result');

    const studentWeb = await browser.newPage();
    await webLogin(studentWeb, studentPhone);
    const uniqueReview = 'local review '+Date.now();
    const reviewResponse = await studentWeb.request.post(web+'/api/backend/vocabulary/srs/add-word',{
      data:{english:uniqueReview,uzbek:'takrorlash'},
    });
    expect(reviewResponse.status()).toBe(201);
    answerFor.set(uniqueReview,'takrorlash'); answerFor.set('takrorlash',uniqueReview);
    const reviewIssued = learner.waitForResponse(r=>r.url()===api+'/vocabulary/srs/quiz');
    await learner.getByRole('button',{name:'Start daily review'}).click();
    const review = (await (await reviewIssued).json()).data;
    expect(review.questions.length).toBeGreaterThan(0);
    await answer(learner,review.questions,q=>answerFor.get(q.prompt) ?? q.options[0] ?? 'review answer');
    await expect(learner.getByRole('heading',{name:'Vocabulary result'})).toBeVisible();
    const stats = (await (await studentWeb.request.get(web+'/api/backend/vocabulary/srs/stats')).json()).data;
    expect(stats.weakWords.find(item=>item.english===uniqueReview).nextReviewAt).toBeTruthy();
    await learner.reload();
    await learner.getByRole('button',{name:/Vocabulary/}).first().click();
    await expect(learner.getByRole('listitem').filter({hasText:collectionTitle}).getByRole('button',{name:'Review result · 100%'})).toBeVisible();
    await learner.getByRole('button',{name:/^Profile/}).first().click();
    learner.once("dialog", dialog => dialog.accept());
    await learner.getByRole('button',{name:'Log out',exact:true}).click();
    await expect(learner.getByRole('button',{name:'Sign in manually'})).toBeVisible();
    await desktopLogin(learner,studentPhone);
    await learner.getByRole('button',{name:/Vocabulary/}).first().click();
    await expect(learner.getByRole('listitem').filter({hasText:collectionTitle}).getByRole('button',{name:'Review result · 100%'})).toBeVisible();

    const raceWord = 'local concurrent review ' + Date.now();
    await studentWeb.request.post(web+'/api/backend/vocabulary/srs/add-word',{data:{english:raceWord,uzbek:'mashq'}});
    const race = (await (await studentWeb.request.get(web+'/api/backend/vocabulary/srs/quiz')).json()).data;
    const raceAnswers = race.questions.map(q=>({
      wordId:q.wordId, answer:q.prompt===raceWord ? 'mashq' : q.prompt==='mashq' ? raceWord : q.options[0] ?? 'review answer',
    }));
    const submitReview = () => studentWeb.request.post(web+'/api/backend/vocabulary/srs/submit',{
      data:{sessionId:race.sessionId,answers:raceAnswers},
    });
    const responseCodes = (await Promise.all([submitReview(), submitReview()])).map(response=>response.status()).sort();
    expect(responseCodes).toEqual([200,409]);
    console.log('PASS review schedule persists, result survives reload and reauthentication, and concurrent review applies once');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
