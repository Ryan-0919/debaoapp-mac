import test from 'node:test';
import assert from 'node:assert/strict';
import {handle, processDueAccountDeletions, store} from '../main.js';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';

function base32Secret(value: string) { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const char of value) bits += alphabet.indexOf(char).toString(2).padStart(5, '0'); const bytes: number[] = []; for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2)); return Buffer.from(bytes); }
function currentTotp(secret: string) { const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const digest = createHmac('sha1', base32Secret(secret)).update(counter).digest(); const offset = digest[digest.length - 1] & 15; const value = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]; return String(value % 1_000_000).padStart(6, '0'); }

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

test('health endpoint returns service status', async () => withServer(async base => {
  const response = await fetch(`${base}/v1/health`); const json = await response.json() as any;
  assert.equal(response.status, 200); assert.equal(json.data.status, 'ok');
}));

test('admin login creates an HttpOnly session and exposes dashboard data', async () => withServer(async base => {
  const appTokenDenied = await fetch(`${base}/v1/admin/dashboard`, {headers: {authorization: 'Bearer demo-token'}});
  assert.equal(appTokenDenied.status, 401);
  const legacyTokenDenied = await fetch(`${base}/v1/admin/dashboard`, {headers: {'admin-token': 'admin-token'}});
  assert.equal(legacyTokenDenied.status, 401);
  const login = await fetch(`${base}/v1/admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'change-me-local'})});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie ?? '', /debao_admin_session=.*HttpOnly/);
  const me = await fetch(`${base}/v1/admin/me`, {headers: {cookie: cookie?.split(';')[0] ?? ''}});
  assert.equal(me.status, 200);
  const meJson = await me.json() as any;
  assert.equal(meJson.data.role, 'super_admin');
  const dashboard = await fetch(`${base}/v1/admin/dashboard`, {headers: {cookie: cookie?.split(';')[0] ?? ''}});
  assert.equal(dashboard.status, 200);
  const navigation = await fetch(`${base}/v1/admin/navigation`, {headers: {cookie: cookie?.split(';')[0] ?? ''}});
  assert.equal(navigation.status, 200);
  const navigationJson = await navigation.json() as any;
  assert.equal(navigationJson.data.items.some((item: any) => item.key === '/system/admins'), true);
  const roles = await fetch(`${base}/v1/admin/roles`, {headers: {cookie: cookie?.split(';')[0] ?? ''}});
  assert.equal(roles.status, 200);
  const rolesJson = await roles.json() as any;
  assert.equal(rolesJson.data.items.some((item: any) => item.code === 'content_editor'), true);
}));

test('admin can enroll MFA and reset revokes every admin session', async () => withServer(async base => {
  const login = await fetch(`${base}/v1/admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'change-me-local'})});
  const loginJson = await login.json() as any; const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const enrollmentResponse = await fetch(`${base}/v1/admin/me/mfa/enroll`, {method: 'POST', headers: {cookie, 'x-csrf-token': loginJson.data.csrfToken}});
  assert.equal(enrollmentResponse.status, 200); const enrollment = await enrollmentResponse.json() as any; assert.match(enrollment.data.otpAuthUri, /^otpauth:\/\/totp\//);
  const verifiedResponse = await fetch(`${base}/v1/admin/auth/mfa/verify`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({challengeToken: enrollment.data.challengeToken, code: currentTotp(enrollment.data.secret)})});
  assert.equal(verifiedResponse.status, 200); const verified = await verifiedResponse.json() as any; const verifiedCookie = verifiedResponse.headers.get('set-cookie')?.split(';')[0] ?? '';
  const adminsResponse = await fetch(`${base}/v1/admin/admins`, {headers: {cookie: verifiedCookie}}); const admins = await adminsResponse.json() as any; assert.equal(admins.data.items[0].mfaEnabled, true);
  const resetResponse = await fetch(`${base}/v1/admin/admins/00000000-0000-0000-0000-000000000099/mfa/reset`, {method: 'POST', headers: {'content-type': 'application/json', cookie: verifiedCookie, 'x-csrf-token': verified.data.csrfToken}, body: JSON.stringify({reason: '测试后恢复本地状态', confirmation: 'RESET'})});
  assert.equal(resetResponse.status, 200);
  const revoked = await fetch(`${base}/v1/admin/me`, {headers: {cookie: verifiedCookie}}); assert.equal(revoked.status, 401);
}));

