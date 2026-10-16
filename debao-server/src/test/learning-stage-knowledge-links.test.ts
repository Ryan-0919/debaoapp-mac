import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {handle, store} from '../main.js';
import {createStore} from '../store.js';

// Each scenario gets a fresh in-memory fixture, and leaves other tests unchanged.
async function isolated(run: (base: string) => Promise<void>) {
  const previous = {...store};
  Object.assign(store, createStore(true));
  try { await withServer(run); } finally { Object.assign(store, previous); }
}

const coursePoint = 'objective-point-civil-act-effect';
const subPoint = 'objective-subpoint-civil-act-limited';
const auth = {authorization: 'Bearer demo-token', 'content-type': 'application/json'};

function curriculum() {
  const now = new Date().toISOString();
  store.learningCards.push({id: 'scope-card', title: '本课背诵卡片', contentType: 'image_gallery', assets: [], recallItems: [], sortOrder: 1, status: 'published', version: 1, createdAt: now, updatedAt: now});
  store.learningStagePlanItems = [
    {id: 'lesson', stageId: 'stage-foundation', contentType: 'course', title: '本课听课', description: '站外听课后打卡', knowledgePointIds: [coursePoint], sortOrder: 10, weekDay: 1, required: true},
    {id: 'card', stageId: 'stage-foundation', contentType: 'card', title: '本课背诵', contentId: 'scope-card', knowledgePointIds: [subPoint], sortOrder: 20, weekDay: 2, required: true},
    {id: 'questions', stageId: 'stage-foundation', contentType: 'question', title: '本课练习', knowledgePointIds: [subPoint], questionCount: 5, sortOrder: 30, weekDay: 2, required: true},
  ];
}

async function preview(base: string) {
  const headers = jsonHeaders(await adminSession(base));
  const response = await fetch(`${base}/v1/admin/learning-coach/stages/stage-foundation/plan/weekly-preview`, {method: 'POST', headers, body: JSON.stringify({startDate: '2026-10-01'})});
  const result = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(result));
  return result.data.days.flatMap((day: any) => day.tasks) as Array<{contentType: string; contentId?: string}>;
}

test('automatic practice includes only published in-scope questions even when fewer than requested', async () => isolated(async base => {
  curriculum();
  const source = store.learningQuestionBankQuestions[0];
  store.learningQuestionBankQuestions.push(
    {...source, id: 'outside-course', pointId: 'other-point', subPointId: undefined},
    {...source, id: 'draft-in-scope', status: 'draft'},
    {...source, id: 'disabled-in-scope', status: 'disabled'},
    {...source, id: 'sibling-subpoint', subPointId: 'other-subpoint'},
  );
  const questions = (await preview(base)).filter(task => task.contentType === 'question');
  assert.deepEqual(questions.map(task => task.contentId), [source.id]);
}));

test('empty matching pool never creates an unscoped question task', async () => isolated(async base => {
  curriculum();
  store.learningQuestionBankQuestions = store.learningQuestionBankQuestions.map(question => ({...question, pointId: 'outside', subPointId: undefined}));
  const questions = (await preview(base)).filter(task => task.contentType === 'question');
  assert.equal(questions.length, 0, 'A question without contentId opens unrestricted practice in the App');
}));

test('automatic cards use published cards matching the stage knowledge points', async () => isolated(async base => {
  curriculum();
  const now = new Date().toISOString();
  store.learningCards.push(
    {id: 'matching-card', title: '匹配考点卡片', contentType: 'image_gallery', assets: [], recallItems: [], knowledgePointIds: [subPoint], sortOrder: 2, status: 'published', version: 1, createdAt: now, updatedAt: now, publishedAt: now},
    {id: 'outside-card', title: '无关考点卡片', contentType: 'image_gallery', assets: [], recallItems: [], knowledgePointIds: ['other-point'], sortOrder: 3, status: 'published', version: 1, createdAt: now, updatedAt: now, publishedAt: now},
  );
  store.learningStagePlanItems[1] = {...store.learningStagePlanItems[1], contentId: undefined};
  const tasks = await preview(base);
  const cards = tasks.filter(task => task.contentType === 'card');
  assert.deepEqual(cards.map(task => task.contentId), ['matching-card']);
}));

test('publish rejects a mixture of taught and untaught points', async () => isolated(async base => {
  curriculum();
  store.learningStagePlanItems[2].knowledgePointIds = [coursePoint, 'untaught'];
  const headers = jsonHeaders(await adminSession(base));
  const response = await fetch(`${base}/v1/admin/learning-coach/stages/stage-foundation/plan/publish`, {method: 'POST', headers, body: '{}'});
  assert.equal(response.status, 422);
}));