test('admin content endpoints enforce session and CSRF and publish question versions', async () => withServer(async base => {
  const denied = await fetch(`${base}/v1/admin/questions`);
  assert.equal(denied.status, 401);
  const login = await fetch(`${base}/v1/admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'change-me-local'})});
  const loginJson = await login.json() as any; const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''; const csrf = loginJson.data.csrfToken;
  const invalidCsrf = await fetch(`${base}/v1/admin/questions`, {method: 'POST', headers: {'content-type': 'application/json', cookie}, body: JSON.stringify({stem: '测试题干足够长', options: ['A', 'B'], answer: 0, analysis: '测试解析'})});
  assert.equal(invalidCsrf.status, 403);
  const create = await fetch(`${base}/v1/admin/questions`, {method: 'POST', headers: {'content-type': 'application/json', cookie, 'x-csrf-token': csrf}, body: JSON.stringify({stem: '测试题干足够长', options: ['A', 'B'], answer: 0, questionType: 'single', analysis: '测试解析', subjectId: 'civil', chapterId: 'civil-objective-chapter-1', pointId: 'civil-objective-point-1'})});
  assert.equal(create.status, 201); const created = await create.json() as any; assert.equal(created.data.status, 'draft'); assert.equal(created.data.subjectId, 'civil');
  const publish = await fetch(`${base}/v1/admin/questions/${created.data.id}/publish`, {method: 'POST', headers: {cookie, 'x-csrf-token': csrf}});
  assert.equal(publish.status, 200); const published = await publish.json() as any; assert.equal(published.data.status, 'published'); assert.equal(published.data.version, 2);
  const edit = await fetch(`${base}/v1/admin/questions/${created.data.id}`, {method: 'PATCH', headers: {'content-type': 'application/json', cookie, 'x-csrf-token': csrf}, body: JSON.stringify({stem: '测试题干更新后足够长', options: ['A', 'B'], answer: 1, analysis: '更新解析', subjectId: 'criminal'})});
  assert.equal(edit.status, 200); const edited = await edit.json() as any; assert.equal(edited.data.status, 'draft'); assert.equal(edited.data.subjectId, 'criminal');
  const versions = await fetch(`${base}/v1/admin/questions/${created.data.id}/versions`, {headers: {cookie}}); assert.equal(versions.status, 200); const versionsJson = await versions.json() as any; assert.equal(versionsJson.data.total >= 2, true); assert.equal(versionsJson.data.items[0].subjectId, 'criminal'); assert.equal(versionsJson.data.items[1].subjectId, 'civil');
  const users = await fetch(`${base}/v1/admin/users`, {headers: {cookie}}); assert.equal(users.status, 200); const usersJson = await users.json() as any; assert.equal(usersJson.data.items.length >= 1, true);
  const subjectiveQuestions = await fetch(`${base}/v1/admin/content/questions/subjective`, {headers: {cookie}}); assert.equal(subjectiveQuestions.status, 200); const subjectiveQuestionsJson = await subjectiveQuestions.json() as any; assert.equal(subjectiveQuestionsJson.data.items.length >= 1, true); assert.equal(subjectiveQuestionsJson.data.items[0].title.length > 0, true);
  const userDetail = await fetch(`${base}/v1/admin/users/u-demo`, {headers: {cookie}}); assert.equal(userDetail.status, 200); const userDetailJson = await userDetail.json() as any; assert.equal(userDetailJson.data.learningSummary.courseCount >= 1, true); assert.equal(userDetailJson.data.courseProgress[0].courseTitle, '民法体系精讲'); assert.equal(userDetailJson.data.examStats.subjectiveSubmissionCount >= 1, true); assert.equal(Array.isArray(userDetailJson.data.questionSubmissions), true);
  const reportResponse = await fetch(`${base}/v1/forum/posts/post-demo/report`, {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer demo-token'}, body: JSON.stringify({reason: 'test report'})}); assert.equal(reportResponse.status, 201); const report = await reportResponse.json() as any; assert.equal(report.data.status, 'pending'); assert.equal('reporterUserId' in report.data, false);
  const duplicateReport = await fetch(`${base}/v1/forum/posts/post-demo/report`, {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer demo-token'}, body: JSON.stringify({reason: 'a different reason'})}); const duplicateJson = await duplicateReport.json() as any; assert.equal(duplicateReport.status, 200); assert.equal(duplicateJson.data.id, report.data.id);
  const oversizedReport = await fetch(`${base}/v1/forum/posts/post-demo/report`, {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer demo-token'}, body: JSON.stringify({reason: 'x'.repeat(201)})}); assert.equal(oversizedReport.status, 422);
  const reportList = await fetch(`${base}/v1/admin/community/reports`, {headers: {cookie}}); assert.equal(reportList.status, 200);
  const resolve = await fetch(`${base}/v1/admin/community/reports/${report.data.id}/resolve`, {method: 'POST', headers: {'content-type': 'application/json', cookie, 'x-csrf-token': csrf}, body: JSON.stringify({resolution: 'reviewed'})}); assert.equal(resolve.status, 200);
 }));

test('question subject filters are honored by user and admin lists', async () => withServer(async base => {
  const sentinel = {id: 'subject-filter-criminal', subjectId: 'criminal', stem: 'Subject filter sentinel question', options: ['A', 'B'], answer: 0, analysis: 'Sentinel analysis', status: 'published' as const, version: 1, updatedAt: new Date().toISOString()};
  store.questions.unshift(sentinel);
  try {
    const userCivil = await fetch(`${base}/v1/questions?subjectId=civil`, {headers: {authorization: 'Bearer demo-token'}});
    assert.equal(userCivil.status, 200); const userCivilJson = await userCivil.json() as any;
    assert.equal(userCivilJson.data.items.some((item: any) => item.id === 'oq1'), true);
    assert.equal(userCivilJson.data.items.some((item: any) => item.id === sentinel.id), false);
    assert.equal(userCivilJson.data.items.every((item: any) => item.subjectId === 'civil' || (!item.subjectId && item.id.startsWith('civil'))), true);
    const userCriminal = await fetch(`${base}/v1/questions?subjectId=criminal`, {headers: {authorization: 'Bearer demo-token'}});
    assert.equal(userCriminal.status, 200); const userCriminalJson = await userCriminal.json() as any;
    assert.equal(userCriminalJson.data.items.some((item: any) => item.id === sentinel.id), true);
    assert.equal(userCriminalJson.data.items.some((item: any) => item.id === 'oq1'), false);

    const login = await fetch(`${base}/v1/admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'change-me-local'})});
    assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const adminCivil = await fetch(`${base}/v1/admin/questions?subjectId=civil`, {headers: {cookie}});
    assert.equal(adminCivil.status, 200); const adminCivilJson = await adminCivil.json() as any;
    assert.equal(adminCivilJson.data.items.some((item: any) => item.id === 'oq1'), true);
    assert.equal(adminCivilJson.data.items.some((item: any) => item.id === sentinel.id), false);
    const adminCriminal = await fetch(`${base}/v1/admin/questions?subjectId=criminal`, {headers: {cookie}});
    assert.equal(adminCriminal.status, 200); const adminCriminalJson = await adminCriminal.json() as any;
    assert.equal(adminCriminalJson.data.items.some((item: any) => item.id === sentinel.id), true);
  } finally {
    const index = store.questions.indexOf(sentinel);
    if (index >= 0) store.questions.splice(index, 1);
  }
}));

test('learning admin manages independent objective and subjective question bank', async () => withServer(async base => {
  const denied = await fetch(`${base}/v1/admin/learning-question-bank/questions?category=objective`);
  assert.equal(denied.status, 401);
  const login = await fetch(`${base}/v1/learning-admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'learning-admin', password: 'local-compose-learning-admin-2026'})});
  assert.equal(login.status, 200);
  const loginJson = await login.json() as any;
  const headers = {'content-type': 'application/json', cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '', 'x-csrf-token': loginJson.data.csrfToken};
  const createdIds: string[] = [];
  let uploadedMediaPath: string | undefined;
  try {
    const objective = await fetch(`${base}/v1/admin/learning-question-bank/questions`, {method: 'POST', headers, body: JSON.stringify({category: 'objective', questionType: 'multiple', subjectId: 'objective-subject-civil', chapterId: 'objective-chapter-civil-act', pointId: 'objective-point-civil-act-effect', subPointId: 'objective-subpoint-civil-act-limited', difficulty: 3, stem: '关于民事法律行为，下列说法正确的有哪些？', options: [{label: '选项一'}, {label: '选项二'}, {label: '选项三'}], correctAnswers: ['A', 'C'], analysis: 'A、C 符合当前知识目录规则。', subQuestions: [], estimatedMinutes: 3, source: '接口测试题', usageScenes: ['daily_practice', 'wrong_review']})});
    assert.equal(objective.status, 201); const objectiveJson = await objective.json() as any; createdIds.push(objectiveJson.data.id); assert.deepEqual(objectiveJson.data.correctAnswers, ['A', 'C']); assert.equal(objectiveJson.data.options[2].key, 'C');
    const mediaBytes = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0]);
    const mediaUpload = await fetch(`${base}/v1/admin/learning-question-bank/media`, {method: 'POST', headers: {'content-type': 'audio/mpeg', cookie: headers.cookie, 'x-csrf-token': headers['x-csrf-token'], 'x-file-name': encodeURIComponent('合同讲解.mp3')}, body: mediaBytes});
    assert.equal(mediaUpload.status, 201); const mediaJson = await mediaUpload.json() as any; assert.equal(mediaJson.data.type, 'audio'); assert.match(mediaJson.data.reference, /^\/v1\/learning-question-media\/[a-f0-9-]+\.mp3$/);
    uploadedMediaPath = join(process.env.DEBAO_UPLOAD_DIR ?? join(process.cwd(), 'uploads'), 'learning-question-media', mediaJson.data.reference.split('/').pop());
    const mediaPlayback = await fetch(`${base}${mediaJson.data.reference}`, {headers: {range: 'bytes=0-3'}}); assert.equal(mediaPlayback.status, 206); assert.equal((await mediaPlayback.arrayBuffer()).byteLength, 4);
    const subjective = await fetch(`${base}/v1/admin/learning-question-bank/questions`, {method: 'POST', headers, body: JSON.stringify({category: 'subjective', questionType: 'case_analysis', subjectId: 'subjective-subject-civil', chapterId: 'subjective-chapter-contract', pointId: 'subjective-point-contract-termination', difficulty: 4, stem: '请结合案情作答。', caseMaterial: '甲乙签订合同后发生履行争议，双方对解除条件存在不同理解。', options: [], correctAnswers: [], analysis: '应先识别解除权基础，再结合违约责任和损失范围分问作答。', explanationMediaType: 'audio', explanationMediaReference: mediaJson.data.reference, subQuestions: [{prompt: '合同能否解除？', referenceAnswer: '应根据法定解除和约定解除条件分别判断。', score: 10}, {prompt: '损失如何承担？', referenceAnswer: '依据违约责任和损失填补原则确定。', score: 10}], estimatedMinutes: 25, usageScenes: ['stage_test']})});
    assert.equal(subjective.status, 201); const subjectiveJson = await subjective.json() as any; createdIds.push(subjectiveJson.data.id); assert.equal(subjectiveJson.data.subQuestions.length, 2); assert.equal(subjectiveJson.data.explanationMediaType, 'audio'); assert.equal(subjectiveJson.data.explanationMediaReference, mediaJson.data.reference);
    const externalMedia = await fetch(`${base}/v1/admin/learning-question-bank/questions`, {method: 'POST', headers, body: JSON.stringify({category: 'subjective', questionType: 'short_answer', subjectId: 'subjective-subject-civil', chapterId: 'subjective-chapter-contract', pointId: 'subjective-point-contract-termination', difficulty: 2, stem: '外部媒体地址应被拒绝。', options: [], correctAnswers: [], analysis: '验证讲解文件只能由后台上传。', explanationMediaType: 'video', explanationMediaReference: 'https://example.com/video.mp4', subQuestions: [{prompt: '为什么？', referenceAnswer: '因为必须上传文件。', score: 10}], estimatedMinutes: 10, usageScenes: ['stage_test']})}); assert.equal(externalMedia.status, 422);
    const publish = await fetch(`${base}/v1/admin/learning-question-bank/questions/${objectiveJson.data.id}/publish`, {method: 'POST', headers}); assert.equal(publish.status, 200); const publishJson = await publish.json() as any; assert.equal(publishJson.data.status, 'published');
    const list = await fetch(`${base}/v1/admin/learning-question-bank/questions?category=objective&subject=${encodeURIComponent('民法')}`, {headers: {cookie: headers.cookie}}); assert.equal(list.status, 200); const listJson = await list.json() as any; assert.equal(listJson.data.items.some((item: any) => item.id === objectiveJson.data.id), true); assert.equal(listJson.data.taxonomyNodes.every((item: any) => item.category === 'objective'), true);
    const invalid = await fetch(`${base}/v1/admin/learning-question-bank/questions`, {method: 'POST', headers, body: JSON.stringify({category: 'objective', questionType: 'multiple', subject: '民法', columnName: '合同法', knowledgePoint: '合同效力', difficulty: 2, stem: '答案数量不合法的多选题', options: [{label: 'A'}, {label: 'B'}], correctAnswers: ['A'], analysis: '测试解析', subQuestions: [], estimatedMinutes: 2, usageScenes: ['daily_practice']})}); assert.equal(invalid.status, 422);
  } finally {
    store.learningQuestionBankQuestions = store.learningQuestionBankQuestions.filter(item => !createdIds.includes(item.id));
    if (uploadedMediaPath) await rm(uploadedMediaPath, {force: true});
  }
}));

test('learning admin uploads and manages image and HTML cards', async () => withServer(async base => {
  const login = await fetch(`${base}/v1/learning-admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'learning-admin', password: 'local-compose-learning-admin-2026'})});
  assert.equal(login.status, 200); const loginJson = await login.json() as any; const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''; const csrf = loginJson.data.csrfToken;
  const uploadedPaths: string[] = []; const cardIds: string[] = [];
  const upload = async (contentType: string, filename: string, bytes: Uint8Array) => {
    const response = await fetch(`${base}/v1/admin/learning-cards/assets`, {method: 'POST', headers: {'content-type': contentType, cookie, 'x-csrf-token': csrf, 'x-file-name': encodeURIComponent(filename)}, body: bytes});
    assert.equal(response.status, 201); const json = await response.json() as any; const localName = json.data.reference.split('/').pop(); uploadedPaths.push(join(process.env.DEBAO_UPLOAD_DIR ?? join(process.cwd(), 'uploads'), 'learning-card-assets', localName)); return json.data;
  };
  try {
    const first = await upload('image/png', '第一页.png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const second = await upload('image/jpeg', '第二页.jpg', Uint8Array.from([255, 216, 255, 217]));
    const html = await upload('text/html', '知识卡.html', new TextEncoder().encode('<!doctype html><title>知识卡</title><h1>合同解除</h1><script>window.top.hacked=true</script>'));
    const htmlPreview = await fetch(`${base}${html.reference}`); assert.equal(htmlPreview.status, 200); assert.match(htmlPreview.headers.get('content-security-policy') ?? '', /sandbox/);
    const created = await fetch(`${base}/v1/admin/learning-cards`, {method: 'POST', headers: {'content-type': 'application/json', cookie, 'x-csrf-token': csrf}, body: JSON.stringify({title: '民法图解卡', description: '两页图片', contentType: 'image_gallery', assets: [first, second], knowledgePointIds: ['objective-point-civil-act-effect'], sortOrder: 10})});
    assert.equal(created.status, 201); const createdJson = await created.json() as any; cardIds.push(createdJson.data.id); assert.equal(createdJson.data.assets.length, 2); assert.equal(createdJson.data.status, 'draft');
    const recallUrl = `${base}/v1/admin/learning-cards/${createdJson.data.id}`;
    const recallHeaders = {'content-type': 'application/json', cookie, 'x-csrf-token': csrf};
    const invalidRecall = await fetch(recallUrl, {method: 'PATCH', headers: recallHeaders, body: JSON.stringify({recallItems: [{prompt: '没有空白', answer: '答案'}]})});
    assert.equal(invalidRecall.status, 422);
    const recallSaved = await fetch(recallUrl, {method: 'PATCH', headers: recallHeaders, body: JSON.stringify({recallItems: [{prompt: '物权变动需要____。', answer: '公示'}]})});
    assert.equal(recallSaved.status, 200);
    assert.equal(((await recallSaved.json()) as any).data.recallItems[0].answer, '公示');
    const published = await fetch(`${base}/v1/admin/learning-cards/${createdJson.data.id}/publish`, {method: 'POST', headers: {'content-type': 'application/json', cookie, 'x-csrf-token': csrf}, body: '{}'}); assert.equal(published.status, 200);
    const edited = await fetch(`${base}/v1/admin/learning-cards/${createdJson.data.id}`, {method: 'PATCH', headers: {'content-type': 'application/json', cookie, 'x-csrf-token': csrf}, body: JSON.stringify({title: '民法图解卡（二版）', contentType: 'image_gallery', assets: [second, first], sortOrder: 20})}); assert.equal(edited.status, 200); const editedJson = await edited.json() as any; assert.equal(editedJson.data.status, 'draft'); assert.equal(editedJson.data.assets[0].filename, '第二页.jpg');
    const htmlCard = await fetch(`${base}/v1/admin/learning-cards`, {method: 'POST', headers: {'content-type': 'application/json', cookie, 'x-csrf-token': csrf}, body: JSON.stringify({title: 'HTML 互动知识卡', contentType: 'html', assets: [html], sortOrder: 30})}); assert.equal(htmlCard.status, 201); const htmlCardJson = await htmlCard.json() as any; cardIds.push(htmlCardJson.data.id);
    assert.equal(editedJson.data.recallItems[0].answer, '公示');
    const invalid = await fetch(`${base}/v1/admin/learning-cards`, {method: 'POST', headers: {'content-type': 'application/json', cookie, 'x-csrf-token': csrf}, body: JSON.stringify({title: '外部图片无效', contentType: 'image_gallery', assets: [{id: 'x', type: 'image', filename: 'x.png', reference: 'https://example.com/x.png', sizeBytes: 10}], sortOrder: 40})}); assert.equal(invalid.status, 422);
    const list = await fetch(`${base}/v1/admin/learning-cards?contentType=html`, {headers: {cookie}}); assert.equal(list.status, 200); const listJson = await list.json() as any; assert.equal(listJson.data.items.some((item: any) => item.id === htmlCardJson.data.id), true);
  } finally {
    store.learningCards = store.learningCards.filter(item => !cardIds.includes(item.id));
    await Promise.all(uploadedPaths.map(path => rm(path, {force: true})));
  }
}));

test('auth and course endpoints enforce token and return data', async () => withServer(async base => {
  const denied = await fetch(`${base}/v1/courses`); assert.equal(denied.status, 401);
  const forged = await fetch(`${base}/v1/courses`, {headers: {authorization: 'Bearer local-forged-token'}}); const forgedJson = await forged.json() as any; assert.equal(forged.status, 401); assert.equal(forgedJson.error.code, 'AUTH_REQUIRED'); assert.match(forgedJson.error.requestId, /^[0-9a-f-]{36}$/);
  const response = await fetch(`${base}/v1/courses`, {headers: {authorization: 'Bearer demo-token'}}); const json = await response.json() as any;
  assert.equal(response.status, 200); assert.equal(json.data.length, 1);
}));