test('a taught subpoint cannot authorize the whole parent point', async () => isolated(async base => {
  curriculum();
  store.learningStagePlanItems[0].knowledgePointIds = [subPoint];
  store.learningStagePlanItems[2].knowledgePointIds = [coursePoint];
  const headers = jsonHeaders(await adminSession(base));
  const response = await fetch(`${base}/v1/admin/learning-coach/stages/stage-foundation/plan/publish`, {method: 'POST', headers, body: '{}'});
  assert.equal(response.status, 422);
}));

test('a future lesson does not count as prior knowledge even if listed first', async () => isolated(async base => {
  curriculum();
  store.learningStagePlanItems[0].weekDay = 7;
  const headers = jsonHeaders(await adminSession(base));
  const response = await fetch(`${base}/v1/admin/learning-coach/stages/stage-foundation/plan/publish`, {method: 'POST', headers, body: '{}'});
  assert.equal(response.status, 422);
}));

test('a taught parent point allows cards and questions at its subpoint', async () => isolated(async base => {
  curriculum();
  const headers = jsonHeaders(await adminSession(base));
  const response = await fetch(`${base}/v1/admin/learning-coach/stages/stage-foundation/plan/publish`, {method: 'POST', headers, body: '{}'});
  assert.equal(response.status, 200);
}));

test('same-day tasks enforce course then card then practice regardless of random ID ordering', async () => isolated(async base => {
  curriculum();
  const today = new Date().toISOString().slice(0, 10);
  store.learningPlans = [{id: 'flow-plan', userId: 'u-demo', title: '闭环测试', dailyMinutes: 60, startDate: today, endDate: today, status: 'active', stageId: 'stage-foundation'}];
  // UUID order must not determine which prerequisite tasks exist.
  store.learningTasks = [
    {id: 'z-course', planId: 'flow-plan', title: '听课', dueDate: today, minutes: 20, status: 'todo', contentType: 'course'},
    {id: 'a-card', planId: 'flow-plan', title: '背诵', dueDate: today, minutes: 20, status: 'todo', contentType: 'card', contentId: 'scope-card'},
    {id: 'b-question', planId: 'flow-plan', title: '练习', dueDate: today, minutes: 20, status: 'todo', contentType: 'question', contentId: 'lqb-demo-objective-1'},
  ];
  const tasks = async () => (await (await fetch(`${base}/v1/learning/tasks`, {headers: auth})).json() as any).data;
  const complete = (id: string) => fetch(`${base}/v1/learning/tasks/${id}/complete`, {method: 'POST', headers: auth});
  let list = await tasks();
  assert.equal(list.find((task: any) => task.id === 'a-card').locked, true);
  assert.equal(list.find((task: any) => task.id === 'b-question').locked, true);
  assert.equal((await complete('a-card')).status, 409);
  assert.equal((await complete('b-question')).status, 409);
  assert.equal((await complete('z-course')).status, 200);
  const firstCompletion = store.learningTasks[0].completedAt;
  assert.equal((await complete('z-course')).status, 200);
  assert.equal(store.learningTasks[0].completedAt, firstCompletion);
  list = await tasks();
  assert.equal(list.find((task: any) => task.id === 'a-card').locked, false);
  assert.equal(list.find((task: any) => task.id === 'b-question').locked, true);
  assert.equal((await complete('a-card')).status, 200);
  list = await tasks();
  assert.equal(list.find((task: any) => task.id === 'b-question').locked, false);
  const sessionResponse = await fetch(`${base}/v1/question-sessions`, {method: 'POST', headers: auth, body: JSON.stringify({mode: 'chapter', questionIds: ['lqb-demo-objective-1']})});
  assert.equal(sessionResponse.status, 201);
  const session = (await sessionResponse.json() as any).data;
  assert.deepEqual(session.questionIds, ['lqb-demo-objective-1']);
  const answer = await fetch(`${base}/v1/question-sessions/${session.id}/answers/lqb-demo-objective-1`, {method: 'PUT', headers: auth, body: JSON.stringify({answers: ['1']})});
  assert.equal(answer.status, 200);
  const submit = await fetch(`${base}/v1/question-sessions/${session.id}/submit`, {method: 'POST', headers: {...auth, 'idempotency-key': 'flow-submit'}, body: JSON.stringify({idempotencyKey: 'flow-submit'})});
  assert.equal(submit.status, 201);
  assert.equal((await complete('b-question')).status, 200);
  assert.equal((await tasks()).every((task: any) => task.status === 'done'), true);
}));