test('order creation is pending until local payment adapter confirms it', async () => withServer(async base => {
  const headers = {'content-type': 'application/json', authorization: 'Bearer demo-token'};
  const created = await fetch(`${base}/v1/orders`, {method: 'POST', headers, body: JSON.stringify({productId: 'p2', clientRequestId: 'test-unique-1'})}); const order = await created.json() as any;
  assert.equal(created.status, 201); assert.equal(order.data.status, 'pending');
  const duplicate = await fetch(`${base}/v1/orders`, {method: 'POST', headers, body: JSON.stringify({productId: 'p2', clientRequestId: 'test-unique-1'})}); const duplicateJson = await duplicate.json() as any;
  assert.equal(duplicate.status, 200); assert.equal(duplicateJson.data.id, order.data.id);
  const paid = await fetch(`${base}/v1/orders/${order.data.id}/pay`, {method: 'POST', headers}); const payment = await paid.json() as any;
  assert.equal(payment.data.status, 'paid');
}));

test('local auth login issues refreshable tokens and logout revokes access', async () => withServer(async base => {
  const headers = {'content-type': 'application/json'};
  const sent = await fetch(`${base}/v1/auth/send-code`, {method: 'POST', headers, body: JSON.stringify({phone: '13800138000'})});
  const sentJson = await sent.json() as any; assert.equal(sent.status, 200); assert.equal(sentJson.data.developmentCode, '123456');
  const loggedIn = await fetch(`${base}/v1/auth/login`, {method: 'POST', headers, body: JSON.stringify({phone: '13800138000', code: '123456'})}); const login = await loggedIn.json() as any;
  assert.equal(loggedIn.status, 200); assert.match(login.data.accessToken, /^local-/);
  const refreshed = await fetch(`${base}/v1/auth/refresh`, {method: 'POST', headers, body: JSON.stringify({refreshToken: login.data.refreshToken})}); const refresh = await refreshed.json() as any;
  assert.equal(refreshed.status, 200); assert.match(refresh.data.accessToken, /^local-/);
  assert.notEqual(refresh.data.refreshToken, login.data.refreshToken);
  const replay = await fetch(`${base}/v1/auth/refresh`, {method: 'POST', headers, body: JSON.stringify({refreshToken: login.data.refreshToken})}); assert.equal(replay.status, 401);
  const out = await fetch(`${base}/v1/auth/logout`, {method: 'POST', headers: {...headers, authorization: `Bearer ${refresh.data.accessToken}`}}); assert.equal(out.status, 200);
  const denied = await fetch(`${base}/v1/me`, {headers: {authorization: `Bearer ${refresh.data.accessToken}`}}); assert.equal(denied.status, 401);
}));

test('verification codes require a challenge, rate limit sends and are consumed once', async () => withServer(async base => {
  const headers = {'content-type': 'application/json'};
  const missing = await fetch(`${base}/v1/auth/login`, {method: 'POST', headers, body: JSON.stringify({phone: '13700000001', code: '123456'})}); const missingJson = await missing.json() as any;
  assert.equal(missing.status, 401); assert.equal(missingJson.error.code, 'AUTH_CODE_NOT_REQUESTED');

  const sent = await fetch(`${base}/v1/auth/send-code`, {method: 'POST', headers, body: JSON.stringify({phone: '13700000002'})}); assert.equal(sent.status, 200);
  const limited = await fetch(`${base}/v1/auth/send-code`, {method: 'POST', headers, body: JSON.stringify({phone: '13700000002'})}); const limitedJson = await limited.json() as any;
  assert.equal(limited.status, 429); assert.equal(limitedJson.error.code, 'AUTH_CODE_RATE_LIMITED');
  const login = await fetch(`${base}/v1/auth/login`, {method: 'POST', headers, body: JSON.stringify({phone: '13700000002', code: '123456'})}); assert.equal(login.status, 200);
  const replay = await fetch(`${base}/v1/auth/login`, {method: 'POST', headers, body: JSON.stringify({phone: '13700000002', code: '123456'})}); const replayJson = await replay.json() as any;
  assert.equal(replay.status, 401); assert.equal(replayJson.error.code, 'AUTH_CODE_CONSUMED');

  await fetch(`${base}/v1/auth/send-code`, {method: 'POST', headers, body: JSON.stringify({phone: '13700000003'})});
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wrong = await fetch(`${base}/v1/auth/login`, {method: 'POST', headers, body: JSON.stringify({phone: '13700000003', code: '000000'})}); assert.equal(wrong.status, 401);
  }
  const blocked = await fetch(`${base}/v1/auth/login`, {method: 'POST', headers, body: JSON.stringify({phone: '13700000003', code: '123456'})}); const blockedJson = await blocked.json() as any;
  assert.equal(blocked.status, 429); assert.equal(blockedJson.error.code, 'AUTH_CODE_ATTEMPTS_EXCEEDED');
}));

test('account security changes phone, unlinks WeChat and revokes a removed device session', async () => withServer(async base => {
  const jsonHeaders = {'content-type': 'application/json'};
  await fetch(`${base}/v1/auth/send-code`, {method: 'POST', headers: jsonHeaders, body: JSON.stringify({phone: '13600000001'})});
  const loggedIn = await fetch(`${base}/v1/auth/login`, {method: 'POST', headers: jsonHeaders, body: JSON.stringify({phone: '13600000001', code: '123456', deviceId: 'ios-security-test'})}); const login = await loggedIn.json() as any;
  const auth = {...jsonHeaders, authorization: `Bearer ${login.data.accessToken}`};
  const devices = await fetch(`${base}/v1/devices`, {headers: auth}); const devicesJson = await devices.json() as any;
  assert.equal(devicesJson.data.some((item: any) => item.id === 'ios-security-test' && item.current), true);

  await fetch(`${base}/v1/account/phone/code`, {method: 'POST', headers: auth, body: JSON.stringify({stage: 'current'})});
  await fetch(`${base}/v1/account/phone/code`, {method: 'POST', headers: auth, body: JSON.stringify({stage: 'new', phone: '13600000002'})});
  const changed = await fetch(`${base}/v1/account/phone/change`, {method: 'POST', headers: auth, body: JSON.stringify({newPhone: '13600000002', oldCode: '123456', newCode: '123456'})}); const changedJson = await changed.json() as any;
  assert.equal(changed.status, 200); assert.equal(changedJson.data.phone, '136****0002');

  const userId = [...store.profiles.values()].find(item => item.phone === '13600000002')!.id;
  store.identities.push({userId, provider: 'wechat', providerUserId: 'wx-security-test', createdAt: new Date().toISOString()});
  await fetch(`${base}/v1/account/identity/code`, {method: 'POST', headers: auth});
  const unlinked = await fetch(`${base}/v1/me/identities/wechat`, {method: 'DELETE', headers: auth, body: JSON.stringify({code: '123456'})});
  assert.equal(unlinked.status, 200); assert.equal(store.identities.some(item => item.userId === userId), false);

  const removed = await fetch(`${base}/v1/devices/ios-security-test`, {method: 'DELETE', headers: auth}); const removedJson = await removed.json() as any;
  assert.equal(removed.status, 200); assert.equal(removedJson.data.revokedSessions, 1);
  const denied = await fetch(`${base}/v1/me`, {headers: auth}); assert.equal(denied.status, 401);
}));

test('account deletion supports cancellation and executes after the cooling-off period', async () => withServer(async base => {
  const headers = {'content-type': 'application/json'};
  await fetch(`${base}/v1/auth/send-code`, {method: 'POST', headers, body: JSON.stringify({phone: '13500000001'})});
  const loggedIn = await fetch(`${base}/v1/auth/login`, {method: 'POST', headers, body: JSON.stringify({phone: '13500000001', code: '123456', deviceId: 'harmony-delete-test'})}); const login = await loggedIn.json() as any;
  const auth = {...headers, authorization: `Bearer ${login.data.accessToken}`};
  await fetch(`${base}/v1/account/deletion/code`, {method: 'POST', headers: auth});
  const scheduled = await fetch(`${base}/v1/account/deletion`, {method: 'POST', headers: auth, body: JSON.stringify({code: '123456'})}); const scheduledJson = await scheduled.json() as any;
  assert.equal(scheduledJson.data.status, 'scheduled'); assert.equal(scheduledJson.data.coolingOffDays, 7);
  const cancelled = await fetch(`${base}/v1/account/deletion/cancel`, {method: 'POST', headers: auth}); assert.equal(cancelled.status, 200);

  await fetch(`${base}/v1/auth/send-code`, {method: 'POST', headers, body: JSON.stringify({phone: '13500000002'})});
  const secondLoginResponse = await fetch(`${base}/v1/auth/login`, {method: 'POST', headers, body: JSON.stringify({phone: '13500000002', code: '123456', deviceId: 'android-delete-due'})}); const secondLogin = await secondLoginResponse.json() as any;
  const secondAuth = {...headers, authorization: `Bearer ${secondLogin.data.accessToken}`};
  await fetch(`${base}/v1/account/deletion/code`, {method: 'POST', headers: secondAuth});
  await fetch(`${base}/v1/account/deletion`, {method: 'POST', headers: secondAuth, body: JSON.stringify({code: '123456'})});
  const user = [...store.profiles.values()].find(item => item.phone === '13500000002')!;
  store.deletionRequests.get(user.id)!.executeAfter = new Date(Date.now() - 1000).toISOString();
  assert.equal(await processDueAccountDeletions(), 1);
  assert.equal(store.profiles.get(user.id)?.name, '已注销用户');
  assert.equal(store.devices.some(item => item.userId === user.id), false);
  const denied = await fetch(`${base}/v1/me`, {headers: secondAuth}); assert.equal(denied.status, 401);
}));

test('WeChat login requires phone binding once and then signs in directly', async () => withServer(async base => {
  const headers = {'content-type': 'application/json'};
  const providers = await fetch(`${base}/v1/auth/providers`); const providersJson = await providers.json() as any;
  assert.equal(providersJson.data.wechat.available, true); assert.equal(providersJson.data.oneClick.available, true);

  const first = await fetch(`${base}/v1/auth/wechat`, {method: 'POST', headers, body: JSON.stringify({code: 'local-wechat-first', deviceId: 'wechat-device'})}); const firstJson = await first.json() as any;
  assert.equal(first.status, 200); assert.equal(firstJson.data.status, 'binding_required'); assert.match(firstJson.data.bindingToken, /^bind-/);

  const bound = await fetch(`${base}/v1/auth/one-click`, {method: 'POST', headers, body: JSON.stringify({providerToken: 'local-one-click:13900139000', bindingToken: firstJson.data.bindingToken, deviceId: 'wechat-device'})}); const boundJson = await bound.json() as any;
  assert.equal(bound.status, 200); assert.match(boundJson.data.accessToken, /^local-/);
  const identities = await fetch(`${base}/v1/me/identities`, {headers: {authorization: `Bearer ${boundJson.data.accessToken}`}}); const identitiesJson = await identities.json() as any;
  assert.equal(identitiesJson.data[0].provider, 'wechat');

  const second = await fetch(`${base}/v1/auth/wechat`, {method: 'POST', headers, body: JSON.stringify({code: 'local-wechat-second', deviceId: 'wechat-device-2'})}); const secondJson = await second.json() as any;
  assert.equal(secondJson.data.status, 'authenticated'); assert.match(secondJson.data.session.accessToken, /^local-/);
}));