async function withServer(run: (base: string) => Promise<void>) {
  const server = createServer(handle);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');
  try { await run(`http://127.0.0.1:${address.port}`); } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function adminSession(base: string) {
  const response = await fetch(`${base}/v1/admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'change-me-local'})});
  assert.equal(response.status, 200);
  const payload = await response.json() as any;
  return {cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '', csrf: payload.data.csrfToken};
}

function jsonHeaders(session: {cookie: string; csrf: string}) {
  return {'content-type': 'application/json', cookie: session.cookie, 'x-csrf-token': session.csrf};
}

test('stage cards and questions require preceding course knowledge points before publish', async () => withServer(async base => {
  const session = await adminSession(base);
  const headers = jsonHeaders(session);
  const code = `point-link-${Date.now()}`;
  const stageResponse = await fetch(`${base}/v1/admin/learning-coach/stages`, {method: 'POST', headers, body: JSON.stringify({code, name: '考点关联测试阶段', description: '测试课程、卡片和题目的考点关联', sortOrder: 900})});
  assert.equal(stageResponse.status, 201);
  const stage = (await stageResponse.json() as any).data;
  const pointId = 'objective-point-civil-act-effect';
  const unrelatedPointId = `objective-point-unrelated-${Date.now()}`;
  store.learningQuestionTaxonomyNodes.push({id: unrelatedPointId, category: 'objective', type: 'point', parentId: 'objective-chapter-civil-act', code: unrelatedPointId, name: '无关考点', sortOrder: 999, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()});
  const courseResponse = await fetch(`${base}/v1/admin/learning-coach/stages/${stage.id}/plan/items`, {method: 'POST', headers, body: JSON.stringify({contentType: 'course', title: '民法外部课程', description: '请完成外部课程后回到 App 打卡。', knowledgePointIds: [pointId], sortOrder: 10, required: true})});
  assert.equal(courseResponse.status, 201);

  const missingCardPoints = await fetch(`${base}/v1/admin/learning-coach/stages/${stage.id}/plan/items`, {method: 'POST', headers, body: JSON.stringify({contentType: 'card', contentId: 'missing-card', title: '没有考点的卡片', sortOrder: 20, required: true})});
  assert.equal(missingCardPoints.status, 422);
  const missingQuestionPoints = await fetch(`${base}/v1/admin/learning-coach/stages/${stage.id}/plan/items`, {method: 'POST', headers, body: JSON.stringify({contentType: 'question', title: '没有考点的自动题', sortOrder: 30, required: true})});
  assert.equal(missingQuestionPoints.status, 422);

  const cardId = `card-stage-link-${Date.now()}`;
  store.learningCards.push({id: cardId, title: '民法考点卡片', contentType: 'image_gallery', assets: [], recallItems: [], sortOrder: 900, status: 'published', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), publishedAt: new Date().toISOString()});
  const cardResponse = await fetch(`${base}/v1/admin/learning-coach/stages/${stage.id}/plan/items`, {method: 'POST', headers, body: JSON.stringify({contentType: 'card', contentId: cardId, title: '关联民法卡片', knowledgePointIds: [pointId], sortOrder: 20, required: true})});
  assert.equal(cardResponse.status, 201);
  const questionResponse = await fetch(`${base}/v1/admin/learning-coach/stages/${stage.id}/plan/items`, {method: 'POST', headers, body: JSON.stringify({contentType: 'question', title: '关联民法自动题', knowledgePointIds: [pointId], questionCount: 1, sortOrder: 30, required: true})});
  assert.equal(questionResponse.status, 201);
  const unrelatedCardResponse = await fetch(`${base}/v1/admin/learning-coach/stages/${stage.id}/plan/items`, {method: 'POST', headers, body: JSON.stringify({contentType: 'card', contentId: cardId, title: '错误考点卡片', knowledgePointIds: [unrelatedPointId], sortOrder: 40, required: true})});
  assert.equal(unrelatedCardResponse.status, 201);
  const rejectedPublish = await fetch(`${base}/v1/admin/learning-coach/stages/${stage.id}/plan/publish`, {method: 'POST', headers, body: JSON.stringify({})});
  assert.equal(rejectedPublish.status, 422);
  const unrelatedCard = (await unrelatedCardResponse.json() as any).data;
  const removeUnrelated = await fetch(`${base}/v1/admin/learning-coach/stages/${stage.id}/plan/items/${unrelatedCard.id}`, {method: 'DELETE', headers});
  assert.equal(removeUnrelated.status, 200);

  const publish = await fetch(`${base}/v1/admin/learning-coach/stages/${stage.id}/plan/publish`, {method: 'POST', headers, body: JSON.stringify({})});
  assert.equal(publish.status, 200);
  const published = (await publish.json() as any).data;
  assert.equal(published.status, 'published');

  store.learningCards = store.learningCards.filter(item => item.id !== cardId);
  store.learningQuestionTaxonomyNodes = store.learningQuestionTaxonomyNodes.filter(item => item.id !== unrelatedPointId);
  store.learningStages = store.learningStages.filter(item => item.id !== stage.id);
  store.learningStagePlanItems = store.learningStagePlanItems.filter(item => item.stageId !== stage.id);
  store.learningStagePlanConfigs = store.learningStagePlanConfigs.filter(item => item.stageId !== stage.id);
}));