test('learning, grading and admin routes expose local product workflows', async () => withServer(async base => {
  const auth = {authorization: 'Bearer demo-token', 'content-type': 'application/json'};
  const task = await fetch(`${base}/v1/learning/tasks` , {headers: auth}); const taskJson = await task.json() as any; assert.equal(task.status, 200); assert.equal(taskJson.data.length, 3);
  const plan = await fetch(`${base}/v1/learning/plans`, {method: 'POST', headers: auth, body: JSON.stringify({title: '周末复习', dailyMinutes: 90})}); assert.equal(plan.status, 201);
  const grade = await fetch(`${base}/v1/grading/submissions`, {method: 'POST', headers: auth, body: JSON.stringify({questionId: 'oq1'})}); const gradeJson = await grade.json() as any; assert.equal(grade.status, 201); assert.equal(gradeJson.data.status, 'queued');
  const adminLogin = await fetch(`${base}/v1/admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'change-me-local'})});
  const adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0] ?? '';
  const overview = await fetch(`${base}/v1/admin/overview`, {headers: {cookie: adminCookie}}); const overviewJson = await overview.json() as any; assert.equal(overview.status, 200); assert.equal(overviewJson.data.gradingQueue >= 1, true);
  const appTokenDenied = await fetch(`${base}/v1/admin/overview`, {headers: {authorization: 'Bearer demo-token'}}); assert.equal(appTokenDenied.status, 401);
  const legacyTokenDenied = await fetch(`${base}/v1/admin/overview`, {headers: {authorization: 'Bearer admin-token'}}); assert.equal(legacyTokenDenied.status, 401);
 }));

test('learning plan validation is strict and course access is personalized', async () => withServer(async base => {
  const auth = {authorization: 'Bearer demo-token', 'content-type': 'application/json'};
  const invalidMinutes = await fetch(`${base}/v1/learning/plans`, {method: 'POST', headers: auth, body: JSON.stringify({title: '无效时长', dailyMinutes: 'not-a-number'})});
  assert.equal(invalidMinutes.status, 422);
  const invalidDate = await fetch(`${base}/v1/learning/plans`, {method: 'POST', headers: auth, body: JSON.stringify({title: '无效日期', startDate: '2026-02-30', endDate: '2026-03-01'})});
  assert.equal(invalidDate.status, 422);
  const reversed = await fetch(`${base}/v1/learning/plans`, {method: 'POST', headers: auth, body: JSON.stringify({title: '反向日期', startDate: '2026-09-02', endDate: '2026-09-01'})});
  assert.equal(reversed.status, 422);
  const emptyPatch = await fetch(`${base}/v1/learning/plans/plan-demo`, {method: 'PATCH', headers: auth, body: JSON.stringify({})});
  assert.equal(emptyPatch.status, 422);

  const created = await fetch(`${base}/v1/learning/plans`, {method: 'POST', headers: auth, body: JSON.stringify({title: '严格校验计划', dailyMinutes: 75, startDate: '2026-09-02', endDate: '2026-09-30'})});
  const createdJson = await created.json() as any;
  assert.equal(created.status, 201);
  const updated = await fetch(`${base}/v1/learning/plans/${createdJson.data.id}`, {method: 'PATCH', headers: auth, body: JSON.stringify({title: '更新后的计划', dailyMinutes: 90, startDate: '2026-09-03', endDate: '2026-10-01', status: 'completed'})});
  const updatedJson = await updated.json() as any;
  assert.equal(updated.status, 200);
  assert.equal(updatedJson.data.dailyMinutes, 90);
  assert.equal(updatedJson.data.status, 'completed');
  const deleted = await fetch(`${base}/v1/learning/plans/${createdJson.data.id}`, {method: 'DELETE', headers: auth});
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json() as any).data.deleted, true);
  const deletedAgain = await fetch(`${base}/v1/learning/plans/${createdJson.data.id}`, {method: 'DELETE', headers: auth});
  assert.equal(deletedAgain.status, 404);

  const courseId = `course-contract-${Date.now()}`;
  const course = {id: courseId, title: '契约测试课程', teacher: '测试老师', type: 'video' as const, progress: 0, lessons: 1, accent: '#123456', status: 'published' as const, updatedAt: new Date().toISOString()};
  const draftCourse = {...course, id: `${courseId}-draft`, status: 'draft' as const};
  const productId = `product-contract-${Date.now()}`;
  const product = {id: productId, name: '契约测试商品', category: '测试', price: 1, originalPrice: 1, sold: 0, accent: '#123456', benefits: [], status: 'on_sale' as const, updatedAt: new Date().toISOString()};
  const draftProduct = {...product, id: `${productId}-draft`, status: 'draft' as const};
  const expired = {userId: 'u-demo', courseId, sourceOrderId: 'contract-order', expiresAt: new Date(Date.now() - 60_000).toISOString()};
  store.courses.push(course, draftCourse);
  store.products.push(product, draftProduct);
  store.entitlements.push(expired);
  try {
    const courses = await fetch(`${base}/v1/courses`, {headers: auth});
    const coursesJson = await courses.json() as any;
    assert.equal(courses.status, 200);
    assert.equal(coursesJson.data.some((item: any) => item.id === `${courseId}-draft`), false);
    assert.equal(coursesJson.data.some((item: any) => item.id === courseId), false);
    const entitlement = await fetch(`${base}/v1/courses/${courseId}/entitlement`, {headers: auth});
    const entitlementJson = await entitlement.json() as any;
    assert.equal(entitlement.status, 200);
    assert.equal(entitlementJson.data.hasAccess, false);
    const missing = await fetch(`${base}/v1/courses/does-not-exist`, {headers: auth});
    assert.equal(missing.status, 404);
    const home = await fetch(`${base}/v1/home`, {headers: auth});
    const homeJson = await home.json() as any;
    assert.equal(home.status, 200);
    assert.equal(homeJson.data.hotCourses.some((item: any) => item.status === 'draft'), false);
    assert.notEqual(homeJson.data.featuredProduct?.status, 'draft');
  } finally {
    store.courses = store.courses.filter(item => item.id !== courseId && item.id !== `${courseId}-draft`);
    store.products = store.products.filter(item => item.id !== productId && item.id !== `${productId}-draft`);
    store.entitlements = store.entitlements.filter(item => item !== expired);
  }
}));

test('subjective grading keeps AI advice separate from manual review and published report', async () => withServer(async base => {
  const user = {authorization: 'Bearer demo-token', 'content-type': 'application/json'};
  const questions = await fetch(`${base}/v1/grading/questions`, {headers: user}); const questionsJson = await questions.json() as any;
  assert.equal(questions.status, 200); assert.equal(questionsJson.data.items.some((item: any) => item.id === 'subjective-demo-1'), true);

  const idempotencyKey = `grading-test-${Date.now()}`;
  const payload = JSON.stringify({questionId: 'subjective-demo-1', answers: [{subQuestionId: 'sq-1', text: '应从请求权基础、构成要件和法律后果展开分析。'}]});
  const submitted = await fetch(`${base}/v1/grading/submissions`, {method: 'POST', headers: {...user, 'idempotency-key': idempotencyKey}, body: payload}); const submittedJson = await submitted.json() as any;
  assert.equal(submitted.status, 201); assert.equal(submittedJson.data.status, 'ai_failed'); assert.match(submittedJson.data.ai.failureReason, /JSON|token|position/i);
  const repeated = await fetch(`${base}/v1/grading/submissions`, {method: 'POST', headers: {...user, 'idempotency-key': idempotencyKey}, body: payload}); const repeatedJson = await repeated.json() as any;
  assert.equal(repeated.status, 200); assert.equal(repeatedJson.data.id, submittedJson.data.id);

  const adminLogin = await fetch(`${base}/v1/admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'change-me-local'})}); const adminLoginJson = await adminLogin.json() as any; const cookie = adminLogin.headers.get('set-cookie')?.split(';')[0] ?? '';
  const queued = await fetch(`${base}/v1/admin/grading/${submittedJson.data.id}/queue-manual`, {method: 'POST', headers: {cookie, 'x-csrf-token': adminLoginJson.data.csrfToken}}); const queuedJson = await queued.json() as any;
  assert.equal(queued.status, 201); assert.equal(queuedJson.data.status, 'available');

  const graderLogin = await fetch(`${base}/v1/grader/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'grader', password: 'change-me-grader'})}); const graderJson = await graderLogin.json() as any; const graderAuth = {authorization: `Bearer ${graderJson.data.accessToken}`, 'content-type': 'application/json'};
  assert.equal(graderLogin.status, 200); assert.equal(graderJson.data.grader.subjectIds.includes('civil'), true); assert.equal('permissions' in graderJson.data.grader, false);
  const claimed = await fetch(`${base}/v1/grader/tasks/${queuedJson.data.id}/claim`, {method: 'POST', headers: graderAuth}); assert.equal(claimed.status, 200);
  const claimedAgain = await fetch(`${base}/v1/grader/tasks/${queuedJson.data.id}/claim`, {method: 'POST', headers: graderAuth}); assert.equal(claimedAgain.status, 409);
  const review = await fetch(`${base}/v1/grader/tasks/${queuedJson.data.id}/review`, {method: 'POST', headers: graderAuth, body: JSON.stringify({totalScore: 15, pointResults: [{pointId: 'rp-1', score: 6, status: 'partial', comment: '基础识别正确'}, {pointId: 'rp-2', score: 5, status: 'partial'}, {pointId: 'rp-3', score: 4, status: 'partial'}], answerAnnotations: [{subQuestionId: 'sq-1', start: 0, end: 7, type: 'correct', comment: '请求权基础识别准确'}], missedPointIds: [], feedback: '请求权分析结构完整。', improvementAdvice: '补充规范依据并加强事实涵摄。', aiOverrideReason: 'AI 首轮不可用，由人工独立评分。'})});
  assert.equal(review.status, 201); const reviewJson = await review.json() as any; assert.equal(reviewJson.data.answerAnnotations.length, 1); assert.deepEqual(reviewJson.data.missedPointIds, []);
  const published = await fetch(`${base}/v1/admin/grading/${submittedJson.data.id}/publish`, {method: 'POST', headers: {cookie, 'x-csrf-token': adminLoginJson.data.csrfToken}}); const publishedJson = await published.json() as any;
  assert.equal(published.status, 200); assert.equal(publishedJson.data.totalScore, 15); assert.equal(publishedJson.data.version, 1);
  const report = await fetch(`${base}/v1/grading/submissions/${submittedJson.data.id}/report`, {headers: user}); const reportJson = await report.json() as any;
  assert.equal(report.status, 200); assert.equal(reportJson.data.feedback, '请求权分析结构完整。'); assert.equal(reportJson.data.answers.length, 1); assert.equal(reportJson.data.answerAnnotations[0].quote, '应从请求权基础'); assert.equal(reportJson.data.pointResults[0].status, 'partial'); assert.equal('provider' in reportJson.data, false);
}));

test('admin can assign and reassign a manual grading task by subject permission', async () => withServer(async base => {
  const login = await fetch(`${base}/v1/admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'change-me-local'})});
  const loginJson = await login.json() as any; const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''; const headers = {cookie, 'x-csrf-token': loginJson.data.csrfToken, 'content-type': 'application/json'};
  const accounts = await fetch(`${base}/v1/admin/grader-accounts`, {headers: {cookie}}); const accountsJson = await accounts.json() as any; assert.equal(accounts.status, 200); assert.equal(accountsJson.data.items.length >= 2, true);
  const assigned = await fetch(`${base}/v1/admin/grading/gsub-demo-queued/assign`, {method: 'POST', headers, body: JSON.stringify({graderId: 'grader-demo', dueAt: '2099-01-01T00:00:00.000Z', reason: '按民法科目分发'})}); const assignedJson = await assigned.json() as any; assert.equal(assigned.status, 200); assert.equal(assignedJson.data.graderId, 'grader-demo');
  const forbidden = await fetch(`${base}/v1/admin/grading/gsub-demo-queued/reassign`, {method: 'POST', headers, body: JSON.stringify({graderId: 'grader-criminal', dueAt: '2099-01-01T00:00:00.000Z', reason: '错误科目测试'})}); assert.equal(forbidden.status, 403);
}));

test('question activity feeds records, mistakes, favorites and learning report', async () => withServer(async base => {
  const auth = {authorization: 'Bearer demo-token', 'content-type': 'application/json'};
  const submitted = await fetch(`${base}/v1/question-submissions`, {method: 'POST', headers: auth, body: JSON.stringify({questionId: 'oq1', answers: ['0']})});
  const submission = await submitted.json() as any;
  assert.equal(submitted.status, 200); assert.equal(submission.data.correct, false);

  const records = await fetch(`${base}/v1/question-records`, {headers: auth}); const recordsJson = await records.json() as any;
  assert.equal(records.status, 200); assert.equal(recordsJson.data.some((item: any) => item.id === submission.data.submissionId), true);
  const civilObjectiveRecords = recordsJson.data.filter((item: any) => item.subjectId === 'civil' && item.mode === 'objective');
  const paginatedRecords = await fetch(`${base}/v1/question-records?page=1&pageSize=1&subjectId=civil&mode=objective`, {headers: auth});
  const paginatedRecordsJson = await paginatedRecords.json() as any;
  assert.equal(paginatedRecords.status, 200);
  assert.equal(paginatedRecordsJson.data.items.length, Math.min(1, civilObjectiveRecords.length));
  assert.equal(paginatedRecordsJson.data.total, civilObjectiveRecords.length);
  assert.equal(paginatedRecordsJson.data.answered, civilObjectiveRecords.reduce((sum: number, item: any) => sum + item.total, 0));
  assert.equal(paginatedRecordsJson.data.correct, civilObjectiveRecords.reduce((sum: number, item: any) => sum + item.correctCount, 0));

  const mistakes = await fetch(`${base}/v1/mistakes`, {headers: auth}); const mistakesJson = await mistakes.json() as any;
  assert.equal(mistakes.status, 200); assert.equal(mistakesJson.data.some((item: any) => item.questionId === 'oq1'), true);

  const favorite = await fetch(`${base}/v1/favorites`, {method: 'POST', headers: auth, body: JSON.stringify({questionId: 'oq1'})}); const favoriteJson = await favorite.json() as any;
  assert.equal(favorite.status === 200 || favorite.status === 201, true);
  const favorites = await fetch(`${base}/v1/favorites`, {headers: auth}); const favoritesJson = await favorites.json() as any;
  assert.equal(favoritesJson.data.some((item: any) => item.questionId === 'oq1'), true);
  const removed = await fetch(`${base}/v1/favorites/${encodeURIComponent(favoriteJson.data.id)}`, {method: 'DELETE', headers: auth});
  assert.equal(removed.status, 200);

  const report = await fetch(`${base}/v1/learning/report?period=week`, {headers: auth}); const reportJson = await report.json() as any;
  assert.equal(report.status, 200); assert.equal(reportJson.data.answered >= 1, true);

  const recordReport = await fetch(`${base}/v1/question-submissions/${submission.data.submissionId}/report`, {headers: auth});
  const recordReportJson = await recordReport.json() as any;
  assert.equal(recordReport.status, 200);
  assert.equal(recordReportJson.data.stem, '关于民事法律行为的效力，下列哪一选项是正确的？');
  assert.deepEqual(recordReportJson.data.options, [
    '无民事行为能力人实施的行为一律无效',
    '限制民事行为能力人实施的纯获利益行为有效',
    '可撤销行为自始当然无效',
    '无权代理行为不得追认',
  ]);
  assert.deepEqual(recordReportJson.data.correctAnswers, ['1']);
}));

test('legal article favorites are user-scoped, idempotent and removable', async () => withServer(async base => {
  const auth = {authorization: 'Bearer demo-token', 'content-type': 'application/json'};
  const initial = await fetch(`${base}/v1/legal-favorites`, {headers: auth});
  assert.equal(initial.status, 200);
  assert.equal(Array.isArray((await initial.json() as any).data), true);
  const created = await fetch(`${base}/v1/legal-favorites`, {method: 'POST', headers: auth, body: JSON.stringify({documentId: 'civil-311'})});
  const createdJson = await created.json() as any;
  assert.equal(created.status, 201);
  assert.equal(createdJson.data.legalDocumentId, 'civil-311');
  assert.equal(createdJson.data.documentVersion, 1);
  assert.equal(createdJson.data.subjectId, 'civil');
  const duplicate = await fetch(`${base}/v1/legal-favorites`, {method: 'POST', headers: auth, body: JSON.stringify({documentId: 'civil-311'})});
  const duplicateJson = await duplicate.json() as any;
  assert.equal(duplicate.status, 200);
  assert.equal(duplicateJson.data.id, createdJson.data.id);
  const listed = await fetch(`${base}/v1/legal-favorites`, {headers: auth});
  const listedJson = await listed.json() as any;
  assert.equal(listedJson.data.some((item: any) => item.id === createdJson.data.id), true);
  const removed = await fetch(`${base}/v1/legal-favorites/${createdJson.data.id}`, {method: 'DELETE', headers: auth});
  assert.equal(removed.status, 200);
  assert.equal((await removed.json() as any).data.removed, true);
  const after = await fetch(`${base}/v1/legal-favorites`, {headers: auth});
  assert.equal((await after.json() as any).data.some((item: any) => item.id === createdJson.data.id), false);
}));

test('user-scoped course progress and notification receipts persist in memory', async () => withServer(async base => {
  const auth = {authorization: 'Bearer demo-token', 'content-type': 'application/json'};
  const updated = await fetch(`${base}/v1/courses/c1/progress`, {method: 'POST', headers: auth, body: JSON.stringify({progress: 73})});
  const updatedJson = await updated.json() as any;
  assert.equal(updated.status, 200); assert.equal(updatedJson.data.progress, 73);
  const course = await fetch(`${base}/v1/courses/c1`, {headers: auth}); const courseJson = await course.json() as any;
  assert.equal(courseJson.data.progress, 73);
  const notifications = await fetch(`${base}/v1/notifications`, {headers: auth}); const notificationsJson = await notifications.json() as any;
  assert.equal(notificationsJson.data.find((item: any) => item.id === 'n1').read, false);
  const marked = await fetch(`${base}/v1/notifications/n1/read`, {method: 'POST', headers: auth}); assert.equal(marked.status, 200);
  const refreshed = await fetch(`${base}/v1/notifications`, {headers: auth}); const refreshedJson = await refreshed.json() as any;
  assert.equal(refreshedJson.data.find((item: any) => item.id === 'n1').read, true);
}));

test('admin imports objective and subjective question files into selected taxonomy', async () => withServer(async base => {
  const login = await fetch(`${base}/v1/admin/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'change-me-local'})});
  const loginJson = await login.json() as any;
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const headers = {cookie, 'x-csrf-token': loginJson.data.csrfToken, 'content-type': 'application/json'};
  const suffix = Date.now();
  const objectiveStem = `批量导入客观题测试题干 ${suffix}`;
  const subjectiveTitle = `批量导入主观题 ${suffix}`;

  const invalidTaxonomy = await fetch(`${base}/v1/admin/content/imports`, {
    method: 'POST',
    headers: {...headers, 'idempotency-key': `invalid-import-${suffix}`},
    body: JSON.stringify({filename: 'invalid.csv', format: 'csv', questionKind: 'objective', subjectId: 'civil', chapterId: 'civil-subjective-chapter-1', pointId: 'civil-subjective-point-1', records: [{stem: objectiveStem, options: ['A', 'B'], answer: 0, analysis: '解析'}]}),
  });
  assert.equal(invalidTaxonomy.status, 422);

  const objectivePreflight = await fetch(`${base}/v1/admin/content/imports`, {
    method: 'POST',
    headers: {...headers, 'idempotency-key': `objective-import-${suffix}`},
    body: JSON.stringify({filename: 'objective.xlsx', format: 'xlsx', questionKind: 'objective', subjectId: 'civil', chapterId: 'civil-objective-chapter-1', pointId: 'civil-objective-point-1', records: [{stem: objectiveStem, options: ['正确选项', '错误选项'], answer: 0, answerIndexes: [0], questionType: 'single', analysis: '批量导入测试解析'}]}),
  });
  const objectiveJob = await objectivePreflight.json() as any;
  assert.equal(objectivePreflight.status, 201);
  assert.equal(objectiveJob.data.successCount, 1);
  assert.equal(objectiveJob.data.errorCount, 0);
  const objectiveConfirm = await fetch(`${base}/v1/admin/content/imports/${objectiveJob.data.id}/confirm`, {method: 'POST', headers});
  assert.equal(objectiveConfirm.status, 200);
  const objectiveList = await fetch(`${base}/v1/admin/questions?keyword=${encodeURIComponent(objectiveStem)}`, {headers: {cookie}});
  const objectiveListJson = await objectiveList.json() as any;
  const importedObjective = objectiveListJson.data.items.find((item: any) => item.stem === objectiveStem);
  assert.equal(importedObjective.status, 'draft');
  assert.equal(importedObjective.chapterId, 'civil-objective-chapter-1');
  assert.equal(importedObjective.pointId, 'civil-objective-point-1');

  const subjectivePreflight = await fetch(`${base}/v1/admin/content/imports`, {
    method: 'POST',
    headers: {...headers, 'idempotency-key': `subjective-import-${suffix}`},
    body: JSON.stringify({filename: 'subjective.json', format: 'json', questionKind: 'subjective', subjectId: 'civil', chapterId: 'civil-subjective-chapter-1', pointId: 'civil-subjective-point-1', records: [{title: subjectiveTitle, caseMaterial: '甲乙双方因合同履行发生争议。', subQuestion: '请分析合同效力及双方责任。', gradingBasis: '识别请求权基础并完成事实涵摄。', totalScore: 30, suggestedMinutes: 45}]}),
  });
  const subjectiveJob = await subjectivePreflight.json() as any;
  assert.equal(subjectivePreflight.status, 201);
  assert.equal(subjectiveJob.data.successCount, 1);
  assert.equal(subjectiveJob.data.questionKind, 'subjective');
  const subjectiveConfirm = await fetch(`${base}/v1/admin/content/imports/${subjectiveJob.data.id}/confirm`, {method: 'POST', headers});
  assert.equal(subjectiveConfirm.status, 200);
  const subjectiveList = await fetch(`${base}/v1/admin/content/questions/subjective?keyword=${encodeURIComponent(subjectiveTitle)}`, {headers: {cookie}});
  const subjectiveListJson = await subjectiveList.json() as any;
  const importedSubjective = subjectiveListJson.data.items.find((item: any) => item.title === subjectiveTitle);
  assert.equal(importedSubjective.status, 'draft');
  assert.equal(importedSubjective.chapterId, 'civil-subjective-chapter-1');
  assert.equal(importedSubjective.pointId, 'civil-subjective-point-1');

  store.questions = store.questions.filter(item => item.stem !== objectiveStem);
  store.gradingRubrics = store.gradingRubrics.filter(item => item.title !== subjectiveTitle);
}));

test('forum supports pagination, reactions, comments and author-only deletion', async () => withServer(async base => {
  const demo = {'content-type': 'application/json', authorization: 'Bearer demo-token'};
  const invalid = await fetch(`${base}/v1/forum/posts`, {method: 'POST', headers: demo, body: JSON.stringify({category: '经验分享', title: '短', body: '正文也太短'})});
  assert.equal(invalid.status, 422);

  const createdResponse = await fetch(`${base}/v1/forum/posts`, {method: 'POST', headers: demo, body: JSON.stringify({category: '答疑求助', title: '行政法复习顺序请教', body: '行政法知识点比较零散，应该按照什么顺序开始复习？'})});
  const created = await createdResponse.json() as any;
  assert.equal(createdResponse.status, 201); assert.equal(created.data.category, '答疑求助'); assert.equal(created.data.canDelete, true);

  const filtered = await fetch(`${base}/v1/forum/posts?category=${encodeURIComponent('答疑求助')}&limit=1`, {headers: demo}); const filteredJson = await filtered.json() as any;
  assert.equal(filtered.status, 200); assert.equal(filteredJson.data.items[0].id, created.data.id);
  const firstPage = await fetch(`${base}/v1/forum/posts?limit=1`, {headers: demo}); const firstPageJson = await firstPage.json() as any;
  assert.equal(typeof firstPageJson.data.nextCursor, 'string');
  const secondPage = await fetch(`${base}/v1/forum/posts?limit=1&cursor=${encodeURIComponent(firstPageJson.data.nextCursor)}`, {headers: demo}); const secondPageJson = await secondPage.json() as any;
  assert.notEqual(secondPageJson.data.items[0].id, firstPageJson.data.items[0].id);

  const liked = await fetch(`${base}/v1/forum/posts/${created.data.id}/like`, {method: 'POST', headers: demo}); const likedJson = await liked.json() as any;
  assert.equal(likedJson.data.liked, true); assert.equal(likedJson.data.likes, 1);
  const unliked = await fetch(`${base}/v1/forum/posts/${created.data.id}/like`, {method: 'POST', headers: demo}); const unlikedJson = await unliked.json() as any;
  assert.equal(unlikedJson.data.liked, false); assert.equal(unlikedJson.data.likes, 0);
  const favorited = await fetch(`${base}/v1/forum/posts/${created.data.id}/favorite`, {method: 'POST', headers: demo}); const favoritedJson = await favorited.json() as any;
  assert.equal(favoritedJson.data.favorited, true);
  const favorites = await fetch(`${base}/v1/forum/posts?scope=favorites`, {headers: demo}); const favoritesJson = await favorites.json() as any;
  assert.equal(favoritesJson.data.items.some((item: any) => item.id === created.data.id), true);

  const otherUserId = `forum-user-${Date.now()}`; const otherToken = `forum-token-${Date.now()}`;
  store.profiles.set(otherUserId, {id: otherUserId, name: '另一位考生', phone: '13300000009', examYear: '2026', studyDays: 1});
  store.sessions.set(otherToken, {userId: otherUserId, refreshToken: 'forum-refresh', deviceId: 'forum-device', expiresAt: '2099-01-01T00:00:00.000Z'});
  const other = {'content-type': 'application/json', authorization: `Bearer ${otherToken}`};
  const detail = await fetch(`${base}/v1/forum/posts/${created.data.id}`, {headers: other}); const detailJson = await detail.json() as any;
  assert.equal(detailJson.data.canDelete, false); assert.equal(detailJson.data.favorited, false);
  const forbiddenPostDelete = await fetch(`${base}/v1/forum/posts/${created.data.id}`, {method: 'DELETE', headers: other}); assert.equal(forbiddenPostDelete.status, 403);

  const commentResponse = await fetch(`${base}/v1/forum/posts/${created.data.id}/comments`, {method: 'POST', headers: other, body: JSON.stringify({body: '建议先搭建行政行为分类框架，再结合真题复习。'})}); const comment = await commentResponse.json() as any;
  assert.equal(commentResponse.status, 201); assert.equal(comment.data.canDelete, true);
  const comments = await fetch(`${base}/v1/forum/posts/${created.data.id}/comments?limit=10`, {headers: demo}); const commentsJson = await comments.json() as any;
  assert.equal(commentsJson.data.items[0].canDelete, false);
  const forbiddenCommentDelete = await fetch(`${base}/v1/forum/comments/${comment.data.id}`, {method: 'DELETE', headers: demo}); assert.equal(forbiddenCommentDelete.status, 403);
  const deletedComment = await fetch(`${base}/v1/forum/comments/${comment.data.id}`, {method: 'DELETE', headers: other}); assert.equal(deletedComment.status, 200);

  const deletedPost = await fetch(`${base}/v1/forum/posts/${created.data.id}`, {method: 'DELETE', headers: demo}); assert.equal(deletedPost.status, 200);
  const missing = await fetch(`${base}/v1/forum/posts/${created.data.id}`, {headers: demo}); assert.equal(missing.status, 404);
}));
