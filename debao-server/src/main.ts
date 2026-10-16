import {type IncomingMessage, type ServerResponse} from 'node:http';
import {createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, open, rename, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createStore, restoreDevelopmentGradingShowcase} from './store.js';
import {createAIAdapter, createCarrierAuthAdapter, createGradingAdapter, createMediaAdapter, createPaymentAdapter, createPushAdapter, createSmsAdapter, createWechatAuthAdapter} from './adapters.js';
import {loadConfig} from './config.js';
import {Infrastructure, type SqlStatement} from './infrastructure.js';
import type {AIMessage, AISession, AIQuota, AIRiskFlag, AIUsageEvent, Announcement, AppLegalDocument, AttachmentUpload, Coupon, ForumCategory, ForumComment, ForumPost, GraderAccount, GradingAIRun, GradingAssignment, GradingReport, GradingReview, GradingRubric, GradingSubmission, GradingSubmissionStatus, LearningActivity, LearningClassType, LearningDiagnosticAttempt, LearningDiagnosticDimension, LearningDiagnosticDimensionDefinition, LearningDiagnosticForm, LearningDiagnosticQuestion, LearningQuestionBankQuestion, LearningQuestionCategory, LearningQuestionOption, LearningQuestionSubQuestion, LearningQuestionTaxonomyNode, LearningQuestionTaxonomyNodeType, LearningQuestionType, LearningQuestionUsageScene, LearningStage, LearningStageCondition, LearningStagePlanConfig, LearningStagePlanItem, LearningTeacher, LearningTeacherAssignment, LegalFavorite, ObjectiveReport, ObjectiveQuestionSnapshot, ObjectiveSession, ObjectiveSessionAnswer, Order, OrderEvent, Product, ProductSku, Question, QuestionSubmissionSnapshot, SmsPurpose, Store, UserProfile, UserSettings, VerificationChallenge} from './types.js';
import type {LearningCard, LearningCardAsset, LearningCardContentType, LearningCardRecallItem} from './types.js';
import {assertGradingTransition, gradingAnswerHash, validateRubric} from './grading.js';
import {handleLiveRoutes} from './live-routes.js';
export const config = loadConfig();
if (config.nodeEnv === 'production' && process.env.DEBAO_TEST_FIXTURES === 'true') {
  throw new Error('Test fixtures are forbidden in production');
}
// Fixtures are opt-in for tests only. Runtime data comes from PostgreSQL.
export const store = createStore(process.env.DEBAO_TEST_FIXTURES === 'true');
// Development fixtures must never create authenticated production sessions.
if (config.nodeEnv === 'production') {
  store.sessions.clear();
  store.graderSessions.clear();
  store.graderAccounts = [];
}
export const paymentAdapter = createPaymentAdapter();
export const smsAdapter = createSmsAdapter();
export const pushAdapter = createPushAdapter();
export const gradingAdapter = createGradingAdapter();
export const aiAdapter = createAIAdapter();
export const mediaAdapter = createMediaAdapter();
export const wechatAuthAdapter = createWechatAuthAdapter();
export const carrierAuthAdapter = createCarrierAuthAdapter();
export const infrastructure = new Infrastructure(config);
const adminAuditLogs: Array<Record<string, unknown>> = [];
const DEMO_DB_USER_ID = '00000000-0000-0000-0000-000000000001';
const FORUM_CATEGORIES: ForumCategory[] = ['经验分享', '答疑求助', '知识整理', '技巧方法'];
function dbUserId(userId: string) { return userId === 'u-demo' ? DEMO_DB_USER_ID : userId; }
function appendAdminAuditLog(values: unknown[]) {
  adminAuditLogs.unshift({id: randomUUID(), adminUserId: values[0], action: values[1], resourceType: values[2], resourceId: values[3], reason: values[4], requestId: values.at(-1), result: 'success', createdAt: new Date().toISOString()});
}
async function persist(text: string, values: unknown[] = []) {
  await infrastructure.query(text, values);
  if (text.toLowerCase().includes('admin_audit_logs')) appendAdminAuditLog(values);
}
async function persistAdminMutation(statements: SqlStatement[], auditValues: unknown[]) {
  await infrastructure.transaction([
    ...statements,
    {text: 'insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', values: auditValues},
  ]);
  appendAdminAuditLog(auditValues);
}
async function persistAnnouncementMutation(statements: SqlStatement[], auditValues: unknown[]) {
  await persistAdminMutation(statements, auditValues);
}
function tokenHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function internalUserId(value: string) { return value === DEMO_DB_USER_ID ? 'u-demo' : value; }
function legalSubjectId(document: {id: string; title: string; article: string; content: string; subjectId?: string}) {
  if (document.subjectId) return document.subjectId;
  const value = `${document.id}${document.title}${document.article}${document.content}`;
  if (value.includes('刑法') || value.includes('criminal')) return 'criminal';
  if (value.includes('行政') || value.includes('admin')) return 'admin';
  if (value.includes('诉讼') || value.includes('proc')) return value.includes('刑') ? 'crim-proc' : 'civil-proc';
  if (value.includes('商法') || value.includes('公司') || value.includes('commercial')) return 'commercial';
  if (value.includes('经济') || value.includes('economic')) return 'economic';
  if (value.includes('理论') || value.includes('theory')) return 'theory';
  return 'civil';
}
function profileFor(userId: string) {
  const profile = store.profiles.get(userId);
  if (!profile) throw new HttpError(404, 'USER_NOT_FOUND', '用户不存在');
  return profile;
}

function questionMatchesSubject(question: Question, subjectId: string | null) {
  if (!subjectId) return true;
  // New rows carry an explicit subject. Keep the ID-prefix fallback for
  // legacy/imported rows created before subject_id was required.
  return question.subjectId === subjectId || (!question.subjectId && question.id.startsWith(subjectId));
}

function isPublishedQuestion(question: Question) {
  return !question.status || question.status === 'published';
}

function learningBankQuestionAsObjective(question: LearningQuestionBankQuestion): Question | undefined {
  if (question.category !== 'objective' || question.status !== 'published' || !['true_false', 'single', 'multiple', 'indeterminate'].includes(question.questionType)) return undefined;
  const answerIndexes = question.correctAnswers.map(answer => question.options.findIndex(option => option.key === answer || option.label === answer)).filter(index => index >= 0);
  if (!answerIndexes.length || !question.options.length) return undefined;
  return {
    id: question.id,
    subjectId: question.subjectId,
    stem: question.stem,
    options: question.options.map(option => option.label),
    answer: answerIndexes[0],
    ...(answerIndexes.length > 1 ? {answerIndexes} : {}),
    questionType: question.questionType as NonNullable<Question['questionType']>,
    chapterId: question.chapterId,
    pointId: question.pointId,
    analysis: question.analysis,
    ...(question.explanationMediaVisible !== false && question.explanationMediaType ? {explanationMediaType: question.explanationMediaType} : {}),
    ...(question.explanationMediaVisible !== false && question.explanationMediaReference ? {explanationMediaReference: question.explanationMediaReference} : {}),
    status: question.status,
    version: question.version,
    source: question.source,
    updatedAt: question.updatedAt,
  };
}

function isPublishedCourse(course: {status?: string}) {
  return !course.status || course.status === 'published';
}

function isSellableProduct(product: Product) {
  return !product.status || product.status === 'on_sale';
}

function productSales(productId: string) {
  return store.orders.filter(order => order.productId === productId &&
    ['paid', 'refund_requested'].includes(order.status)).length;
}

function planDate(value: unknown, field: string, fallback: string) {
  const candidate = value === undefined ? fallback : String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${field} 必须是 YYYY-MM-DD 格式`);
  }
  const [year, month, day] = candidate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${field} 不是有效日期`);
  }
  return candidate;
}

function planMinutes(value: unknown, fallback = 60) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 1440) {
    throw new HttpError(422, 'VALIDATION_ERROR', '每日学习时长必须是 1 到 1440 分钟的整数');
  }
  return candidate;
}

function parsePositiveInteger(value: string | null, fallback: number, minimum: number, maximum: number, field: string) {
  if (value === null) return fallback;
  const candidate = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(candidate)) throw new HttpError(422, 'VALIDATION_ERROR', `${field} 必须是整数`);
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new HttpError(422, 'VALIDATION_ERROR', `${field} 必须是 ${minimum} 到 ${maximum} 的整数`);
  return parsed;
}

function draftKey(userId: string, questionId: string) {
  return `${userId}\u0000${questionId}`;
}

function draftableQuestion(questionId: string) {
  const question = store.questions.find(item => item.id === questionId);
  if (question) return isPublishedQuestion(question);
  return store.gradingRubrics.some(item => item.questionId === questionId && item.status === 'published');
}

function assertPlanDateRange(startDate: string, endDate: string) {
  if (Date.parse(`${endDate}T00:00:00.000Z`) < Date.parse(`${startDate}T00:00:00.000Z`)) {
    throw new HttpError(422, 'VALIDATION_ERROR', '计划结束日期不能早于开始日期');
  }
}

function normalizeLearningTask(task: Store['learningTasks'][number], now = Date.now()) {
  if (task.status === 'todo' && Date.parse(`${task.dueDate}T23:59:59.999Z`) < now) task.status = 'overdue';
  return task;
}

async function recordLearningPlanVersion(plan: Store['learningPlans'][number], reason: string, source: Store['learningPlanVersions'][number]['source'], createdBy?: string, requestId?: string) {
  const tasks = store.learningTasks.filter(task => task.planId === plan.id).map(task => ({...task}));
  const entry: Store['learningPlanVersions'][number] = {id: `plan-version-${randomUUID()}`, planId: plan.id, version: plan.version ?? 1, reason, source, snapshot: {plan: {...plan}, tasks}, ...(createdBy ? {createdBy} : {}), createdAt: new Date().toISOString()};
  store.learningPlanVersions.unshift(entry);
  await persist('insert into learning_plan_versions (id,plan_id,version,reason,source,snapshot,created_by,created_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) on conflict (plan_id,version) do update set reason=excluded.reason, source=excluded.source, snapshot=excluded.snapshot, created_by=excluded.created_by', [entry.id, entry.planId, entry.version, entry.reason, entry.source, JSON.stringify(entry.snapshot), entry.createdBy ?? null, entry.createdAt]);
  if (createdBy && requestId) await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1,$2,$3,$4,$5,$6)', [createdBy, `learning.plan.${source}`, 'learning_plan', plan.id, reason, requestId]);
  return entry;
}

function planDateFromNow() { return new Date().toISOString().slice(0, 10); }

function dateCapacity(config: LearningStagePlanConfig, date: string) {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  if (config.holidayDates.includes(date)) return {min: config.holidayMinMinutes, max: config.holidayMaxMinutes};
  if (day === 0 || day === 6) return {min: config.weekendMinMinutes, max: config.weekendMaxMinutes};
  return {min: config.weekdayMinMinutes, max: config.weekdayMaxMinutes};
}

function buildCapacitySchedule(config: LearningStagePlanConfig, startDate: string, totalMinutes: number, deadline?: string) {
  const configuredDays = [...new Set(config.studyDays)].filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
  const regularDays = configuredDays.length ? configuredDays : [1, 2, 3, 4, 5];
  const horizonEnd = deadline ?? addDays(startDate, config.durationDays - 1);
  const rows: Array<{date: string; min: number; max: number; minutes: number}> = [];
  for (let cursor = startDate; cursor <= horizonEnd; cursor = addDays(cursor, 1)) {
    const day = new Date(`${cursor}T00:00:00.000Z`).getUTCDay();
    const isHoliday = config.holidayDates.includes(cursor);
    if (isHoliday || regularDays.includes(day) || config.makeupPolicy === 'weekend' && (day === 0 || day === 6)) {
      const range = dateCapacity(config, cursor); rows.push({date: cursor, ...range, minutes: 0});
    }
  }
  if (!rows.length) rows.push({date: startDate, ...dateCapacity(config, startDate), minutes: 0});
  let remaining = Math.max(0, totalMinutes);
  const assign = (row: {min: number; max: number; minutes: number}, daysLeft: number) => {
    if (remaining <= 0) return;
    const desired = Math.ceil(remaining / Math.max(1, daysLeft));
    const amount = Math.min(row.max, Math.max(row.min, desired));
    row.minutes = Math.min(remaining, amount); remaining -= row.minutes;
  };
  for (let index = 0; index < rows.length; index += 1) assign(rows[index], rows.length - index);
  let cursor = addDays(horizonEnd, 1);
  while (remaining > 0) {
    const day = new Date(`${cursor}T00:00:00.000Z`).getUTCDay();
    const isHoliday = config.holidayDates.includes(cursor);
    if (isHoliday || regularDays.includes(day) || config.makeupPolicy === 'weekend' && (day === 0 || day === 6)) {
      const range = dateCapacity(config, cursor); const row = {date: cursor, ...range, minutes: 0}; rows.push(row); assign(row, 1);
    }
    cursor = addDays(cursor, 1);
  }
  return {rows: rows.filter(row => row.minutes > 0), incomplete: Boolean(rows.at(-1)?.date && rows.at(-1)!.date > horizonEnd)};
}

function planTaskDatesForRebalance(plan: Store['learningPlans'][number], tasks: Store['learningTasks']) {
  const pending = tasks.filter(task => task.status !== 'done').sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id));
  const stageConfig = plan.stageId ? stagePlanConfig(plan.stageId) : undefined;
  const totalMinutes = pending.reduce((sum, task) => sum + task.minutes, 0);
  const schedule = stageConfig ? buildCapacitySchedule(stageConfig, planDateFromNow(), totalMinutes, plan.endDate) : {rows: [], incomplete: false};
  const slots = schedule.rows.map(row => row.date); const capacityByDate = new Map(schedule.rows.map(row => [row.date, row.minutes]));
  const assignments = new Map<string, string>(); const minutesByDate = new Map<string, number>();
  let slotIndex = 0;
  for (const task of pending) {
    while (slotIndex < slots.length && (minutesByDate.get(slots[slotIndex]) ?? 0) > 0 && (minutesByDate.get(slots[slotIndex]) as number) + task.minutes > (capacityByDate.get(slots[slotIndex]) ?? plan.dailyMinutes)) slotIndex += 1;
    if (stageConfig && !slots[slotIndex]) {
      const last = slots.at(-1) ?? planDateFromNow(); let cursor = addDays(last, 1);
      const regularDays = stageConfig.studyDays.length ? stageConfig.studyDays : [1, 2, 3, 4, 5];
      while (!regularDays.includes(new Date(`${cursor}T00:00:00.000Z`).getUTCDay()) && !(stageConfig.makeupPolicy === 'weekend' && [0, 6].includes(new Date(`${cursor}T00:00:00.000Z`).getUTCDay()))) cursor = addDays(cursor, 1);
      slots.push(cursor); capacityByDate.set(cursor, dateCapacity(stageConfig, cursor).max);
    }
    const date = slots[slotIndex] ?? planDateFromNow(); assignments.set(task.id, date); minutesByDate.set(date, (minutesByDate.get(date) ?? 0) + task.minutes);
  }
  return assignments;
}

async function rebalanceLearningPlan(plan: Store['learningPlans'][number], reason = '根据未完成任务自动重排', force = false) {
  if (plan.pausedAt || !plan.autoGenerated) return false;
  const tasks = store.learningTasks.filter(task => task.planId === plan.id);
  const today = planDateFromNow();
  const overdue = tasks.some(task => task.status !== 'done' && task.dueDate < today);
  if (!overdue && !force) return false;
  const assignments = planTaskDatesForRebalance(plan, tasks); const now = new Date().toISOString();
  const changed = tasks.filter(task => task.status !== 'done' && assignments.get(task.id) && assignments.get(task.id) !== task.dueDate);
  if (!changed.length) return false;
  const nextEndDate = [...assignments.values()].sort().at(-1) ?? plan.endDate;
  const nextVersion = (plan.version ?? 1) + 1;
  await infrastructure.transaction([
    ...changed.map(task => ({text: 'update learning_tasks set due_date=$1,status=\'todo\' where id=$2 and plan_id=$3', values: [assignments.get(task.id), task.id, plan.id]})),
    {text: 'update learning_plans set end_date=$1,version=$2,change_reason=$3,updated_at=$4 where id=$5', values: [nextEndDate, nextVersion, reason, now, plan.id]},
  ]);
  for (const task of changed) { task.dueDate = assignments.get(task.id) as string; if (task.status !== 'done') task.status = 'todo'; }
  plan.endDate = nextEndDate; plan.version = nextVersion; plan.changeReason = reason; plan.updatedAt = now;
  await recordLearningPlanVersion(plan, reason, 'auto');
  return true;
}

async function shiftPendingPlanTasks(plan: Store['learningPlans'][number], days: number, reason: string) {
  const tasks = store.learningTasks.filter(task => task.planId === plan.id && task.status !== 'done');
  const stageConfig = plan.stageId ? stagePlanConfig(plan.stageId) : undefined;
  const regularDays = stageConfig?.studyDays?.length ? stageConfig.studyDays : [0, 1, 2, 3, 4, 5, 6];
  const allowedDays = stageConfig?.makeupPolicy === 'weekend' ? [...new Set([...regularDays, 0, 6])] : regularDays;
  const shiftedDate = (date: string) => { let next = addDays(date, days); while (!allowedDays.includes(new Date(`${next}T00:00:00.000Z`).getUTCDay())) next = addDays(next, 1); return next; };
  const nextEndDate = shiftedDate(plan.endDate); const now = new Date().toISOString(); const nextVersion = (plan.version ?? 1) + 1;
  await infrastructure.transaction([
    ...tasks.map(task => ({text: 'update learning_tasks set due_date=$1,status=\'todo\' where id=$2 and plan_id=$3', values: [shiftedDate(task.dueDate), task.id, plan.id]})),
    {text: 'update learning_plans set end_date=$1,version=$2,change_reason=$3,updated_at=$4 where id=$5', values: [nextEndDate, nextVersion, reason, now, plan.id]},
  ]);
  for (const task of tasks) { task.dueDate = shiftedDate(task.dueDate); if (task.status !== 'done') task.status = 'todo'; }
  plan.endDate = nextEndDate; plan.version = nextVersion; plan.changeReason = reason; plan.updatedAt = now;
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function addDays(dateValue: string, amount: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function earlyAccessRequestTarget(plan: Store['learningPlans'][number], tasks: Store['learningTasks']) {
  const today = planDateFromNow();
  const currentUnlocked = plan.earlyUnlockedThrough && plan.earlyUnlockedThrough > today ? plan.earlyUnlockedThrough : today;
  const dayTasks = tasks.filter(task => task.planId === plan.id && task.dueDate === currentUnlocked);
  if (!dayTasks.length || dayTasks.some(task => task.status !== 'done')) return undefined;
  const next = addDays(currentUnlocked, 1);
  return next <= plan.endDate ? next : undefined;
}

function learningPlanStartDate(userId: string) {
  const order = store.orders.find(item => item.userId === userId && item.status === 'paid' && store.learningClassTypes.some(classType => classType.productId === item.productId && classType.status === 'active'));
  return dateOnly(order?.paidAt ?? order?.createdAt ?? new Date().toISOString());
}

function defaultStagePlanConfig(stageId: string): LearningStagePlanConfig {
  return {stageId, totalMinutes: store.learningStagePlanItems.filter(item => item.stageId === stageId).reduce((sum, item) => sum + (item.minutes ?? 0), 0), dailyMinutes: 120, minDailyMinutes: 30, maxDailyMinutes: 180, weekdayMinMinutes: 30, weekdayMaxMinutes: 180, weekendMinMinutes: 60, weekendMaxMinutes: 240, holidayMinMinutes: 60, holidayMaxMinutes: 180, holidayDates: [], studyDays: [1, 2, 3, 4, 5, 6, 0], durationDays: 30, makeupPolicy: 'spread', cardUnlockRule: 'after_course_checkin', questionPushCount: 5, questionSelectionStrategy: 'profile', status: 'published', version: 1, updatedAt: new Date().toISOString()};
}

function stagePlanConfig(stageId: string) {
  return store.learningStagePlanConfigs.find(item => item.stageId === stageId) ?? defaultStagePlanConfig(stageId);
}

async function markStagePlanDraft(stageId: string, adminId: string, requestId: string, reason: string) {
  const current = stagePlanConfig(stageId);
  if (current.status === 'draft') return current;
  const publishedSnapshot = current.publishedSnapshot ?? stagePlanSnapshot(current);
  const updated: LearningStagePlanConfig = {...current, status: 'draft', version: current.version + 1, publishedAt: undefined, publishedSnapshot, updatedAt: new Date().toISOString()};
  await persistAdminMutation([{text: 'update learning_stage_plan_configs set status=$1,version=$2,published_at=null,published_snapshot=$3::jsonb,updated_by=$4,updated_at=$5 where stage_id=$6', values: [updated.status, updated.version, JSON.stringify(publishedSnapshot), adminId, updated.updatedAt, stageId]}], [adminId, 'learning_stage_plan.draft', 'learning_stage_plan', stageId, reason, requestId]);
  const index = store.learningStagePlanConfigs.findIndex(item => item.stageId === stageId);
  if (index >= 0) store.learningStagePlanConfigs[index] = updated; else store.learningStagePlanConfigs.push(updated);
  return updated;
}

function validateStagePlanContent(contentType: LearningStagePlanItem['contentType'], contentId: string | undefined) {
  // A course in a stage plan is an external lesson. The app shows the
  // configured copy and the learner returns to check in after listening.
  if (contentType === 'course') {
    if (contentId) throw new HttpError(422, 'VALIDATION_ERROR', '站外课程不需要关联站内视频，请填写课程文案');
    return;
  }
  if (contentType === 'task') {
    if (contentId) throw new HttpError(422, 'VALIDATION_ERROR', '自定义学习任务不能填写内容 ID');
    return;
  }
  if (contentType === 'assessment') {
    if (!contentId) throw new HttpError(422, 'VALIDATION_ERROR', '周考必须关联已发布的客观题试卷 ID');
    if (!store.papers.some(item => item.id === contentId && item.status === 'published') && !store.learningAssessmentPapers.some(item => item.id === contentId && item.status === 'published')) throw new HttpError(422, 'LEARNING_CONTENT_NOT_FOUND', '关联的学习中心试卷不存在或尚未发布');
    return;
  }
  // A question slot without an ID is filled at runtime from the learner's
  // diagnostic profile. A card slot without an ID is filled from published
  // cards whose own knowledge points match the preceding course content.
  if ((contentType === 'question' || contentType === 'card') && !contentId) return;
  if (!contentId) throw new HttpError(422, 'VALIDATION_ERROR', '主观题必须关联题库题目 ID');
  const exists = contentType === 'question'
    ? store.learningQuestionBankQuestions.some(item => item.id === contentId && item.category === 'objective') || store.questions.some(item => item.id === contentId)
    : contentType === 'subjective'
      ? store.learningQuestionBankQuestions.some(item => item.id === contentId && item.category === 'subjective' && item.status === 'published')
      : store.learningCards.some(item => item.id === contentId);
  if (!exists) throw new HttpError(422, 'LEARNING_CONTENT_NOT_FOUND', '关联的学习内容不存在');
}

function knowledgePointIdsRelated(leftId: string, rightId: string) {
  if (leftId === rightId) return true;
  const left = store.learningQuestionTaxonomyNodes.find(node => node.id === leftId);
  // A taught parent covers its children; a taught child cannot authorize siblings.
  return left?.type === 'subpoint' && left.parentId === rightId;
}

function knowledgePointIdsOverlap(leftIds: string[], rightIds: string[]) {
  return leftIds.some(leftId => rightIds.some(rightId => knowledgePointIdsRelated(leftId, rightId)));
}

function publishedCardIdsForKnowledgePoints(pointIds: string[]) {
  if (!pointIds.length) return [];
  return store.learningCards
    .filter(card => card.status === 'published' && (card.knowledgePointIds?.length ?? 0) > 0 && knowledgePointIdsOverlap(card.knowledgePointIds ?? [], pointIds))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .map(card => card.id);
}

function validateStagePlanKnowledgeLinks(stageId: string) {
  const items = store.learningStagePlanItems.filter(item => item.stageId === stageId).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  for (const [itemIndex, item] of items.entries()) {
    if (item.contentType === 'course') {
      if (!item.knowledgePointIds?.length) throw new HttpError(422, 'LEARNING_KNOWLEDGE_POINTS_REQUIRED', `课程“${item.title}”必须关联听课考点`);
      continue;
    }
    if (!['card', 'question', 'subjective'].includes(item.contentType)) continue;
    const itemDay = item.weekDay ?? itemIndex + 1;
    const priorCourses = items.filter((candidate, index) => candidate.contentType === 'course' && ((candidate.weekDay ?? index + 1) < itemDay || (candidate.weekDay ?? index + 1) === itemDay && index < itemIndex));
    const priorPoints = new Set(priorCourses.flatMap(course => course.knowledgePointIds ?? []));
    const linkedPoints = item.knowledgePointIds ?? [];
    const selectedCard = item.contentType === 'card' && item.contentId ? store.learningCards.find(card => card.id === item.contentId) : undefined;
    const effectivePoints = linkedPoints.length ? linkedPoints : selectedCard?.knowledgePointIds ?? [];
    if (!effectivePoints.length) throw new HttpError(422, 'LEARNING_KNOWLEDGE_POINTS_REQUIRED', `“${item.title}”必须关联前置听课考点，或选择已绑定考点的学习卡片`);
    if (!priorCourses.length || !effectivePoints.every(pointId => [...priorPoints].some(priorPointId => knowledgePointIdsRelated(pointId, priorPointId)))) {
      throw new HttpError(422, 'LEARNING_KNOWLEDGE_POINT_MISMATCH', `“${item.title}”必须关联前面听课覆盖的考点`);
    }
    if (selectedCard?.knowledgePointIds?.length && !selectedCard.knowledgePointIds.every(pointId => [...priorPoints].some(priorPointId => knowledgePointIdsRelated(pointId, priorPointId)))) throw new HttpError(422, 'LEARNING_KNOWLEDGE_POINT_MISMATCH', `卡片“${selectedCard.title}”关联的考点超出了前面听课覆盖范围`);
  }
}

function stageItemMinutes(item: LearningStagePlanItem, config: LearningStagePlanConfig, itemCount: number) {
  // New content rows do not ask the operator for a duration. When the stage
  // still has a configured total duration, spread it evenly for calendar
  // capacity calculations; legacy rows keep their explicit estimate.
  if ((item.minutes ?? 0) > 0) return item.minutes as number;
  return Math.max(1, Math.round(config.totalMinutes / Math.max(1, itemCount)));
}

function questionDifficultyForProfile(scores: Record<string, number>) {
  const values = Object.values(scores).map(Number).filter(Number.isFinite);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 50;
  if (average < 40) return {min: 1, max: 2};
  if (average < 70) return {min: 2, max: 4};
  return {min: 3, max: 5};
}

function profileQuestionIds(userId: string, count: number, knowledgePointIds: string[] = []) {
  const attempt = store.learningDiagnosticAttempts.find(item => item.userId === userId);
  const range = questionDifficultyForProfile(attempt?.scores ?? {});
  const published = store.learningQuestionBankQuestions.filter(item => item.status === 'published' && item.category === 'objective');
  const pointSet = new Set(knowledgePointIds);
  const inCourseScope = (item: LearningQuestionBankQuestion) => !pointSet.size || pointSet.has(item.pointId) || Boolean(item.subPointId && pointSet.has(item.subPointId));
  const scoped = published.filter(inCourseScope);
  const pool = knowledgePointIds.length ? scoped : published;
  const preferred = pool.filter(item => item.difficulty >= range.min && item.difficulty <= range.max);
  const selected: string[] = [];
  const add = (id: string) => { if (selected.length < Math.max(0, count) && !selected.includes(id)) selected.push(id); };
  // Carry unresolved mistakes into the next week's practice first.
  store.mistakes
    .filter(item => item.userId === userId && !item.resolved)
    .sort((left, right) => right.wrongCount - left.wrongCount)
    .forEach(item => { if (pool.some(question => question.id === item.questionId)) add(item.questionId); });
  // Then cover knowledge points missed in recent weekly/assessment papers.
  const weakKeys = new Set<string>();
  store.objectiveReports
    .filter(item => item.userId === userId && item.mode === 'exam')
    .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
    .slice(0, 8)
    .forEach(report => report.results.filter(result => !result.correct).forEach(result => {
      const question = published.find(item => item.id === result.questionId);
      if (question) weakKeys.add(`${question.subjectId}:${question.subPointId ?? question.pointId}`);
    }));
  pool.filter(item => weakKeys.has(`${item.subjectId}:${item.subPointId ?? item.pointId}`)).sort((left, right) => left.difficulty - right.difficulty).forEach(item => add(item.id));
  [...preferred, ...pool.filter(item => !preferred.includes(item))].forEach(item => add(item.id));
  return selected;
}

function stagePlanSnapshot(config: LearningStagePlanConfig) {
  return {totalMinutes: config.totalMinutes, dailyMinutes: config.dailyMinutes, minDailyMinutes: config.minDailyMinutes, maxDailyMinutes: config.maxDailyMinutes, weekdayMinMinutes: config.weekdayMinMinutes, weekdayMaxMinutes: config.weekdayMaxMinutes, weekendMinMinutes: config.weekendMinMinutes, weekendMaxMinutes: config.weekendMaxMinutes, holidayMinMinutes: config.holidayMinMinutes, holidayMaxMinutes: config.holidayMaxMinutes, holidayDates: config.holidayDates, studyDays: config.studyDays, durationDays: config.durationDays, makeupPolicy: config.makeupPolicy, cardUnlockRule: config.cardUnlockRule, questionPushCount: config.questionPushCount, questionSelectionStrategy: config.questionSelectionStrategy};
}

function learningTaskIsUnlocked(task: Store['learningTasks'][number], tasks: Store['learningTasks'], config?: LearningStagePlanConfig) {
  if (!config || task.contentType === 'course' || task.contentType === 'task') return true;
  // Same-day prerequisites must not depend on randomly generated task IDs.
  const rank = (item: Store['learningTasks'][number]) => item.contentType === 'course' ? 0 : item.contentType === 'card' ? 1 : item.contentType === 'assessment' ? 3 : 2;
  const ordered = tasks.slice().sort((left, right) => left.dueDate.localeCompare(right.dueDate) || rank(left) - rank(right) || left.id.localeCompare(right.id));
  const index = ordered.findIndex(item => item.id === task.id);
  const previous = ordered.slice(0, index);
  if (task.contentType === 'card') {
    if (config.cardUnlockRule === 'immediate') return true;
    if (config.cardUnlockRule === 'after_previous_content') return previous.filter(item => item.contentType === 'course' || item.contentType === 'card').every(item => item.status === 'done');
    return previous.filter(item => item.contentType === 'course').every(item => item.status === 'done');
  }
  if (task.contentType === 'question' || task.contentType === 'subjective') return previous.filter(item => item.contentType === 'card').every(item => item.status === 'done');
  if (task.contentType === 'assessment') return previous.filter(item => item.contentType !== 'assessment').every(item => item.status === 'done');
  return true;
}

const autoLearningPlanInFlight = new Map<string, Promise<Store['learningPlans'][number] | undefined>>();

function buildStagePlanSchedule(userId: string, stageId: string, config: LearningStagePlanConfig, startDate = learningPlanStartDate(userId), deadline?: string) {
  const items = store.learningStagePlanItems.filter(item => item.stageId === stageId).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  const totalMinutes = config.totalMinutes > 0 ? config.totalMinutes : items.reduce((sum, item) => sum + stageItemMinutes(item, config, items.length), 0);
  const schedule = buildCapacitySchedule(config, startDate, totalMinutes, deadline);
  let dateCursor = 0; let capacity = schedule.rows[0]?.minutes ?? 0;
  const tasks: Store['learningTasks'] = [];
  for (const item of items) {
    const priorCoursePointIds = items.slice(0, items.indexOf(item)).filter(candidate => candidate.contentType === 'course').flatMap(candidate => candidate.knowledgePointIds ?? []);
    const linkedPointIds = item.knowledgePointIds?.length ? item.knowledgePointIds : priorCoursePointIds;
    const autoCardId = item.contentType === 'card' && !item.contentId ? publishedCardIdsForKnowledgePoints(linkedPointIds)[0] : undefined;
    if (item.contentType === 'card' && !item.contentId && !autoCardId) continue;
    let remaining = stageItemMinutes(item, config, items.length); let part = 1;
    while (remaining > 0) {
      if (!schedule.rows[dateCursor]) break;
      if (capacity <= 0) { dateCursor += 1; capacity = schedule.rows[dateCursor]?.minutes ?? 0; continue; }
      const minutes = Math.min(remaining, capacity);
      tasks.push({id: `task-${randomUUID()}`, planId: '', title: remaining === minutes ? item.title : `${item.title}（第${part}部分）`, ...(item.description ? {description: item.description} : {}), dueDate: schedule.rows[dateCursor].date, minutes, status: 'todo', ...(item.contentType ? {contentType: item.contentType} : {}), ...((item.contentId ?? autoCardId) ? {contentId: item.contentId ?? autoCardId} : {})});
      remaining -= minutes; capacity -= minutes; part += 1;
    }
    if (remaining > 0) break;
  }
  return {items, tasks, startDate, endDate: tasks.at(-1)?.dueDate ?? startDate, eligibleDays: config.studyDays, incomplete: schedule.incomplete || tasks.length < items.length};
}

function buildWeeklyStagePlanSchedule(stageId: string, config: LearningStagePlanConfig, startDate: string, deadline: string | undefined, cursor = 0, offsetMinutes = 0, userId = 'u-demo') {
  const items = store.learningStagePlanItems.filter(item => item.stageId === stageId).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  let itemIndex = Math.max(0, cursor);
  let itemOffset = Math.max(0, offsetMinutes);
  const horizonEnd = deadline ? (deadline < addDays(startDate, 6) ? deadline : addDays(startDate, 6)) : addDays(startDate, 6);
  const tasks: Store['learningTasks'] = [];
  const itemMinutes = (item: LearningStagePlanItem) => stageItemMinutes(item, config, items.length);
  const dailyTarget = (date: string) => {
    const range = dateCapacity(config, date);
    return Math.min(range.max, Math.max(range.min, config.dailyMinutes));
  };
  const usedByDate = new Map<string, number>();
  // The team owns the weekly curriculum. A row is a unit of work, not a
  // duration; weekDay is optional and defaults to the next day in sequence.
  // When an item has no legacy duration, its share of the stage total is used
  // so the generated user's calendar still reflects the configured daily
  // learning-time range.
  while (itemIndex < items.length) {
    const item = items[itemIndex];
    let dayOffset = item.weekDay === undefined ? itemIndex - cursor : Math.max(0, item.weekDay - 1);
    const workMinutes = itemMinutes(item);
    if (item.weekDay === undefined) {
      while (dayOffset < 6 && (usedByDate.get(addDays(startDate, dayOffset)) ?? 0) > 0 && (usedByDate.get(addDays(startDate, dayOffset)) as number) + workMinutes > dailyTarget(addDays(startDate, dayOffset))) dayOffset += 1;
    }
    const dueDate = addDays(startDate, dayOffset);
    if (dueDate > horizonEnd) break;
    const previousCoursePointIds = items
      .slice(0, itemIndex)
      .filter(candidate => candidate.contentType === 'course')
      .flatMap(candidate => candidate.knowledgePointIds ?? []);
    const linkedPointIds = item.contentType === 'course' ? [] : (item.knowledgePointIds?.length ? item.knowledgePointIds : previousCoursePointIds);
    const ids = item.contentType === 'question' && !item.contentId
      ? profileQuestionIds(userId, item.questionCount ?? config.questionPushCount, linkedPointIds)
      : item.contentType === 'card' && !item.contentId
        ? publishedCardIdsForKnowledgePoints(linkedPointIds)
        : [item.contentId];
    // Never send an empty question ID: clients would open unrestricted practice.
    if ((item.contentType === 'question' || item.contentType === 'card') && !ids.length) { itemIndex += 1; itemOffset = 0; continue; }
    const selectedIds = ids.length ? ids : [undefined];
    const minutesPerTask = Math.max(1, Math.ceil(workMinutes / selectedIds.length));
    selectedIds.forEach((contentId, questionIndex) => {
      const taskId = `task-${randomUUID()}`;
      tasks.push({id: taskId, planId: '', title: questionIndex > 0 ? `${item.title}（第${questionIndex + 1}题）` : item.title, ...(item.description ? {description: item.description} : {}), dueDate, minutes: minutesPerTask, status: 'todo', ...(item.contentType ? {contentType: item.contentType} : {}), ...(contentId ? {contentId} : {})});
    });
    usedByDate.set(dueDate, (usedByDate.get(dueDate) ?? 0) + minutesPerTask * selectedIds.length);
    itemIndex += 1;
    itemOffset = 0;
  }
  return {items, tasks, generatedThrough: horizonEnd, contentCursor: itemIndex, contentOffsetMinutes: itemOffset, startDate, endDate: deadline ?? horizonEnd, incomplete: itemIndex < items.length};
}

async function extendAutoLearningPlan(plan: Store['learningPlans'][number]) {
  if (!plan.autoGenerated || plan.status !== 'active' || plan.pausedAt || !plan.stageId || !plan.generatedThrough) return plan;
  const today = planDateFromNow();
  if (plan.generatedThrough >= today) return plan;
  const config = stagePlanConfig(plan.stageId);
  if (config.status !== 'published') return plan;
  const classType = plan.classTypeId ? store.learningClassTypes.find(item => item.id === plan.classTypeId) : undefined;
  const startDate = addDays(plan.generatedThrough, 1) < today ? today : addDays(plan.generatedThrough, 1);
  if (startDate > plan.endDate) return plan;
  const weekly = buildWeeklyStagePlanSchedule(plan.stageId, config, startDate, classType?.endDate ?? plan.endDate, plan.contentCursor ?? 0, plan.contentOffsetMinutes ?? 0, plan.userId);
  if (!weekly.tasks.length && weekly.contentCursor === (plan.contentCursor ?? 0)) return plan;
  const now = new Date().toISOString();
  const nextVersion = (plan.version ?? 1) + 1;
  weekly.tasks.forEach(task => { task.planId = plan.id; });
  await infrastructure.transaction([
    ...weekly.tasks.map(task => ({text: 'insert into learning_tasks (id,plan_id,title,description,due_date,minutes,status,content_type,content_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', values: [task.id, task.planId, task.title, task.description ?? null, task.dueDate, task.minutes, task.status, task.contentType ?? null, task.contentId ?? null]})),
    {text: 'update learning_plans set generated_through=$1,content_cursor=$2,content_offset_minutes=$3,version=$4,updated_at=$5 where id=$6', values: [weekly.generatedThrough, weekly.contentCursor, weekly.contentOffsetMinutes, nextVersion, now, plan.id]},
  ]);
  store.learningTasks.unshift(...weekly.tasks);
  plan.generatedThrough = weekly.generatedThrough;
  plan.contentCursor = weekly.contentCursor;
  plan.contentOffsetMinutes = weekly.contentOffsetMinutes;
  plan.version = nextVersion;
  plan.updatedAt = now;
  await recordLearningPlanVersion(plan, '自动生成下一周学习任务', 'auto');
  return plan;
}
async function ensureAutoLearningPlan(userId: string, classTypeId: string | undefined, stageId: string | undefined) {
  if (!stageId) return undefined;
  const existing = store.learningPlans.find(item => item.userId === userId && item.stageId === stageId && item.autoGenerated && item.status === 'active');
  if (existing) { await extendAutoLearningPlan(existing); return existing; }
  const key = `${userId}:${stageId}`;
  const pending = autoLearningPlanInFlight.get(key);
  if (pending) return pending;
  const generation = generateAutoLearningPlan(userId, classTypeId, stageId);
  autoLearningPlanInFlight.set(key, generation);
  try {
    return await generation;
  } finally {
    autoLearningPlanInFlight.delete(key);
  }
}

async function generateAutoLearningPlan(userId: string, classTypeId: string | undefined, stageId: string) {
  const config = stagePlanConfig(stageId);
  if (config.status !== 'published') return undefined;
  const classType = classTypeId ? store.learningClassTypes.find(item => item.id === classTypeId) : undefined;
  const startDate = learningPlanStartDate(userId);
  const deadline = classType?.endDate;
  const weekly = buildWeeklyStagePlanSchedule(stageId, config, startDate, deadline, 0, 0, userId);
  if (!weekly.items.length || !weekly.tasks.length) return undefined;
  const plan = {id: `plan-${randomUUID()}`, userId, title: `${store.learningStages.find(item => item.id === stageId)?.name ?? '当前阶段'}学习计划`, dailyMinutes: config.dailyMinutes, startDate, endDate: deadline ?? weekly.endDate, status: 'active' as const, version: 1, changeReason: '首次诊断自动生成', generatedThrough: weekly.generatedThrough, contentCursor: weekly.contentCursor, contentOffsetMinutes: weekly.contentOffsetMinutes, updatedAt: new Date().toISOString(), ...(classTypeId ? {classTypeId} : {}), stageId, autoGenerated: true};
  weekly.tasks.forEach(task => { task.planId = plan.id; });
  await infrastructure.transaction([
    {text: 'insert into learning_plans (id,user_id,title,daily_minutes,start_date,end_date,status,class_type_id,stage_id,auto_generated,version,change_reason,generated_through,content_cursor,content_offset_minutes,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', values: [plan.id, dbUserId(userId), plan.title, plan.dailyMinutes, plan.startDate, plan.endDate, plan.status, plan.classTypeId ?? null, plan.stageId ?? null, true, plan.version, plan.changeReason, plan.generatedThrough, plan.contentCursor, plan.contentOffsetMinutes, plan.updatedAt]},
    ...weekly.tasks.map(task => ({text: 'insert into learning_tasks (id,plan_id,title,description,due_date,minutes,status,content_type,content_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', values: [task.id, task.planId, task.title, task.description ?? null, task.dueDate, task.minutes, task.status, task.contentType ?? null, task.contentId ?? null]})),
  ]);
  store.learningPlans.unshift(plan);
  store.learningTasks.unshift(...weekly.tasks);
  await recordLearningPlanVersion(plan, plan.changeReason, 'auto');
  return plan;
}
function reportWindow(period: string, now = Date.now()) {
  const end = new Date(now);
  const start = new Date(end);
  if (period === 'day') {
    start.setUTCHours(0, 0, 0, 0);
  } else if (period === 'week') {
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  } else if (period === 'month') {
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(1);
  } else {
    throw new HttpError(422, 'VALIDATION_ERROR', 'period 必须是 day、week 或 month');
  }
  return {start, end};
}

const PENDING_ORDER_TTL_MS = 30 * 60 * 1000;
const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
const ATTACHMENT_TYPES = new Set<AttachmentUpload['contentType']>(['image/jpeg', 'image/png', 'application/pdf']);
// The raw upload token is returned only at preflight time. Keep the persisted
// digest on the in-memory record without making it part of the public API.
const ATTACHMENT_TOKEN_HASH = Symbol('attachmentTokenHash');
type InternalAttachmentUpload = AttachmentUpload & {[ATTACHMENT_TOKEN_HASH]?: string};

function productSkuFor(productId: string, skuId: string | undefined, requireAvailable = false): ProductSku | undefined {
  const candidates = store.productSkus.filter(item => item.productId === productId && item.status === 'active');
  const sku = skuId ? candidates.find(item => item.id === skuId) : candidates[0];
  if (sku && requireAvailable && sku.stock < 1) throw new HttpError(409, 'SKU_OUT_OF_STOCK', '所选规格暂时缺货');
  if (skuId && !sku) throw new HttpError(404, 'SKU_NOT_FOUND', '商品规格不存在或已下架');
  return sku;
}

function couponFor(code: string | undefined, amount: number, now = Date.now()): {coupon?: Coupon; discount: number} {
  if (!code) return {discount: 0};
  const coupon = store.coupons.find(item => item.code.toUpperCase() === code.toUpperCase());
  if (!coupon || coupon.status !== 'active') throw new HttpError(422, 'COUPON_INVALID', '优惠券不存在或已停用');
  if (Date.parse(coupon.startsAt) > now || Date.parse(coupon.endsAt) <= now) throw new HttpError(422, 'COUPON_EXPIRED', '优惠券不在有效期内');
  if (coupon.usageLimit !== undefined && coupon.usedCount >= coupon.usageLimit) throw new HttpError(409, 'COUPON_EXHAUSTED', '优惠券已领完');
  if (amount < coupon.minAmount) throw new HttpError(422, 'COUPON_MIN_AMOUNT', `订单金额满 ${coupon.minAmount} 元可用`);
  const raw = coupon.type === 'percentage' ? amount * (coupon.value / 100) : coupon.value;
  const discount = Math.max(0, Math.min(amount, coupon.maxDiscount === undefined ? raw : Math.min(raw, coupon.maxDiscount)));
  return {coupon, discount: Math.round(discount * 100) / 100};
}

async function recordOrderEvent(event: OrderEvent) {
  store.orderEvents.unshift(event);
  await persist('insert into order_events (id, order_id, event_type, payload, created_at) values ($1, $2, $3, $4::jsonb, $5)', [event.id, event.orderId, event.type, JSON.stringify({actor: event.actor, ...event.metadata}), event.createdAt]);
}

async function expirePendingOrders(now = Date.now()) {
  // `expiresAt` is persisted as the absolute deadline when an order is
  // created. Older rows may not have it, so only those rows derive a
  // deadline from `createdAt` and the legacy TTL.
  const due = store.orders.filter(order => {
    if (order.status !== 'pending') return false;
    const deadline = order.expiresAt ? Date.parse(order.expiresAt) : Date.parse(order.createdAt) + PENDING_ORDER_TTL_MS;
    return Number.isFinite(deadline) && deadline <= now;
  });
  for (const order of due) {
    order.status = 'closed';
    order.closedAt = new Date(now).toISOString();
    await restoreOrderInventory(order);
    await recordOrderEvent({id: `oe-${randomUUID()}`, orderId: order.id, type: 'expired', actor: 'system', metadata: {}, createdAt: order.closedAt});
    await persist('update orders set status = $1, closed_at = $2 where id = $3 and status = $4', ['closed', order.closedAt, order.id, 'pending']);
  }
  return due.length;
}

function learningActivityKey(userId: string, key: string) { return `${userId}\u0000${key}`; }

function validateLearningActivity(input: Record<string, unknown>, userId: string): LearningActivity {
  const kind = String(input.kind ?? 'reading');
  if (!['question', 'course', 'task', 'reading'].includes(kind)) throw new HttpError(422, 'VALIDATION_ERROR', '学习活动类型不正确');
  const durationSeconds = Number(input.durationSeconds ?? 0);
  const quantity = Number(input.quantity ?? 1);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 24 * 3600) throw new HttpError(422, 'VALIDATION_ERROR', '学习时长必须是 0 到 24 小时的整数秒');
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) throw new HttpError(422, 'VALIDATION_ERROR', '学习数量不正确');
  const occurredAt = input.occurredAt === undefined ? new Date().toISOString() : String(input.occurredAt);
  if (!Number.isFinite(Date.parse(occurredAt)) || Date.parse(occurredAt) > Date.now() + 5 * 60_000) throw new HttpError(422, 'VALIDATION_ERROR', '学习活动时间不正确');
  const idempotencyKey = String(input.idempotencyKey ?? '').trim() || undefined;
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 160)) throw new HttpError(422, 'VALIDATION_ERROR', '学习活动幂等键长度不正确');
  if (kind === 'course' && (!input.courseId || !store.courses.some(course => course.id === String(input.courseId)))) throw new HttpError(404, 'COURSE_NOT_FOUND', '课程不存在');
  if (kind === 'task' && (!input.taskId || !store.learningTasks.some(task => task.id === String(input.taskId)))) throw new HttpError(404, 'TASK_NOT_FOUND', '学习任务不存在');
  if (kind === 'question' && input.questionId !== undefined && !store.questions.some(question => question.id === String(input.questionId))) throw new HttpError(404, 'QUESTION_NOT_FOUND', '题目不存在');
  if (input.subjectId !== undefined && !store.subjects.some(subject => subject.id === String(input.subjectId))) throw new HttpError(404, 'SUBJECT_NOT_FOUND', '科目不存在');
  return {
    id: `activity-${randomUUID()}`,
    userId,
    kind: kind as LearningActivity['kind'],
    ...(input.subjectId ? {subjectId: String(input.subjectId)} : {}),
    ...(input.questionId ? {questionId: String(input.questionId)} : {}),
    ...(input.courseId ? {courseId: String(input.courseId)} : {}),
    ...(input.taskId ? {taskId: String(input.taskId)} : {}),
    durationSeconds,
    quantity,
    ...(idempotencyKey ? {idempotencyKey} : {}),
    occurredAt: new Date(occurredAt).toISOString(),
  };
}

function attachmentType(value: unknown): AttachmentUpload['contentType'] {
  const type = String(value ?? '') as AttachmentUpload['contentType'];
  if (!ATTACHMENT_TYPES.has(type)) throw new HttpError(422, 'ATTACHMENT_TYPE_UNSUPPORTED', '仅支持 JPG、PNG 或 PDF 文件');
  return type;
}

function validateAttachmentMeta(input: Record<string, unknown>, userId: string): InternalAttachmentUpload {
  const filename = String(input.filename ?? '').trim();
  const sizeBytes = Number(input.sizeBytes);
  if (!filename || filename.length > 255 || /[\\/\0]/.test(filename)) throw new HttpError(422, 'ATTACHMENT_FILENAME_INVALID', '文件名不正确');
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > ATTACHMENT_MAX_BYTES) throw new HttpError(422, 'ATTACHMENT_TOO_LARGE', '文件大小必须在 1B 到 15MB 之间');
  const contentType = attachmentType(input.contentType);
  const now = new Date().toISOString();
  const uploadToken = `upload-token-${randomUUID()}`;
  return {id: `upload-${randomUUID()}`, userId, filename, contentType, sizeBytes, ...(input.sha256 ? {sha256: String(input.sha256)} : {}), status: 'pending', uploadToken, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), createdAt: now, [ATTACHMENT_TOKEN_HASH]: tokenHash(uploadToken)};
}

function aiSessionFor(id: string, userId: string): AISession {
  const session = store.aiSessions.find(item => item.id === id && item.userId === userId && !item.deletedAt);
  if (!session) throw new HttpError(404, 'AI_SESSION_NOT_FOUND', 'AI 会话不存在');
  return session;
}

function aiSessionView(session: AISession, includeMessages = false) {
  const messages = store.aiMessages.filter(item => item.sessionId === session.id).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const last = messages.at(-1);
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: messages.length,
    ...(last ? {lastMessage: {role: last.role, content: last.content.slice(0, 200), createdAt: last.createdAt}} : {}),
    ...(includeMessages ? {messages} : {}),
  };
}

const DEFAULT_AI_DAILY_LIMIT = 20;
const DEFAULT_AI_MONTHLY_LIMIT = 300;

function aiQuotaFor(userId: string): AIQuota {
  const existing = store.aiQuotas.get(userId);
  if (existing) return existing;
  const created: AIQuota = {
    userId,
    dailyLimit: DEFAULT_AI_DAILY_LIMIT,
    monthlyLimit: DEFAULT_AI_MONTHLY_LIMIT,
    updatedAt: new Date().toISOString(),
  };
  store.aiQuotas.set(userId, created);
  return created;
}

function aiUsageCounts(userId: string, now = Date.now()) {
  const current = new Date(now);
  const dayStart = new Date(current);
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const events = store.aiUsage.filter(item => item.userId === userId && item.status === 'completed');
  return {
    usedToday: events.filter(item => Date.parse(item.createdAt) >= dayStart.getTime()).length,
    usedThisMonth: events.filter(item => Date.parse(item.createdAt) >= monthStart.getTime()).length,
  };
}

function assertAIQuota(userId: string) {
  const quota = aiQuotaFor(userId);
  const usage = aiUsageCounts(userId);
  if (usage.usedToday >= quota.dailyLimit || usage.usedThisMonth >= quota.monthlyLimit) {
    throw new HttpError(429, 'AI_QUOTA_EXCEEDED', 'AI 使用额度已用尽，请稍后再试', {
      dailyLimit: quota.dailyLimit,
      monthlyLimit: quota.monthlyLimit,
      usedToday: usage.usedToday,
      usedThisMonth: usage.usedThisMonth,
    });
  }
  return {quota, usage};
}

/** Record provider telemetry without making a successful AI response depend
 * on a secondary analytics write.  Production operators can replay failed
 * telemetry writes from the request log; local mode simply keeps the event in
 * memory when PostgreSQL is unavailable. */
async function recordAIUsage(event: Omit<AIUsageEvent, 'id' | 'createdAt'> & {createdAt?: string}) {
  const item: AIUsageEvent = {id: randomUUID(), createdAt: event.createdAt ?? new Date().toISOString(), ...event};
  store.aiUsage.unshift(item);
  const values = [
    item.id,
    item.userId ? dbUserId(item.userId) : null,
    item.sessionId ?? null,
    item.messageId ?? null,
    item.provider,
    item.model ?? null,
    item.feature,
    item.status,
    item.inputTokens ?? null,
    item.outputTokens ?? null,
    item.costMinor ?? null,
    item.errorCode ?? null,
    item.createdAt,
  ];
  try {
    await persist('insert into ai_usage_events (id, user_id, session_id, message_id, provider, model, feature, status, input_tokens, output_tokens, cost_minor, error_code, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)', values);
  } catch {
    // Keep the in-memory event so the admin view remains truthful during a
    // transient database outage.  The provider response itself is unaffected.
  }
  return item;
}

async function recordAIRisk(result: {risk?: {risk: string; reason: string}}, context: Pick<AIRiskFlag, 'userId' | 'sessionId' | 'messageId'>) {
  if (!result.risk || !result.risk.risk.trim() || !result.risk.reason.trim()) return undefined;
  const flag: AIRiskFlag = {
    id: randomUUID(),
    ...context,
    risk: result.risk.risk.trim().slice(0, 80),
    reason: result.risk.reason.trim().slice(0, 2000),
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  store.aiRiskFlags.unshift(flag);
  try {
    await persist('insert into ai_risk_flags (id, user_id, session_id, message_id, risk, reason, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)', [flag.id, flag.userId ? dbUserId(flag.userId) : null, flag.sessionId ?? null, flag.messageId ?? null, flag.risk, flag.reason, flag.status, flag.createdAt]);
  } catch {
    // See recordAIUsage: preserve the local signal during a transient outage.
  }
  return flag;
}

function aiUsageInRange(event: AIUsageEvent, from?: number, to?: number) {
  const created = Date.parse(event.createdAt);
  return Number.isFinite(created) && (from === undefined || created >= from) && (to === undefined || created < to);
}

/** Aggregate AI telemetry for the operations console.  The default grouping
 * is by user (the shape consumed by the first admin UI), while operators can
 * request `groupBy=user,provider,feature,date` to inspect a finer-grained
 * cost slice without exposing an unbounded raw event stream. */
function aggregateAIUsage(events: AIUsageEvent[], options: {from?: number; to?: number; userId?: string; provider?: string; feature?: string; status?: string; groupBy?: string[]}) {
  const filtered = events.filter(event =>
    aiUsageInRange(event, options.from, options.to) &&
    (!options.userId || event.userId === options.userId) &&
    (!options.provider || event.provider === options.provider) &&
    (!options.feature || event.feature === options.feature) &&
    (!options.status || event.status === options.status));
  const requested = new Set((options.groupBy?.length ? options.groupBy : ['user']).map(value => value === 'day' ? 'date' : value));
  const validDimensions = new Set(['user', 'provider', 'model', 'feature', 'date', 'status']);
  for (const dimension of requested) if (!validDimensions.has(dimension)) throw new HttpError(422, 'VALIDATION_ERROR', `groupBy 不支持 ${dimension}`);
  const groups = new Map<string, Record<string, unknown>>();
  for (const event of filtered) {
    const date = event.createdAt.slice(0, 10);
    const values: Record<string, string | undefined> = {
      user: event.userId,
      provider: event.provider,
      model: event.model,
      feature: event.feature,
      date,
      status: event.status,
    };
    const key = [...requested].sort().map(dimension => `${dimension}=${values[dimension] ?? ''}`).join('|');
    const current = groups.get(key) ?? {
      ...(requested.has('user') && values.user ? {userId: values.user} : {}),
      ...(requested.has('provider') && values.provider ? {provider: values.provider} : {}),
      ...(requested.has('model') && values.model ? {model: values.model} : {}),
      ...(requested.has('feature') && values.feature ? {feature: values.feature} : {}),
      ...(requested.has('date') ? {date} : {}),
      ...(requested.has('status') ? {status: values.status} : {}),
      requests: 0,
      completedRequests: 0,
      failedRequests: 0,
      blockedRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokens: 0,
      costMinor: 0,
      cost: 0,
    };
    current.requests = Number(current.requests) + 1;
    if (event.status === 'completed') current.completedRequests = Number(current.completedRequests) + 1;
    if (event.status === 'failed') current.failedRequests = Number(current.failedRequests) + 1;
    if (event.status === 'blocked_quota') current.blockedRequests = Number(current.blockedRequests) + 1;
    current.inputTokens = Number(current.inputTokens) + (event.inputTokens ?? 0);
    current.outputTokens = Number(current.outputTokens) + (event.outputTokens ?? 0);
    current.tokens = Number(current.tokens) + (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
    current.costMinor = Number(current.costMinor) + (event.costMinor ?? 0);
    // Keep `cost` as a yuan-like decimal for the existing admin table while
    // retaining the exact minor-unit value for reconciliation.
    current.cost = Number(current.costMinor) / 100;
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) => Number(right.requests) - Number(left.requests));
}

type AnnouncementEffectiveStatus = Announcement['status'] | 'expired';
const ANNOUNCEMENT_MAX_TIMESTAMP = Date.parse('2099-12-31T23:59:59+08:00');

function announcementEffectiveStatus(item: Announcement, now = Date.now()): AnnouncementEffectiveStatus {
  if (item.status === 'draft' || item.status === 'withdrawn') return item.status;
  if (item.endsAt && Date.parse(item.endsAt) <= now) return 'expired';
  if (item.startsAt && Date.parse(item.startsAt) > now) return 'scheduled';
  return 'published';
}

function announcementMatchesAudience(item: Announcement, userId: string) {
  if (item.audienceType === 'all') return true;
  return store.profiles.get(userId)?.examYear === item.audienceValue;
}

function announcementVisibleTo(item: Announcement, userId: string, now = Date.now()) {
  return announcementEffectiveStatus(item, now) === 'published' && announcementMatchesAudience(item, userId);
}

function announcementFeedVisibleTo(item: Announcement, userId: string, now = Date.now()) {
  return announcementVisibleTo(item, userId, now) && !store.notificationClosures.has(`${userId}:announcement:${item.id}`);
}

function announcementDeepLink(item: Announcement) {
  return item.deepLink || `/announcements/${encodeURIComponent(item.id)}`;
}

function announcementDeliveryTime(item: Announcement) {
  return item.startsAt ?? item.publishedAt ?? item.createdAt;
}

function announcementPublishedAt(item: Announcement) {
  if (item.publishedAt) return item.publishedAt;
  return announcementEffectiveStatus(item) === 'published' ? announcementDeliveryTime(item) : undefined;
}

function compareAnnouncements(left: Announcement, right: Announcement) {
  if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
  return Date.parse(announcementDeliveryTime(right)) - Date.parse(announcementDeliveryTime(left));
}

function publicAnnouncement(item: Announcement, userId: string) {
  const key = `${userId}:announcement:${item.id}`;
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    status: 'published' as const,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    isPinned: item.isPinned,
    audienceType: item.audienceType,
    deepLink: announcementDeepLink(item),
    read: store.notificationReceipts.has(key),
    closed: store.notificationClosures.has(key),
    publishedAt: announcementPublishedAt(item),
    createdAt: item.createdAt,
  };
}

const learningDiagnosticQuestionTypes = new Set(['single', 'multiple', 'scale', 'text', 'number']);
const learningDiagnosticOptionTypes = new Set(['single', 'multiple', 'scale']);
const learningQuestionObjectiveTypes = new Set<LearningQuestionType>(['true_false', 'single', 'indeterminate', 'multiple']);
const learningQuestionSubjectiveTypes = new Set<LearningQuestionType>(['short_answer', 'case_analysis']);
const learningQuestionUsageScenes = new Set<LearningQuestionUsageScene>(['diagnostic', 'daily_practice', 'stage_test', 'wrong_review']);
const activeLearningDiagnosticDimensions = () => store.learningDiagnosticDimensions.filter(item => item.status === 'active').sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code));
const emptyLearningDiagnosticScores = (): Record<string, number> => Object.fromEntries(activeLearningDiagnosticDimensions().map(item => [item.code, 0]));
const activeLearningStages = (classTypeId?: string) => store.learningStages.filter(item => item.status === 'active' && (!classTypeId || item.classTypeId === classTypeId)).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));

function validateLearningQuestionBankInput(input: Record<string, unknown>, existing?: LearningQuestionBankQuestion): LearningQuestionBankQuestion {
  const category = String(input.category ?? existing?.category ?? 'objective') as LearningQuestionCategory;
  const questionType = String(input.questionType ?? existing?.questionType ?? 'single') as LearningQuestionType;
  const subjectId = String(input.subjectId ?? existing?.subjectId ?? '').trim();
  const chapterId = String(input.chapterId ?? existing?.chapterId ?? '').trim();
  const pointId = String(input.pointId ?? existing?.pointId ?? '').trim();
  const subPointId = String(input.subPointId ?? existing?.subPointId ?? '').trim() || undefined;
  const subjectNode = store.learningQuestionTaxonomyNodes.find(item => item.id === subjectId && item.category === category && item.type === 'subject' && item.status === 'active');
  const chapterNode = store.learningQuestionTaxonomyNodes.find(item => item.id === chapterId && item.category === category && item.type === 'chapter' && item.parentId === subjectId && item.status === 'active');
  const pointNode = store.learningQuestionTaxonomyNodes.find(item => item.id === pointId && item.category === category && item.type === 'point' && item.parentId === chapterId && item.status === 'active');
  const subPointNode = subPointId ? store.learningQuestionTaxonomyNodes.find(item => item.id === subPointId && item.category === category && item.type === 'subpoint' && item.parentId === pointId && item.status === 'active') : undefined;
  if (!subjectNode || !chapterNode || !pointNode) throw new HttpError(422, 'VALIDATION_ERROR', '请选择当前题库有效的科目、章节和考点');
  const activeSubPoints = store.learningQuestionTaxonomyNodes.filter(item => item.category === category && item.type === 'subpoint' && item.parentId === pointId && item.status === 'active');
  if (activeSubPoints.length > 0 && !subPointNode) throw new HttpError(422, 'VALIDATION_ERROR', '该考点存在子考点，题目必须归入子考点');
  if (subPointId && !subPointNode) throw new HttpError(422, 'VALIDATION_ERROR', '子考点不属于当前考点或已停用');
  const subject = subjectNode.name;
  const columnName = chapterNode.name;
  const knowledgePoint = pointNode.name;
  const subKnowledgePoint = subPointNode?.name;
  const difficulty = Number(input.difficulty ?? existing?.difficulty ?? 3);
  const stem = String(input.stem ?? existing?.stem ?? '').trim();
  const analysis = String(input.analysis ?? existing?.analysis ?? '').trim();
  const explanationMediaTypeValue = input.explanationMediaReference === '' ? '' : String(input.explanationMediaType ?? existing?.explanationMediaType ?? '').trim();
  const explanationMediaType = explanationMediaTypeValue ? explanationMediaTypeValue as 'audio' | 'video' : undefined;
  const explanationMediaReference = String(input.explanationMediaReference ?? existing?.explanationMediaReference ?? '').trim() || undefined;
  if (input.explanationMediaVisible !== undefined && typeof input.explanationMediaVisible !== 'boolean') throw new HttpError(422, 'VALIDATION_ERROR', '讲解显示开关格式不正确');
  const explanationMediaVisible = input.explanationMediaVisible as boolean | undefined ?? existing?.explanationMediaVisible ?? true;
  const caseMaterial = String(input.caseMaterial ?? existing?.caseMaterial ?? '').trim() || undefined;
  const estimatedMinutes = Number(input.estimatedMinutes ?? existing?.estimatedMinutes ?? (category === 'objective' ? 2 : 20));
  const source = String(input.source ?? existing?.source ?? '').trim() || undefined;
  const sourceYearValue = input.sourceYear === undefined ? existing?.sourceYear : Number(input.sourceYear);
  const sourceYear = sourceYearValue === undefined || sourceYearValue === null || sourceYearValue === 0 ? undefined : Number(sourceYearValue);
  const rawScenes = input.usageScenes === undefined ? (existing?.usageScenes ?? ['daily_practice']) : input.usageScenes;
  const usageScenes = Array.isArray(rawScenes) ? [...new Set(rawScenes.map(String))] as LearningQuestionUsageScene[] : [];
  if (!['objective', 'subjective'].includes(category) || category === 'objective' && !learningQuestionObjectiveTypes.has(questionType) || category === 'subjective' && !learningQuestionSubjectiveTypes.has(questionType)) throw new HttpError(422, 'VALIDATION_ERROR', '主客观分类与题型不匹配');
  if (subject.length < 1 || subject.length > 80 || columnName.length < 1 || columnName.length > 120 || knowledgePoint.length < 1 || knowledgePoint.length > 160 || subKnowledgePoint && subKnowledgePoint.length > 160) throw new HttpError(422, 'VALIDATION_ERROR', '科目、专栏、考点或子考点信息不正确');
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5 || !Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 600) throw new HttpError(422, 'VALIDATION_ERROR', '难度或预计作答时间不正确');
  if (stem.length < 2 || stem.length > 20000 || analysis.length < 2 || analysis.length > 30000 || caseMaterial && caseMaterial.length > 30000) throw new HttpError(422, 'VALIDATION_ERROR', '题干至少 2 个字，做题解析必须填写且不能超过 30000 字');
  if (explanationMediaType && !['audio', 'video'].includes(explanationMediaType) || Boolean(explanationMediaType) !== Boolean(explanationMediaReference) || explanationMediaReference && explanationMediaReference.length > 2048) throw new HttpError(422, 'VALIDATION_ERROR', '讲解音视频类型与上传文件必须同时存在');
  if (explanationMediaReference) {
    const mediaMatch = /^\/v1\/learning-question-media\/[a-f0-9-]+\.(mp3|m4a|wav|ogg|mp4|webm|mov)$/.exec(explanationMediaReference);
    const extension = mediaMatch?.[1];
    const typeMatches = explanationMediaType === 'audio' ? ['mp3', 'm4a', 'wav', 'ogg'].includes(extension ?? '') : ['mp4', 'webm', 'mov'].includes(extension ?? '');
    if (!mediaMatch || !typeMatches) throw new HttpError(422, 'MEDIA_REFERENCE_INVALID', '讲解音视频必须使用后台上传的文件');
  }
  if (source && source.length > 160 || sourceYear !== undefined && (!Number.isInteger(sourceYear) || sourceYear < 1980 || sourceYear > 2200)) throw new HttpError(422, 'VALIDATION_ERROR', '题目来源或年份不正确');
  if (!usageScenes.length || usageScenes.some(scene => !learningQuestionUsageScenes.has(scene))) throw new HttpError(422, 'VALIDATION_ERROR', '至少选择一个有效使用场景');

  let options: LearningQuestionOption[] = [];
  let correctAnswers: string[] = [];
  let subQuestions: LearningQuestionSubQuestion[] = [];
  if (category === 'objective') {
    const rawOptions = Array.isArray(input.options) ? input.options : (existing?.options ?? []);
    options = rawOptions.map((raw, index) => {
      const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      return {key: String.fromCharCode(65 + index), label: String(value.label ?? '').trim()};
    });
    if (questionType === 'true_false') options = [{key: 'A', label: '正确'}, {key: 'B', label: '错误'}];
    if (options.length < 2 || options.length > 7 || options.some(option => !option.label || option.label.length > 2000)) throw new HttpError(422, 'VALIDATION_ERROR', '客观题需要 2 到 7 个有效选项');
    const rawAnswers = input.correctAnswers === undefined ? (existing?.correctAnswers ?? []) : input.correctAnswers;
    correctAnswers = Array.isArray(rawAnswers) ? [...new Set(rawAnswers.map(String).map(value => value.toUpperCase()))] : [];
    if (correctAnswers.some(answer => !options.some(option => option.key === answer))) throw new HttpError(422, 'VALIDATION_ERROR', '正确答案必须来自当前选项');
    const requiresSingle = questionType === 'true_false' || questionType === 'single';
    if (requiresSingle && correctAnswers.length !== 1 || questionType === 'multiple' && correctAnswers.length < 2 || questionType === 'indeterminate' && correctAnswers.length < 1) throw new HttpError(422, 'VALIDATION_ERROR', '正确答案数量与题型不匹配');
  } else {
    const rawSubQuestions = Array.isArray(input.subQuestions) ? input.subQuestions : (existing?.subQuestions ?? []);
    subQuestions = rawSubQuestions.map((raw, index) => {
      const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      return {id: String(value.id ?? existing?.subQuestions[index]?.id ?? `sq-${randomUUID()}`), prompt: String(value.prompt ?? '').trim(), referenceAnswer: String(value.referenceAnswer ?? '').trim(), ...(String(value.analysis ?? '').trim() ? {analysis: String(value.analysis).trim()} : {}), score: Number(value.score ?? 0)};
    });
    if (!subQuestions.length || subQuestions.length > 20 || subQuestions.some(item => item.prompt.length < 2 || item.prompt.length > 10000 || item.referenceAnswer.length < 2 || item.referenceAnswer.length > 30000 || !Number.isFinite(item.score) || item.score <= 0 || item.score > 100)) throw new HttpError(422, 'VALIDATION_ERROR', '主观题需要 1 到 20 个完整设问，并设置参考答案和分值');
    if (questionType === 'case_analysis' && (!caseMaterial || caseMaterial.length < 10)) throw new HttpError(422, 'VALIDATION_ERROR', '案例题需要填写完整案例材料');
  }
  const now = new Date().toISOString();
  return {id: existing?.id ?? `lqb-${randomUUID()}`, category, questionType, subject, subjectId, columnName, chapterId, knowledgePoint, pointId, ...(subKnowledgePoint ? {subKnowledgePoint, subPointId} : {}), difficulty, stem, options, correctAnswers, analysis, explanationMediaVisible, ...(explanationMediaType && explanationMediaReference ? {explanationMediaType, explanationMediaReference} : {}), ...(caseMaterial ? {caseMaterial} : {}), subQuestions, estimatedMinutes, ...(source ? {source} : {}), ...(sourceYear ? {sourceYear} : {}), usageScenes, status: existing?.status ?? 'draft', version: existing?.version ?? 1, createdAt: existing?.createdAt ?? now, updatedAt: now, ...(existing?.publishedAt ? {publishedAt: existing.publishedAt} : {})};
}

function learningQuestionExplanationMediaUpdate(question: LearningQuestionBankQuestion, adminId: string): SqlStatement {
  return {text: 'update learning_question_bank_questions set explanation_media_type=$1, explanation_media_reference=$2, updated_by=$3, explanation_media_visible=$5 where id=$4', values: [question.explanationMediaType ?? null, question.explanationMediaReference ?? null, adminId, question.id, question.explanationMediaVisible !== false]};
}

function validateLearningCardInput(input: Record<string, unknown>, existing?: LearningCard): LearningCard {
  const title = String(input.title ?? existing?.title ?? '').trim();
  const description = String(input.description ?? existing?.description ?? '').trim() || undefined;
  const contentType = String(input.contentType ?? existing?.contentType ?? '') as LearningCardContentType;
  const sortOrder = Number(input.sortOrder ?? existing?.sortOrder ?? 0);
  const rawAssets = input.assets === undefined ? existing?.assets ?? [] : input.assets;
  const rawRecallItems = input.recallItems === undefined ? existing?.recallItems ?? [] : input.recallItems;
  const rawKnowledgePointIds = input.knowledgePointIds === undefined ? existing?.knowledgePointIds ?? [] : input.knowledgePointIds;
  if (!Array.isArray(rawRecallItems) || rawRecallItems.length > 20) throw new HttpError(422, 'RECALL_INVALID', '挖空内容最多 20 条');
  const recallItems: LearningCardRecallItem[] = rawRecallItems.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const prompt = String(item.prompt ?? '').trim(); const answer = String(item.answer ?? '').trim();
    if (prompt.split('____').length !== 2) throw new HttpError(422, 'RECALL_INVALID', `第 ${index + 1} 条题干需包含一个 ____ 挖空位置`);
    if (prompt.length < 2 || prompt.length > 1000 || answer.length < 1 || answer.length > 300) throw new HttpError(422, 'RECALL_INVALID', `第 ${index + 1} 条挖空内容不完整`);
    return {id: String(item.id ?? `recall-${randomUUID()}`), prompt, answer, sortOrder: index};
  });
  if (title.length < 2 || title.length > 160 || description && description.length > 1000) throw new HttpError(422, 'VALIDATION_ERROR', '卡片标题需为 2 到 160 个字，说明不能超过 1000 个字');
  if (!['image_gallery', 'html', 'pdf'].includes(contentType) || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 99999 || !Array.isArray(rawAssets)) throw new HttpError(422, 'VALIDATION_ERROR', '卡片类型、素材或排序不正确');
  if (!Array.isArray(rawKnowledgePointIds) || rawKnowledgePointIds.length > 50) throw new HttpError(422, 'LEARNING_KNOWLEDGE_POINTS_INVALID', '卡片关联考点最多 50 个');
  const knowledgePointIds = [...new Set(rawKnowledgePointIds.map(String).map(id => id.trim()).filter(Boolean))];
  if (knowledgePointIds.some(id => !store.learningQuestionTaxonomyNodes.some(node => node.id === id && node.category === 'objective' && (node.type === 'point' || node.type === 'subpoint') && node.status === 'active'))) throw new HttpError(422, 'LEARNING_KNOWLEDGE_POINTS_INVALID', '卡片关联的考点或知识点不存在');
  const assets: LearningCardAsset[] = rawAssets.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const type = String(item.type ?? ''); const reference = String(item.reference ?? '').trim(); const filename = String(item.filename ?? '').trim(); const sizeBytes = Number(item.sizeBytes ?? 0);
    const match = /^\/v1\/learning-card-assets\/([a-f0-9-]+)\.(jpg|jpeg|png|webp|gif|html|pdf)$/.exec(reference);
    const extension = match?.[2]; const typeMatches = type === 'image' ? ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension ?? '') : type === 'html' ? extension === 'html' : type === 'pdf' && extension === 'pdf';
    if (!match || !typeMatches || filename.length < 1 || filename.length > 255 || !Number.isInteger(sizeBytes) || sizeBytes < 1) throw new HttpError(422, 'CARD_ASSET_INVALID', `第 ${index + 1} 个卡片素材不是后台上传的有效文件`);
    return {id: String(item.id ?? match[1]), type: type as LearningCardAsset['type'], filename, reference, sizeBytes, sortOrder: index};
  });
  if (contentType === 'image_gallery' && (assets.length < 1 || assets.length > 20 || assets.some(item => item.type !== 'image'))) throw new HttpError(422, 'VALIDATION_ERROR', '图片卡片需上传 1 到 20 张图片');
  if (contentType === 'html' && (assets.length !== 1 || assets[0].type !== 'html')) throw new HttpError(422, 'VALIDATION_ERROR', 'HTML 卡片必须上传且只能上传一个 HTML 文件');
  if (contentType === 'pdf' && (assets.length !== 1 || assets[0].type !== 'pdf')) throw new HttpError(422, 'VALIDATION_ERROR', 'PDF 卡片必须上传且只能上传一个 PDF 文件');
  const now = new Date().toISOString();
  return {id: existing?.id ?? `lcard-${randomUUID()}`, title, ...(description ? {description} : {}), contentType, assets, recallItems, knowledgePointIds, sortOrder, status: existing?.status ?? 'draft', version: existing?.version ?? 1, createdAt: existing?.createdAt ?? now, updatedAt: now, ...(existing?.publishedAt ? {publishedAt: existing.publishedAt} : {})};
}

function learningStageConditionMatches(condition: LearningStageCondition, scores: Record<string, number>) {
  const score = Number(scores[condition.dimension] ?? 0);
  if (condition.operator === 'gte') return score >= condition.value;
  if (condition.operator === 'lte') return score <= condition.value;
  return score >= condition.value && condition.upperValue !== undefined && score <= condition.upperValue;
}

function resolveLearningStage(scores: Record<string, number>, classTypeId?: string) {
  return activeLearningStages(classTypeId).find(stage => stage.conditions.length > 0 && stage.conditions.every(condition => learningStageConditionMatches(condition, scores)));
}

function activeTeacherForStage(stageId: string) {
  const stage = store.learningStages.find(item => item.id === stageId);
  const selected = stage?.teacherIds?.length
    ? store.learningTeachers.filter(item => stage.teacherIds?.includes(item.id) && item.status === 'active')
    : store.learningTeachers.filter(item => item.stageId === stageId && item.status === 'active');
  return selected.sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))[0];
}

function publicLearningStage(stage: LearningStage) {
  return {...stage, conditions: stage.conditions.map(condition => ({...condition}))};
}

function publicLearningClassType(classType: LearningClassType) {
  return {...classType};
}

function publicLearningTeacher(teacher: LearningTeacher) {
  return {...teacher};
}

function publicLearningTeacherAssignment(assignment: LearningTeacherAssignment) {
  const classType = assignment.classTypeId ? store.learningClassTypes.find(item => item.id === assignment.classTypeId) : undefined;
  const stage = assignment.stageId ? store.learningStages.find(item => item.id === assignment.stageId) : undefined;
  const teacher = assignment.teacherId ? store.learningTeachers.find(item => item.id === assignment.teacherId) : undefined;
  return {id: assignment.id, status: assignment.status, classType: classType ? {id: classType.id, code: classType.code, name: classType.name} : undefined, stage: stage ? {id: stage.id, code: stage.code, name: stage.name} : undefined, teacher: teacher ? {id: teacher.id, name: teacher.name, subject: teacher.subject, specialty: teacher.specialty} : undefined, assignedAt: assignment.updatedAt};
}

function publicAdminLearningDiagnosticResult(attempt: LearningDiagnosticAttempt) {
  const profile = store.profiles.get(attempt.userId);
  const assignment = store.learningTeacherAssignments.find(item => item.attemptId === attempt.id);
  return {
    attemptId: attempt.id,
    user: profile ? publicProfile(profile) : {id: attempt.userId, name: '未知用户', phone: '', examYear: ''},
    scores: attempt.scores,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    answeredCount: attempt.answers.filter(item => item.optionIds.length > 0 || item.value !== undefined && String(item.value).trim() !== '').length,
    questionCount: attempt.questionSnapshot.length,
    ...(assignment ? {assignment: publicLearningTeacherAssignment(assignment)} : {}),
    answers: attempt.answers,
    questionSnapshot: attempt.questionSnapshot.map(question => ({...question, options: question.options.map(option => ({...option}))})),
  };
}

function hasLearningCoachAccess(userId: string) {
  return store.orders.some(order => order.userId === userId && order.status === 'paid' && store.learningClassTypes.some(classType => classType.productId === order.productId && classType.status === 'active'));
}

function learningClassTypeForUser(userId: string) {
  const order = store.orders.find(item => item.userId === userId && item.status === 'paid' && store.learningClassTypes.some(classType => classType.productId === item.productId && classType.status === 'active'));
  return order ? store.learningClassTypes.find(classType => classType.productId === order.productId && classType.status === 'active') : undefined;
}

function validateLearningDiagnosticQuestion(input: Record<string, unknown>, existing?: LearningDiagnosticQuestion): LearningDiagnosticQuestion {
  const formId = String(input.formId ?? existing?.formId ?? 'initial-assessment').trim();
  const form = store.learningDiagnosticForms.find(item => item.id === formId);
  if (!form) throw new HttpError(422, 'VALIDATION_ERROR', '诊断表单不存在');
  const stem = String(input.stem ?? existing?.stem ?? '').trim();
  const description = String(input.description ?? existing?.description ?? '').trim() || undefined;
  const section = String(input.section ?? existing?.section ?? '').trim() || undefined;
  const placeholder = String(input.placeholder ?? existing?.placeholder ?? '').trim() || undefined;
  const type = String(input.type ?? existing?.type ?? 'single');
  const dimension = String(input.dimension ?? existing?.dimension ?? 'foundation') as LearningDiagnosticDimension;
  const required = input.required === undefined ? (existing?.required ?? true) : Boolean(input.required);
  const sortOrder = Number(input.sortOrder ?? existing?.sortOrder ?? 0);
  const validationInput = input.validation && typeof input.validation === 'object' ? input.validation as Record<string, unknown> : existing?.validation ?? {};
  const validation = Object.fromEntries(Object.entries(validationInput).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => [key, Number(value)]));
  if (stem.length < 4 || stem.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', '题目内容需要填写 4 到 500 个字');
  if (description && description.length > 300) throw new HttpError(422, 'VALIDATION_ERROR', '题目说明不能超过 300 个字');
  if (section && section.length > 120) throw new HttpError(422, 'VALIDATION_ERROR', '分组名称不能超过 120 个字');
  if (placeholder && placeholder.length > 240) throw new HttpError(422, 'VALIDATION_ERROR', '填写提示不能超过 240 个字');
  if (!learningDiagnosticQuestionTypes.has(type)) throw new HttpError(422, 'VALIDATION_ERROR', '诊断题类型不正确');
  if (!store.learningDiagnosticDimensions.some(item => item.code === dimension && item.status === 'active')) throw new HttpError(422, 'VALIDATION_ERROR', '画像维度不存在或已停用');
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new HttpError(422, 'VALIDATION_ERROR', '排序值必须是 0 到 9999 的整数');
  const rawOptions = Array.isArray(input.options) ? input.options : existing?.options ?? [];
  if (learningDiagnosticOptionTypes.has(type) && (rawOptions.length < 2 || rawOptions.length > 8)) throw new HttpError(422, 'VALIDATION_ERROR', '选择题需要配置 2 到 8 个选项');
  if (!learningDiagnosticOptionTypes.has(type) && rawOptions.length) throw new HttpError(422, 'VALIDATION_ERROR', '填空、数字题不需要配置选项');
  const existingIds = new Set(existing?.options.map(option => option.id) ?? []);
  const options = rawOptions.map((value, index) => {
    const option = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const label = String(option.label ?? '').trim();
    const score = Number(option.score);
    const optionSortOrder = Number(option.sortOrder ?? (index + 1) * 10);
    if (!label || label.length > 160) throw new HttpError(422, 'VALIDATION_ERROR', `第 ${index + 1} 个选项内容不能为空且不能超过 160 个字`);
    if (!Number.isInteger(score) || score < 0 || score > 10) throw new HttpError(422, 'VALIDATION_ERROR', `第 ${index + 1} 个选项分值必须是 0 到 10 的整数`);
    if (!Number.isInteger(optionSortOrder) || optionSortOrder < 0 || optionSortOrder > 9999) throw new HttpError(422, 'VALIDATION_ERROR', '选项排序值必须是 0 到 9999 的整数');
    const requestedId = String(option.id ?? '');
    return {id: existingIds.has(requestedId) ? requestedId : `diagnostic-option-${randomUUID()}`, label, score, sortOrder: optionSortOrder};
  });
  if (new Set(options.map(option => option.label)).size !== options.length) throw new HttpError(422, 'VALIDATION_ERROR', '同一道题的选项内容不能重复');
  if (type === 'text' && validation.minLength !== undefined && (!Number.isInteger(validation.minLength) || validation.minLength < 0 || validation.minLength > 5000)) throw new HttpError(422, 'VALIDATION_ERROR', '文本长度下限需要是 0 到 5000 的整数');
  if (type === 'text' && validation.maxLength !== undefined && (!Number.isInteger(validation.maxLength) || validation.maxLength < 1 || validation.maxLength > 5000)) throw new HttpError(422, 'VALIDATION_ERROR', '文本长度上限需要是 1 到 5000 的整数');
  if (type === 'text' && validation.minLength !== undefined && validation.maxLength !== undefined && validation.minLength > validation.maxLength) throw new HttpError(422, 'VALIDATION_ERROR', '文本长度下限不能超过上限');
  if (['number', 'scale'].includes(type) && (validation.min !== undefined || validation.max !== undefined) && (validation.min === undefined || validation.max === undefined || !Number.isFinite(validation.min) || !Number.isFinite(validation.max) || validation.min >= validation.max)) throw new HttpError(422, 'VALIDATION_ERROR', '数字题范围不正确');
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? `diagnostic-question-${randomUUID()}`,
    formId,
    stem,
    ...(description ? {description} : {}),
    ...(section ? {section} : {}),
    ...(placeholder ? {placeholder} : {}),
    ...(Object.keys(validation).length ? {validation} : {}),
    type: type as LearningDiagnosticQuestion['type'],
    dimension,
    required,
    sortOrder,
    status: existing?.status ?? 'draft',
    version: existing?.version ?? 1,
    options: options.sort((left, right) => left.sortOrder - right.sortOrder),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.publishedAt ? {publishedAt: existing.publishedAt} : {}),
  };
}

function assertPublishableLearningDiagnosticQuestion(question: LearningDiagnosticQuestion) {
  if (!store.learningDiagnosticForms.some(item => item.id === question.formId)) throw new HttpError(409, 'DIAGNOSTIC_FORM_NOT_FOUND', '诊断表单不存在');
  if (!store.learningDiagnosticDimensions.some(item => item.code === question.dimension && item.status === 'active')) throw new HttpError(409, 'DIAGNOSTIC_DIMENSION_INVALID', '题目使用的画像维度不存在或已停用');
  if (question.stem.length < 4 || question.stem.length > 500) throw new HttpError(409, 'DIAGNOSTIC_QUESTION_INVALID', '题目内容不完整');
  if (learningDiagnosticOptionTypes.has(question.type)) {
    if (question.options.length < 2 || question.options.length > 8 || question.options.some(option => !option.label.trim())) throw new HttpError(409, 'DIAGNOSTIC_QUESTION_INVALID', '选择题至少需要 2 个有效选项');
    if (new Set(question.options.map(option => option.label.trim())).size !== question.options.length) throw new HttpError(409, 'DIAGNOSTIC_QUESTION_INVALID', '选择题选项不能重复');
  } else if (question.options.length) {
    throw new HttpError(409, 'DIAGNOSTIC_QUESTION_INVALID', '文本题和数字题不能包含选项');
  }
}

function publicLearningDiagnosticForm(form: LearningDiagnosticForm) {
  return {id: form.id, title: form.title, subtitle: form.subtitle, description: form.description, estimatedMinutes: form.estimatedMinutes, submitLabel: form.submitLabel, successTitle: form.successTitle, successDescription: form.successDescription, version: form.version};
}

function publicLearningDiagnosticQuestion(question: LearningDiagnosticQuestion) {
  return {
    id: question.id,
    formId: question.formId,
    stem: question.stem,
    description: question.description,
    section: question.section,
    placeholder: question.placeholder,
    validation: question.validation,
    type: question.type,
    required: question.required,
    sortOrder: question.sortOrder,
    version: question.version,
    options: question.options.map(option => ({id: option.id, label: option.label, sortOrder: option.sortOrder})),
  };
}

function scoreLearningDiagnostic(input: Record<string, unknown>, userId: string): LearningDiagnosticAttempt {
  const form = store.learningDiagnosticForms.find(item => item.id === 'initial-assessment' && item.status === 'published');
  const questions = store.learningDiagnosticQuestions.filter(question => question.formId === form?.id && question.status === 'published').sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  if (!questions.length) throw new HttpError(409, 'DIAGNOSTIC_NOT_READY', '学习诊断尚未发布，请稍后再试');
  const rawAnswers = Array.isArray(input.answers) ? input.answers : [];
  const answerMap = new Map<string, string[]>();
  for (const raw of rawAnswers) {
    const answer = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const questionId = String(answer.questionId ?? '');
    if (!questionId || answerMap.has(questionId)) throw new HttpError(422, 'VALIDATION_ERROR', '诊断答案中存在重复或无效的题目');
    answerMap.set(questionId, [...(Array.isArray(answer.optionIds) ? answer.optionIds.map(String) : []), ...(answer.value !== undefined ? [`__value:${String(answer.value)}`] : [])]);
  }
  if ([...answerMap.keys()].some(id => !questions.some(question => question.id === id))) throw new HttpError(422, 'VALIDATION_ERROR', '答案包含未发布的诊断题');
  const totals = emptyLearningDiagnosticScores();
  const counts = emptyLearningDiagnosticScores();
  const answers: LearningDiagnosticAttempt['answers'] = [];
  for (const question of questions) {
    const rawValues = [...new Set(answerMap.get(question.id) ?? [])];
    const valueToken = rawValues.find(item => item.startsWith('__value:'));
    const optionIds = rawValues.filter(item => !item.startsWith('__value:'));
    const value = valueToken ? valueToken.slice('__value:'.length) : undefined;
    if (learningDiagnosticOptionTypes.has(question.type) && value !== undefined) throw new HttpError(422, 'VALIDATION_ERROR', `“${question.stem}”不接受文本或数字答案`);
    if (!learningDiagnosticOptionTypes.has(question.type) && optionIds.length) throw new HttpError(422, 'VALIDATION_ERROR', `“${question.stem}”不接受选项答案`);
    if (question.required && !optionIds.length && (value === undefined || value.trim() === '')) throw new HttpError(422, 'DIAGNOSTIC_ANSWER_REQUIRED', `请完成“${question.stem}”`);
    if (question.type === 'single' && optionIds.length > 1) throw new HttpError(422, 'VALIDATION_ERROR', `“${question.stem}”只能选择一个选项`);
    const selected = optionIds.map(id => question.options.find(option => option.id === id));
    if (selected.some(option => !option)) throw new HttpError(422, 'VALIDATION_ERROR', `“${question.stem}”包含无效选项`);
    if (question.type === 'text' && value !== undefined && question.validation?.minLength !== undefined && value.length < question.validation.minLength) throw new HttpError(422, 'VALIDATION_ERROR', `“${question.stem}”填写内容过短`);
    if (question.type === 'text' && value !== undefined && question.validation?.maxLength !== undefined && value.length > question.validation.maxLength) throw new HttpError(422, 'VALIDATION_ERROR', `“${question.stem}”填写内容过长`);
    let numericValue: number | undefined;
    if (question.type === 'number' || question.type === 'scale') {
      if (value !== undefined) numericValue = Number(value);
      if (numericValue !== undefined && (!Number.isFinite(numericValue) || question.validation?.min !== undefined && numericValue < question.validation.min || question.validation?.max !== undefined && numericValue > question.validation.max)) throw new HttpError(422, 'VALIDATION_ERROR', `“${question.stem}”数值超出范围`);
    }
    answers.push({questionId: question.id, optionIds, ...(value !== undefined ? {value: numericValue ?? value} : {})});
    if (selected.length) {
      const maxScore = Math.max(...question.options.map(option => option.score), 1);
      const average = selected.reduce((sum, option) => sum + (option?.score ?? 0), 0) / selected.length;
      totals[question.dimension] = (totals[question.dimension] ?? 0) + average / maxScore * 100;
      counts[question.dimension] = (counts[question.dimension] ?? 0) + 1;
    } else if (numericValue !== undefined && question.validation?.min !== undefined && question.validation?.max !== undefined) {
      totals[question.dimension] = (totals[question.dimension] ?? 0) + ((numericValue - question.validation.min) / (question.validation.max - question.validation.min)) * 100;
      counts[question.dimension] = (counts[question.dimension] ?? 0) + 1;
    }
  }
  const scores = emptyLearningDiagnosticScores();
  for (const dimension of Object.keys(scores)) scores[dimension] = counts[dimension] ? Math.round(totals[dimension] / counts[dimension]) : 0;
  const now = new Date().toISOString();
  return {id: randomUUID(), userId, answers, questionSnapshot: structuredClone(questions), scores, status: 'submitted', startedAt: String(input.startedAt ?? now), submittedAt: now};
}

function announcementAudienceCount(item: Announcement) {
  if (item.audienceType === 'all') return store.profiles.size;
  return [...store.profiles.values()].filter(profile => profile.examYear === item.audienceValue).length;
}

function adminAnnouncement(item: Announcement) {
  const notificationId = `announcement:${item.id}`;
  const suffix = `:${notificationId}`;
  const readCount = [...store.notificationReceipts].filter(key => key.endsWith(suffix)).length;
  const closedCount = [...store.notificationClosures].filter(key => key.endsWith(suffix)).length;
  const audienceCount = announcementAudienceCount(item);
  return {
    ...item,
    status: announcementEffectiveStatus(item),
    persistedStatus: item.status,
    publishedAt: announcementPublishedAt(item),
    audienceCount,
    readCount,
    closedCount,
    readRate: audienceCount > 0 ? Math.round((readCount / audienceCount) * 10000) / 100 : 0,
  };
}

function announcementTimestamp(value: unknown, field: string) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) throw new HttpError(422, 'VALIDATION_ERROR', `${field}不是有效时间`);
  if (timestamp > ANNOUNCEMENT_MAX_TIMESTAMP) throw new HttpError(422, 'VALIDATION_ERROR', `${field}不能晚于 2099-12-31 23:59:59`);
  return new Date(timestamp).toISOString();
}

function validateAnnouncementWindow(startsAt?: string, endsAt?: string) {
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw new HttpError(422, 'VALIDATION_ERROR', '结束时间必须晚于开始时间');
}

function announcementAudience(input: Record<string, unknown>, current?: Announcement) {
  const audienceType = String(input.audienceType ?? current?.audienceType ?? 'all');
  if (audienceType !== 'all' && audienceType !== 'exam_year') throw new HttpError(422, 'VALIDATION_ERROR', '投放受众不正确');
  const audienceValue = audienceType === 'exam_year' ? String(input.audienceValue ?? current?.audienceValue ?? '').trim() : undefined;
  if (audienceType === 'exam_year' && !/^20\d{2}$/.test(audienceValue ?? '')) throw new HttpError(422, 'VALIDATION_ERROR', '请选择有效的考试年份');
  return {audienceType, audienceValue} as Pick<Announcement, 'audienceType' | 'audienceValue'>;
}

function announcementLink(value: unknown, current?: string) {
  if (value === undefined) return current;
  const deepLink = String(value ?? '').trim();
  if (!deepLink) return undefined;
  if (deepLink.length > 2000 || /[\u0000-\u001f\u007f]/.test(deepLink)) throw new HttpError(422, 'VALIDATION_ERROR', '跳转目标格式不正确');
  if (deepLink.startsWith('https://')) {
    try {
      const parsed = new URL(deepLink);
      if (!parsed.hostname) throw new Error('missing host');
    } catch {
      throw new HttpError(422, 'VALIDATION_ERROR', 'H5 地址必须是有效的 https:// 链接');
    }
    return deepLink;
  }
  const supportedPaths = new Set([
    '/home', '/questions', '/mall', '/courses', '/profile',
    '/learning/records', '/learning/plan', '/learning/plans', '/grading',
    '/notifications', '/law-search', '/mistakes', '/favorites', '/ai-chat', '/orders',
  ]);
  const supportedPattern = /^(?:\/announcements|\/products|\/commerce\/products|\/courses|\/forum\/posts|\/community\/posts|\/orders)\/[^/?#]+$|^\/grading\/[^/?#]+\/report$/;
  if (!supportedPaths.has(deepLink) && !supportedPattern.test(deepLink)) throw new HttpError(422, 'VALIDATION_ERROR', '请选择有效的 App 页面或内容目标');
  return deepLink;
}

function validateAnnouncementTarget(deepLink?: string) {
  if (!deepLink || deepLink.startsWith('https://')) return;
  const product = deepLink.match(/^\/(?:products|commerce\/products)\/([^/?#]+)$/);
  if (product && !store.products.some(item => item.id === decodePathSegment(product[1]) && isSellableProduct(item))) throw new HttpError(422, 'VALIDATION_ERROR', '所选商品不存在或已下架');
  const course = deepLink.match(/^\/courses\/([^/?#]+)$/);
  if (course && !store.courses.some(item => item.id === decodePathSegment(course[1]) && isPublishedCourse(item))) throw new HttpError(422, 'VALIDATION_ERROR', '所选课程不存在或未发布');
  const post = deepLink.match(/^\/(?:forum\/posts|community\/posts)\/([^/?#]+)$/);
  if (post && !store.forumPosts.some(item => item.id === decodePathSegment(post[1]) && item.status === 'published')) throw new HttpError(422, 'VALIDATION_ERROR', '所选帖子不存在或已隐藏');
  const gradingReport = deepLink.match(/^\/grading\/([^/?#]+)\/report$/);
  if (gradingReport && !store.gradingSubmissions.some(item => item.id === decodePathSegment(gradingReport[1]))) throw new HttpError(422, 'VALIDATION_ERROR', '所选批改记录不存在');
}

function notificationItemsFor(userId: string) {
  const staticItems = [
    {id: 'n1', type: 'learning', title: '今日学习提醒', body: '民法体系精讲还有 2 节待完成。', createdAt: new Date().toISOString(), deepLink: '/learning/plan'},
    {id: 'n2', type: 'grading', title: '批改完成', body: '您的主观题答案已完成批改。', createdAt: new Date(Date.now() - 86_400_000).toISOString(), deepLink: '/grading'},
    {id: 'n3', type: 'order', title: '订单通知', body: '订单 DB202608270001 已支付成功。', createdAt: '2026-08-27T00:00:00.000Z', deepLink: '/orders'},
  ];
  const gradingItems = store.gradingReports.filter(report => {
    const submission = store.gradingSubmissions.find(item => item.id === report.submissionId);
    return submission?.userId === userId;
  }).map(report => ({id: `grading-report:${report.id}`, type: 'grading', title: '批改报告已发布', body: `您的主观题批改报告已发布，得分 ${report.totalScore}/${report.maxScore}。`, createdAt: report.publishedAt, deepLink: `/grading/${report.submissionId}/report`}));
  const inquiryItems = store.learningInquiries.filter(item => item.userId === userId && item.status === 'answered')
    .map(item => ({id: `inquiry:${item.id}`, type: 'learning', title: '老师已回复你的错因答疑', body: `${item.teacherName ?? '答疑老师'}：${item.reply ?? ''}`, createdAt: item.repliedAt!, deepLink: '/learning/inquiries'}));
  const announcementItems = store.announcements.filter(item => announcementFeedVisibleTo(item, userId)).sort(compareAnnouncements).map(item => ({id: `announcement:${item.id}`, type: 'announcement', title: item.title, body: item.body, createdAt: announcementDeliveryTime(item), deepLink: announcementDeepLink(item), pinned: item.isPinned}));
  const orderItems = store.orders.filter(order => order.userId === userId).flatMap(order => {
    const event = store.orderEvents.find(item => item.orderId === order.id && item.type !== 'created');
    if (!event) return [];
    return [{id: `order:${order.id}:${event.id}`, type: 'order', title: '订单状态更新', body: `订单 ${order.id} 当前状态：${order.status}`, createdAt: event.createdAt, deepLink: `/orders/${encodeURIComponent(order.id)}`}];
  });
  const deduped = new Map<string, {id: string; type: string; title: string; body: string; createdAt: string; deepLink: string; pinned?: boolean}>();
  for (const item of [...(process.env.DEBAO_TEST_FIXTURES === 'true' ? staticItems : []), ...gradingItems, ...inquiryItems, ...announcementItems, ...orderItems]) if (!deduped.has(item.id)) deduped.set(item.id, item);
  return [...deduped.values()].filter(item => !store.notificationClosures.has(`${userId}:${item.id}`)).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(item => ({...item, read: store.notificationReceipts.has(`${userId}:${item.id}`) || item.id === 'n3'}));
}

async function restoreOrderInventory(order: Order) {
  // A SKU can be disabled after an order is created; inventory still needs
  // to be returned to that exact row during cancellation/expiry.
  const sku = order.skuId
    ? store.productSkus.find(item => item.id === order.skuId && item.productId === order.productId)
    : undefined;
  if (!sku) return;
  const updatedAt = new Date().toISOString();
  const result = await infrastructure.query<{stock: number | string}>(
    'update product_skus set stock = stock + 1, updated_at = $1 where id = $2 and product_id = $3 returning stock',
    [updatedAt, sku.id, sku.productId],
  );
  // A null result is the expected development-mode fallback when no database
  // is configured. A non-null zero-row result means the SKU disappeared and
  // must not be counted back into memory.
  if (result && result.rowCount !== 1) return;
  const persistedStock = result?.rows[0]?.stock;
  sku.stock = persistedStock === undefined ? sku.stock + 1 : Number(persistedStock);
  sku.updatedAt = updatedAt;
}

async function reserveOrderInventory(sku: ProductSku, updatedAt: string) {
  const result = await infrastructure.query<{stock: number | string}>(
    'update product_skus set stock = stock - 1, updated_at = $1 where id = $2 and product_id = $3 and status = $4 and stock > 0 returning stock',
    [updatedAt, sku.id, sku.productId, 'active'],
  );
  // A configured database is authoritative. If another request consumed the
  // last unit, the conditional update affects zero rows and this request must
  // not create an order or mutate the local view.
  if (result && result.rowCount !== 1) throw new HttpError(409, 'SKU_OUT_OF_STOCK', '所选规格暂时缺货');
  const persistedStock = result?.rows[0]?.stock;
  sku.stock = persistedStock === undefined ? sku.stock - 1 : Number(persistedStock);
  sku.updatedAt = updatedAt;
}

function attachmentFor(id: string, userId: string) {
  const upload = store.attachmentUploads.find(item => item.id === id && item.userId === userId);
  if (!upload) throw new HttpError(404, 'ATTACHMENT_NOT_FOUND', '附件不存在');
  if (upload.status === 'pending' && Date.parse(upload.expiresAt) <= Date.now()) upload.status = 'expired';
  return upload;
}

function validateSubmissionAttachments(answers: Array<{attachments: string[]}>, userId: string) {
  const ids = [...new Set(answers.flatMap(answer => answer.attachments))];
  for (const id of ids) {
    const upload = attachmentFor(id, userId);
    if (upload.status !== 'completed') throw new HttpError(409, 'ATTACHMENT_NOT_READY', '请等待附件上传完成后再提交');
  }
}

function questionAnswerIndexes(question: Pick<Question, 'answer' | 'answerIndexes' | 'options'>) {
  const indexes = question.answerIndexes?.length ? question.answerIndexes : [question.answer];
  return [...new Set(indexes)].filter(index => Number.isInteger(index) && index >= 0 && index < question.options.length).sort((a, b) => a - b);
}

/** Normalize the answer metadata accepted by admin/import APIs. */
function normalizeQuestionChoices(input: Record<string, unknown>, options: string[], fallback?: Pick<Question, 'answer' | 'answerIndexes' | 'questionType'>) {
  const rawType = input.questionType === undefined ? fallback?.questionType : input.questionType;
  const inferredIndexes = Array.isArray(input.answerIndexes)
    ? input.answerIndexes.map(Number)
    : input.answer !== undefined
      ? [Number(input.answer)]
      : fallback?.answerIndexes?.length
        ? [...fallback.answerIndexes]
        : fallback ? [fallback.answer] : [];
  const indexes = [...new Set(inferredIndexes)].sort((left, right) => left - right);
  const questionType = rawType === undefined || rawType === ''
    ? (indexes.length > 1 ? 'multiple' : 'single')
    : String(rawType);
  if (!['true_false', 'single', 'multiple', 'indeterminate'].includes(questionType)) throw new HttpError(422, 'VALIDATION_ERROR', '题型必须是 true_false、single、multiple 或 indeterminate');
  if (!indexes.length || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= options.length)) throw new HttpError(422, 'VALIDATION_ERROR', '答案选项无效');
  if (questionType === 'true_false' && (options.length !== 2 || indexes.length !== 1)) throw new HttpError(422, 'VALIDATION_ERROR', '判断题必须有两个选项且只能设置一个正确答案');
  if (questionType === 'single' && indexes.length !== 1) throw new HttpError(422, 'VALIDATION_ERROR', '单选题只能设置一个正确答案');
  if (questionType === 'multiple' && indexes.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '多选题至少需要两个正确答案');
  return {
    answer: indexes[0],
    ...(['multiple', 'indeterminate'].includes(questionType) ? {answerIndexes: indexes} : {}),
    questionType: questionType as NonNullable<Question['questionType']>,
  };
}

function questionSnapshot(question: Question): QuestionSubmissionSnapshot {
  return {
    id: question.id,
    ...(question.subjectId ? {subjectId: question.subjectId} : {}),
    stem: question.stem,
    options: [...question.options],
    answer: question.answer,
    ...(question.answerIndexes?.length ? {answerIndexes: [...question.answerIndexes]} : {}),
    ...(question.questionType ? {questionType: question.questionType} : {}),
    analysis: question.analysis,
    version: question.version ?? 1,
    ...(question.source ? {source: question.source} : {}),
  };
}

function objectiveSubmissionSnapshot(question: ObjectiveQuestionSnapshot): QuestionSubmissionSnapshot {
  return {
    id: question.id,
    ...(question.subjectId ? {subjectId: question.subjectId} : {}),
    stem: question.stem,
    options: [...question.options],
    answer: question.answer,
    ...(question.answerIndexes?.length ? {answerIndexes: [...question.answerIndexes]} : {}),
    ...(question.questionType ? {questionType: question.questionType} : {}),
    analysis: question.analysis,
    version: question.version,
    ...(question.source ? {source: question.source} : {}),
  };
}

function storedQuestionSnapshot(value: unknown): QuestionSubmissionSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.stem !== 'string' || !Array.isArray(candidate.options) || typeof candidate.analysis !== 'string') return undefined;
  const options = candidate.options.map(String);
  const answer = Number(candidate.answer);
  const version = Number(candidate.version ?? 1);
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length || !Number.isInteger(version) || version < 1) return undefined;
  const answerIndexes = Array.isArray(candidate.answerIndexes) ? candidate.answerIndexes.map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < options.length) : undefined;
  const questionType = ['true_false', 'single', 'multiple', 'indeterminate'].includes(String(candidate.questionType)) ? candidate.questionType as NonNullable<Question['questionType']> : undefined;
  return {
    id: candidate.id,
    ...(typeof candidate.subjectId === 'string' ? {subjectId: candidate.subjectId} : {}),
    stem: candidate.stem,
    options,
    answer,
    ...(answerIndexes?.length ? {answerIndexes: [...new Set(answerIndexes)].sort((a, b) => a - b)} : {}),
    ...(questionType ? {questionType} : {}),
    analysis: candidate.analysis,
    version,
    ...(typeof candidate.source === 'string' ? {source: candidate.source} : {}),
  };
}

function publicObjectiveQuestion(question: Question, includeSolutions = false) {
  const base = {
    id: question.id,
    ...(question.subjectId ? {subjectId: question.subjectId} : {}),
    stem: question.stem,
    options: question.options,
    ...(question.questionType ? {questionType: question.questionType} : {}),
    version: question.version ?? 1,
    ...(question.source ? {source: question.source} : {}),
  };
  return includeSolutions ? {...base, answer: question.answer, ...(question.answerIndexes?.length ? {answerIndexes: question.answerIndexes} : {}), analysis: question.analysis} : base;
}

function objectiveSessionView(session: ObjectiveSession, includeSolutions = false) {
  return {
    id: session.id,
    mode: session.mode,
    title: session.title,
    ...(session.subjectId ? {subjectId: session.subjectId} : {}),
    ...(session.paperId ? {paperId: session.paperId} : {}),
    ...(session.learningTaskId ? {learningTaskId: session.learningTaskId} : {}),
    questionIds: session.questionIds,
    questions: session.questions.map(question => includeSolutions ? question : ({
      id: question.id,
      ...(question.subjectId ? {subjectId: question.subjectId} : {}),
      stem: question.stem,
      options: question.options,
      ...(question.questionType ? {questionType: question.questionType} : {}),
      version: question.version,
      ...(question.source ? {source: question.source} : {}),
    })),
    answers: session.answers,
    durationSeconds: session.durationSeconds,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    status: session.status,
    submittedAt: session.submittedAt,
    ...(session.reportId ? {reportId: session.reportId} : {}),
  };
}

function objectiveAnswerValues(value: unknown, optionCount: number) {
  if (!Array.isArray(value)) throw new HttpError(422, 'VALIDATION_ERROR', '答案必须是数组');
  const values = value.map(item => String(item).trim()).filter(Boolean);
  const indexes = values.map(item => Number(item));
  if (indexes.some(index => !Number.isInteger(index) || index < 0 || index >= optionCount)) throw new HttpError(422, 'VALIDATION_ERROR', '答案选项无效');
  return [...new Set(indexes)].sort((a, b) => a - b).map(String);
}

function objectiveAnswersEqual(left: string[], right: number[]) {
  return left.map(Number).sort((a, b) => a - b).join(',') === right.join(',');
}

function objectiveReportFor(session: ObjectiveSession, submittedAt: string): ObjectiveReport {
  const answerMap = new Map(session.answers.map(item => [item.questionId, item.answers]));
  const results = session.questions.map(question => {
    const answers = answerMap.get(question.id) ?? [];
    const correctAnswers = questionAnswerIndexes(question);
    return {
      questionId: question.id,
      ...(question.subjectId ? {subjectId: question.subjectId} : {}),
      stem: question.stem,
      options: question.options,
      ...(question.questionType ? {questionType: question.questionType} : {}),
      version: question.version,
      answers,
      correctAnswers: correctAnswers.map(String),
      correct: objectiveAnswersEqual(answers, correctAnswers),
      analysis: question.analysis,
      ...(question.explanationMediaType ? {explanationMediaType: question.explanationMediaType} : {}),
      ...(question.explanationMediaReference ? {explanationMediaReference: question.explanationMediaReference} : {}),
    };
  });
  const correct = results.filter(item => item.correct).length;
  const subjectStats = [...new Set(results.map(item => item.subjectId).filter((item): item is string => Boolean(item)))].map(subjectId => {
    const items = results.filter(item => item.subjectId === subjectId); const subjectCorrect = items.filter(item => item.correct).length;
    return {subjectId, total: items.length, correct: subjectCorrect, correctRate: items.length ? Math.round(subjectCorrect / items.length * 100) : 0};
  });
  return {id: `oreport-${randomUUID()}`, sessionId: session.id, userId: session.userId, mode: session.mode, title: session.title, total: results.length, answered: session.answers.filter(item => item.answers.length > 0).length, correct, score: results.length ? Math.round(correct / results.length * 100) : 0, maxScore: 100, results, subjectStats, submittedAt};
}

function forumRelationKey(postId: string, userId: string) { return `${postId}:${userId}`; }

function publicForumPost(post: ForumPost, viewerId: string) {
  return {
    id: post.id,
    authorId: post.userId,
    userName: post.userName,
    category: post.category,
    title: post.title,
    body: post.body,
    likes: post.likes,
    comments: store.forumComments.filter(item => item.postId === post.id && !item.deletedAt).length,
    liked: store.forumLikes.has(forumRelationKey(post.id, viewerId)),
    favorited: store.forumFavorites.has(forumRelationKey(post.id, viewerId)),
    canDelete: post.userId === viewerId,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function publicForumComment(comment: ForumComment, viewerId: string) {
  return {id: comment.id, postId: comment.postId, authorId: comment.userId, userName: comment.userName, body: comment.body, canDelete: comment.userId === viewerId, createdAt: comment.createdAt};
}

function publicForumReport(report: Store['communityReports'][number]) {
  // Never expose the reporter's internal user id to the mobile client.  The
  // moderation console reads the full record through its authenticated admin
  // endpoint instead.
  return {id: report.id, postId: report.postId, reason: report.reason, status: report.status, createdAt: report.createdAt};
}

function activeForumPost(id: string) {
  const post = store.forumPosts.find(item => item.id === id && item.status === 'published' && !item.deletedAt);
  if (!post) throw new HttpError(404, 'FORUM_POST_NOT_FOUND', '帖子不存在或已删除');
  return post;
}

function forumLimit(value: string | null) {
  if (value === null) return 20;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) throw new HttpError(422, 'VALIDATION_ERROR', 'limit 必须是 1 到 50 的整数');
  return parsed;
}

function encodeForumCursor(createdAt: string, id: string) {
  return Buffer.from(JSON.stringify({createdAt, id}), 'utf8').toString('base64url');
}

function decodeForumCursor(value: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {createdAt?: unknown; id?: unknown};
    if (typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt)) || typeof parsed.id !== 'string' || !parsed.id) throw new Error();
    return {createdAt: parsed.createdAt, id: parsed.id};
  } catch {
    throw new HttpError(422, 'VALIDATION_ERROR', 'cursor 格式不正确');
  }
}

function isAfterDescendingCursor(item: {createdAt: string; id: string}, cursor?: {createdAt: string; id: string}) {
  if (!cursor) return true;
  const itemTime = Date.parse(item.createdAt); const cursorTime = Date.parse(cursor.createdAt);
  return itemTime < cursorTime || (itemTime === cursorTime && item.id < cursor.id);
}

function isAfterAscendingCursor(item: {createdAt: string; id: string}, cursor?: {createdAt: string; id: string}) {
  if (!cursor) return true;
  const itemTime = Date.parse(item.createdAt); const cursorTime = Date.parse(cursor.createdAt);
  return itemTime > cursorTime || (itemTime === cursorTime && item.id > cursor.id);
}
function publicProfile(profile: UserProfile): UserProfile {
  const phone = /^1\d{10}$/.test(profile.phone) ? `${profile.phone.slice(0, 3)}****${profile.phone.slice(-4)}` : profile.phone;
  const studyDays = new Set([
    ...store.learningActivities.filter(item => item.userId === profile.id && (item.durationSeconds > 0 || item.quantity > 0)).map(item => item.occurredAt.slice(0, 10)),
    ...store.submissions.filter(item => item.userId === profile.id).map(item => item.createdAt.slice(0, 10)),
    ...store.learningTasks.filter(item => item.status === 'done' && item.completedAt && store.learningPlans.some(plan => plan.id === item.planId && plan.userId === profile.id)).map(item => item.completedAt!.slice(0, 10)),
  ]).size;
  return {...profile, phone, studyDays: process.env.DEBAO_TEST_FIXTURES === 'true' ? profile.studyDays : studyDays};
}
function devicePlatform(deviceId: string): 'android' | 'ios' | 'harmony' {
  if (deviceId.toLowerCase().startsWith('ios')) return 'ios';
  if (deviceId.toLowerCase().startsWith('harmony')) return 'harmony';
  return 'android';
}
function latestChallenge(phone: string, purpose: SmsPurpose) {
  return store.verificationChallenges
    .filter(item => item.phone === phone && item.purpose === purpose)
    .sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt))[0];
}
async function sendVerificationCode(phone: string, purpose: SmsPurpose, context: {requestIp?: string; deviceId?: string} = {}) {
  const latest = latestChallenge(phone, purpose);
  if (latest && Date.now() - Date.parse(latest.requestedAt) < 60_000) {
    const retryAfter = Math.ceil((60_000 - (Date.now() - Date.parse(latest.requestedAt))) / 1000);
    throw new HttpError(429, 'AUTH_CODE_RATE_LIMITED', `请 ${retryAfter} 秒后再试`, {retryAfter});
  }
  const recentCount = store.verificationChallenges.filter(item => item.phone === phone && Date.now() - Date.parse(item.requestedAt) < 3_600_000).length;
  if (recentCount >= 5) throw new HttpError(429, 'AUTH_CODE_RATE_LIMITED', '验证码请求过于频繁，请稍后再试', {retryAfter: 3600});
  const recentForIp = context.requestIp ? store.verificationChallenges.filter(item => item.requestIp === context.requestIp && Date.now() - Date.parse(item.requestedAt) < 3_600_000).length : 0;
  if (recentForIp >= 20) throw new HttpError(429, 'AUTH_CODE_RATE_LIMITED', '当前网络验证码请求过于频繁，请稍后再试', {retryAfter: 3600});
  const recentForDevice = context.deviceId ? store.verificationChallenges.filter(item => item.deviceId === context.deviceId && Date.now() - Date.parse(item.requestedAt) < 3_600_000).length : 0;
  if (recentForDevice >= 10) throw new HttpError(429, 'AUTH_CODE_RATE_LIMITED', '当前设备验证码请求过于频繁，请稍后再试', {retryAfter: 3600});
  const verificationCode = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
  let result;
  try { result = await smsAdapter.sendCode(phone, purpose, verificationCode); } catch (error) { throw adapterFailure(smsAdapter.name, error); }
  if (!result.accepted) return {accepted: false, expiresIn: 300};
  const codeHash = createHash('sha256').update(`${phone}:${purpose}:${verificationCode}`).digest('hex');
  const challenge: VerificationChallenge = {phone, purpose, providerMessageId: result.providerMessageId, requestIp: context.requestIp, deviceId: context.deviceId, requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString(), attempts: 0, codeHash};
  store.verificationChallenges.push(challenge);
  await persist('insert into auth_verification_challenges (phone, purpose, provider_message_id, request_ip, device_id, requested_at, expires_at, code_hash) values ($1, $2, $3, $4, $5, $6, $7, $8)', [phone, purpose, challenge.providerMessageId, challenge.requestIp ?? null, challenge.deviceId ?? null, challenge.requestedAt, challenge.expiresAt, challenge.codeHash]);
  return {accepted: true, expiresIn: 300, ...(smsAdapter.name === 'local' ? {developmentCode: '123456'} : {})};
}
async function verifyCodeChallenge(phone: string, code: string, purpose: SmsPurpose) {
  let challenge = latestChallenge(phone, purpose);
  if (!challenge) {
    const result = await infrastructure.query<{phone: string; purpose: SmsPurpose; provider_message_id: string; request_ip?: string; device_id?: string; requested_at: string; expires_at: string; attempts: number; code_hash?: string; consumed_at?: string}>('select phone, purpose, provider_message_id, request_ip, device_id, requested_at, expires_at, attempts, code_hash, consumed_at from auth_verification_challenges where phone = $1 and purpose = $2 order by requested_at desc limit 1', [phone, purpose]);
    const row = result?.rows[0];
    if (row) {
      challenge = {phone: row.phone, purpose: row.purpose, providerMessageId: row.provider_message_id, requestIp: row.request_ip, deviceId: row.device_id, requestedAt: new Date(row.requested_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(), attempts: row.attempts, codeHash: row.code_hash, consumedAt: row.consumed_at ? new Date(row.consumed_at).toISOString() : undefined};
      store.verificationChallenges.push(challenge);
    }
  }
  if (!challenge) throw new HttpError(401, 'AUTH_CODE_NOT_REQUESTED', '请先获取验证码');
  if (challenge.consumedAt) throw new HttpError(401, 'AUTH_CODE_CONSUMED', '验证码已使用，请重新获取');
  if (Date.parse(challenge.expiresAt) <= Date.now()) throw new HttpError(401, 'AUTH_CODE_EXPIRED', '验证码已过期');
  if (challenge.attempts >= 5) throw new HttpError(429, 'AUTH_CODE_ATTEMPTS_EXCEEDED', '验证次数过多，请重新获取验证码');
  let verified;
  try { verified = await smsAdapter.verifyCode(phone, code, purpose, challenge.codeHash); } catch (error) { throw adapterFailure(smsAdapter.name, error); }
  if (!verified.valid) {
    challenge.attempts += 1;
    await persist('update auth_verification_challenges set attempts = $1 where provider_message_id = $2', [challenge.attempts, challenge.providerMessageId]);
    throw new HttpError(401, 'AUTH_CODE_INVALID', '验证码错误');
  }
  return challenge;
}
async function consumeChallenge(challenge: VerificationChallenge) {
  challenge.consumedAt = new Date().toISOString();
  await persist('update auth_verification_challenges set attempts = $1, consumed_at = $2 where provider_message_id = $3', [challenge.attempts, challenge.consumedAt, challenge.providerMessageId]);
}
async function verifyAndConsumeCode(phone: string, code: string, purpose: SmsPurpose) {
  const challenge = await verifyCodeChallenge(phone, code, purpose);
  await consumeChallenge(challenge);
}
async function upsertLoginDevice(userId: string, deviceId: string) {
  const platform = devicePlatform(deviceId); const now = new Date().toISOString();
  const existing = store.devices.find(item => item.id === deviceId);
  const device = {id: deviceId, userId, platform, name: existing?.name ?? `${platform === 'ios' ? 'iPhone' : platform === 'harmony' ? 'HarmonyOS' : 'Android'} 设备`, pushToken: existing?.pushToken, lastSeenAt: now};
  store.devices = [device, ...store.devices.filter(item => item.id !== deviceId)];
  await persist('insert into devices (id, user_id, platform, name, push_token, last_seen_at) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set user_id = excluded.user_id, platform = excluded.platform, name = excluded.name, last_seen_at = excluded.last_seen_at', [device.id, dbUserId(userId), device.platform, device.name, device.pushToken ?? null, device.lastSeenAt]);
}
async function resolveUserForPhone(phone: string, nickname = '法考学习者') {
  const memory = [...store.profiles.values()].find(item => item.phone === phone);
  if (memory) return memory.id;
  const result = await infrastructure.query<{id: string; name: string; phone: string; exam_year: string; study_days: number}>('select id, name, phone, exam_year, study_days from users where phone = $1 and deleted_at is null limit 1', [phone]);
  const row = result?.rows[0];
  if (row) {
    const id = internalUserId(row.id); store.profiles.set(id, {id, name: row.name, phone: row.phone, examYear: row.exam_year, studyDays: row.study_days}); return id;
  }
  const id = randomUUID(); const profile: UserProfile = {id, name: nickname || '法考学习者', phone, examYear: String(new Date().getFullYear()), studyDays: 0};
  store.profiles.set(id, profile);
  await persist('insert into users (id, name, phone, exam_year, study_days) values ($1, $2, $3, $4, $5)', [id, profile.name, profile.phone, profile.examYear, profile.studyDays]);
  return id;
}
async function issueSession(userId: string, deviceId: string, eventType: string, provider: string) {
  assertLoginAllowed(userId);
  const accessToken = `local-${randomUUID()}`; const refreshToken = `refresh-${randomUUID()}`; const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const session = {userId, refreshToken, deviceId, expiresAt}; store.sessions.set(accessToken, session);
  await upsertLoginDevice(userId, deviceId);
  await persist('insert into refresh_sessions (user_id, token_hash, device_id, expires_at) values ($1, $2, $3, $4)', [dbUserId(userId), tokenHash(refreshToken), deviceId, expiresAt]);
  await infrastructure.cacheSet(`session:${tokenHash(refreshToken)}`, session, 604800);
  await persist('insert into auth_events (user_id, event_type, provider, device_id) values ($1, $2, $3, $4)', [dbUserId(userId), eventType, provider, deviceId]);
  return {accessToken, refreshToken, expiresIn: 604800, profile: publicProfile(profileFor(userId))};
}
async function bindingTicketByToken(bindingToken: string) {
  const hash = tokenHash(bindingToken); const memory = store.bindingTickets.get(hash);
  if (memory && !memory.consumedAt && Date.parse(memory.expiresAt) > Date.now()) return {hash, ticket: memory};
  const result = await infrastructure.query<{provider: 'wechat'; provider_user_id: string; union_id?: string; nickname?: string; expires_at: string; consumed_at?: string}>('select provider, provider_user_id, union_id, nickname, expires_at, consumed_at from auth_binding_tickets where token_hash = $1 and consumed_at is null and expires_at > now()', [hash]);
  const row = result?.rows[0];
  if (!row) return undefined;
  const ticket = {provider: row.provider, providerUserId: row.provider_user_id, unionId: row.union_id, nickname: row.nickname, expiresAt: new Date(row.expires_at).toISOString(), consumedAt: row.consumed_at ? new Date(row.consumed_at).toISOString() : undefined};
  store.bindingTickets.set(hash, ticket); return {hash, ticket};
}
async function bindWechatIdentity(userId: string, hash: string, ticket: {providerUserId: string; unionId?: string; nickname?: string; expiresAt: string; consumedAt?: string}) {
  const collision = store.identities.find(item => item.provider === 'wechat' && (item.providerUserId === ticket.providerUserId || (ticket.unionId && item.unionId === ticket.unionId)) && item.userId !== userId);
  if (collision) throw new HttpError(409, 'IDENTITY_ALREADY_BOUND', '该微信账号已绑定其他手机号');
  if (!store.identities.some(item => item.provider === 'wechat' && item.providerUserId === ticket.providerUserId)) store.identities.push({userId, provider: 'wechat', providerUserId: ticket.providerUserId, unionId: ticket.unionId, nickname: ticket.nickname, createdAt: new Date().toISOString()});
  ticket.consumedAt = new Date().toISOString();
  await persist('insert into user_identities (user_id, provider, provider_user_id, union_id, nickname) values ($1, $2, $3, $4, $5) on conflict (provider, provider_user_id) do nothing', [dbUserId(userId), 'wechat', ticket.providerUserId, ticket.unionId ?? null, ticket.nickname ?? null]);
  await persist('update auth_binding_tickets set consumed_at = now() where token_hash = $1', [hash]);
}
async function sessionByRefreshToken(refreshToken: string) {
  const memory = [...store.sessions.values()].find(item => item.refreshToken === refreshToken && !item.revokedAt && Date.parse(item.expiresAt) > Date.now());
  if (memory) return memory;
  const cached = await infrastructure.cacheGet<{userId: string; refreshToken: string; deviceId: string; expiresAt: string}>(`session:${tokenHash(refreshToken)}`);
  if (cached && Date.parse(cached.expiresAt) > Date.now()) return cached;
  const result = await infrastructure.query<{user_id: string; device_id: string; expires_at: string}>('select user_id, device_id, expires_at from refresh_sessions where token_hash = $1 and revoked_at is null and expires_at > now()', [tokenHash(refreshToken)]);
  const row = result?.rows[0];
  return row ? {userId: row.user_id === DEMO_DB_USER_ID ? 'u-demo' : row.user_id, refreshToken, deviceId: row.device_id, expiresAt: new Date(row.expires_at).toISOString()} : undefined;
}

export async function processDueAccountDeletions(now = Date.now()) {
  const due = [...store.deletionRequests.values()].filter(item => !item.cancelledAt && !item.completedAt && Date.parse(item.executeAfter) <= now);
  for (const deletion of due) {
    const profile = store.profiles.get(deletion.userId);
    if (!profile) continue;
    const completedAt = new Date(now).toISOString();
    const anonymousPhone = `deleted-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    store.profiles.set(deletion.userId, {...profile, name: '已注销用户', phone: anonymousPhone, studyDays: 0, avatarColor: undefined, avatarUrl: undefined});
    store.identities = store.identities.filter(item => item.userId !== deletion.userId);
    store.devices = store.devices.filter(item => item.userId !== deletion.userId);
    for (const [key, draft] of store.drafts.entries()) {
      if (draft.userId === deletion.userId) store.drafts.delete(key);
    }
    for (const [access, session] of store.sessions.entries()) {
      if (session.userId !== deletion.userId) continue;
      session.revokedAt = completedAt;
      await infrastructure.cacheDelete(`session:${tokenHash(session.refreshToken)}`);
      store.sessions.delete(access);
    }
    deletion.completedAt = completedAt;
    await persist('update users set name = $1, phone = $2, study_days = 0, avatar_color = null, avatar_url = null, updated_at = now() where id = $3', ['已注销用户', anonymousPhone, dbUserId(deletion.userId)]);
    await persist('delete from user_identities where user_id = $1', [dbUserId(deletion.userId)]);
    await persist('delete from devices where user_id = $1', [dbUserId(deletion.userId)]);
    await persist('delete from question_drafts where user_id = $1', [dbUserId(deletion.userId)]);
    await persist('update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [dbUserId(deletion.userId)]);
    await persist('update account_deletion_requests set completed_at = $1 where user_id = $2 and cancelled_at is null and completed_at is null', [completedAt, dbUserId(deletion.userId)]);
    await persist('insert into auth_events (user_id, event_type) values ($1, $2)', [dbUserId(deletion.userId), 'deletion_completed']);
  }
  return due.length;
}

export async function hydrateStore() {
  await ensureDevelopmentAdminRecord();
  const inquiries = await infrastructure.query<any>('select * from learning_inquiries order by created_at desc');
  if (inquiries) store.learningInquiries = inquiries.rows.map(row => ({
    id: row.id, userId: internalUserId(row.user_id), reportId: row.report_id,
    questionId: row.question_id, question: row.question_snapshot, reason: row.reason,
    status: row.status, reply: row.reply ?? undefined, teacherName: row.teacher_name ?? undefined,
    repliedBy: row.replied_by ?? undefined, createdAt: new Date(row.created_at).toISOString(),
    repliedAt: row.replied_at ? new Date(row.replied_at).toISOString() : undefined,
    clientRequestId: row.client_request_id,
  }));
  const auditRows = await infrastructure.query<any>('select id, admin_user_id, action, resource_type, resource_id, reason, request_id, created_at from admin_audit_logs order by created_at desc');
  if (auditRows) {
    adminAuditLogs.splice(0, adminAuditLogs.length, ...auditRows.rows.map(row => ({
      id: row.id, adminUserId: row.admin_user_id, action: row.action,
      resourceType: row.resource_type, resourceId: row.resource_id,
      reason: row.reason, requestId: row.request_id, result: 'success',
      createdAt: new Date(row.created_at).toISOString(),
    })));
  }
  const adminSettings = await infrastructure.query<{setting_key: string; setting_value: string}>('select setting_key, setting_value from admin_system_settings where setting_key = $1', ['refund_review_threshold']);
  const persistedRefundThreshold = adminSettings?.rows.find(item => item.setting_key === 'refund_review_threshold')?.setting_value;
  if (persistedRefundThreshold !== undefined) {
    const parsed = Number(persistedRefundThreshold);
    if (validRefundReviewThreshold(parsed)) adminRefundDualReviewThreshold = parsed;
  }
  const profiles = await infrastructure.query<{id: string; name: string; phone: string; exam_year: string; study_days: number; avatar_color?: string; avatar_url?: string}>('select id, name, phone, exam_year, study_days, avatar_color, avatar_url from users where deleted_at is null order by created_at');
  if (profiles) store.profiles = new Map(profiles.rows.map(item => { const id = internalUserId(item.id); return [id, {id, name: item.name, phone: item.phone, examYear: item.exam_year, studyDays: item.study_days, avatarColor: item.avatar_color, avatarUrl: item.avatar_url}]; }));
  const subjects = await infrastructure.query<any>('select id, name, color, question_type, chapters from subjects order by id');
  if (subjects) {
    store.subjects = subjects.rows.map(item => ({
      id: item.id, name: item.name, color: item.color, questionCount: 0,
      questionType: item.question_type, chapters: Array.isArray(item.chapters) ? item.chapters : [],
    }));
    adminSubjectCatalog.splice(0, adminSubjectCatalog.length, ...store.subjects.map(subject => ({
      ...subject, questionType: subject.questionType ?? 'both' as const, chapters: subject.chapters ?? [],
    })));
  }
  const restrictions = await infrastructure.query<{user_id: string; restriction_type: 'login' | 'community'; reason: string; expires_at?: string; created_at: string; lifted_at?: string}>('select user_id, restriction_type, reason, expires_at, created_at, lifted_at from user_restrictions where lifted_at is null');
  if (restrictions) store.userRestrictions = new Map(restrictions.rows.map(item => [internalUserId(item.user_id), {type: item.restriction_type, reason: item.reason, expiresAt: item.expires_at ? new Date(item.expires_at).toISOString() : undefined, createdAt: new Date(item.created_at).toISOString()}]));
  const userSettings = await infrastructure.query<{user_id: string; learning_reminders: boolean; course_updates: boolean; order_notifications: boolean; updated_at: string}>('select user_id, learning_reminders, course_updates, order_notifications, updated_at from user_settings');
  if (userSettings) {
    store.userSettings = new Map(userSettings.rows.map(item => {
      const userId = internalUserId(item.user_id);
      return [userId, {userId, learningReminders: item.learning_reminders, courseUpdates: item.course_updates, orderNotifications: item.order_notifications, updatedAt: new Date(item.updated_at).toISOString()}];
    }));
  }
  const courses = await infrastructure.query<any>('select id, title, teacher, type, progress, lessons, accent, status, product_id, is_hot, hot_sort_order, updated_at from courses order by id');
  if (courses) store.courses = courses.rows.map(item => ({...item, ...(item.product_id ? {productId: item.product_id} : {}), isHot: Boolean(item.is_hot), hotSortOrder: Number(item.hot_sort_order ?? 0), updatedAt: new Date(item.updated_at).toISOString()}));
  const courseSections = await infrastructure.query<{id: string; course_id: string; title: string; sort_order: number; updated_at: string}>('select id, course_id, title, sort_order, updated_at from course_sections order by course_id, sort_order');
  if (courseSections) store.courseSections = courseSections.rows.map(item => ({id: item.id, courseId: item.course_id, title: item.title, sortOrder: item.sort_order, updatedAt: new Date(item.updated_at).toISOString()}));
  const courseLessons = await infrastructure.query<any>('select id, section_id, title, media_kind, media_reference, handout_reference, duration_seconds, trial_enabled, sort_order, material_category, material_kind, downloadable, article_content, updated_at from course_lessons order by section_id, sort_order');
  if (courseLessons) store.courseLessons = courseLessons.rows.map(item => ({id: item.id, sectionId: item.section_id, title: item.title, mediaKind: item.media_kind, mediaReference: item.media_reference, handoutReference: item.handout_reference, durationSeconds: item.duration_seconds, trialEnabled: item.trial_enabled, sortOrder: item.sort_order, materialCategory: item.material_category ?? undefined, materialKind: item.material_kind ?? undefined, downloadable: Boolean(item.downloadable), articleContent: item.article_content ?? undefined, updatedAt: new Date(item.updated_at).toISOString()}));
  const liveSessions = await infrastructure.query<{id: string; course_id: string; lesson_id?: string; title: string; teacher: string; starts_at: string; ends_at: string; provider?: 'polyv'|'tencent'; provider_room_id?: string; recording_video_id?: string; play_url?: string; recording_url?: string; status: 'scheduled' | 'live' | 'completed' | 'cancelled'; notification_status: 'not_required' | 'sent' | 'unavailable' | 'failed'; updated_at: string}>('select id, course_id, lesson_id, title, teacher, starts_at, ends_at, provider, provider_room_id, recording_video_id, play_url, recording_url, status, notification_status, updated_at from live_sessions order by starts_at desc');
  if (liveSessions) store.liveSessions = liveSessions.rows.map(item => ({id: item.id, courseId: item.course_id, lessonId: item.lesson_id, title: item.title, teacher: item.teacher, startsAt: new Date(item.starts_at).toISOString(), endsAt: new Date(item.ends_at).toISOString(), provider: item.provider ?? 'tencent', providerRoomId: item.provider_room_id, recordingVideoId: item.recording_video_id, playUrl: item.play_url, recordingUrl: item.recording_url, status: item.status, notificationStatus: item.notification_status, updatedAt: new Date(item.updated_at).toISOString()}));
  const progress = await infrastructure.query<{user_id: string; course_id: string; progress: number; updated_at: string}>('select user_id, course_id, progress::float, updated_at from user_course_progress');
  if (progress) store.courseProgress = progress.rows.map(item => ({userId: item.user_id === DEMO_DB_USER_ID ? 'u-demo' : item.user_id, courseId: item.course_id, progress: item.progress, updatedAt: new Date(item.updated_at).toISOString()}));
  const products = await infrastructure.query<{id: string; name: string; category: string; price: number; original_price: number; sold: number; accent: string; benefits: string[]; status?: Product['status']; updated_at?: string}>('select id, name, category, price::float, original_price::float, sold, accent, benefits, status, updated_at from products order by id');
  if (products) store.products = products.rows.map(item => ({id: item.id, name: item.name, category: item.category, price: Number(item.price), originalPrice: Number(item.original_price), sold: Number(item.sold), accent: item.accent, benefits: Array.isArray(item.benefits) ? item.benefits.map(String) : [], ...(item.status ? {status: item.status} : {}), ...(item.updated_at ? {updatedAt: new Date(item.updated_at).toISOString()} : {})}));
  const priceHistoryRows = await infrastructure.query<any>('select id, product_id, price::float, reason, created_by, created_at from product_price_history order by created_at desc');
  if (priceHistoryRows) {
    adminProductPriceHistory.push(...priceHistoryRows.rows.map((item: any) => ({id: item.id, productId: item.product_id, price: Number(item.price), reason: item.reason, createdBy: item.created_by ?? undefined, createdAt: new Date(item.created_at).toISOString()})));
  }
  const skus = await infrastructure.query<any>('select id, product_id, name, price::float, stock, status, attributes, updated_at from product_skus order by product_id, id');
  if (skus) {
    store.productSkus = skus.rows.map((item: any) => ({id: item.id, productId: item.product_id, name: item.name, price: Number(item.price), stock: Number(item.stock), status: item.status, attributes: item.attributes && typeof item.attributes === 'object' ? item.attributes : {}, updatedAt: new Date(item.updated_at).toISOString()}));
    const byProduct = new Map<string, ProductSku[]>();
    for (const sku of store.productSkus) byProduct.set(sku.productId, [...(byProduct.get(sku.productId) ?? []), sku]);
    store.products = store.products.map(product => ({...product, skus: byProduct.get(product.id) ?? product.skus}));
  }
  const coupons = await infrastructure.query<any>('select code, discount_type, discount_value::float, min_amount::float, max_discount::float, starts_at, ends_at, usage_limit, used_count, status from coupons order by code');
  if (coupons) store.coupons = coupons.rows.map((item: any) => ({code: item.code, type: item.discount_type, value: Number(item.discount_value), minAmount: Number(item.min_amount), maxDiscount: item.max_discount === null || item.max_discount === undefined ? undefined : Number(item.max_discount), startsAt: new Date(item.starts_at).toISOString(), endsAt: new Date(item.ends_at).toISOString(), usageLimit: item.usage_limit === null || item.usage_limit === undefined ? undefined : Number(item.usage_limit), usedCount: Number(item.used_count), status: item.status}));
  const orders = await infrastructure.query<any>('select o.id, o.user_id, o.product_id, o.amount::float, o.status, o.client_request_id, o.sku_id, o.coupon_code, o.discount_amount::float, o.expires_at, o.paid_at, o.closed_at, o.refunded_at, o.created_at, p.name as product_name from orders o join products p on p.id = o.product_id order by o.created_at desc');
  if (orders) store.orders = orders.rows.map((item: any) => ({id: item.id, userId: item.user_id === DEMO_DB_USER_ID ? 'u-demo' : item.user_id, productId: item.product_id, productName: item.product_name, amount: Number(item.amount), status: item.status, createdAt: new Date(item.created_at).toISOString(), ...(item.client_request_id ? {clientRequestId: item.client_request_id} : {}), ...(item.sku_id ? {skuId: item.sku_id} : {}), ...(item.coupon_code ? {couponCode: item.coupon_code} : {}), ...(item.discount_amount ? {discountAmount: Number(item.discount_amount)} : {}), ...(item.expires_at ? {expiresAt: new Date(item.expires_at).toISOString()} : {}), ...(item.paid_at ? {paidAt: new Date(item.paid_at).toISOString()} : {}), ...(item.closed_at ? {closedAt: new Date(item.closed_at).toISOString()} : {}), ...(item.refunded_at ? {refundedAt: new Date(item.refunded_at).toISOString()} : {})}));
  const orderEvents = await infrastructure.query<any>('select id, order_id, event_type, payload, created_at from order_events order by created_at desc');
  if (orderEvents) store.orderEvents = orderEvents.rows.map((item: any) => ({id: item.id, orderId: item.order_id, type: item.event_type, actor: item.payload?.actor ?? 'system', metadata: item.payload && typeof item.payload === 'object' ? Object.fromEntries(Object.entries(item.payload).filter(([key]) => key !== 'actor')) : {}, createdAt: new Date(item.created_at).toISOString()}));
  const refundRows = await infrastructure.query<any>('select id, order_id, user_id, reason, review_reason, amount::float, status, reviewed_by, reviewed_at, first_reviewed_by, first_reviewed_at, second_reviewed_by, second_reviewed_at, created_at from refund_requests order by created_at desc');
  if (refundRows) store.refunds = refundRows.rows.map((item: any) => ({
    id: item.id,
    orderId: item.order_id,
    userId: item.user_id ? internalUserId(item.user_id) : undefined,
    reason: item.reason,
    amount: Number(item.amount),
    status: item.status,
    createdAt: new Date(item.created_at).toISOString(),
    reviewReason: item.review_reason ?? undefined,
    reviewedBy: item.reviewed_by ?? undefined,
    reviewedAt: item.reviewed_at ? new Date(item.reviewed_at).toISOString() : undefined,
    firstReviewedBy: item.first_reviewed_by ?? undefined,
    firstReviewedAt: item.first_reviewed_at ? new Date(item.first_reviewed_at).toISOString() : undefined,
    secondReviewedBy: item.second_reviewed_by ?? undefined,
    secondReviewedAt: item.second_reviewed_at ? new Date(item.second_reviewed_at).toISOString() : undefined,
  }));
  const plans = await infrastructure.query<any>('select id, user_id, title, daily_minutes, start_date, end_date, status, class_type_id, stage_id, auto_generated, version, change_reason, generated_through, content_cursor, content_offset_minutes, early_unlocked_through, updated_at, paused_at, paused_until, pause_reason from learning_plans order by created_at desc');
  if (plans) store.learningPlans = plans.rows.map((item: any) => ({id: item.id, userId: item.user_id === DEMO_DB_USER_ID ? 'u-demo' : item.user_id, title: item.title, dailyMinutes: Number(item.daily_minutes), startDate: dateOnly(String(item.start_date)), endDate: dateOnly(String(item.end_date)), status: item.status, version: Number(item.version ?? 1), ...(item.change_reason ? {changeReason: item.change_reason} : {}), ...(item.generated_through ? {generatedThrough: dateOnly(String(item.generated_through))} : {}), ...(item.content_cursor !== undefined ? {contentCursor: Number(item.content_cursor ?? 0)} : {}), ...(item.content_offset_minutes !== undefined ? {contentOffsetMinutes: Number(item.content_offset_minutes ?? 0)} : {}), ...(item.early_unlocked_through ? {earlyUnlockedThrough: dateOnly(String(item.early_unlocked_through))} : {}), ...(item.updated_at ? {updatedAt: new Date(item.updated_at).toISOString()} : {}), ...(item.paused_at ? {pausedAt: new Date(item.paused_at).toISOString()} : {}), ...(item.paused_until ? {pausedUntil: dateOnly(String(item.paused_until))} : {}), ...(item.pause_reason ? {pauseReason: item.pause_reason} : {}), ...(item.class_type_id ? {classTypeId: item.class_type_id} : {}), ...(item.stage_id ? {stageId: item.stage_id} : {}), ...(item.auto_generated ? {autoGenerated: true} : {})}));
  const earlyAccess = await infrastructure.query<any>('select id, user_id, plan_id, requested_through, status, reason, reviewed_by, reviewed_at, created_at from learning_early_access_requests order by created_at desc');
  if (earlyAccess) store.learningEarlyAccessRequests = earlyAccess.rows.map((item: any) => ({id: item.id, userId: internalUserId(item.user_id), planId: item.plan_id, requestedThrough: dateOnly(String(item.requested_through)), status: item.status, ...(item.reason ? {reason: item.reason} : {}), ...(item.reviewed_by ? {reviewedBy: item.reviewed_by} : {}), ...(item.reviewed_at ? {reviewedAt: new Date(item.reviewed_at).toISOString()} : {}), createdAt: new Date(item.created_at).toISOString()}));
  const planVersions = await infrastructure.query<any>('select id, plan_id, version, reason, source, snapshot, created_by, created_at from learning_plan_versions order by created_at desc');
  if (planVersions) store.learningPlanVersions = planVersions.rows.map((item: any) => ({id: item.id, planId: item.plan_id, version: Number(item.version), reason: item.reason, source: item.source, snapshot: item.snapshot, ...(item.created_by ? {createdBy: item.created_by} : {}), createdAt: new Date(item.created_at).toISOString()}));
  const diagnosticForms = await infrastructure.query<any>('select * from learning_diagnostic_forms order by created_at');
  if (diagnosticForms) store.learningDiagnosticForms = diagnosticForms.rows.map((row: any) => ({id: row.id, title: row.title, subtitle: row.subtitle ?? undefined, description: row.description ?? undefined, estimatedMinutes: Number(row.estimated_minutes), submitLabel: row.submit_label, successTitle: row.success_title, successDescription: row.success_description, status: row.status, version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined}));
  const diagnosticDimensions = await infrastructure.query<any>('select * from learning_diagnostic_dimensions order by sort_order, code');
  if (diagnosticDimensions) store.learningDiagnosticDimensions = diagnosticDimensions.rows.map((row: any) => ({code: row.code, label: row.label, description: row.description ?? undefined, color: row.color ?? undefined, sortOrder: Number(row.sort_order), status: row.status, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()}));
  const diagnosticQuestions = await infrastructure.query<any>(`select q.*, coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'score', o.score, 'sortOrder', o.sort_order) order by o.sort_order) filter (where o.id is not null), '[]') as options from learning_diagnostic_questions q left join learning_diagnostic_options o on o.question_id = q.id group by q.id order by q.sort_order, q.created_at`);
  if (diagnosticQuestions) store.learningDiagnosticQuestions = diagnosticQuestions.rows.map((row: any) => ({id: row.id, formId: row.form_id, stem: row.stem, description: row.description ?? undefined, section: row.section ?? undefined, placeholder: row.placeholder ?? undefined, validation: row.validation ?? undefined, type: row.question_type, dimension: row.dimension, required: row.required, sortOrder: Number(row.sort_order), status: row.status, version: Number(row.version), options: Array.isArray(row.options) ? row.options.map((option: any) => ({id: String(option.id), label: String(option.label), score: Number(option.score), sortOrder: Number(option.sortOrder)})) : [], createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined}));
  const diagnosticAttempts = await infrastructure.query<any>('select id, user_id, status, question_snapshot, answers, scores, started_at, submitted_at from learning_diagnostic_attempts order by submitted_at desc');
  if (diagnosticAttempts) store.learningDiagnosticAttempts = diagnosticAttempts.rows.map((row: any) => ({id: row.id, userId: internalUserId(row.user_id), status: row.status, questionSnapshot: row.question_snapshot ?? [], answers: row.answers ?? [], scores: row.scores ?? emptyLearningDiagnosticScores(), startedAt: new Date(row.started_at).toISOString(), submittedAt: new Date(row.submitted_at).toISOString()}));
  const learningQuestionTaxonomy = await infrastructure.query<any>('select * from learning_question_taxonomy_nodes order by category, node_type, sort_order, name, id');
  if (learningQuestionTaxonomy) store.learningQuestionTaxonomyNodes = learningQuestionTaxonomy.rows.map((row: any) => ({id: row.id, category: row.category, type: row.node_type, parentId: row.parent_id ?? undefined, code: row.code, name: row.name, sortOrder: Number(row.sort_order), status: row.status, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()}));
  const learningQuestionBank = await infrastructure.query<any>('select * from learning_question_bank_questions order by updated_at desc, id');
  if (learningQuestionBank) store.learningQuestionBankQuestions = learningQuestionBank.rows.map((row: any) => ({id: row.id, category: row.category, questionType: row.question_type, subject: row.subject, subjectId: row.subject_id, columnName: row.column_name, chapterId: row.chapter_id, knowledgePoint: row.knowledge_point, pointId: row.point_id, subKnowledgePoint: row.sub_knowledge_point ?? undefined, subPointId: row.subpoint_id ?? undefined, difficulty: Number(row.difficulty), stem: row.stem, options: Array.isArray(row.options) ? row.options : [], correctAnswers: Array.isArray(row.correct_answers) ? row.correct_answers.map(String) : [], analysis: row.analysis ?? '', explanationMediaVisible: row.explanation_media_visible !== false, explanationMediaType: row.explanation_media_type ?? undefined, explanationMediaReference: row.explanation_media_reference ?? undefined, caseMaterial: row.case_material ?? undefined, subQuestions: Array.isArray(row.sub_questions) ? row.sub_questions.map((item: any) => ({...item, score: Number(item.score)})) : [], estimatedMinutes: Number(row.estimated_minutes), source: row.source ?? undefined, sourceYear: row.source_year === null || row.source_year === undefined ? undefined : Number(row.source_year), usageScenes: Array.isArray(row.usage_scenes) ? row.usage_scenes : [], status: row.status, version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined}));
  const learningAssessmentPapers = await infrastructure.query<any>('select id,title,subject_id,question_ids,duration_minutes,status,created_at,updated_at from learning_assessment_papers order by updated_at desc');
  if (learningAssessmentPapers) store.learningAssessmentPapers = learningAssessmentPapers.rows.map((row: any) => ({id: row.id, title: row.title, subjectId: row.subject_id, questionIds: Array.isArray(row.question_ids) ? row.question_ids.map(String) : [], durationMinutes: Number(row.duration_minutes), status: row.status, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()}));
  const learningCards = await infrastructure.query<any>('select * from learning_cards order by sort_order, updated_at desc, id');
  if (learningCards) store.learningCards = learningCards.rows.map((row: any) => ({id: row.id, title: row.title, description: row.description ?? undefined, contentType: row.content_type, assets: Array.isArray(row.assets) ? row.assets : [], recallItems: Array.isArray(row.recall_items) ? row.recall_items : [], knowledgePointIds: Array.isArray(row.knowledge_point_ids) ? row.knowledge_point_ids.map(String) : [], sortOrder: Number(row.sort_order), status: row.status, version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined}));
  const learningClassTypes = await infrastructure.query<any>('select * from learning_class_types order by sort_order, id');
  if (learningClassTypes) store.learningClassTypes = learningClassTypes.rows.map((row: any) => ({id: row.id, code: row.code, name: row.name, productId: row.product_id ?? undefined, description: row.description ?? undefined, endDate: dateOnly(String(row.end_date ?? '2099-12-31')), sortOrder: Number(row.sort_order), status: row.status, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()}));
  const learningStages = await infrastructure.query<any>('select * from learning_stages order by sort_order, id');
  if (learningStages) store.learningStages = learningStages.rows.map((row: any) => ({id: row.id, classTypeId: row.class_type_id, code: row.code, name: row.name, description: row.description ?? undefined, conditions: Array.isArray(row.conditions) ? row.conditions : [], teacherIds: Array.isArray(row.teacher_ids) ? row.teacher_ids.map(String) : [], sortOrder: Number(row.sort_order), status: row.status, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()}));
  const learningTeachers = await infrastructure.query<any>('select * from learning_teachers order by stage_id, sort_order, id');
  if (learningTeachers) store.learningTeachers = learningTeachers.rows.map((row: any) => ({id: row.id, ...(row.stage_id ? {stageId: row.stage_id} : {}), name: row.name, subject: row.subject, specialty: row.specialty, sortOrder: Number(row.sort_order), status: row.status, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()}));
  const stagePlanConfigs = await infrastructure.query<any>('select stage_id, total_minutes, daily_minutes, min_daily_minutes, max_daily_minutes, weekday_min_minutes, weekday_max_minutes, weekend_min_minutes, weekend_max_minutes, holiday_min_minutes, holiday_max_minutes, holiday_dates, study_days, duration_days, makeup_policy, card_unlock_rule, question_push_count, question_selection_strategy, status, version, published_at, published_snapshot, updated_at from learning_stage_plan_configs');
  if (stagePlanConfigs) store.learningStagePlanConfigs = stagePlanConfigs.rows.map((row: any) => ({stageId: row.stage_id, totalMinutes: Number(row.total_minutes ?? 0), dailyMinutes: Number(row.daily_minutes), minDailyMinutes: Number(row.min_daily_minutes ?? 30), maxDailyMinutes: Number(row.max_daily_minutes ?? row.daily_minutes ?? 180), weekdayMinMinutes: Number(row.weekday_min_minutes ?? row.min_daily_minutes ?? 30), weekdayMaxMinutes: Number(row.weekday_max_minutes ?? row.max_daily_minutes ?? 180), weekendMinMinutes: Number(row.weekend_min_minutes ?? row.min_daily_minutes ?? 60), weekendMaxMinutes: Number(row.weekend_max_minutes ?? row.max_daily_minutes ?? 240), holidayMinMinutes: Number(row.holiday_min_minutes ?? row.min_daily_minutes ?? 60), holidayMaxMinutes: Number(row.holiday_max_minutes ?? row.max_daily_minutes ?? 180), holidayDates: Array.isArray(row.holiday_dates) ? row.holiday_dates.map(String) : [], studyDays: Array.isArray(row.study_days) ? row.study_days.map(Number) : [1, 2, 3, 4, 5, 6, 0], durationDays: Number(row.duration_days), makeupPolicy: row.makeup_policy, cardUnlockRule: row.card_unlock_rule ?? 'after_course_checkin', questionPushCount: Number(row.question_push_count ?? 5), questionSelectionStrategy: row.question_selection_strategy ?? 'profile', status: row.status === 'draft' ? 'draft' : 'published', version: Number(row.version ?? 1), ...(row.published_at ? {publishedAt: new Date(row.published_at).toISOString()} : {}), ...(row.published_snapshot ? {publishedSnapshot: row.published_snapshot} : {}), updatedAt: new Date(row.updated_at).toISOString()}));
  const stagePlanItems = await infrastructure.query<any>('select id, stage_id, content_type, content_id, knowledge_point_ids, title, description, minutes, week_day, question_count, sort_order, required from learning_stage_plan_items order by stage_id, sort_order, id');
  if (stagePlanItems) store.learningStagePlanItems = stagePlanItems.rows.map((row: any) => ({id: row.id, stageId: row.stage_id, contentType: row.content_type, ...(row.content_id ? {contentId: row.content_id} : {}), knowledgePointIds: Array.isArray(row.knowledge_point_ids) ? row.knowledge_point_ids.map(String) : [], title: row.title, ...(row.description ? {description: row.description} : {}), minutes: Number(row.minutes ?? 0), ...(row.week_day ? {weekDay: Number(row.week_day)} : {}), ...(row.question_count ? {questionCount: Number(row.question_count)} : {}), sortOrder: Number(row.sort_order), required: Boolean(row.required)}));
  const teacherAssignments = await infrastructure.query<any>('select * from learning_teacher_assignments order by created_at desc');
  if (teacherAssignments) store.learningTeacherAssignments = teacherAssignments.rows.map((row: any) => ({id: row.id, userId: internalUserId(row.user_id), attemptId: row.attempt_id, ...(row.class_type_id ? {classTypeId: row.class_type_id} : {}), stageId: row.stage_id ?? undefined, teacherId: row.teacher_id ?? undefined, scores: row.scores ?? {}, status: row.status, reason: row.reason ?? undefined, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()}));
  const questions = await infrastructure.query<{id: string; subject_id?: string; chapter_id?: string; point_id?: string; stem: string; options: string[]; answer: number; answer_indexes?: number[]; question_type?: NonNullable<Question['questionType']>; analysis: string; status?: Question['status']; version?: number; source?: string; updated_at?: string}>('select id, subject_id, chapter_id, point_id, stem, options, answer, answer_indexes, question_type, analysis, status, version, source, updated_at from questions where type = \'objective\' order by id');
  if (questions) {
    store.questions = questions.rows.map(item => ({
      id: item.id,
      ...(item.subject_id ? {subjectId: item.subject_id} : {}),
      ...(item.chapter_id ? {chapterId: item.chapter_id} : {}),
      ...(item.point_id ? {pointId: item.point_id} : {}),
      stem: item.stem,
      options: item.options,
      answer: item.answer,
      ...(Array.isArray(item.answer_indexes) && item.answer_indexes.length ? {answerIndexes: item.answer_indexes.map(Number)} : {}),
      ...(item.question_type ? {questionType: item.question_type} : {}),
      analysis: item.analysis,
      status: item.status,
      version: item.version,
      source: item.source,
      updatedAt: item.updated_at ? new Date(item.updated_at).toISOString() : undefined,
    }));
  }
  const drafts = await infrastructure.query<{user_id: string; question_id: string; answers: string[]; updated_at: string}>('select user_id, question_id, answers, updated_at from question_drafts order by updated_at desc');
  if (drafts) {
    store.drafts = new Map(drafts.rows.map(item => {
      const userId = internalUserId(item.user_id);
      const questionId = item.question_id;
      return [draftKey(userId, questionId), {userId, questionId, answers: Array.isArray(item.answers) ? item.answers.map(String) : [], updatedAt: new Date(item.updated_at).toISOString()}];
    }));
  }
  const papers = await infrastructure.query<{id: string; name: string; exam_year: string; volume: string; mode: string; duration_minutes: number; total_score: number; question_ids: string[]; product_id?: string; status: 'draft' | 'published' | 'archived'; version: number; updated_at: string}>('select id, name, exam_year, volume, mode, duration_minutes, total_score, question_ids, product_id, status, version, updated_at from content_papers order by updated_at desc');
  if (papers) store.papers = papers.rows.map(item => ({id: item.id, name: item.name, year: item.exam_year, volume: item.volume, mode: item.mode, durationMinutes: item.duration_minutes, totalScore: item.total_score, questionIds: item.question_ids ?? [], ...(item.product_id ? {productId: item.product_id} : {}), status: item.status, version: item.version, updatedAt: new Date(item.updated_at).toISOString()}));
  const importJobs = await infrastructure.query<any>('select id, filename, resource_type, question_kind, import_format, subject_id, chapter_id, point_id, status, success_count, warning_count, error_count, valid_records, errors, idempotency_key, created_at, completed_at from admin_import_jobs order by created_at desc');
  if (importJobs) {
    adminImports.splice(0, adminImports.length, ...importJobs.rows.map((item: any) => ({
      id: item.id,
      filename: item.filename,
      format: (['xlsx', 'csv', 'json'].includes(item.import_format) ? item.import_format : String(item.filename).split('.').pop()?.toLowerCase() === 'xlsx' ? 'xlsx' : String(item.filename).split('.').pop()?.toLowerCase() === 'csv' ? 'csv' : 'json') as AdminImportJob['format'],
      questionKind: (['objective', 'subjective'].includes(item.question_kind) ? item.question_kind : String(item.resource_type).startsWith('subjective') ? 'subjective' : 'objective') as AdminImportJob['questionKind'],
      subjectId: item.subject_id ?? '',
      chapterId: item.chapter_id ?? '',
      pointId: item.point_id ?? '',
      status: (item.status === 'completed' ? 'completed' : 'preflight') as AdminImportJob['status'],
      successCount: Number(item.success_count),
      warningCount: Number(item.warning_count),
      errorCount: Number(item.error_count),
      validRecords: Array.isArray(item.valid_records) ? item.valid_records : [],
      errors: Array.isArray(item.errors) ? item.errors : [],
      idempotencyKey: item.idempotency_key ?? `hydrated-${item.id}`,
      createdAt: new Date(item.created_at).toISOString(),
      completedAt: item.completed_at ? new Date(item.completed_at).toISOString() : undefined,
    })));
  }
  const submissions = await infrastructure.query<{id: string; user_id: string; question_id: string; answers: string[]; score: number; question_snapshot?: unknown; idempotency_key?: string; created_at: string}>('select id, user_id, question_id, answers, score::float, question_snapshot, idempotency_key, created_at from question_submissions order by created_at desc');
  if (submissions) store.submissions = submissions.rows.map(item => {
    const snapshot = storedQuestionSnapshot(item.question_snapshot);
    return {
      id: item.id,
      userId: item.user_id === DEMO_DB_USER_ID ? 'u-demo' : item.user_id,
      questionId: item.question_id,
      answers: Array.isArray(item.answers) ? item.answers.map(String) : [],
      correct: Number(item.score) > 0,
      createdAt: new Date(item.created_at).toISOString(),
      ...(snapshot ? {questionSnapshot: snapshot} : {}),
      ...(item.idempotency_key ? {idempotencyKey: item.idempotency_key} : {}),
    };
  });
  const objectiveSessionRows = await infrastructure.query<any>('select id, user_id, mode, title, subject_id, paper_id, learning_task_id, question_ids, questions_snapshot, answers, duration_seconds, started_at, expires_at, status, idempotency_key, create_idempotency_key, submission_idempotency_key, report_id, submitted_at, created_at, updated_at from objective_sessions order by created_at desc');
  if (objectiveSessionRows) {
    store.objectiveSessions = objectiveSessionRows.rows.map((row: any) => ({
      id: row.id,
      userId: internalUserId(row.user_id),
      mode: row.mode,
      title: row.title,
      subjectId: row.subject_id,
      paperId: row.paper_id,
      ...(row.learning_task_id ? {learningTaskId: row.learning_task_id} : {}),
      questionIds: row.question_ids ?? [],
      questions: row.questions_snapshot ?? [],
      answers: row.answers ?? [],
      durationSeconds: Number(row.duration_seconds),
      startedAt: new Date(row.started_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      status: row.status,
      ...(row.create_idempotency_key || row.idempotency_key ? {createIdempotencyKey: row.create_idempotency_key ?? row.idempotency_key} : {}),
      ...(row.submission_idempotency_key ? {submissionIdempotencyKey: row.submission_idempotency_key} : {}),
      reportId: row.report_id,
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }
  const objectiveReportRows = await infrastructure.query<any>('select id, session_id, user_id, mode, title, total, answered, correct, score, max_score, results, subject_stats, submitted_at from objective_reports order by submitted_at desc');
  if (objectiveReportRows) {
    store.objectiveReports = objectiveReportRows.rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      userId: internalUserId(row.user_id),
      mode: row.mode,
      title: row.title,
      total: Number(row.total),
      answered: Number(row.answered),
      correct: Number(row.correct),
      score: Number(row.score),
      maxScore: Number(row.max_score),
      results: row.results ?? [],
      subjectStats: row.subject_stats ?? [],
      submittedAt: new Date(row.submitted_at).toISOString(),
    }));
  }
  const tasks = await infrastructure.query<any>('select id, plan_id, title, description, due_date, minutes, status, completed_at, subject_id, content_type, content_id, prerequisite_task_id, card_recall from learning_tasks order by due_date, id');
  if (tasks) store.learningTasks = tasks.rows.map((item: any) => ({id: item.id, cardRecall: item.card_recall ?? undefined, planId: item.plan_id, title: item.title, ...(item.description ? {description: item.description} : {}), dueDate: dateOnly(String(item.due_date)), minutes: Number(item.minutes), status: item.status, ...(item.completed_at ? {completedAt: new Date(item.completed_at).toISOString()} : {}), ...(item.subject_id ? {subjectId: item.subject_id} : {}), ...(item.content_type ? {contentType: item.content_type} : {}), ...(item.content_id ? {contentId: item.content_id} : {}), ...(item.prerequisite_task_id ? {prerequisiteTaskId: item.prerequisite_task_id} : {})}));
  const learningSubjectiveSubmissions = await infrastructure.query<any>('select id, user_id, task_id, question_id, answers, submitted_at from learning_subjective_submissions order by submitted_at desc');
  if (learningSubjectiveSubmissions) store.learningSubjectiveSubmissions = learningSubjectiveSubmissions.rows.map((item: any) => ({id: item.id, userId: internalUserId(item.user_id), taskId: item.task_id, questionId: item.question_id, answers: Array.isArray(item.answers) ? item.answers : [], submittedAt: new Date(item.submitted_at).toISOString()}));
  const learningActivities = await infrastructure.query<any>('select id, user_id, kind, subject_id, course_id, task_id, question_id, duration_seconds, quantity, idempotency_key, occurred_at from learning_activities order by occurred_at desc');
  if (learningActivities) {
    store.learningActivities = learningActivities.rows.map((item: any) => ({id: item.id, userId: internalUserId(item.user_id), kind: item.kind, subjectId: item.subject_id ?? undefined, questionId: item.question_id ?? undefined, courseId: item.course_id ?? undefined, taskId: item.task_id ?? undefined, durationSeconds: Number(item.duration_seconds), quantity: Number(item.quantity), idempotencyKey: item.idempotency_key ?? undefined, occurredAt: new Date(item.occurred_at).toISOString()}));
    store.learningActivityKeys = new Set(store.learningActivities.filter(item => item.idempotencyKey).map(item => learningActivityKey(item.userId, item.idempotencyKey!)));
  }
  const favorites = await infrastructure.query<{user_id: string; question_id: string; created_at: string}>('select user_id, question_id, created_at from favorites order by created_at desc');
  if (favorites) store.favorites = favorites.rows.map(item => ({id: `favorite:${item.question_id}`, userId: item.user_id === DEMO_DB_USER_ID ? 'u-demo' : item.user_id, questionId: item.question_id, createdAt: new Date(item.created_at).toISOString()}));
  const mistakes = await infrastructure.query<{user_id: string; question_id: string; wrong_count: number; last_answer: string}>('select user_id, question_id, wrong_count, last_answer from mistakes where resolved_at is null');
  if (mistakes) store.mistakes = mistakes.rows.map(item => ({id: `mistake:${item.question_id}`, userId: item.user_id === DEMO_DB_USER_ID ? 'u-demo' : item.user_id, questionId: item.question_id, wrongCount: item.wrong_count, lastAnswer: item.last_answer ?? '', resolved: false}));
  const entitlements = await infrastructure.query<{user_id: string; course_id: string; source_order_id: string; expires_at?: string}>('select user_id, course_id, source_order_id, expires_at from course_entitlements');
  if (entitlements) store.entitlements = entitlements.rows.map(item => ({userId: item.user_id === DEMO_DB_USER_ID ? 'u-demo' : item.user_id, courseId: item.course_id, sourceOrderId: item.source_order_id, expiresAt: item.expires_at ? new Date(item.expires_at).toISOString() : undefined}));
  const grading = await infrastructure.query<{id: string; user_id: string; question_id?: string; file_url?: string; status: 'queued' | 'processing' | 'completed' | 'rejected'; score?: number; feedback?: string; assigned_admin_id?: string; claimed_at?: string; version: number; created_at: string}>('select id, user_id, question_id, file_url, status, score::float, feedback, assigned_admin_id, claimed_at, version, created_at from grading_submissions order by created_at desc');
  if (grading) store.grading = grading.rows.map(item => ({id: item.id, userId: item.user_id === DEMO_DB_USER_ID ? 'u-demo' : item.user_id, questionId: item.question_id, fileUrl: item.file_url, status: item.status, score: item.score, feedback: item.feedback, assignedAdminId: item.assigned_admin_id, claimedAt: item.claimed_at ? new Date(item.claimed_at).toISOString() : undefined, version: item.version, createdAt: new Date(item.created_at).toISOString()}));
  const rubricRows = await infrastructure.query<any>('select r.*, coalesce(jsonb_agg(jsonb_build_object(\'id\', p.id, \'title\', p.title, \'description\', p.description, \'maxScore\', p.max_score, \'sortOrder\', p.sort_order, \'keywords\', p.keywords, \'legalReferences\', p.legal_references) order by p.sort_order) filter (where p.id is not null), \'[]\') as points from grading_rubrics r left join grading_rubric_points p on p.rubric_id = r.id group by r.id order by r.updated_at desc');
  if (rubricRows) store.gradingRubrics = rubricRows.rows.map((row: any) => ({id: row.id, questionId: row.question_id, questionVersion: row.question_version, title: row.title, subjectId: row.subject_id, chapterId: row.chapter_id ?? undefined, pointId: row.point_id ?? undefined, caseMaterial: row.case_material, subQuestions: row.sub_questions, gradingBasis: row.grading_basis, totalScore: Number(row.total_score), suggestedMinutes: row.suggested_minutes, allowedAnswerTypes: row.allowed_answer_types, points: row.points ?? [], status: row.status, versionReason: row.version_reason, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined}));
  const gradingPaperRows = await infrastructure.query<any>('select id, title, subject_id, exam_year, total_score, question_ids, status, created_at, updated_at from grading_papers order by updated_at desc');
  if (gradingPaperRows) store.gradingPapers = gradingPaperRows.rows.map((row: any) => ({id: row.id, title: row.title, subjectId: row.subject_id, year: row.exam_year, totalScore: Number(row.total_score), questionIds: row.question_ids ?? [], status: row.status, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()}));
  const advancedSubmissions = await infrastructure.query<any>('select id, user_id, grading_paper_id, question_id, rubric_id, question_version, idempotency_key, answer_hash, answers_snapshot, status, ai_failure_reason, current_assignment_id, latest_report_id, created_at, updated_at from grading_submissions where rubric_id is not null order by created_at desc');
  if (advancedSubmissions) store.gradingSubmissions = advancedSubmissions.rows.map((row: any) => ({id: row.id, userId: internalUserId(row.user_id), paperId: row.grading_paper_id, questionId: row.question_id, rubricId: row.rubric_id, questionVersion: row.question_version, idempotencyKey: row.idempotency_key, answerHash: row.answer_hash, answers: row.answers_snapshot ?? [], status: row.status, aiFailureReason: row.ai_failure_reason, currentAssignmentId: row.current_assignment_id, latestReportId: row.latest_report_id, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()}));
  const assignmentRows = await infrastructure.query<any>('select id, submission_id, grader_id, status, claimed_at, due_at, submitted_at, return_reason, created_at from grading_assignments order by created_at desc');
  if (assignmentRows) store.gradingAssignments = assignmentRows.rows.map((row: any) => ({id: row.id, submissionId: row.submission_id, graderId: row.grader_id, status: row.status, claimedAt: row.claimed_at ? new Date(row.claimed_at).toISOString() : undefined, dueAt: row.due_at ? new Date(row.due_at).toISOString() : undefined, submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : undefined, returnReason: row.return_reason, createdAt: new Date(row.created_at).toISOString()}));
  const aiRunRows = await infrastructure.query<any>('select * from grading_ai_runs order by created_at desc');
  if (aiRunRows) store.gradingAiRuns = aiRunRows.rows.map((row: any) => ({id: row.id, submissionId: row.submission_id, provider: row.provider, model: row.model, status: row.status, suggestedScore: row.suggested_score === null ? undefined : Number(row.suggested_score), result: row.result, failureReason: row.failure_reason, inputTokens: row.input_tokens, outputTokens: row.output_tokens, costMinor: row.cost_minor, createdAt: new Date(row.created_at).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined}));
  const reviewRows = await infrastructure.query<any>('select * from grading_reviews order by created_at desc');
  if (reviewRows) store.gradingReviews = reviewRows.rows.map((row: any) => ({id: row.id, submissionId: row.submission_id, assignmentId: row.assignment_id, graderId: row.grader_id ?? undefined, reviewerType: row.reviewer_type ?? 'grader', reviewerAdminId: row.reviewer_admin_id ?? undefined, totalScore: Number(row.total_score), pointResults: row.point_results ?? [], answerAnnotations: row.answer_annotations ?? [], missedPointIds: row.missed_point_ids ?? [], feedback: row.feedback, improvementAdvice: row.improvement_advice, aiOverrideReason: row.ai_override_reason, status: row.status, createdAt: new Date(row.created_at).toISOString(), reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : undefined, reviewedBy: row.reviewed_by}));
  const reportRows = await infrastructure.query<any>('select * from grading_reports order by published_at desc');
  if (reportRows) store.gradingReports = reportRows.rows.map((row: any) => ({id: row.id, submissionId: row.submission_id, reviewId: row.review_id, version: row.version, totalScore: Number(row.total_score), maxScore: Number(row.max_score), answers: row.answers_snapshot ?? [], pointResults: row.point_results ?? [], answerAnnotations: row.answer_annotations ?? [], missedPointIds: row.missed_point_ids ?? [], feedback: row.feedback, improvementAdvice: row.improvement_advice, publishedBy: row.published_by, publishedAt: new Date(row.published_at).toISOString()}));
  const graderRows = await infrastructure.query<any>('select id, username, display_name, password_hash, status, subject_ids, created_at from grader_accounts order by created_at');
  if (graderRows) store.graderAccounts = graderRows.rows.map((row: any) => ({id: row.id, username: row.username, displayName: row.display_name, passwordHash: row.password_hash, status: row.status, subjectIds: row.subject_ids ?? [], createdAt: new Date(row.created_at).toISOString()}));
  const creditRows = await infrastructure.query<any>('select user_id, balance from grading_credit_accounts');
  if (creditRows) for (const row of creditRows.rows) store.gradingCredits.set(internalUserId(row.user_id), Number(row.balance));
  const legalDocuments = await infrastructure.query<{id: string; title: string; article: string; content: string; document_code?: string; source_url?: string; effective_from: string; effective_to?: string; status: 'draft' | 'published' | 'disabled'; version: number; updated_at: string}>('select id, title, article, content, document_code, source_url, effective_from, effective_to, status, version, updated_at from legal_documents order by updated_at desc');
  if (legalDocuments) store.legalDocuments = legalDocuments.rows.map(item => {
    const document = {id: item.id, title: item.title, article: item.article, content: item.content, documentCode: item.document_code, sourceUrl: item.source_url, effectiveFrom: item.effective_from, effectiveTo: item.effective_to, status: item.status, version: item.version, updatedAt: new Date(item.updated_at).toISOString()};
    return {...document, subjectId: legalSubjectId(document)};
  });
  const legalFavorites = await infrastructure.query<{id: string; user_id: string; legal_document_id: string; document_version: number; article: string; title: string; content: string; subject_id?: string; effective_from?: string; created_at: string}>('select id, user_id, legal_document_id, document_version, article, title, content, subject_id, effective_from, created_at from legal_favorites order by created_at desc');
  if (legalFavorites) store.legalFavorites = legalFavorites.rows.map(item => ({id: item.id, userId: internalUserId(item.user_id), legalDocumentId: item.legal_document_id, documentVersion: Number(item.document_version), article: item.article, title: item.title, content: item.content, subjectId: item.subject_id, effectiveFrom: item.effective_from, createdAt: new Date(item.created_at).toISOString()}));
  const appLegalDocuments = await infrastructure.query<{key: AppLegalDocument['key']; title: string; version: number; status: 'draft' | 'published' | 'disabled'; sections: unknown; updated_at: string}>('select key, title, version, status, sections, updated_at from app_legal_documents order by key');
  if (appLegalDocuments) {
    const hydrated = appLegalDocuments.rows.flatMap(item => {
      if (!appLegalKeys.has(item.key) || !Array.isArray(item.sections)) return [];
      const sections = item.sections.filter((section): section is {title: string; body: string} => Boolean(section && typeof section === 'object' && typeof (section as {title?: unknown}).title === 'string' && typeof (section as {body?: unknown}).body === 'string'));
      return [{key: item.key, title: item.title, version: Number(item.version), status: item.status, sections, updatedAt: new Date(item.updated_at).toISOString()}];
    });
    if (hydrated.length) store.appLegalDocuments = hydrated;
  }
  const announcements = await infrastructure.query<any>('select id, title, body, status, starts_at, ends_at, is_pinned, audience_type, audience_value, deep_link, published_at, withdrawn_at, withdrawal_reason, updated_at, created_at from announcements order by created_at desc');
  if (announcements) store.announcements = announcements.rows.map(item => ({
    id: item.id,
    title: item.title,
    body: item.body,
    status: ['draft', 'scheduled', 'published', 'withdrawn'].includes(item.status) ? item.status : 'draft',
    startsAt: item.starts_at ? new Date(item.starts_at).toISOString() : undefined,
    endsAt: item.ends_at ? new Date(item.ends_at).toISOString() : undefined,
    isPinned: item.is_pinned === true,
    audienceType: item.audience_type === 'exam_year' ? 'exam_year' : 'all',
    audienceValue: item.audience_value ?? undefined,
    deepLink: item.deep_link ?? undefined,
    publishedAt: item.published_at ? new Date(item.published_at).toISOString() : undefined,
    withdrawnAt: item.withdrawn_at ? new Date(item.withdrawn_at).toISOString() : undefined,
    withdrawalReason: item.withdrawal_reason ?? undefined,
    updatedAt: new Date(item.updated_at ?? item.created_at).toISOString(),
    createdAt: new Date(item.created_at).toISOString(),
  }));
  const receipts = await infrastructure.query<{user_id: string; notification_id: string; closed_at?: string}>('select user_id, notification_id, closed_at from user_notification_receipts');
  if (receipts) for (const item of receipts.rows) {
    const userId = item.user_id === DEMO_DB_USER_ID ? 'u-demo' : item.user_id;
    store.notificationReceipts.add(`${userId}:${item.notification_id}`);
    if (item.closed_at) store.notificationClosures.add(`${userId}:${item.notification_id}`);
  }
  const attachments = await infrastructure.query<any>('select id, user_id, filename, content_type, size_bytes, sha256, status, upload_token_hash, expires_at, completed_at, created_at from attachment_uploads order by created_at desc');
  if (attachments) store.attachmentUploads = attachments.rows.map((item: any) => ({id: item.id, userId: internalUserId(item.user_id), filename: item.filename, contentType: item.content_type, sizeBytes: Number(item.size_bytes), sha256: item.sha256 ?? undefined, status: item.status, uploadToken: `hydrated-${item.upload_token_hash}`, expiresAt: new Date(item.expires_at).toISOString(), completedAt: item.completed_at ? new Date(item.completed_at).toISOString() : undefined, createdAt: new Date(item.created_at).toISOString(), [ATTACHMENT_TOKEN_HASH]: String(item.upload_token_hash)}));
  const aiSessions = await infrastructure.query<any>('select id, user_id, title, client_request_id, created_at, updated_at, deleted_at from ai_sessions where deleted_at is null order by updated_at desc');
  if (aiSessions) {
    store.aiSessions = aiSessions.rows.map((item: any) => ({id: item.id, userId: internalUserId(item.user_id), title: item.title, clientRequestId: item.client_request_id ?? undefined, createdAt: new Date(item.created_at).toISOString(), updatedAt: new Date(item.updated_at).toISOString(), deletedAt: item.deleted_at ? new Date(item.deleted_at).toISOString() : undefined}));
    store.aiSessionRequestKeys = new Map(store.aiSessions.filter(item => item.clientRequestId).map(item => [`${item.userId}:${item.clientRequestId}`, item.id]));
  }
  const aiMessages = await infrastructure.query<any>('select id, session_id, role, content, client_request_id, created_at from ai_messages order by created_at');
  if (aiMessages) {
    store.aiMessages = aiMessages.rows.map((item: any) => ({id: item.id, sessionId: item.session_id, role: item.role, content: item.content, clientRequestId: item.client_request_id ?? undefined, createdAt: new Date(item.created_at).toISOString()}));
    store.aiMessageRequestKeys = new Map(store.aiMessages.filter(item => item.clientRequestId).map(item => [`${item.sessionId}:${item.clientRequestId}`, item.id]));
  }
  const aiQuotaRows = await infrastructure.query<any>('select user_id, daily_limit, monthly_limit, updated_by, updated_at from ai_quota_settings');
  if (aiQuotaRows) {
    store.aiQuotas = new Map(aiQuotaRows.rows.map((item: any) => {
      const userId = internalUserId(item.user_id);
      return [userId, {userId, dailyLimit: Number(item.daily_limit), monthlyLimit: Number(item.monthly_limit), updatedBy: item.updated_by ?? undefined, updatedAt: new Date(item.updated_at).toISOString()} satisfies AIQuota];
    }));
  }
  const aiUsageRows = await infrastructure.query<any>('select id, user_id, session_id, message_id, provider, model, feature, status, input_tokens, output_tokens, cost_minor::float, error_code, created_at from ai_usage_events order by created_at desc');
  if (aiUsageRows) {
    store.aiUsage = aiUsageRows.rows.map((item: any) => ({
      id: item.id,
      userId: item.user_id ? internalUserId(item.user_id) : undefined,
      sessionId: item.session_id ?? undefined,
      messageId: item.message_id ?? undefined,
      provider: item.provider,
      model: item.model ?? undefined,
      feature: item.feature,
      status: item.status,
      inputTokens: item.input_tokens === null || item.input_tokens === undefined ? undefined : Number(item.input_tokens),
      outputTokens: item.output_tokens === null || item.output_tokens === undefined ? undefined : Number(item.output_tokens),
      costMinor: item.cost_minor === null || item.cost_minor === undefined ? undefined : Number(item.cost_minor),
      errorCode: item.error_code ?? undefined,
      createdAt: new Date(item.created_at).toISOString(),
    } satisfies AIUsageEvent));
  }
  const aiRiskRows = await infrastructure.query<any>('select id, user_id, session_id, message_id, risk, reason, status, reviewed_by, reviewed_at, created_at from ai_risk_flags order by created_at desc');
  if (aiRiskRows) {
    store.aiRiskFlags = aiRiskRows.rows.map((item: any) => ({
      id: item.id,
      userId: item.user_id ? internalUserId(item.user_id) : undefined,
      sessionId: item.session_id ?? undefined,
      messageId: item.message_id ?? undefined,
      risk: item.risk,
      reason: item.reason,
      status: item.status,
      reviewedBy: item.reviewed_by ?? undefined,
      reviewedAt: item.reviewed_at ? new Date(item.reviewed_at).toISOString() : undefined,
      createdAt: new Date(item.created_at).toISOString(),
    } satisfies AIRiskFlag));
  }
  const banners = await infrastructure.query<{id: string; title: string; image_url: string; target: string; starts_at: string; ends_at?: string; position?: string; sort_order?: number; requires_login?: boolean}>('select id, title, image_url, target, starts_at, ends_at, position, sort_order, requires_login from banners order by sort_order asc, starts_at desc');
  if (banners) store.banners = banners.rows.map(item => ({id: item.id, title: item.title, imageUrl: item.image_url, target: item.target, startsAt: new Date(item.starts_at).toISOString(), endsAt: item.ends_at ? new Date(item.ends_at).toISOString() : undefined, position: item.position, sortOrder: Number(item.sort_order ?? 0), requiresLogin: Boolean(item.requires_login)}));
  const templateRows = await infrastructure.query<any>('select id, code, channel, title_template, body_template, status, updated_by, updated_at from notification_templates order by updated_at desc');
  if (templateRows) {
    // `adminPushJobs` is also used as the backwards-compatible in-memory
    // collection for templates and jobs.  Keep its public shape stable while
    // restoring durable rows after a process restart.
    for (const item of templateRows.rows) {
      adminPushJobs.push({id: item.id, resourceType: 'template', code: item.code, channel: item.channel, titleTemplate: item.title_template, bodyTemplate: item.body_template, status: item.status, updatedBy: item.updated_by ?? undefined, updatedAt: new Date(item.updated_at).toISOString()});
    }
  }
  const pushRows = await infrastructure.query<any>('select id, template_id, audience, status, scheduled_at, sent_count, failed_count, attempts, last_error, created_by, created_at, completed_at, updated_at from push_jobs order by created_at desc');
  if (pushRows) {
    for (const item of pushRows.rows) {
      adminPushJobs.push({id: item.id, resourceType: 'push_job', templateId: item.template_id ?? undefined, audience: item.audience && typeof item.audience === 'object' ? item.audience : {}, status: item.status, scheduledAt: item.scheduled_at ? new Date(item.scheduled_at).toISOString() : undefined, sentCount: Number(item.sent_count ?? 0), failedCount: Number(item.failed_count ?? 0), attempts: Number(item.attempts ?? 0), lastError: item.last_error ?? undefined, createdBy: item.created_by ?? undefined, createdAt: new Date(item.created_at).toISOString(), completedAt: item.completed_at ? new Date(item.completed_at).toISOString() : undefined, updatedAt: item.updated_at ? new Date(item.updated_at).toISOString() : undefined});
    }
  }
  const exportRows = await infrastructure.query<any>('select id, admin_user_id, resource_type, filters, status, file_url, expires_at, row_count, error_message, content_type, created_at, completed_at, updated_at from admin_export_jobs order by created_at desc');
  if (exportRows) {
    for (const item of exportRows.rows) {
      adminExportJobs.push({id: item.id, resourceType: item.resource_type, filters: item.filters && typeof item.filters === 'object' ? item.filters : {}, status: item.status, fileUrl: item.file_url ?? undefined, expiresAt: item.expires_at ? new Date(item.expires_at).toISOString() : undefined, rowCount: item.row_count === null || item.row_count === undefined ? undefined : Number(item.row_count), errorMessage: item.error_message ?? undefined, contentType: item.content_type ?? undefined, createdBy: item.admin_user_id, createdAt: new Date(item.created_at).toISOString(), completedAt: item.completed_at ? new Date(item.completed_at).toISOString() : undefined, updatedAt: item.updated_at ? new Date(item.updated_at).toISOString() : undefined});
    }
  }
  const devices = await infrastructure.query<{id: string; user_id: string; platform: 'android' | 'ios' | 'harmony'; name: string; push_token?: string; last_seen_at: string}>('select id, user_id, platform, name, push_token, last_seen_at from devices order by last_seen_at desc');
  if (devices) store.devices = devices.rows.map(item => ({id: item.id, userId: item.user_id === DEMO_DB_USER_ID ? 'u-demo' : item.user_id, platform: item.platform, name: item.name, pushToken: item.push_token, lastSeenAt: new Date(item.last_seen_at).toISOString()}));
  const forumPosts = await infrastructure.query<{id: string; user_id: string; user_name: string; category: ForumCategory; title: string; body: string; likes: number; status: 'published'; created_at: string; updated_at: string; deleted_at?: string}>('select p.id, p.user_id, coalesce(u.name, \'用户\') as user_name, p.category, p.title, p.body, p.likes, p.status, p.created_at, p.updated_at, p.deleted_at from forum_posts p left join users u on u.id = p.user_id order by p.created_at desc');
  if (forumPosts) store.forumPosts = forumPosts.rows.map(item => ({id: item.id, userId: internalUserId(item.user_id), userName: item.user_name, category: item.category, title: item.title, body: item.body, likes: item.likes, status: item.status, createdAt: new Date(item.created_at).toISOString(), updatedAt: new Date(item.updated_at).toISOString(), deletedAt: item.deleted_at ? new Date(item.deleted_at).toISOString() : undefined}));
  const forumComments = await infrastructure.query<{id: string; post_id: string; user_id: string; user_name: string; body: string; created_at: string; deleted_at?: string}>('select c.id, c.post_id, c.user_id, coalesce(u.name, \'用户\') as user_name, c.body, c.created_at, c.deleted_at from forum_comments c left join users u on u.id = c.user_id order by c.created_at');
  if (forumComments) store.forumComments = forumComments.rows.map(item => ({id: item.id, postId: item.post_id, userId: internalUserId(item.user_id), userName: item.user_name, body: item.body, createdAt: new Date(item.created_at).toISOString(), deletedAt: item.deleted_at ? new Date(item.deleted_at).toISOString() : undefined}));
  const forumLikes = await infrastructure.query<{post_id: string; user_id: string}>('select post_id, user_id from forum_post_likes');
  if (forumLikes) store.forumLikes = new Set(forumLikes.rows.map(item => forumRelationKey(item.post_id, internalUserId(item.user_id))));
  const forumFavorites = await infrastructure.query<{post_id: string; user_id: string}>('select post_id, user_id from forum_post_favorites');
  if (forumFavorites) store.forumFavorites = new Set(forumFavorites.rows.map(item => forumRelationKey(item.post_id, internalUserId(item.user_id))));
  const moderationRows = await infrastructure.query<any>('select id, target_type, target_id, action, reason, duration_seconds, created_by, created_at from community_moderation_actions order by created_at desc');
  if (moderationRows) {
    store.communityModerationActions = moderationRows.rows.map((item: any) => ({
      id: item.id,
      targetType: item.target_type,
      targetId: item.target_id,
      action: item.action,
      reason: item.reason,
      durationSeconds: item.duration_seconds === null || item.duration_seconds === undefined ? undefined : Number(item.duration_seconds),
      createdBy: item.created_by ?? undefined,
      createdAt: new Date(item.created_at).toISOString(),
    }));
  }
  const identities = await infrastructure.query<{user_id: string; provider: 'wechat'; provider_user_id: string; union_id?: string; nickname?: string; created_at: string}>('select user_id, provider, provider_user_id, union_id, nickname, created_at from user_identities');
  if (identities) store.identities = identities.rows.map(item => ({userId: internalUserId(item.user_id), provider: item.provider, providerUserId: item.provider_user_id, unionId: item.union_id, nickname: item.nickname, createdAt: new Date(item.created_at).toISOString()}));
  const challenges = await infrastructure.query<{phone: string; purpose: SmsPurpose; provider_message_id: string; request_ip?: string; device_id?: string; requested_at: string; expires_at: string; attempts: number; code_hash?: string; consumed_at?: string}>('select phone, purpose, provider_message_id, request_ip, device_id, requested_at, expires_at, attempts, code_hash, consumed_at from auth_verification_challenges where requested_at > now() - interval \'1 hour\' order by requested_at');
  if (challenges) store.verificationChallenges = challenges.rows.map(item => ({phone: item.phone, purpose: item.purpose, providerMessageId: item.provider_message_id, requestIp: item.request_ip, deviceId: item.device_id, requestedAt: new Date(item.requested_at).toISOString(), expiresAt: new Date(item.expires_at).toISOString(), attempts: item.attempts, codeHash: item.code_hash, consumedAt: item.consumed_at ? new Date(item.consumed_at).toISOString() : undefined}));
  const deletions = await infrastructure.query<{user_id: string; requested_at: string; execute_after: string; cancelled_at?: string; completed_at?: string}>('select user_id, requested_at, execute_after, cancelled_at, completed_at from account_deletion_requests order by requested_at desc');
  if (deletions) store.deletionRequests = new Map(deletions.rows.map(item => { const userId = internalUserId(item.user_id); return [userId, {userId, requestedAt: new Date(item.requested_at).toISOString(), executeAfter: new Date(item.execute_after).toISOString(), cancelledAt: item.cancelled_at ? new Date(item.cancelled_at).toISOString() : undefined, completedAt: item.completed_at ? new Date(item.completed_at).toISOString() : undefined}]; }));
  if (process.env.DEBAO_TEST_FIXTURES === 'true') restoreDevelopmentGradingShowcase(store);
  await processDueAccountDeletions();
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

function adapterFailure(name: string, error: unknown) {
  const detail = error instanceof Error ? error.message : 'provider request failed';
  return new HttpError(503, 'ADAPTER_UNAVAILABLE', `${name} 服务暂时不可用`, {provider: name, reason: detail});
}

function send(res: ServerResponse, status: number, body: unknown, requestId: string) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...((res as ServerResponse & {debaoHeaders?: Record<string, string>}).debaoHeaders ?? {})});
  res.end(JSON.stringify(status >= 400 ? {error: {...body as object, requestId}} : {data: body, requestId}));
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体不能超过 2MB'); }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', '请求体必须是 JSON 对象');
  }
}

function accessToken(req: IncomingMessage) {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '');
}

function optionalUserId(req: IncomingMessage): string {
  return accessToken(req) ? requireAuth(req) : '';
}

async function configuredExam() {
  const result = await infrastructure.query<{setting_value: string}>(
    'select setting_value from admin_system_settings where setting_key = $1',
    ['exam_date'],
  );
  const date = result?.rows[0]?.setting_value;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const deadline = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(deadline)) return null;
  return {year: date.slice(0, 4), daysRemaining: Math.max(0, Math.ceil((deadline - Date.now()) / 86400000))};
}

async function adminSettingsView() {
  const row = await infrastructure.query<{setting_value: string}>(
    'select setting_value from admin_system_settings where setting_key=$1', ['exam_date']);
  const examDate = row?.rows[0]?.setting_value ?? '';
  const flagRows = await infrastructure.query<{setting_key: string; setting_value: string}>('select setting_key, setting_value from admin_system_settings where setting_key like $1', ['feature.%']);
  const stored = Object.fromEntries((flagRows?.rows ?? []).map(item => [item.setting_key.slice('feature.'.length), item.setting_value === 'true']));
  return {examYear: examDate.slice(0, 4), examDate, refundReviewThreshold: adminRefundDualReviewThreshold,
    featureFlags: {objectiveBank: stored.objectiveBank !== false, objectiveExam: stored.objectiveExam !== false, studyMaterials: stored.studyMaterials !== false, hotCourses: stored.hotCourses !== false, ai: aiAdapter.name === 'http', forum: true}};
}

async function persistSubject(subject: typeof adminSubjectCatalog[number]) {
  await persist(
    'insert into subjects (id,name,color,question_count,question_type,chapters) values ($1,$2,$3,0,$4,$5::jsonb) on conflict (id) do update set name=excluded.name,question_type=excluded.question_type,chapters=excluded.chapters',
    [subject.id, subject.name, subject.color, subject.questionType, JSON.stringify(subject.chapters)]);
  const current = store.subjects.find(item => item.id === subject.id);
  if (current) Object.assign(current, subject);
  else store.subjects.push(subject);
}

type AdminAccount = {id: string; username: string; displayName: string; role: string; permissions: string[]; passwordHash?: string; mfaEnabled?: boolean; mfaSecret?: string};
type AdminSession = {adminId: string; username: string; displayName: string; role: string; permissions: string[]; csrfToken: string; expiresAt: string; revokedAt?: string};
const adminSessions = new Map<string, AdminSession>();
const adminMfaChallenges = new Map<string, {account: AdminAccount; expiresAt: number; enrollmentSecret?: string}>();
let developmentAdminMfaSecret = config.adminMfaSecret;
let adminId = '00000000-0000-0000-0000-000000000099';
let learningAdminId = '00000000-0000-0000-0000-000000000402';
let gradingAdminId = '00000000-0000-0000-0000-000000000401';
const adminPermissions = ['*'];
const adminCookie = 'debao_admin_session';
const adminRoleCatalog = [
  {id: 'role-super-admin', code: 'super_admin', name: '超级管理员', permissions: ['*']},
  {id: 'role-content', code: 'content_editor', name: '内容编辑', permissions: ['dashboard.read', 'content.questions.read', 'content.questions.write', 'content.questions.publish', 'courses.read', 'courses.write', 'courses.publish']},
  {id: 'role-ops', code: 'operator', name: '运营人员', permissions: ['dashboard.read', 'users.read', 'users.write', 'users.restrict', 'users.sessions.revoke', 'entitlements.adjust', 'orders.read', 'products.read', 'products.write', 'refunds.read', 'refunds.approve', 'community.read', 'community.reports.resolve', 'community.moderate', 'operations.read', 'operations.announcements.write', 'operations.push.test', 'operations.push.write', 'ai.read', 'ai.quotas.read', 'ai.providers.read', 'ai.flags.read', 'ai.flags.review', 'ai.usage.read', 'analytics.read']},
];

// Development authentication intentionally uses configured local credentials
// instead of the production admin table. When a local PostgreSQL database is
// enabled, retain a durable actor row so audit-log foreign keys remain valid.
async function ensureDevelopmentAdminRecord() {
  if (config.nodeEnv === 'production') return;
  const existing = await infrastructure.query<{id: string}>('select id from admin_users where username = $1 limit 1', [config.adminUsername]);
  if (existing?.rows[0]?.id) {
    adminId = existing.rows[0].id;
  } else {
    const created = await infrastructure.query<{id: string}>('insert into admin_users (id, username, password_hash, display_name, status, mfa_enabled) values ($1, $2, $3, $4, $5, false) on conflict (id) do update set username = excluded.username, display_name = excluded.display_name, status = excluded.status returning id', [adminId, config.adminUsername, 'development-local-auth-only', '得宝管理员', 'active']);
    if (created?.rows[0]?.id) adminId = created.rows[0].id;
  }
  for (const account of [
    {id: learningAdminId, username: config.learningAdminUsername, name: '学习中心管理员', kind: 'learning'},
    {id: gradingAdminId, username: config.gradingAdminUsername, name: '批改管理员', kind: 'grading'},
  ]) {
    const found = await infrastructure.query<{id: string}>('select id from admin_users where username=$1 limit 1', [account.username]);
    let id = found?.rows[0]?.id;
    if (!id) {
      const saved = await infrastructure.query<{id: string}>('insert into admin_users (id,username,password_hash,display_name,status,mfa_enabled) values ($1,$2,$3,$4,$5,false) on conflict (id) do update set username=excluded.username returning id', [account.id, account.username, 'development-local-auth-only', account.name, 'active']);
      id = saved?.rows[0]?.id;
    }
    if (id && account.kind === 'learning') learningAdminId = id;
    if (id && account.kind === 'grading') gradingAdminId = id;
  }
}

async function storeBinaryBody(req: IncomingMessage, filePath: string, maxBytes: number): Promise<number> {
  const temporaryPath = `${filePath}.upload`;
  let file;
  let size = 0;
  try {
    file = await open(temporaryPath, 'wx');
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `讲解文件不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB`);
      await file.write(buffer);
    }
    if (!size) throw new HttpError(422, 'VALIDATION_ERROR', '请选择要上传的音频或视频文件');
    await file.close();
    file = undefined;
    await rename(temporaryPath, filePath);
    return size;
  } catch (error) {
    await file?.close().catch(() => undefined);
    await rm(temporaryPath, {force: true}).catch(() => undefined);
    throw error;
  }
}
// Refunds at or above this amount require two distinct administrators to
// review before a payment-provider call can be made. The value starts from
// deployment configuration and can be updated through the audited admin
// settings endpoint (and is restored from PostgreSQL on boot).
const DEFAULT_ADMIN_REFUND_DUAL_REVIEW_THRESHOLD = 1000;
let adminRefundDualReviewThreshold = config.refundReviewThreshold ?? DEFAULT_ADMIN_REFUND_DUAL_REVIEW_THRESHOLD;

function validRefundReviewThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000;
}

function normalizeRefundReviewThreshold(value: unknown) {
  const threshold = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!validRefundReviewThreshold(threshold)) throw new HttpError(422, 'VALIDATION_ERROR', '退款复核金额阈值必须是 0 到 1000000000 的有效数字');
  return threshold;
}

function refundNeedsDualReview(refund: Store['refunds'][number]) {
  return refund.amount >= adminRefundDualReviewThreshold;
}

function refundReviewStage(refund: Store['refunds'][number]) {
  if (!refundNeedsDualReview(refund)) return 'not_required' as const;
  if (refund.secondReviewedBy) return 'ready' as const;
  if (refund.firstReviewedBy) return 'first_reviewed' as const;
  return 'required' as const;
}

function publicRefund(refund: Store['refunds'][number]) {
  return {
    ...refund,
    dualReviewRequired: refundNeedsDualReview(refund),
    reviewStage: refundReviewStage(refund),
    readyForApproval: !refundNeedsDualReview(refund) || refundReviewStage(refund) === 'ready',
  };
}

/**
 * Record one review for a high-value refund.  Reviews are deliberately kept
 * separate from approval: the second reviewer only makes the request ready
 * and never invokes a payment provider.
 */
async function reviewAdminRefund(req: IncomingMessage, res: ServerResponse, refundId: string, requestId: string) {
  const admin = requireAdmin(req);
  const refund = store.refunds.find(item => item.id === refundId);
  if (!refund) throw new HttpError(404, 'NOT_FOUND', '退款申请不存在');
  if (refund.status === 'completed' || refund.status === 'rejected') throw new HttpError(409, 'REFUND_REVIEW_CLOSED', '退款申请已结束，不能继续复核');
  if (!refundNeedsDualReview(refund)) throw new HttpError(409, 'REFUND_DUAL_REVIEW_NOT_REQUIRED', '当前退款金额未达到双人复核阈值');
  const input = await body(req);
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 2 || reason.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', '复核原因长度必须为 2 到 500 个字符');
  if (refund.firstReviewedBy === admin.adminId || refund.secondReviewedBy === admin.adminId) {
    throw new HttpError(409, 'REFUND_REVIEW_DUPLICATE', '同一管理员不能重复复核该退款');
  }
  const now = new Date().toISOString();
  if (!refund.firstReviewedBy) {
    refund.firstReviewedBy = admin.adminId;
    refund.firstReviewedAt = now;
    refund.status = 'reviewing';
  } else if (!refund.secondReviewedBy) {
    refund.secondReviewedBy = admin.adminId;
    refund.secondReviewedAt = now;
    refund.status = 'reviewing';
  } else {
    throw new HttpError(409, 'REFUND_ALREADY_REVIEWED', '退款已完成双人复核');
  }
  await persist('update refund_requests set status = $1, first_reviewed_by = $2, first_reviewed_at = $3, second_reviewed_by = $4, second_reviewed_at = $5, updated_at = now() where id = $6', [refund.status, refund.firstReviewedBy ?? null, refund.firstReviewedAt ?? null, refund.secondReviewedBy ?? null, refund.secondReviewedAt ?? null, refund.id]);
  await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'refund.review', 'refund', refund.id, reason, requestId]);
  return send(res, 200, publicRefund(refund), requestId);
}

/** Approve a refund only after its required review stage is complete. */
async function approveAdminRefund(req: IncomingMessage, res: ServerResponse, refundId: string, requestId: string) {
  const admin = requireAdmin(req);
  const refund = store.refunds.find(item => item.id === refundId);
  if (!refund) throw new HttpError(404, 'NOT_FOUND', '退款申请不存在');
  if (refund.status === 'completed') return send(res, 200, publicRefund(refund), requestId);
  if (refund.status === 'rejected') throw new HttpError(409, 'REFUND_REVIEW_CLOSED', '退款申请已拒绝，不能再次通过');
  if (refundNeedsDualReview(refund) && (!refund.firstReviewedBy || !refund.secondReviewedBy || refund.firstReviewedBy === refund.secondReviewedBy)) {
    throw new HttpError(409, 'REFUND_DUAL_REVIEW_REQUIRED', '高金额退款必须由两位不同管理员完成复核后才能通过', {reviewStage: refundReviewStage(refund), threshold: adminRefundDualReviewThreshold});
  }
  if (paymentAdapter.name === 'unconfigured') throw adapterFailure('payment-refund', new Error('退款 Provider 未配置'));
  const now = new Date().toISOString();
  refund.status = 'completed';
  refund.reviewedAt = now;
  refund.reviewedBy = admin.adminId;
  const order = store.orders.find(item => item.id === refund.orderId);
  if (order) {
    order.status = 'refunded';
    order.refundedAt = now;
    await recordOrderEvent({id: `oe-${randomUUID()}`, orderId: order.id, type: 'refunded', actor: 'admin', metadata: {refundId: refund.id}, createdAt: now});
  }
  await persist('update refund_requests set status = $1, reviewed_by = $2, reviewed_at = $3, updated_at = now() where id = $4', ['completed', admin.adminId, now, refund.id]);
  await persist('update orders set status = $1, refunded_at = $2 where id = $3', ['refunded', now, refund.orderId]);
  await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'refund.approve', 'refund', refund.id, '后台审核通过', requestId]);
  return send(res, 200, publicRefund(refund), requestId);
}

async function rejectAdminRefund(req: IncomingMessage, res: ServerResponse, refundId: string, requestId: string) {
  const admin = requireAdmin(req);
  const refund = store.refunds.find(item => item.id === refundId);
  if (!refund) throw new HttpError(404, 'NOT_FOUND', '退款申请不存在');
  if (refund.status === 'completed') return send(res, 200, publicRefund(refund), requestId);
  if (refund.status === 'rejected') return send(res, 200, publicRefund(refund), requestId);
  const input = await body(req);
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 2 || reason.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', '拒绝原因长度必须为 2 到 500 个字符');
  const now = new Date().toISOString();
  refund.status = 'rejected';
  refund.reviewedAt = now;
  refund.reviewedBy = admin.adminId;
  refund.reviewReason = reason;
  const order = store.orders.find(item => item.id === refund.orderId);
  if (order && order.status === 'refund_requested') order.status = 'paid';
  await recordOrderEvent({id: `oe-${randomUUID()}`, orderId: refund.orderId, type: 'refund_rejected', actor: 'admin', metadata: {refundId: refund.id, reason}, createdAt: now});
  await persist('update refund_requests set status = $1, reviewed_by = $2, reviewed_at = $3, review_reason = $4, updated_at = now() where id = $5', ['rejected', admin.adminId, now, reason, refund.id]);
  await persist('update orders set status = $1 where id = $2 and status = $3', ['paid', refund.orderId, 'refund_requested']);
  await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'refund.reject', 'refund', refund.id, reason, requestId]);
  return send(res, 200, publicRefund(refund), requestId);
}
const adminQuestionHistory = new Map<string, Array<Record<string, unknown>>>();
const adminSubjectCatalog = store.subjects.map(subject => ({...subject, questionType: subject.questionType ?? 'both' as const, chapters: subject.chapters ?? [{id: `${subject.id}-objective-chapter-1`, name: '客观题基础理论', questionType: 'objective' as const, points: [{id: `${subject.id}-objective-point-1`, name: '客观题核心考点'}]}, {id: `${subject.id}-subjective-chapter-1`, name: '主观题案例分析', questionType: 'subjective' as const, points: [{id: `${subject.id}-subjective-point-1`, name: '主观题核心考点'}]}]}));
const adminProductPriceHistory: Array<{id: string; productId: string; price: number; reason: string; createdBy?: string; createdAt: string}> = [];
type ImportTaxonomy = {subjectId: string; chapterId: string; pointId: string};
type ObjectiveImportRecord = ImportTaxonomy & {kind: 'objective'; stem: string; options: string[]; answer: number; answerIndexes?: number[]; questionType: NonNullable<Question['questionType']>; analysis: string; source?: string};
type SubjectiveImportRecord = ImportTaxonomy & {kind: 'subjective'; title: string; caseMaterial: string; subQuestion: string; gradingBasis: string; totalScore: number; suggestedMinutes: number};
type AdminImportJob = {id: string; filename: string; format: 'xlsx' | 'json' | 'csv'; questionKind: 'objective' | 'subjective'; subjectId: string; chapterId: string; pointId: string; status: 'preflight' | 'completed'; successCount: number; warningCount: number; errorCount: number; errors: Array<{row: number; message: string}>; validRecords: Array<ObjectiveImportRecord | SubjectiveImportRecord>; idempotencyKey: string; createdAt: string; completedAt?: string};
const adminImports: AdminImportJob[] = [];
const adminPushJobs: Array<Record<string, unknown>> = [];
const adminExportJobs: Array<Record<string, unknown>> = [];
const adminCommunityRules: Array<Record<string, unknown>> = [{id: 'forum-default', name: '默认社区内容规则', status: 'active', action: 'review_and_restrict', keywords: []}];

type AdminPushJob = {
  id: string;
  resourceType: 'push_job';
  templateId?: string;
  audience: Record<string, unknown>;
  status: 'queued' | 'sending' | 'completed' | 'failed' | 'blocked_provider' | 'cancelled';
  scheduledAt?: string;
  sentCount: number;
  failedCount: number;
  attempts: number;
  lastError?: string;
  createdBy?: string;
  createdAt: string;
  completedAt?: string;
  updatedAt?: string;
  /** Runtime-only guard preventing duplicate processing in one process. */
  processing?: boolean;
};

type AdminExportJob = {
  id: string;
  resourceType: string;
  filters: Record<string, unknown>;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'expired';
  rowCount?: number;
  fileUrl?: string;
  contentType?: string;
  content?: string;
  errorMessage?: string;
  expiresAt?: string;
  createdBy?: string;
  createdAt: string;
  completedAt?: string;
  updatedAt?: string;
  processing?: boolean;
};

function pushJobRecord(value: Record<string, unknown>): AdminPushJob {
  return value as unknown as AdminPushJob;
}

function exportJobRecord(value: Record<string, unknown>): AdminExportJob {
  return value as unknown as AdminExportJob;
}

function publicPushJob(job: AdminPushJob) {
  const {processing: _processing, ...publicJob} = job;
  return publicJob;
}

function publicExportJob(job: AdminExportJob) {
  // CSV content is an implementation detail and must never be returned from
  // list/detail APIs.  It is only streamed by the authenticated download
  // endpoint below.
  const {content: _content, processing: _processing, ...publicJob} = job;
  return publicJob;
}

function moderationTargetFor(report: Store['communityReports'][number], input: Record<string, unknown>) {
  const requestedType = typeof input.targetType === 'string' ? input.targetType : undefined;
  const requestedId = typeof input.targetId === 'string' ? input.targetId.trim() : undefined;
  const targetType = requestedType ?? (report.commentId ? 'comment' : report.postId ? 'post' : undefined);
  const targetId = requestedId || (targetType === 'comment' ? report.commentId : targetType === 'post' ? report.postId : undefined);
  if (!targetType || !['post', 'comment', 'user'].includes(targetType) || !targetId) return undefined;
  return {targetType: targetType as Store['communityModerationActions'][number]['targetType'], targetId};
}

/** Apply a report decision and retain an immutable moderation action.  The
 * report route calls this only after validating the conclusion/reason, so a
 * malformed request cannot partially hide a post or comment. */
async function applyCommunityModeration(report: Store['communityReports'][number], input: Record<string, unknown>, adminId: string, requestId: string) {
  const action = String(input.action ?? 'none') as Store['communityModerationActions'][number]['action'];
  if (!['none', 'hide', 'delete', 'warn', 'restrict', 'ban'].includes(action)) throw new HttpError(422, 'VALIDATION_ERROR', '处罚动作不正确');
  const reason = String(input.reason ?? input.resolution ?? '').trim();
  if (reason.length < 2 || reason.length > 2000) throw new HttpError(422, 'VALIDATION_ERROR', '处理依据长度必须为 2 到 2000 个字符');
  const target = moderationTargetFor(report, input);
  if (action !== 'none' && !target) throw new HttpError(422, 'MODERATION_TARGET_REQUIRED', '处罚动作需要有效的帖子、评论或用户目标');
  const rawDuration = input.durationSeconds;
  const durationSeconds = rawDuration === undefined || rawDuration === null || rawDuration === '' ? undefined : Number(rawDuration);
  if (durationSeconds !== undefined && (!Number.isInteger(durationSeconds) || durationSeconds <= 0 || durationSeconds > 31_536_000)) throw new HttpError(422, 'VALIDATION_ERROR', '处罚时长必须是 1 到 31536000 秒的整数');
  if (action === 'restrict' && durationSeconds === undefined) throw new HttpError(422, 'DURATION_REQUIRED', '限时禁言必须提供 durationSeconds');
  if (['none', 'hide', 'delete', 'warn'].includes(action) && durationSeconds !== undefined) throw new HttpError(422, 'VALIDATION_ERROR', '当前处罚动作不支持 durationSeconds');

  let targetUserId: string | undefined;
  if (target?.targetType === 'post') {
    const post = store.forumPosts.find(item => item.id === target.targetId);
    if (!post) throw new HttpError(404, 'NOT_FOUND', '目标帖子不存在');
    targetUserId = post.userId;
    if (action === 'hide' || action === 'delete') {
      const now = new Date().toISOString();
      post.deletedAt = now;
      post.updatedAt = now;
      await persist('update forum_posts set deleted_at = $1, updated_at = $1 where id = $2 and deleted_at is null', [now, post.id]);
    }
  } else if (target?.targetType === 'comment') {
    const comment = store.forumComments.find(item => item.id === target.targetId);
    if (!comment) throw new HttpError(404, 'NOT_FOUND', '目标评论不存在');
    targetUserId = comment.userId;
    if (action === 'hide' || action === 'delete') {
      const now = new Date().toISOString();
      comment.deletedAt = now;
      await persist('update forum_comments set deleted_at = $1 where id = $2 and deleted_at is null', [now, comment.id]);
    }
  } else if (target?.targetType === 'user') {
    targetUserId = internalUserId(target.targetId);
    profileFor(targetUserId);
  }

  if (['warn', 'restrict', 'ban'].includes(action)) {
    if (!targetUserId) throw new HttpError(422, 'MODERATION_USER_REQUIRED', '警告或封禁动作需要关联用户');
    const expiresAt = action === 'restrict' && durationSeconds !== undefined ? new Date(Date.now() + durationSeconds * 1000).toISOString() : undefined;
    const restriction = {type: 'community' as const, reason, ...(expiresAt ? {expiresAt} : {}), createdAt: new Date().toISOString()};
    if (action !== 'warn') {
      store.userRestrictions.set(targetUserId, restriction);
      await persist('insert into user_restrictions (user_id, restriction_type, reason, expires_at, created_by) values ($1, $2, $3, $4, $5) on conflict (user_id) do update set restriction_type = excluded.restriction_type, reason = excluded.reason, expires_at = excluded.expires_at, lifted_at = null', [dbUserId(targetUserId), 'community', reason, expiresAt ?? null, adminId]);
    }
  }

  const createdAt = new Date().toISOString();
  const moderationAction: Store['communityModerationActions'][number] = {
    id: randomUUID(),
    targetType: target?.targetType ?? 'user',
    targetId: target?.targetId ?? (report.postId ?? report.commentId ?? report.id),
    action,
    reason,
    ...(durationSeconds !== undefined ? {durationSeconds} : {}),
    createdBy: adminId,
    createdAt,
  };
  store.communityModerationActions.unshift(moderationAction);
  await persist('insert into community_moderation_actions (id, target_type, target_id, action, reason, duration_seconds, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)', [moderationAction.id, moderationAction.targetType, moderationAction.targetId, moderationAction.action, moderationAction.reason, moderationAction.durationSeconds ?? null, adminId, createdAt]);
  await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [adminId, `community.report.${action}`, 'community_report', report.id, reason, requestId]);
  return moderationAction;
}

function interpolateTemplate(template: string, profile?: UserProfile) {
  if (!profile) return template;
  return template
    .replace(/\{\{\s*name\s*\}\}/g, profile.name)
    .replace(/\{\{\s*userId\s*\}\}/g, profile.id)
    .replace(/\{\{\s*examYear\s*\}\}/g, profile.examYear);
}

function audienceDevices(audience: Record<string, unknown>) {
  const requestedUserId = typeof audience.userId === 'string' ? audience.userId : undefined;
  const requestedUsers = Array.isArray(audience.userIds) ? new Set(audience.userIds.map(String)) : undefined;
  const platform = typeof audience.platform === 'string' ? audience.platform : undefined;
  const examYear = typeof audience.examYear === 'string' ? audience.examYear : undefined;
  return store.devices.filter(device => {
    if (!device.pushToken) return false;
    if (requestedUserId && device.userId !== requestedUserId) return false;
    if (requestedUsers && !requestedUsers.has(device.userId)) return false;
    if (platform && device.platform !== platform) return false;
    if (examYear && store.profiles.get(device.userId)?.examYear !== examYear) return false;
    return true;
  });
}

function templateForJob(job: AdminPushJob) {
  return adminPushJobs.find(item => item.resourceType === 'template' && item.id === job.templateId);
}

/** Process one queued push job.  The worker is deliberately explicit: when a
 * provider is unavailable jobs remain `blocked_provider`, and when a provider
 * call fails the job becomes retryable `failed` rather than claiming delivery.
 */
export async function processAdminPushJob(id: string) {
  const job = adminPushJobs.map(pushJobRecord).find(item => item.resourceType === 'push_job' && item.id === id);
  if (!job || job.processing || !['queued', 'failed'].includes(job.status)) return job;
  if (job.scheduledAt && Number.isFinite(Date.parse(job.scheduledAt)) && Date.parse(job.scheduledAt) > Date.now()) return job;
  if (pushAdapter.name === 'unconfigured') {
    job.status = 'blocked_provider';
    job.updatedAt = new Date().toISOString();
    await persist('update push_jobs set status = $1, updated_at = $2 where id = $3', [job.status, job.updatedAt, job.id]);
    return job;
  }
  const template = templateForJob(job);
  if (!template) {
    job.status = 'failed';
    job.lastError = 'notification template not found';
    job.updatedAt = new Date().toISOString();
    await persist('update push_jobs set status = $1, last_error = $2, updated_at = $3 where id = $4', [job.status, job.lastError, job.updatedAt, job.id]);
    return job;
  }
  job.processing = true;
  job.status = 'sending';
  job.attempts = (job.attempts ?? 0) + 1;
  job.updatedAt = new Date().toISOString();
  await persist('update push_jobs set status = $1, attempts = $2, updated_at = $3 where id = $4', [job.status, job.attempts, job.updatedAt, job.id]);
  const devices = audienceDevices(job.audience ?? {});
  let sentCount = 0;
  let failedCount = 0;
  let lastError: string | undefined;
  for (const device of devices) {
    try {
      const profile = store.profiles.get(device.userId);
      const result = await pushAdapter.send(device.pushToken!, interpolateTemplate(String(template.titleTemplate ?? ''), profile), interpolateTemplate(String(template.bodyTemplate ?? ''), profile));
      if (result.accepted) sentCount += 1;
      else { failedCount += 1; lastError = result.providerMessageId || 'provider rejected message'; }
    } catch (error) {
      failedCount += 1;
      lastError = error instanceof Error ? error.message : 'provider request failed';
    }
  }
  job.sentCount = (job.sentCount ?? 0) + sentCount;
  job.failedCount = (job.failedCount ?? 0) + failedCount;
  job.lastError = lastError;
  job.status = failedCount > 0 && sentCount === 0 ? 'failed' : 'completed';
  job.completedAt = new Date().toISOString();
  job.updatedAt = job.completedAt;
  job.processing = false;
  await persist('update push_jobs set status = $1, sent_count = $2, failed_count = $3, last_error = $4, completed_at = $5, updated_at = $6 where id = $7', [job.status, job.sentCount, job.failedCount, job.lastError ?? null, job.completedAt, job.updatedAt, job.id]);
  return job;
}

function exportRows(resourceType: string, filters: Record<string, unknown>) {
  const keyword = typeof filters.keyword === 'string' ? filters.keyword : undefined;
  switch (resourceType) {
    case 'analytics_overview':
      return [{users: store.profiles.size, courses: store.courses.length, questions: store.questions.length, orders: store.orders.length, forumPosts: store.forumPosts.length}];
    case 'users':
      return [...store.profiles.values()].filter(item => !keyword || item.id.includes(keyword) || item.name.includes(keyword)).map(item => ({id: item.id, name: item.name, phone: `${item.phone.slice(0, 3)}****${item.phone.slice(-4)}`, examYear: item.examYear, studyDays: item.studyDays}));
    case 'questions':
      return store.questions.filter(item => !keyword || item.id.includes(keyword) || item.stem.includes(keyword)).map(item => ({id: item.id, subjectId: item.subjectId, stem: item.stem, status: item.status, version: item.version, updatedAt: item.updatedAt}));
    case 'orders':
      return store.orders.filter(item => !keyword || item.id.includes(keyword) || item.productName.includes(keyword)).map(item => ({...item}));
    case 'learning_records':
      return store.submissions.map(item => ({...item, eventType: 'question_submission'}));
    case 'community_reports':
      return store.communityReports.map(item => ({...item}));
    case 'ai_usage':
      return store.aiUsage.map(item => ({...item}));
    default:
      throw new HttpError(422, 'VALIDATION_ERROR', '不支持的导出资源');
  }
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportContent(rows: Array<Record<string, unknown>>) {
  // Keep a UTF-8 BOM even for an empty result so the authenticated download
  // endpoint can distinguish a generated empty CSV from a job that is not
  // ready yet.
  if (!rows.length) return {content: '\uFEFF', contentType: 'text/csv; charset=utf-8'};
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const lines = [columns.map(csvCell).join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))];
  return {content: `\uFEFF${lines.join('\r\n')}`, contentType: 'text/csv; charset=utf-8'};
}

/** Run an export outside the request critical path and retain a short-lived
 * download token in memory.  Durable metadata is updated at every state
 * transition so a separate worker can resume queued jobs after a restart. */
export async function processAdminExportJob(id: string) {
  const job = adminExportJobs.map(exportJobRecord).find(item => item.id === id);
  if (!job || job.processing || !['queued', 'failed'].includes(job.status)) return job;
  job.processing = true;
  job.status = 'processing';
  job.updatedAt = new Date().toISOString();
  await persist('update admin_export_jobs set status = $1, updated_at = $2 where id = $3', [job.status, job.updatedAt, job.id]);
  try {
    const rows = exportRows(job.resourceType, job.filters ?? {});
    const rendered = exportContent(rows);
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    job.rowCount = rows.length;
    job.content = rendered.content;
    job.contentType = rendered.contentType;
    job.expiresAt = expiresAt;
    job.fileUrl = `/v1/admin/exports/${encodeURIComponent(job.id)}/download`;
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    await persist('update admin_export_jobs set status = $1, file_url = $2, expires_at = $3, row_count = $4, content_type = $5, error_message = null, completed_at = $6, updated_at = $7 where id = $8', [job.status, job.fileUrl, job.expiresAt, job.rowCount, job.contentType, job.completedAt, job.updatedAt, job.id]);
  } catch (error) {
    job.status = 'failed';
    job.errorMessage = error instanceof Error ? error.message : 'export worker failed';
    job.updatedAt = new Date().toISOString();
    await persist('update admin_export_jobs set status = $1, error_message = $2, updated_at = $3 where id = $4', [job.status, job.errorMessage, job.updatedAt, job.id]);
  } finally {
    job.processing = false;
  }
  return job;
}

async function expireAdminExportIfNeeded(job: AdminExportJob) {
  if (job.status !== 'completed' || !job.expiresAt || Date.parse(job.expiresAt) > Date.now()) return false;
  job.status = 'expired';
  job.content = undefined;
  job.updatedAt = new Date().toISOString();
  await persist('update admin_export_jobs set status = $1, updated_at = $2 where id = $3', [job.status, job.updatedAt, job.id]);
  return true;
}

/** Resume durable jobs that were queued before a process restart.  Callers may
 * run this from a timer/worker entrypoint; it is safe to invoke repeatedly. */
export async function processAdminWorkers() {
  const queuedPush = adminPushJobs.map(pushJobRecord).filter(item => item.resourceType === 'push_job' && ['queued', 'failed'].includes(item.status));
  const queuedExports = adminExportJobs.map(exportJobRecord).filter(item => ['queued', 'failed'].includes(item.status));
  for (const job of queuedPush) await processAdminPushJob(job.id);
  for (const job of queuedExports) await processAdminExportJob(job.id);
  return {push: queuedPush.length, exports: queuedExports.length};
}

function cookieValue(req: IncomingMessage, name: string) {
  const header = req.headers.cookie ?? '';
  const pair = header.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
}

function passwordHash(candidate: string) { return scryptSync(candidate, config.authSecret, 32).toString('base64'); }
function passwordMatches(candidate: string, storedHash?: string) {
  if (storedHash) { const expected = Buffer.from(storedHash, 'base64'); const actual = Buffer.from(passwordHash(candidate), 'base64'); return expected.length === actual.length && timingSafeEqual(expected, actual); }
  const expected = Buffer.from(scryptSync(config.adminPassword, config.authSecret, 32));
  const actual = Buffer.from(scryptSync(candidate, config.authSecret, 32));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function adminKey() { return createHash('sha256').update(config.authSecret).digest(); }
function encryptAdminSecret(secret: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', adminKey(), iv); const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]); return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`; }
function decryptAdminSecret(value?: string) { if (!value) return undefined; try { const [ivText, tagText, dataText] = value.split('.'); if (!ivText || !tagText || !dataText) return undefined; const decipher = createDecipheriv('aes-256-gcm', adminKey(), Buffer.from(ivText, 'base64url')); decipher.setAuthTag(Buffer.from(tagText, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8'); } catch { return undefined; } }
function base32Encode(value: Buffer) { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let output = ''; let buffer = 0; let bits = 0; for (const byte of value) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(buffer >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31]; return output; }
function newAdminMfaSecret() { return base32Encode(randomBytes(20)); }
function adminOtpUri(username: string, secret: string) { return `otpauth://totp/Debao%20Admin:${encodeURIComponent(username)}?secret=${secret}&issuer=Debao%20Admin&algorithm=SHA1&digits=6&period=30`; }

function base32Bytes(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const char of value.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')) { const index = alphabet.indexOf(char); if (index < 0) throw new Error('invalid base32 secret'); bits += index.toString(2).padStart(5, '0'); }
  const bytes: number[] = []; for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2)); return Buffer.from(bytes);
}

function totpCode(secret: string, counter: number) { const key = base32Bytes(secret); const counterBuffer = Buffer.alloc(8); counterBuffer.writeBigUInt64BE(BigInt(counter)); const digest = createHmac('sha1', key).update(counterBuffer).digest(); const offset = digest[digest.length - 1] & 0x0f; const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]; return String(value % 1_000_000).padStart(6, '0'); }
function totpValid(secret: string, code: string, timestamp = Date.now()) { if (!/^\d{6}$/.test(code)) return false; try { const counter = Math.floor(timestamp / 30000); return [-1, 0, 1].some(offset => timingSafeEqual(Buffer.from(totpCode(secret, counter + offset)), Buffer.from(code))); } catch { return false; } }

async function issueAdminSession(res: ServerResponse, account: AdminAccount, requestId: string, req?: IncomingMessage) {
  const token = randomBytes(32).toString('base64url'); const csrfToken = randomBytes(24).toString('base64url'); const expiresAt = new Date(Date.now() + 8 * 3600000).toISOString(); adminSessions.set(token, {adminId: account.id, username: account.username, displayName: account.displayName, role: account.role, permissions: account.permissions, csrfToken, expiresAt}); const secure = config.nodeEnv === 'production' ? '; Secure' : ''; (res as ServerResponse & {debaoHeaders?: Record<string, string>}).debaoHeaders = {'set-cookie': `${adminCookie}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure}`, 'access-control-allow-credentials': 'true'};
  if (config.nodeEnv === 'production') { await persist('insert into admin_sessions (admin_user_id, token_hash, csrf_token, ip, user_agent, expires_at) values ($1, $2, $3, $4, $5, $6)', [account.id, tokenHash(token), csrfToken, req?.socket.remoteAddress ?? null, req?.headers['user-agent'] ?? null, expiresAt]); await persist('update admin_users set last_login_at = now(), updated_at = now() where id = $1', [account.id]); }
  return {admin: {id: account.id, name: account.displayName, role: account.role, permissions: account.permissions}, csrfToken, expiresAt, requestId};
}

async function adminAccountForLogin(username: string): Promise<AdminAccount | undefined> {
  if (config.nodeEnv !== 'production') return username === config.adminUsername ? {id: adminId, username, displayName: '得宝管理员', role: 'super_admin', permissions: adminPermissions, mfaEnabled: Boolean(developmentAdminMfaSecret), mfaSecret: developmentAdminMfaSecret} : undefined;
  const result = await infrastructure.query<{id: string; username: string; display_name: string; role: string; password_hash: string; mfa_enabled: boolean; mfa_secret_enc?: string; permissions: string[]}>('select au.id, au.username, au.display_name, coalesce(min(ar.code), \'super_admin\') as role, au.password_hash, au.mfa_enabled, au.mfa_secret_enc, coalesce(array_agg(arp.permission_code) filter (where arp.permission_code is not null), array[\'*\']) as permissions from admin_users au left join admin_user_roles aur on aur.admin_user_id = au.id left join admin_roles ar on ar.id = aur.role_id left join admin_role_permissions arp on arp.role_id = ar.id where au.username = $1 and au.status = \'active\' group by au.id', [username]);
  const row = result?.rows[0]; if (!row) return undefined; return {id: row.id, username: row.username, displayName: row.display_name, role: row.role, permissions: row.permissions, passwordHash: row.password_hash, mfaEnabled: row.mfa_enabled, mfaSecret: decryptAdminSecret(row.mfa_secret_enc)};
}

function adminSession(req: IncomingMessage) {
  const cookie = cookieValue(req, adminCookie);
  if (!cookie) return undefined;
  const session = adminSessions.get(cookie);
  if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) return undefined;
  return session;
}

function verificationContext(req: IncomingMessage, deviceId?: string) {
  return {requestIp: req.socket.remoteAddress, deviceId: deviceId || store.sessions.get(accessToken(req) ?? '')?.deviceId};
}

function requireAuth(req: IncomingMessage) {
  const token = accessToken(req);
  if (!token || !store.sessions.has(token)) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录');
  const session = store.sessions.get(token);
  if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) throw new HttpError(401, 'AUTH_REQUIRED', '登录状态已失效');
  assertLoginAllowed(session.userId);
  return session.userId;
}

function assertLoginAllowed(userId: string) {
  const restriction = store.userRestrictions.get(userId);
  if (!restriction || restriction.type !== 'login') return;
  if (restriction.expiresAt && Number.isFinite(Date.parse(restriction.expiresAt)) && Date.parse(restriction.expiresAt) <= Date.now()) {
    store.userRestrictions.delete(userId);
    return;
  }
  throw new HttpError(403, 'ACCOUNT_LOGIN_RESTRICTED', restriction.reason || '账号暂时无法登录', {expiresAt: restriction.expiresAt});
}

/** Community moderation uses the same durable restriction record as account
 * restrictions, but must be checked at every write entry point.  Expired
 * restrictions are removed lazily so a user is not blocked after the end of
 * a temporary mute. */
function assertCommunityAllowed(userId: string) {
  const restriction = store.userRestrictions.get(userId);
  if (!restriction || restriction.type !== 'community') return;
  if (restriction.expiresAt && Number.isFinite(Date.parse(restriction.expiresAt)) && Date.parse(restriction.expiresAt) <= Date.now()) {
    store.userRestrictions.delete(userId);
    void persist('update user_restrictions set lifted_at = now() where user_id = $1 and restriction_type = $2 and lifted_at is null', [dbUserId(userId), 'community']);
    return;
  }
  throw new HttpError(403, 'COMMUNITY_RESTRICTED', restriction.reason || '当前账号暂时无法发言', {expiresAt: restriction.expiresAt});
}

function decodePathSegment(value: string) {
  try { return decodeURIComponent(value); } catch { throw new HttpError(400, 'VALIDATION_ERROR', '路径参数格式不正确'); }
}

function graderToken(req: IncomingMessage) { return accessToken(req); }
function requireGrader(req: IncomingMessage) {
  const token = graderToken(req); if (!token) throw new HttpError(401, 'GRADER_AUTH_REQUIRED', '请先登录批改人员工作台');
  const session = store.graderSessions.get(token); if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) throw new HttpError(401, 'GRADER_AUTH_REQUIRED', '批改人员登录状态已失效');
  const account = store.graderAccounts.find(item => item.id === session.graderId && item.status === 'active'); if (!account) throw new HttpError(401, 'GRADER_AUTH_REQUIRED', '批改人员账号不可用');
  return account;
}
function gradingEvent(submissionId: string, eventType: string, actorType: 'user' | 'grader' | 'admin' | 'system', actorId?: string, metadata: Record<string, unknown> = {}) {
  const event = {id: randomUUID(), submissionId, eventType, actorType, actorId, metadata, createdAt: new Date().toISOString()};
  store.gradingEvents.unshift(event); void persist('insert into grading_events (id, submission_id, event_type, actor_type, actor_id, metadata) values ($1, $2, $3, $4, $5, $6::jsonb)', [event.id, submissionId, eventType, actorType, actorId ?? null, JSON.stringify(metadata)]); return event;
}
function gradingStatus(item: GradingSubmission, next: GradingSubmissionStatus) { assertGradingTransition(item.status, next); item.status = next; item.updatedAt = new Date().toISOString(); }
function publicGradingQuestion(rubric: typeof store.gradingRubrics[number]) {
  return {id: rubric.questionId, rubricId: rubric.id, version: rubric.questionVersion, title: rubric.title, subjectId: rubric.subjectId, caseMaterial: rubric.caseMaterial, subQuestions: rubric.subQuestions, totalScore: rubric.totalScore, suggestedMinutes: rubric.suggestedMinutes, allowedAnswerTypes: rubric.allowedAnswerTypes, status: rubric.status};
}
function publicGradingSubmission(item: GradingSubmission) {
  const report = item.latestReportId ? store.gradingReports.find(entry => entry.id === item.latestReportId) : undefined;
  const rubric = store.gradingRubrics.find(entry => entry.id === item.rubricId);
  const paper = item.paperId ? store.gradingPapers.find(entry => entry.id === item.paperId) : undefined;
  return {id: item.id, paperId: item.paperId, paperTitle: paper?.title, questionId: item.questionId, questionTitle: rubric?.title, rubricId: item.rubricId, questionVersion: item.questionVersion, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt, latestReportId: item.latestReportId, score: report?.totalScore, maxScore: report?.maxScore, feedback: report?.feedback};
}
function publicReport(report: GradingReport) { return {...report}; }
function gradingMetrics(events = store.gradingEvents) {
  const completed = events.filter(item => item.eventType === 'manual_submitted'); const hourly = new Map<string, number>(); const daily = new Map<string, number>();
  for (const event of completed) { const hour = event.createdAt.slice(0, 13) + ':00:00.000Z'; const day = event.createdAt.slice(0, 10); hourly.set(hour, (hourly.get(hour) ?? 0) + 1); daily.set(day, (daily.get(day) ?? 0) + 1); }
  return {hourlyCompleted: [...hourly].sort(([left], [right]) => left.localeCompare(right)).map(([period, count]) => ({period, count})), dailyCompleted: [...daily].sort(([left], [right]) => left.localeCompare(right)).map(([period, count]) => ({period, count}))};
}

const adminWritePermissionRules: Array<{method: string; path: RegExp; permission: string}> = [
  {method: 'POST', path: /^\/v1\/admin\/learning-cards\/assets$/, permission: 'learning.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-cards$/, permission: 'learning.questions.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-cards\/[^/]+$/, permission: 'learning.questions.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/learning-cards\/[^/]+$/, permission: 'learning.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-cards\/[^/]+\/(publish|disable)$/, permission: 'learning.questions.publish'},
  {method: 'POST', path: /^\/v1\/admin\/learning-question-bank\/media$/, permission: 'learning.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-question-bank\/questions$/, permission: 'learning.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-question-bank\/questions\/(import|bulk)$/, permission: 'learning.questions.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-question-bank\/questions\/[^/]+$/, permission: 'learning.questions.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/learning-question-bank\/questions\/[^/]+$/, permission: 'learning.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-question-bank\/questions\/[^/]+\/(publish|disable)$/, permission: 'learning.questions.publish'},
  {method: 'POST', path: /^\/v1\/admin\/learning-question-bank\/questions\/[^/]+\/copy$/, permission: 'learning.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-question-bank\/taxonomy$/, permission: 'learning.questions.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-question-bank\/taxonomy\/[^/]+$/, permission: 'learning.questions.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/learning-question-bank\/taxonomy\/[^/]+$/, permission: 'learning.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-coach\/class-types$/, permission: 'learning.stages.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-coach\/class-types\/[^/]+$/, permission: 'learning.stages.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/learning-coach\/class-types\/[^/]+$/, permission: 'learning.stages.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-coach\/stages$/, permission: 'learning.stages.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-coach\/stages\/[^/]+$/, permission: 'learning.stages.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/learning-coach\/stages\/[^/]+$/, permission: 'learning.stages.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-coach\/stages\/[^/]+\/teachers$/, permission: 'learning.stages.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-coach\/teachers\/[^/]+$/, permission: 'learning.stages.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/learning-coach\/teachers\/[^/]+$/, permission: 'learning.stages.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-coach\/teachers$/, permission: 'learning.stages.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-coach\/stages\/[^/]+\/plan$/, permission: 'learning.stages.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning\/plans\/[^/]+$/, permission: 'learning.stages.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning\/plans\/[^/]+\/tasks\/[^/]+$/, permission: 'learning.stages.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-coach\/stages\/[^/]+\/plan\/preview$/, permission: 'learning.stages.read'},
  {method: 'POST', path: /^\/v1\/admin\/learning-coach\/stages\/[^/]+\/plan\/publish$/, permission: 'learning.stages.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-coach\/stages\/[^/]+\/plan\/items$/, permission: 'learning.stages.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-coach\/stages\/[^/]+\/plan\/items\/[^/]+$/, permission: 'learning.stages.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/learning-coach\/stages\/[^/]+\/plan\/items\/[^/]+$/, permission: 'learning.stages.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-diagnostic\/form$/, permission: 'learning.diagnostics.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-diagnostic\/form\/(publish|disable)$/, permission: 'learning.diagnostics.publish'},
  {method: 'POST', path: /^\/v1\/admin\/learning-diagnostic\/dimensions$/, permission: 'learning.diagnostics.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-diagnostic\/dimensions\/[^/]+$/, permission: 'learning.diagnostics.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/learning-diagnostic\/dimensions\/[^/]+$/, permission: 'learning.diagnostics.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-diagnostic\/questions$/, permission: 'learning.diagnostics.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/learning-diagnostic\/questions\/[^/]+$/, permission: 'learning.diagnostics.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/learning-diagnostic\/questions\/[^/]+$/, permission: 'learning.diagnostics.write'},
  {method: 'POST', path: /^\/v1\/admin\/learning-diagnostic\/questions\/[^/]+\/(publish|disable)$/, permission: 'learning.diagnostics.publish'},
  {method: 'POST', path: /^\/v1\/admin\/users$/, permission: 'users.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/users\/[^/]+$/, permission: 'users.write'},
  {method: 'POST', path: /^\/v1\/admin\/users\/[^/]+\/restrictions$/, permission: 'users.restrict'},
  {method: 'DELETE', path: /^\/v1\/admin\/users\/[^/]+\/restrictions$/, permission: 'users.restrict'},
  {method: 'POST', path: /^\/v1\/admin\/users\/[^/]+\/sessions\/revoke$/, permission: 'users.sessions.revoke'},
  {method: 'POST', path: /^\/v1\/admin\/users\/[^/]+\/entitlements\/adjust$/, permission: 'entitlements.adjust'},
  {method: 'POST', path: /^\/v1\/admin\/questions$/, permission: 'content.questions.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/questions\/[^/]+$/, permission: 'content.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/questions\/[^/]+\/publish$/, permission: 'content.questions.publish'},
  {method: 'POST', path: /^\/v1\/admin\/courses$/, permission: 'courses.write'},
  {method: 'POST', path: /^\/v1\/admin\/courses\/[^/]+\/publish$/, permission: 'courses.publish'},
  {method: 'POST', path: /^\/v1\/admin\/products$/, permission: 'products.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/products\/[^/]+$/, permission: 'products.write'},
  {method: 'POST', path: /^\/v1\/admin\/products\/[^/]+\/skus$/, permission: 'products.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/products\/[^/]+\/skus\/[^/]+$/, permission: 'products.write'},
  {method: 'POST', path: /^\/v1\/admin\/coupons$/, permission: 'products.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/coupons\/[^/]+$/, permission: 'products.write'},
  {method: 'GET', path: /^\/v1\/admin\/orders\/[^/]+$/, permission: 'orders.read'},
  {method: 'POST', path: /^\/v1\/admin\/refunds\/[^/]+\/approve$/, permission: 'refunds.approve'},
  {method: 'POST', path: /^\/v1\/admin\/refunds\/[^/]+\/review$/, permission: 'refunds.approve'},
  {method: 'POST', path: /^\/v1\/admin\/refunds\/[^/]+\/reject$/, permission: 'refunds.approve'},
  {method: 'POST', path: /^\/v1\/admin\/community\/reports\/[^/]+\/resolve$/, permission: 'community.reports.resolve'},
  {method: 'POST', path: /^\/v1\/admin\/community\/posts\/[^/]+\/hide$/, permission: 'community.moderate'},
  {method: 'POST', path: /^\/v1\/admin\/community\/comments\/[^/]+\/hide$/, permission: 'community.moderate'},
  {method: 'POST', path: /^\/v1\/admin\/community\/rules$/, permission: 'community.rules.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/community\/rules\/[^/]+$/, permission: 'community.rules.write'},
 {method: 'POST', path: /^\/v1\/admin\/banners$/, permission: 'operations.banners.write'},
 {method: 'PATCH', path: /^\/v1\/admin\/banners\/[^/]+$/, permission: 'operations.banners.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/banners\/[^/]+$/, permission: 'operations.banners.write'},
  {method: 'POST', path: /^\/v1\/admin\/templates$/, permission: 'operations.templates.write'},
  {method: 'POST', path: /^\/v1\/admin\/push-jobs$/, permission: 'operations.push.write'},
  {method: 'POST', path: /^\/v1\/admin\/push-jobs\/[^/]+\/cancel$/, permission: 'operations.push.write'},
  {method: 'POST', path: /^\/v1\/admin\/push-jobs\/[^/]+\/retry$/, permission: 'operations.push.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/ai\/quotas\/[^/]+$/, permission: 'ai.quotas.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/ai\/flags\/[^/]+$/, permission: 'ai.flags.review'},
  {method: 'POST', path: /^\/v1\/admin\/exports$/, permission: 'analytics.export'},
  {method: 'POST', path: /^\/v1\/admin\/exports\/[^/]+\/retry$/, permission: 'analytics.export'},
  {method: 'PATCH', path: /^\/v1\/admin\/settings$/, permission: 'system.settings.write'},
  {method: 'POST', path: /^\/v1\/admin\/announcements$/, permission: 'operations.announcements.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/announcements\/[^/]+$/, permission: 'operations.announcements.write'},
  {method: 'DELETE', path: /^\/v1\/admin\/announcements\/[^/]+$/, permission: 'operations.announcements.write'},
  {method: 'POST', path: /^\/v1\/admin\/announcements\/[^/]+\/publish$/, permission: 'operations.announcements.write'},
  {method: 'POST', path: /^\/v1\/admin\/announcements\/[^/]+\/withdraw$/, permission: 'operations.announcements.write'},
  {method: 'POST', path: /^\/v1\/admin\/push\/test$/, permission: 'operations.push.test'},
  {method: 'POST', path: /^\/v1\/admin\/admins\/[^/]+\/mfa\/reset$/, permission: 'system.admins.mfa'},
  {method: 'POST', path: /^\/v1\/admin\/content\/papers$/, permission: 'content.questions.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/content\/papers\/[^/]+$/, permission: 'content.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/content\/papers\/[^/]+\/publish$/, permission: 'content.questions.publish'},
  {method: 'POST', path: /^\/v1\/admin\/content\/imports$/, permission: 'content.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/content\/imports\/[^/]+\/confirm$/, permission: 'content.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/content\/laws$/, permission: 'content.questions.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/content\/laws\/[^/]+$/, permission: 'content.questions.write'},
  {method: 'POST', path: /^\/v1\/admin\/content\/laws\/[^/]+\/publish$/, permission: 'content.questions.publish'},
  {method: 'POST', path: /^\/v1\/admin\/content\/laws\/[^/]+\/disable$/, permission: 'content.questions.publish'},
  {method: 'POST', path: /^\/v1\/admin\/courses\/[^/]+\/sections$/, permission: 'courses.write'},
  {method: 'POST', path: /^\/v1\/admin\/courses\/[^/]+\/lessons$/, permission: 'courses.write'},
  {method: 'POST', path: /^\/v1\/admin\/courses\/live-sessions$/, permission: 'courses.write'},
  {method: 'POST', path: /^\/v1\/admin\/courses\/live-sessions\/[^/]+\/cancel$/, permission: 'courses.write'},
  {method: 'POST', path: /^\/v1\/admin\/grading\/[^/]+\/claim$/, permission: 'grading.claim'},
  {method: 'POST', path: /^\/v1\/admin\/grading\/[^/]+\/submit$/, permission: 'grading.submit'},
  {method: 'POST', path: /^\/v1\/admin\/grading\/[^/]+\/publish$/, permission: 'grading.publish'},
  {method: 'POST', path: /^\/v1\/admin\/grading\/[^/]+\/reassign$/, permission: 'grading.assign'},
  {method: 'POST', path: /^\/v1\/admin\/grading\/[^/]+\/escalate$/, permission: 'grading.review'},
  {method: 'POST', path: /^\/v1\/admin\/grading\/[^/]+\/queue-manual$/, permission: 'grading.assign'},
  {method: 'POST', path: /^\/v1\/admin\/content\/questions\/[^/]+\/grading-rubric$/, permission: 'content.questions.write'},
  {method: 'PATCH', path: /^\/v1\/admin\/content\/questions\/[^/]+\/grading-rubric$/, permission: 'content.questions.write'},
];
const adminReadPermissionRules: Array<{path: RegExp; permission: string}> = [
  {path: /^\/v1\/admin\/learning-cards(?:\/|$)/, permission: 'learning.questions.read'},
  {path: /^\/v1\/admin\/learning-question-bank(?:\/|$)/, permission: 'learning.questions.read'},
  {path: /^\/v1\/admin\/learning-coach(?:\/|$)/, permission: 'learning.stages.read'},
  {path: /^\/v1\/admin\/learning\/plans(?:\/|$)/, permission: 'learning.stages.read'},
  {path: /^\/v1\/admin\/learning-diagnostic(?:\/|$)/, permission: 'learning.diagnostics.read'},
  {path: /^\/v1\/admin\/grading(?:\/|$)/, permission: 'grading.read'},
  {path: /^\/v1\/admin\/(me|navigation|dashboard|overview)$/, permission: 'dashboard.read'},
  {path: /^\/v1\/admin\/users(?:\/|$)/, permission: 'users.read'},
  {path: /^\/v1\/admin\/content\//, permission: 'content.questions.read'},
  {path: /^\/v1\/admin\/questions(?:\/|$)/, permission: 'content.questions.read'},
  {path: /^\/v1\/admin\/(courses|learning|grading)/, permission: 'courses.read'},
  {path: /^\/v1\/admin\/content\/questions\/[^/]+\/grading-rubric$/, permission: 'content.questions.read'},
  {path: /^\/v1\/admin\/(products|orders|refunds|entitlements)/, permission: 'orders.read'},
  {path: /^\/v1\/admin\/community\//, permission: 'community.read'},
  {path: /^\/v1\/admin\/(announcements|banners|templates|push-jobs)/, permission: 'operations.read'},
  {path: /^\/v1\/admin\/exports(?:\/|$)/, permission: 'analytics.read'},
  {path: /^\/v1\/admin\/ai\/flags(?:\/|$)/, permission: 'ai.flags.read'},
  {path: /^\/v1\/admin\/ai\/usage(?:\/|$)/, permission: 'ai.usage.read'},
  {path: /^\/v1\/admin\/ai\/quotas(?:\/|$)/, permission: 'ai.quotas.read'},
  {path: /^\/v1\/admin\/ai\/providers(?:\/|$)/, permission: 'ai.providers.read'},
  {path: /^\/v1\/admin\/ai\//, permission: 'ai.read'},
  {path: /^\/v1\/admin\/analytics\//, permission: 'analytics.read'},
  {path: /^\/v1\/admin\/(admins|roles|audit-logs|settings|health)/, permission: 'system.admins.read'},
];

function adminWritePermission(req: IncomingMessage) {
  const method = req.method ?? 'GET';
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return undefined;
  const path = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname.replace(/\/$/, '') || '/';
  return adminWritePermissionRules.find(rule => rule.method === method && rule.path.test(path))?.permission;
}
function adminReadPermission(req: IncomingMessage) {
  if ((req.method ?? 'GET') !== 'GET') return undefined;
  const path = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname.replace(/\/$/, '') || '/';
  return adminReadPermissionRules.find(rule => rule.path.test(path))?.permission;
}

function requireAdmin(req: IncomingMessage, permission?: string) {
  const session = adminSession(req);
  if (!session) throw new HttpError(401, 'ADMIN_AUTH_REQUIRED', '请先登录运营后台');
  const requiredPermission = permission ?? adminWritePermission(req) ?? adminReadPermission(req);
  if (requiredPermission && !session.permissions.includes('*') && !session.permissions.includes(requiredPermission)) throw new HttpError(403, 'ADMIN_FORBIDDEN', '当前管理员没有执行该操作的权限');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET') && req.headers['x-csrf-token'] !== session.csrfToken) throw new HttpError(403, 'CSRF_INVALID', '请求校验失败，请刷新后台后重试');
  return session;
}

function productFor(id: string, requireSellable = false): Product {
  const product = store.products.find(item => item.id === id);
  if (!product) throw new HttpError(404, 'NOT_FOUND', '商品不存在');
  if (requireSellable && !isSellableProduct(product)) throw new HttpError(404, 'NOT_FOUND', '商品不存在或已下架');
  return product;
}

function orderFor(id: string, userId?: string): Order {
  const order = store.orders.find(item => item.id === id && (!userId || item.userId === userId));
  if (!order) throw new HttpError(404, 'NOT_FOUND', '订单不存在');
  return order;
}

const appLegalKeys = new Set<AppLegalDocument['key']>([
  'terms',
  'privacy',
  'sdk-list',
  'account-deletion',
]);

function appLegalFor(key: string): AppLegalDocument {
  if (!appLegalKeys.has(key as AppLegalDocument['key'])) {
    throw new HttpError(404, 'LEGAL_DOCUMENT_NOT_FOUND', '应用文档不存在');
  }
  const document = store.appLegalDocuments.find(item => item.key === key && item.status === 'published');
  if (!document) throw new HttpError(404, 'LEGAL_DOCUMENT_NOT_FOUND', '应用文档暂不可用');
  return document;
}

function settingsFor(userId: string): UserSettings {
  const existing = store.userSettings.get(userId);
  if (existing) return existing;
  const created: UserSettings = {
    userId,
    learningReminders: true,
    courseUpdates: true,
    orderNotifications: true,
    updatedAt: new Date().toISOString(),
  };
  store.userSettings.set(userId, created);
  return created;
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const requestId = randomUUID();
  if (req.method === 'OPTIONS') {
    // Flutter Web identifies its client through a custom header. Keep the
    // preflight contract in sync with ApiClient so local Web builds can use
    // the same authenticated API path as native clients.
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers':
          'authorization,content-type,accept,x-csrf-token,idempotency-key,x-client-platform,x-file-name',
      'access-control-allow-credentials': 'true',
    });
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/$/, '') || '/';
  try {
    await processDueAccountDeletions();
    // Keep local order state deterministic between requests; the durable
    // worker can run the same transition in production.
    await expirePendingOrders();
    const handledLiveRoute = await handleLiveRoutes({
      req, url: new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), store,
      auth: () => requireAuth(req), admin: () => requireAdmin(req), body: () => body(req),
      fail: (status, code, message) => { throw new HttpError(status, code, message); },
      send: (status, data) => { send(res, status, data, requestId); },
      persist,
    });
    if (handledLiveRoute) return;
    const appLegalMatch = path.match(/^\/v1\/legal-documents\/([^/]+)$/);
    if (appLegalMatch && req.method === 'GET') {
      let key: string;
      try { key = decodeURIComponent(appLegalMatch[1]); } catch { throw new HttpError(404, 'LEGAL_DOCUMENT_NOT_FOUND', '应用文档不存在'); }
      return send(res, 200, appLegalFor(key), requestId);
    }
    if (req.method === 'POST' && path === '/v1/auth/send-code') {
      const input = await body(req); const phone = String(input.phone ?? '').trim(); const rawPurpose = String(input.purpose ?? 'login');
      if (!['login', 'bind_phone'].includes(rawPurpose)) throw new HttpError(422, 'VALIDATION_ERROR', '验证码用途不正确');
      const purpose = rawPurpose as SmsPurpose;
      if (!/^1\d{10}$/.test(phone)) throw new HttpError(422, 'VALIDATION_ERROR', '手机号格式不正确');
      return send(res, 200, await sendVerificationCode(phone, purpose, verificationContext(req, typeof input.deviceId === 'string' ? input.deviceId : undefined)), requestId);
    }
    if (req.method === 'POST' && path === '/v1/auth/login') {
      const input = await body(req); const phone = String(input.phone ?? '').trim(); const code = String(input.code ?? '').trim();
      if (!/^1\d{10}$/.test(phone) || !/^\d{6}$/.test(code)) throw new HttpError(422, 'VALIDATION_ERROR', '手机号或验证码格式不正确');
      await verifyAndConsumeCode(phone, code, 'login');
      const deviceId = String(input.deviceId ?? `device-${randomUUID()}`); const userId = await resolveUserForPhone(phone); assertLoginAllowed(userId);
      return send(res, 200, await issueSession(userId, deviceId, 'login', 'sms'), requestId);
    }
    if (req.method === 'POST' && path === '/v1/auth/wechat/bind-phone') {
      const input = await body(req); const bindingToken = String(input.bindingToken ?? ''); const phone = String(input.phone ?? '').trim(); const code = String(input.code ?? '').trim(); const deviceId = String(input.deviceId ?? `device-${randomUUID()}`);
      if (!/^1\d{10}$/.test(phone) || !/^\d{6}$/.test(code)) throw new HttpError(422, 'VALIDATION_ERROR', '手机号或验证码格式不正确');
      await verifyAndConsumeCode(phone, code, 'bind_phone');
      const result = await bindingTicketByToken(bindingToken); if (!result) throw new HttpError(401, 'BINDING_TICKET_INVALID', '微信绑定已过期，请重新授权');
      const userId = await resolveUserForPhone(phone, result.ticket.nickname); await bindWechatIdentity(userId, result.hash, result.ticket);
      return send(res, 200, await issueSession(userId, deviceId, 'bind_phone', 'wechat+sms'), requestId);
    }
    if (req.method === 'PATCH' && path === '/v1/me') {
      const userId = requireAuth(req); const input = await body(req); const current = profileFor(userId);
      const next: UserProfile = {...current, ...(typeof input.name === 'string' ? {name: input.name.trim()} : {}), ...(typeof input.examYear === 'string' ? {examYear: input.examYear} : {}), ...(typeof input.avatarColor === 'string' ? {avatarColor: input.avatarColor} : {}), ...(typeof input.avatarUrl === 'string' ? {avatarUrl: input.avatarUrl.trim() || undefined} : {})};
      if (!next.name || !/^20\d{2}$/.test(next.examYear)) throw new HttpError(422, 'VALIDATION_ERROR', '昵称和考试年份格式不正确');
      if (next.avatarColor && !/^#[0-9A-Fa-f]{6}$/.test(next.avatarColor)) throw new HttpError(422, 'VALIDATION_ERROR', '头像颜色格式不正确');
      if (next.avatarUrl && (!/^https?:\/\//.test(next.avatarUrl) || next.avatarUrl.length > 2000)) throw new HttpError(422, 'VALIDATION_ERROR', '头像地址格式不正确');
      store.profiles.set(userId, next);
      await persist('insert into users (id, name, phone, exam_year, study_days, avatar_color, avatar_url) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set name = excluded.name, phone = excluded.phone, exam_year = excluded.exam_year, study_days = excluded.study_days, avatar_color = excluded.avatar_color, avatar_url = excluded.avatar_url, updated_at = now()', [dbUserId(userId), next.name, next.phone, next.examYear, next.studyDays, next.avatarColor ?? null, next.avatarUrl ?? null]);
      return send(res, 200, publicProfile(next), requestId);
    }
    if (req.method === 'GET' && path === '/v1/me/identities') {
      const userId = requireAuth(req); return send(res, 200, store.identities.filter(item => item.userId === userId).map(item => ({provider: item.provider, nickname: item.nickname, boundAt: item.createdAt})), requestId);
    }
    if (req.method === 'POST' && path === '/v1/account/identity/code') {
      const userId = requireAuth(req); if (!store.identities.some(item => item.userId === userId && item.provider === 'wechat')) throw new HttpError(404, 'NOT_FOUND', '微信账号尚未绑定'); return send(res, 200, await sendVerificationCode(profileFor(userId).phone, 'unlink_identity', verificationContext(req)), requestId);
    }
    if (req.method === 'POST' && path === '/v1/account/identity/link-code') {
      const userId = requireAuth(req); if (store.identities.some(item => item.userId === userId && item.provider === 'wechat')) throw new HttpError(409, 'IDENTITY_ALREADY_BOUND', '当前账号已经绑定微信'); return send(res, 200, await sendVerificationCode(profileFor(userId).phone, 'link_identity', verificationContext(req)), requestId);
    }
    if (req.method === 'POST' && path === '/v1/me/identities/wechat') {
      const userId = requireAuth(req); const input = await body(req); const code = String(input.code ?? '').trim(); const smsCode = String(input.smsCode ?? '').trim(); if (!code || !/^\d{6}$/.test(smsCode)) throw new HttpError(422, 'VALIDATION_ERROR', '微信授权或短信验证码格式不正确'); if (store.identities.some(item => item.userId === userId && item.provider === 'wechat')) throw new HttpError(409, 'IDENTITY_ALREADY_BOUND', '当前账号已经绑定微信'); await verifyAndConsumeCode(profileFor(userId).phone, smsCode, 'link_identity'); let identity; try { identity = await wechatAuthAdapter.exchangeCode(code); } catch (error) { throw adapterFailure(wechatAuthAdapter.name, error); } const collision = store.identities.find(item => item.provider === 'wechat' && (item.providerUserId === identity.providerUserId || (identity.unionId && item.unionId === identity.unionId))); if (collision) throw new HttpError(409, 'IDENTITY_ALREADY_BOUND', '该微信账号已绑定其他手机号'); const createdAt = new Date().toISOString(); store.identities.push({userId, provider: 'wechat', providerUserId: identity.providerUserId, unionId: identity.unionId, nickname: identity.nickname, createdAt}); await persist('insert into user_identities (user_id, provider, provider_user_id, union_id, nickname, created_at) values ($1, $2, $3, $4, $5, $6)', [dbUserId(userId), 'wechat', identity.providerUserId, identity.unionId ?? null, identity.nickname ?? null, createdAt]); await persist('insert into auth_events (user_id, event_type, provider) values ($1, $2, $3)', [dbUserId(userId), 'bind', 'wechat']); return send(res, 201, {provider: 'wechat', nickname: identity.nickname, boundAt: createdAt}, requestId);
    }
    if (req.method === 'DELETE' && path === '/v1/me/identities/wechat') {
      const userId = requireAuth(req); const input = await body(req); const code = String(input.code ?? ''); const identity = store.identities.find(item => item.userId === userId && item.provider === 'wechat'); if (!identity) throw new HttpError(404, 'NOT_FOUND', '微信账号尚未绑定'); if (!/^\d{6}$/.test(code)) throw new HttpError(422, 'VALIDATION_ERROR', '请输入 6 位验证码'); await verifyAndConsumeCode(profileFor(userId).phone, code, 'unlink_identity'); store.identities = store.identities.filter(item => item !== identity); await persist('delete from user_identities where user_id = $1 and provider = $2', [dbUserId(userId), 'wechat']); await persist('insert into auth_events (user_id, event_type, provider) values ($1, $2, $3)', [dbUserId(userId), 'unbind', 'wechat']); return send(res, 200, {removed: true}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/account/phone/code') {
      const userId = requireAuth(req); const input = await body(req); const stage = String(input.stage ?? ''); const current = profileFor(userId);
      if (stage === 'current') return send(res, 200, await sendVerificationCode(current.phone, 'change_phone_old', verificationContext(req)), requestId);
      const phone = String(input.phone ?? '').trim(); if (stage !== 'new' || !/^1\d{10}$/.test(phone)) throw new HttpError(422, 'VALIDATION_ERROR', '新手机号格式不正确');
      if ([...store.profiles.values()].some(item => item.phone === phone && item.id !== userId)) throw new HttpError(409, 'PHONE_ALREADY_BOUND', '新手机号已绑定其他账号');
      return send(res, 200, await sendVerificationCode(phone, 'change_phone_new', verificationContext(req)), requestId);
    }
    if (req.method === 'POST' && path === '/v1/account/phone/change') {
      const userId = requireAuth(req); const input = await body(req); const current = profileFor(userId); const newPhone = String(input.newPhone ?? '').trim(); const oldCode = String(input.oldCode ?? '').trim(); const newCode = String(input.newCode ?? '').trim();
      if (!/^1\d{10}$/.test(newPhone) || !/^\d{6}$/.test(oldCode) || !/^\d{6}$/.test(newCode)) throw new HttpError(422, 'VALIDATION_ERROR', '手机号或验证码格式不正确');
      if (newPhone === current.phone) throw new HttpError(422, 'PHONE_UNCHANGED', '新手机号不能与当前手机号相同');
      const collision = [...store.profiles.values()].find(item => item.phone === newPhone && item.id !== userId); if (collision) throw new HttpError(409, 'PHONE_ALREADY_BOUND', '新手机号已绑定其他账号');
      const oldChallenge = await verifyCodeChallenge(current.phone, oldCode, 'change_phone_old');
      const newChallenge = await verifyCodeChallenge(newPhone, newCode, 'change_phone_new');
      await consumeChallenge(oldChallenge); await consumeChallenge(newChallenge);
      const next = {...current, phone: newPhone}; store.profiles.set(userId, next);
      await persist('update users set phone = $1, updated_at = now() where id = $2', [newPhone, dbUserId(userId)]);
      await persist('insert into auth_events (user_id, event_type, provider, metadata) values ($1, $2, $3, $4)', [dbUserId(userId), 'change_phone', 'sms', JSON.stringify({phoneChanged: true})]);
      return send(res, 200, publicProfile(next), requestId);
    }
    if (req.method === 'GET' && path === '/v1/account/deletion') {
      const userId = requireAuth(req); const deletion = store.deletionRequests.get(userId); const active = deletion && !deletion.cancelledAt && !deletion.completedAt;
      return send(res, 200, active ? {status: 'scheduled', requestedAt: deletion.requestedAt, executeAfter: deletion.executeAfter, coolingOffDays: 7} : {status: 'none'}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/account/deletion/code') {
      const userId = requireAuth(req); return send(res, 200, await sendVerificationCode(profileFor(userId).phone, 'delete_account', verificationContext(req)), requestId);
    }
    if (req.method === 'POST' && path === '/v1/account/deletion') {
      const userId = requireAuth(req); const input = await body(req); const code = String(input.code ?? ''); if (!/^\d{6}$/.test(code)) throw new HttpError(422, 'VALIDATION_ERROR', '请输入 6 位验证码'); const existing = store.deletionRequests.get(userId); if (existing && !existing.cancelledAt && !existing.completedAt) throw new HttpError(409, 'DELETION_ALREADY_SCHEDULED', '账号注销已申请，可在冷静期内撤销');
      await verifyAndConsumeCode(profileFor(userId).phone, code, 'delete_account');
      const requestedAt = new Date().toISOString(); const executeAfter = new Date(Date.now() + 7 * 86400000).toISOString(); const deletion = {userId, requestedAt, executeAfter}; store.deletionRequests.set(userId, deletion);
      await persist('insert into account_deletion_requests (user_id, requested_at, execute_after) values ($1, $2, $3)', [dbUserId(userId), requestedAt, executeAfter]);
      await persist('insert into auth_events (user_id, event_type, metadata) values ($1, $2, $3)', [dbUserId(userId), 'deletion_requested', JSON.stringify({executeAfter})]);
      return send(res, 200, {status: 'scheduled', requestedAt, executeAfter, coolingOffDays: 7}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/account/deletion/cancel') {
      const userId = requireAuth(req); const deletion = store.deletionRequests.get(userId); if (!deletion || deletion.cancelledAt || deletion.completedAt) throw new HttpError(409, 'DELETION_NOT_SCHEDULED', '当前没有待执行的注销申请');
      deletion.cancelledAt = new Date().toISOString(); await persist('update account_deletion_requests set cancelled_at = $1 where user_id = $2 and cancelled_at is null and completed_at is null', [deletion.cancelledAt, dbUserId(userId)]); await persist('insert into auth_events (user_id, event_type) values ($1, $2)', [dbUserId(userId), 'deletion_cancelled']); return send(res, 200, {status: 'cancelled', cancelledAt: deletion.cancelledAt}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/devices') {
      const userId = requireAuth(req); const currentDeviceId = store.sessions.get(accessToken(req) ?? '')?.deviceId ?? (accessToken(req) === 'demo-token' ? 'demo-device' : undefined); return send(res, 200, store.devices.filter(item => item.userId === userId).map(item => ({...item, current: item.id === currentDeviceId})), requestId);
    }
    if (req.method === 'POST' && path === '/v1/devices') {
      const userId = requireAuth(req); const input = await body(req); const platform = String(input.platform ?? 'android'); const deviceId = String(input.deviceId ?? '').trim(); if (!deviceId || !['android', 'ios', 'harmony'].includes(platform)) throw new HttpError(422, 'VALIDATION_ERROR', '设备 ID 或平台不正确'); const ownedByOther = store.devices.some(item => item.id === deviceId && item.userId !== userId); if (ownedByOther) throw new HttpError(409, 'DEVICE_ALREADY_BOUND', '设备已绑定其他账号'); const device = {id: deviceId, userId, platform: platform as 'android' | 'ios' | 'harmony', name: String(input.name ?? '未命名设备').trim().slice(0, 120) || '未命名设备', pushToken: typeof input.pushToken === 'string' ? input.pushToken : undefined, lastSeenAt: new Date().toISOString()}; store.devices = [device, ...store.devices.filter(item => item.id !== device.id)]; await persist('insert into devices (id, user_id, platform, name, push_token, last_seen_at) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set name = excluded.name, push_token = excluded.push_token, last_seen_at = excluded.last_seen_at', [device.id, dbUserId(userId), device.platform, device.name, device.pushToken ?? null, device.lastSeenAt]); return send(res, 201, {...device, current: device.id === store.sessions.get(accessToken(req) ?? '')?.deviceId}, requestId);
    }
    const managedDevice = path.match(/^\/v1\/devices\/([^/]+)$/);
    if (managedDevice && req.method === 'DELETE') {
      const userId = requireAuth(req); const deviceId = managedDevice[1]; const device = store.devices.find(item => item.id === deviceId && item.userId === userId); if (!device) throw new HttpError(404, 'DEVICE_NOT_FOUND', '设备不存在');
      store.devices = store.devices.filter(item => item !== device); const sessions = [...store.sessions.entries()].filter(([, session]) => session.userId === userId && session.deviceId === deviceId); for (const [access, session] of sessions) { session.revokedAt = new Date().toISOString(); await persist('update refresh_sessions set revoked_at = now() where token_hash = $1', [tokenHash(session.refreshToken)]); await infrastructure.cacheDelete(`session:${tokenHash(session.refreshToken)}`); store.sessions.delete(access); }
      await persist('delete from devices where id = $1 and user_id = $2', [deviceId, dbUserId(userId)]); await persist('insert into auth_events (user_id, event_type, metadata) values ($1, $2, $3)', [dbUserId(userId), 'device_removed', JSON.stringify({deviceId})]); return send(res, 200, {removed: true, revokedSessions: sessions.length}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/health') { const infra = await infrastructure.status(); return send(res, 200, {status: 'ok', service: 'debao-server', adapters: {payment: paymentAdapter.name, sms: smsAdapter.name, push: pushAdapter.name, grading: gradingAdapter.name, ai: aiAdapter.name, media: mediaAdapter.name, wechatAuth: wechatAuthAdapter.name, carrierAuth: carrierAuthAdapter.name}, ...infra}, requestId); }
    if (req.method === 'GET' && path === '/v1/auth/providers') {
      return send(res, 200, {
        sms: {available: smsAdapter.name !== 'unconfigured'},
        wechat: {available: wechatAuthAdapter.name !== 'unconfigured'},
        oneClick: {available: carrierAuthAdapter.name !== 'unconfigured'},
      }, requestId);
    }
    if (req.method === 'POST' && path === '/v1/auth/wechat') {
      const input = await body(req); const code = String(input.code ?? '').trim(); const deviceId = String(input.deviceId ?? `device-${randomUUID()}`);
      if (!code) throw new HttpError(422, 'VALIDATION_ERROR', '微信授权 code 不能为空');
      let identity; try { identity = await wechatAuthAdapter.exchangeCode(code); } catch (error) { throw adapterFailure(wechatAuthAdapter.name, error); }
       const existing = store.identities.find(item => item.provider === 'wechat' && (item.providerUserId === identity.providerUserId || (identity.unionId && item.unionId === identity.unionId)));
       if (existing) { assertLoginAllowed(existing.userId); return send(res, 200, {status: 'authenticated', session: await issueSession(existing.userId, deviceId, 'login', 'wechat')}, requestId); }
      const bindingToken = `bind-${randomUUID()}`; const hash = tokenHash(bindingToken); const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
      store.bindingTickets.set(hash, {provider: 'wechat', providerUserId: identity.providerUserId, unionId: identity.unionId, nickname: identity.nickname, expiresAt});
      await persist('insert into auth_binding_tickets (token_hash, provider, provider_user_id, union_id, nickname, expires_at) values ($1, $2, $3, $4, $5, $6)', [hash, 'wechat', identity.providerUserId, identity.unionId ?? null, identity.nickname ?? null, expiresAt]);
      return send(res, 200, {status: 'binding_required', bindingToken, expiresIn: 600, wechatProfile: {nickname: identity.nickname}}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/auth/one-click') {
      const input = await body(req); const providerToken = String(input.providerToken ?? '').trim(); const deviceId = String(input.deviceId ?? `device-${randomUUID()}`);
      if (!providerToken) throw new HttpError(422, 'VALIDATION_ERROR', '运营商认证 token 不能为空');
      let verified; try { verified = await carrierAuthAdapter.verifyToken(providerToken); } catch (error) { throw adapterFailure(carrierAuthAdapter.name, error); }
      if (!/^1\d{10}$/.test(verified.phone)) throw new HttpError(502, 'PROVIDER_RESPONSE_INVALID', '运营商返回的手机号格式不正确');
       const userId = await resolveUserForPhone(verified.phone); assertLoginAllowed(userId); const bindingToken = typeof input.bindingToken === 'string' ? input.bindingToken : undefined;
      if (bindingToken) { const result = await bindingTicketByToken(bindingToken); if (!result) throw new HttpError(401, 'BINDING_TICKET_INVALID', '微信绑定已过期，请重新授权'); await bindWechatIdentity(userId, result.hash, result.ticket); }
      return send(res, 200, await issueSession(userId, deviceId, bindingToken ? 'bind_phone' : 'login', bindingToken ? 'wechat+carrier' : 'carrier'), requestId);
    }
    if (req.method === 'POST' && path === '/v1/auth/refresh') {
      const input = await body(req); const refresh = String(input.refreshToken ?? ''); const session = await sessionByRefreshToken(refresh);
      if (!session) throw new HttpError(401, 'AUTH_REQUIRED', 'refresh token 无效');
      for (const [access, active] of store.sessions.entries()) if (active.refreshToken === refresh) { active.revokedAt = new Date().toISOString(); store.sessions.delete(access); }
      await persist('update refresh_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [tokenHash(refresh)]);
      await infrastructure.cacheDelete(`session:${tokenHash(refresh)}`);
      return send(res, 200, await issueSession(session.userId, session.deviceId, 'refresh', 'refresh_token'), requestId);
    }
    if (req.method === 'GET' && path === '/v1/me') { const userId = requireAuth(req); return send(res, 200, publicProfile(profileFor(userId)), requestId); }
    if (req.method === 'GET' && path === '/v1/me/settings') {
      const userId = requireAuth(req);
      return send(res, 200, settingsFor(userId), requestId);
    }
    if (req.method === 'PATCH' && path === '/v1/me/settings') {
      const userId = requireAuth(req);
      const input = await body(req);
      const current = settingsFor(userId);
      const next: UserSettings = {
        ...current,
        ...(typeof input.learningReminders === 'boolean' ? {learningReminders: input.learningReminders} : {}),
        ...(typeof input.courseUpdates === 'boolean' ? {courseUpdates: input.courseUpdates} : {}),
        ...(typeof input.orderNotifications === 'boolean' ? {orderNotifications: input.orderNotifications} : {}),
        updatedAt: new Date().toISOString(),
      };
      if (input.learningReminders === undefined && input.courseUpdates === undefined && input.orderNotifications === undefined) {
        throw new HttpError(422, 'VALIDATION_ERROR', '至少提供一项设置');
      }
      store.userSettings.set(userId, next);
      await persist('insert into user_settings (user_id, learning_reminders, course_updates, order_notifications, updated_at) values ($1, $2, $3, $4, $5) on conflict (user_id) do update set learning_reminders = excluded.learning_reminders, course_updates = excluded.course_updates, order_notifications = excluded.order_notifications, updated_at = excluded.updated_at', [dbUserId(userId), next.learningReminders, next.courseUpdates, next.orderNotifications, next.updatedAt]);
      return send(res, 200, next, requestId);
    }
    if (req.method === 'POST' && path === '/v1/auth/logout') { const token = accessToken(req); requireAuth(req); if (token) { const session = store.sessions.get(token); if (session) { session.revokedAt = new Date().toISOString(); await persist('update refresh_sessions set revoked_at = now() where token_hash = $1', [tokenHash(session.refreshToken)]); await infrastructure.cacheDelete(`session:${tokenHash(session.refreshToken)}`); } } return send(res, 200, {loggedOut: true}, requestId); }
    if (req.method === 'GET' && path === '/v1/notifications') {
      const userId = requireAuth(req); const rawItems = notificationItemsFor(userId).map(item => ({...item, time: item.createdAt}));
      const hasPagination = ['cursor', 'limit', 'unreadOnly', 'page', 'pageSize'].some(key => url.searchParams.has(key));
      if (!hasPagination) return send(res, 200, rawItems, requestId);
      const unreadOnly = url.searchParams.get('unreadOnly') === 'true'; const filtered = unreadOnly ? rawItems.filter(item => !item.read) : rawItems;
      const pageSize = parsePositiveInteger(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'), 20, 1, 100, 'limit');
      const page = parsePositiveInteger(url.searchParams.get('page'), 1, 1, 1_000_000, 'page');
      const cursor = url.searchParams.has('cursor') ? parsePositiveInteger(url.searchParams.get('cursor'), 0, 0, 1_000_000, 'cursor') : (page - 1) * pageSize;
      const items = filtered.slice(cursor, cursor + pageSize);
      return send(res, 200, {items, total: filtered.length, unreadCount: rawItems.filter(item => !item.read).length, ...(cursor + pageSize < filtered.length ? {nextCursor: String(cursor + pageSize)} : {})}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/notifications/permission') {
      requireAuth(req); return send(res, 200, {granted: false, reason: '系统通知权限需由三端原生模块申请'}, requestId);
    }
    const notificationReadMatch = path.match(/^\/v1\/notifications\/([^/]+)\/read$/);
    if (notificationReadMatch && req.method === 'POST') {
      const userId = requireAuth(req); const notificationId = notificationReadMatch[1];
      if (!notificationItemsFor(userId).some(item => item.id === notificationId)) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', '通知不存在');
      store.notificationReceipts.add(`${userId}:${notificationId}`);
      await persist('insert into user_notification_receipts (user_id, notification_id) values ($1, $2) on conflict (user_id, notification_id) do update set read_at = now()', [dbUserId(userId), notificationId]);
      return send(res, 200, {id: notificationId, read: true}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/notifications/read-all') {
      const userId = requireAuth(req); const items = notificationItemsFor(userId); const now = new Date().toISOString();
      for (const item of items) { store.notificationReceipts.add(`${userId}:${item.id}`); await persist('insert into user_notification_receipts (user_id, notification_id, read_at) values ($1, $2, $3) on conflict (user_id, notification_id) do update set read_at = excluded.read_at', [dbUserId(userId), item.id, now]); }
      return send(res, 200, {read: items.length, readAt: now}, requestId);
    }
    const announcementReadMatch = path.match(/^\/v1\/announcements\/([^/]+)\/(read|close)$/);
    if (announcementReadMatch && req.method === 'POST') {
      const userId = requireAuth(req); const announcementId = decodeURIComponent(announcementReadMatch[1]); const announcement = store.announcements.find(item => item.id === announcementId && announcementVisibleTo(item, userId));
      if (!announcement) throw new HttpError(404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在');
      const notificationId = `announcement:${announcement.id}`; const key = `${userId}:${notificationId}`; const action = announcementReadMatch[2]; store.notificationReceipts.add(key);
      if (action === 'close') store.notificationClosures.add(key);
      await persist('insert into user_notification_receipts (user_id, notification_id, read_at, closed_at) values ($1, $2, now(), $3) on conflict (user_id, notification_id) do update set read_at = now(), closed_at = coalesce(excluded.closed_at, user_notification_receipts.closed_at)', [dbUserId(userId), notificationId, action === 'close' ? new Date().toISOString() : null]);
      return send(res, 200, {id: announcement.id, read: true, ...(action === 'close' ? {closed: true} : {})}, requestId);
    }
    const announcementDetailMatch = path.match(/^\/v1\/announcements\/([^/]+)$/);
    if (announcementDetailMatch && req.method === 'GET') {
      const userId = requireAuth(req); const announcement = store.announcements.find(item => item.id === decodeURIComponent(announcementDetailMatch[1]) && announcementVisibleTo(item, userId));
      if (!announcement) throw new HttpError(404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在');
      return send(res, 200, publicAnnouncement(announcement, userId), requestId);
    }
    if (req.method === 'GET' && path === '/v1/question-subjects') {
      return send(res, 200, store.subjects.map(subject => ({
        ...subject,
        questionCount: store.questions.filter(question => question.subjectId === subject.id && question.status === 'published').length +
          store.learningQuestionBankQuestions.filter(question => question.subjectId === subject.id && question.category === 'objective' && question.status === 'published' && !store.questions.some(item => item.id === question.id)).length,
      })), requestId);
    }
    if (req.method === 'GET' && path === '/v1/question-papers') {
      return send(res, 200, store.papers.filter(paper => paper.status === 'published').map(paper => ({
        id: paper.id, title: paper.name, year: paper.year, volume: paper.volume, ...(paper.productId ? {productId: paper.productId} : {}),
        questionCount: paper.questionIds.length, durationMinutes: paper.durationMinutes, mode: paper.mode,
      })), requestId);
    }
    if (req.method === 'POST' && path === '/v1/question-sessions') {
      const userId = requireAuth(req);
      const input = await body(req);
      const modeValue = String(input.mode ?? 'chapter');
      if (!['chapter', 'year', 'random', 'exam'].includes(modeValue)) throw new HttpError(422, 'VALIDATION_ERROR', '答题模式不正确');
      const mode = modeValue as ObjectiveSession['mode'];
      const requestedQuestionType = typeof input.questionType === 'string' && input.questionType.trim() ? input.questionType.trim() : undefined;
      if (requestedQuestionType && !['true_false', 'single', 'multiple', 'indeterminate'].includes(requestedQuestionType)) throw new HttpError(422, 'VALIDATION_ERROR', '题型筛选不正确');
      const requestedKey = String(req.headers['idempotency-key'] ?? input.idempotencyKey ?? '').trim() || undefined;
      if (requestedKey && (requestedKey.length < 8 || requestedKey.length > 120)) throw new HttpError(422, 'VALIDATION_ERROR', 'Idempotency-Key 格式不正确');
      if (requestedKey) {
        const existing = store.objectiveSessions.find(item => item.userId === userId && (item.createIdempotencyKey ?? item.idempotencyKey) === requestedKey);
        if (existing) return send(res, 200, objectiveSessionView(existing), requestId);
      }
      const subjectId = typeof input.subjectId === 'string' && input.subjectId.trim() ? input.subjectId.trim() : undefined;
      if (subjectId && !store.subjects.some(item => item.id === subjectId) && !store.learningQuestionBankQuestions.some(item => item.subjectId === subjectId)) throw new HttpError(422, 'VALIDATION_ERROR', '科目不存在');
      const requestedPaperId = typeof input.paperId === 'string' && input.paperId.trim() ? input.paperId.trim() : undefined;
      const paper = requestedPaperId ? store.papers.find(item => item.id === requestedPaperId && item.status === 'published') : undefined;
      const learningPaper = requestedPaperId ? store.learningAssessmentPapers.find(item => item.id === requestedPaperId && item.status === 'published') : undefined;
      if (requestedPaperId && !paper && !learningPaper) throw new HttpError(404, 'QUESTION_PAPER_NOT_FOUND', '试卷不存在或尚未发布');
      const requestedLearningTaskId = typeof input.learningTaskId === 'string' && input.learningTaskId.trim() ? input.learningTaskId.trim() : undefined;
      if (requestedLearningTaskId) {
        const learningPlanIds = new Set(store.learningPlans.filter(item => item.userId === userId).map(item => item.id));
        const learningTask = store.learningTasks.find(item => item.id === requestedLearningTaskId && learningPlanIds.has(item.planId));
        if (!learningTask) throw new HttpError(404, 'LEARNING_TASK_NOT_FOUND', '学习任务不存在或不属于当前用户');
        if (!['question', 'assessment'].includes(learningTask.contentType ?? '')) throw new HttpError(422, 'LEARNING_TASK_TYPE_INVALID', '当前学习任务不是客观题任务');
      }
      if (paper?.mode === 'advanced') { const paidProductId = paper.productId; const hasEntitlement = Boolean(paidProductId) && store.orders.some(item => item.userId === userId && item.productId === paidProductId && item.status === 'paid'); if (!paidProductId || !hasEntitlement) throw new HttpError(403, 'ADVANCED_EXAM_REQUIRES_PAYMENT', '进阶考试需要购买指定商品后参加'); }
      const learningBankCandidates = store.learningQuestionBankQuestions.map(learningBankQuestionAsObjective).filter((item): item is Question => Boolean(item));
      let candidates = paper || learningPaper
        ? (paper?.questionIds ?? learningPaper?.questionIds ?? []).map(id => store.questions.find(question => question.id === id) ?? learningBankCandidates.find(question => question.id === id)).filter((item): item is Question => Boolean(item))
        : [...store.questions, ...learningBankCandidates].filter(item => isPublishedQuestion(item) && questionMatchesSubject(item, subjectId ?? null));
      candidates = candidates.filter(item => isPublishedQuestion(item) && (!subjectId || questionMatchesSubject(item, subjectId)));
      if (requestedQuestionType) candidates = candidates.filter(item => (item.questionType ?? 'single') === requestedQuestionType);
      if (Array.isArray(input.questionIds) && input.questionIds.length > 0) {
        const requestedIds = [...new Set(input.questionIds.map(String))];
        const byId = new Map(candidates.map(item => [item.id, item]));
        candidates = requestedIds.map(id => byId.get(id)).filter((item): item is Question => Boolean(item));
        if (candidates.length !== requestedIds.length) throw new HttpError(422, 'QUESTION_NOT_AVAILABLE', '所选题目不存在、未发布或不属于当前科目');
      }
      const requestedLimit = input.limit === undefined ? (mode === 'exam' ? 100 : 20) : Number(input.limit);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) throw new HttpError(422, 'VALIDATION_ERROR', '题量必须是 1 到 100 的整数');
      if (!paper && !learningPaper && mode === 'random') candidates = [...candidates].sort(() => Math.random() - 0.5);
      candidates = candidates.slice(0, requestedLimit);
      if (!candidates.length) throw new HttpError(404, 'NO_PUBLISHED_QUESTIONS', '当前没有可作答题目');
      const durationSeconds = input.durationSeconds === undefined ? (mode === 'exam' ? 120 * 60 : Math.max(15 * 60, candidates.length * 90)) : Number(input.durationSeconds);
      if (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 8 * 3600) throw new HttpError(422, 'VALIDATION_ERROR', '答题时长必须在 1 分钟到 8 小时之间');
      const now = new Date().toISOString();
      const questions: ObjectiveQuestionSnapshot[] = candidates.map(item => ({id: item.id, ...(item.subjectId ? {subjectId: item.subjectId} : {}), stem: item.stem, options: item.options, answer: item.answer, ...(item.answerIndexes?.length ? {answerIndexes: [...item.answerIndexes]} : {}), ...(item.questionType ? {questionType: item.questionType} : {}), analysis: item.analysis, ...(item.explanationMediaType ? {explanationMediaType: item.explanationMediaType} : {}), ...(item.explanationMediaReference ? {explanationMediaReference: item.explanationMediaReference} : {}), version: item.version ?? 1, ...(item.source ? {source: item.source} : {})}));
      const session: ObjectiveSession = {id: `osession-${randomUUID()}`, userId, mode, title: String(input.title ?? (mode === 'exam' ? '客观题考试' : '客观题练习')).trim().slice(0, 200) || '客观题练习', ...(subjectId ? {subjectId} : {}), ...(paper ? {paperId: paper.id} : {}), ...(requestedLearningTaskId ? {learningTaskId: requestedLearningTaskId} : {}), questionIds: questions.map(item => item.id), questions, answers: [], durationSeconds, startedAt: now, expiresAt: new Date(Date.now() + durationSeconds * 1000).toISOString(), status: 'in_progress', ...(requestedKey ? {createIdempotencyKey: requestedKey} : {}), createdAt: now, updatedAt: now};
      store.objectiveSessions.unshift(session);
      await persist('insert into objective_sessions (id, user_id, mode, title, subject_id, paper_id, learning_task_id, question_ids, questions_snapshot, answers, duration_seconds, started_at, expires_at, status, idempotency_key, create_idempotency_key, submission_idempotency_key, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $15, null, $12, $12)', [session.id, dbUserId(userId), session.mode, session.title, session.subjectId ?? null, session.paperId ?? null, session.learningTaskId ?? null, JSON.stringify(session.questionIds), JSON.stringify(session.questions), JSON.stringify(session.answers), session.durationSeconds, session.startedAt, session.expiresAt, session.status, session.createIdempotencyKey ?? null]);
      return send(res, 201, objectiveSessionView(session), requestId);
    }
    if (req.method === 'GET' && path === '/v1/question-sessions') {
      const userId = requireAuth(req); const status = url.searchParams.get('status');
      if (status && !['in_progress', 'submitted', 'expired'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '答题会话状态不正确');
      const sessions = store.objectiveSessions.filter(item => item.userId === userId && (!status || item.status === status)).map(item => objectiveSessionView(item, item.status === 'submitted'));
      return send(res, 200, {items: sessions, total: sessions.length}, requestId);
    }
    const objectiveSessionMatch = path.match(/^\/v1\/question-sessions\/([^/]+)$/);
    if (objectiveSessionMatch && req.method === 'GET') {
      const userId = requireAuth(req); const session = store.objectiveSessions.find(item => item.id === objectiveSessionMatch[1] && item.userId === userId);
      if (!session) throw new HttpError(404, 'QUESTION_SESSION_NOT_FOUND', '答题会话不存在');
      if (session.status === 'in_progress' && Date.parse(session.expiresAt) <= Date.now()) { session.status = 'expired'; session.updatedAt = new Date().toISOString(); await persist('update objective_sessions set status = $1, updated_at = $2 where id = $3 and user_id = $4', [session.status, session.updatedAt, session.id, dbUserId(userId)]); }
      return send(res, 200, objectiveSessionView(session, session.status === 'submitted'), requestId);
    }
    const objectiveAnswerCollection = path.match(/^\/v1\/question-sessions\/([^/]+)\/answers$/);
    const objectiveAnswerItem = path.match(/^\/v1\/question-sessions\/([^/]+)\/answers\/([^/]+)$/);
    if ((objectiveAnswerCollection || objectiveAnswerItem) && (req.method === 'PUT' || req.method === 'PATCH')) {
      const userId = requireAuth(req); const sessionId = (objectiveAnswerCollection ?? objectiveAnswerItem)![1]; const input = await body(req);
      const session = store.objectiveSessions.find(item => item.id === sessionId && item.userId === userId);
      if (!session) throw new HttpError(404, 'QUESTION_SESSION_NOT_FOUND', '答题会话不存在');
      if (session.status !== 'in_progress') throw new HttpError(409, 'QUESTION_SESSION_CLOSED', '答题会话已经结束');
      if (Date.parse(session.expiresAt) <= Date.now()) { session.status = 'expired'; session.updatedAt = new Date().toISOString(); await persist('update objective_sessions set status = $1, updated_at = $2 where id = $3 and user_id = $4', [session.status, session.updatedAt, session.id, dbUserId(userId)]); throw new HttpError(409, 'QUESTION_SESSION_EXPIRED', '答题时间已结束'); }
      const questionId = objectiveAnswerItem ? objectiveAnswerItem[2] : String(input.questionId ?? ''); const question = session.questions.find(item => item.id === questionId);
      if (!question) throw new HttpError(404, 'QUESTION_NOT_IN_SESSION', '题目不属于当前答题会话');
      const answers = objectiveAnswerValues(input.answers, question.options.length); if (!['multiple', 'indeterminate'].includes(question.questionType ?? 'single') && answers.length > 1) throw new HttpError(422, 'VALIDATION_ERROR', '判断题和单选题只能选择一个答案');
      const updatedAt = new Date().toISOString(); const existing = session.answers.find(item => item.questionId === questionId);
      if (existing) { existing.answers = answers; existing.updatedAt = updatedAt; } else session.answers.push({questionId, answers, updatedAt});
      session.updatedAt = updatedAt;
      await persist('update objective_sessions set answers = $1::jsonb, updated_at = $2 where id = $3 and user_id = $4 and status = \'in_progress\'', [JSON.stringify(session.answers), updatedAt, session.id, dbUserId(userId)]);
      return send(res, 200, {questionId, answers, updatedAt}, requestId);
    }
    const objectiveSubmitMatch = path.match(/^\/v1\/question-sessions\/([^/]+)\/submit$/);
    if (objectiveSubmitMatch && req.method === 'POST') {
      const userId = requireAuth(req); const input = await body(req); const session = store.objectiveSessions.find(item => item.id === objectiveSubmitMatch[1] && item.userId === userId);
      if (!session) throw new HttpError(404, 'QUESTION_SESSION_NOT_FOUND', '答题会话不存在');
      if (session.status === 'submitted' && session.reportId) { const report = store.objectiveReports.find(item => item.id === session.reportId); if (report) return send(res, 200, report, requestId); }
      if (session.status === 'expired' || (session.status === 'in_progress' && Date.parse(session.expiresAt) <= Date.now())) { session.status = 'expired'; session.updatedAt = new Date().toISOString(); await persist('update objective_sessions set status = $1, updated_at = $2 where id = $3 and user_id = $4', [session.status, session.updatedAt, session.id, dbUserId(userId)]); throw new HttpError(409, 'QUESTION_SESSION_EXPIRED', '答题时间已结束，无法交卷'); }
      const idempotencyKey = String(req.headers['idempotency-key'] ?? input.idempotencyKey ?? '').trim();
      if (idempotencyKey.length < 8 || idempotencyKey.length > 120) throw new HttpError(422, 'IDEMPOTENCY_KEY_REQUIRED', '交卷必须携带有效的 Idempotency-Key');
      const existingByKey = store.objectiveSessions.find(item => item.userId === userId && item.submissionIdempotencyKey === idempotencyKey && item.status === 'submitted');
      if (existingByKey?.reportId) { const report = store.objectiveReports.find(item => item.id === existingByKey.reportId); if (report) return send(res, 200, report, requestId); }
      if (session.submissionIdempotencyKey && session.submissionIdempotencyKey !== idempotencyKey) throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', '该答题会话已经使用其他幂等键交卷');
      session.submissionIdempotencyKey = idempotencyKey;
      const submittedAt = new Date().toISOString(); const report = objectiveReportFor(session, submittedAt); session.status = 'submitted'; session.reportId = report.id; session.submittedAt = submittedAt; session.updatedAt = submittedAt; store.objectiveReports.unshift(report);
      for (const result of report.results) {
        const snapshot = session.questions.find(item => item.id === result.questionId);
        const submission = {id: randomUUID(), userId, questionId: result.questionId, answers: [...result.answers], correct: result.correct, createdAt: submittedAt, ...(snapshot ? {questionSnapshot: objectiveSubmissionSnapshot(snapshot)} : {})};
        store.submissions.unshift(submission);
        await persist('insert into question_submissions (id, user_id, question_id, answers, score, question_snapshot, created_at) values ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)', [submission.id, dbUserId(userId), submission.questionId, JSON.stringify(submission.answers), result.correct ? 1 : 0, snapshot ? JSON.stringify(snapshot) : null, submittedAt]);
        if (!result.correct) {
          const lastAnswer = result.answers.join(','); const old = store.mistakes.find(item => item.userId === userId && item.questionId === result.questionId);
          if (old) { old.wrongCount += 1; old.lastAnswer = lastAnswer; old.resolved = false; } else store.mistakes.unshift({id: `mistake:${result.questionId}`, userId, questionId: result.questionId, wrongCount: 1, lastAnswer, resolved: false});
          await persist('insert into mistakes (user_id, question_id, wrong_count, last_answer, resolved_at) values ($1, $2, $3, $4, null) on conflict (user_id, question_id) do update set wrong_count = mistakes.wrong_count + 1, last_answer = excluded.last_answer, resolved_at = null', [dbUserId(userId), result.questionId, lastAnswer]);
        }
      }
      await persist('update objective_sessions set answers = $1::jsonb, status = $2, submission_idempotency_key = $3, idempotency_key = coalesce(idempotency_key, create_idempotency_key), report_id = $4, submitted_at = $5, updated_at = $5 where id = $6 and user_id = $7', [JSON.stringify(session.answers), session.status, session.submissionIdempotencyKey, session.reportId, submittedAt, session.id, dbUserId(userId)]);
      await persist('insert into objective_reports (id, session_id, user_id, mode, title, total, answered, correct, score, max_score, results, subject_stats, submitted_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)', [report.id, report.sessionId, dbUserId(userId), report.mode, report.title, report.total, report.answered, report.correct, report.score, report.maxScore, JSON.stringify(report.results), JSON.stringify(report.subjectStats), report.submittedAt]);
      return send(res, 201, report, requestId);
    }
    const objectiveReportMatch = path.match(/^\/v1\/question-sessions\/([^/]+)\/report$/);
    if (objectiveReportMatch && req.method === 'GET') {
      const userId = requireAuth(req); const session = store.objectiveSessions.find(item => item.id === objectiveReportMatch[1] && item.userId === userId); if (!session) throw new HttpError(404, 'QUESTION_SESSION_NOT_FOUND', '答题会话不存在');
      if (!session.reportId) throw new HttpError(404, 'QUESTION_REPORT_NOT_READY', '答题报告尚未生成'); const report = store.objectiveReports.find(item => item.id === session.reportId); if (!report) throw new HttpError(404, 'QUESTION_REPORT_NOT_READY', '答题报告尚未生成'); return send(res, 200, report, requestId);
    }
    if (req.method === 'GET' && path === '/v1/questions') {
      requireAuth(req);
      const subject = url.searchParams.get('subjectId');
      const rawPage = url.searchParams.get('page');
      const rawPageSize = url.searchParams.get('pageSize');
      const page = parsePositiveInteger(rawPage, 1, 1, 1_000_000, 'page');
      const pageSize = parsePositiveInteger(rawPageSize, 20, 1, 50, 'pageSize');
      const filtered = store.questions.filter(item => isPublishedQuestion(item) && questionMatchesSubject(item, subject));
      return send(res, 200, {items: filtered.slice((page - 1) * pageSize, page * pageSize).map(item => publicObjectiveQuestion(item)), page, pageSize, total: filtered.length}, requestId);
    }
    const questionMatch = path.match(/^\/v1\/questions\/([^/]+)$/);
    if (questionMatch && req.method === 'GET') { requireAuth(req); const question = store.questions.find(item => item.id === questionMatch[1] && isPublishedQuestion(item)); if (!question) throw new HttpError(404, 'NOT_FOUND', '题目不存在'); return send(res, 200, publicObjectiveQuestion(question), requestId); }
    const draftMatch = path.match(/^\/v1\/question-drafts\/([^/]+)$/);
    if (draftMatch && (req.method === 'GET' || req.method === 'PUT')) {
      const userId = requireAuth(req);
      const questionId = draftMatch[1];
      if (!draftableQuestion(questionId)) throw new HttpError(404, 'NOT_FOUND', '题目不存在或已下架');
      const key = draftKey(userId, questionId);
      if (req.method === 'GET') {
        const draft = store.drafts.get(key);
        if (!draft) return send(res, 200, {questionId, answers: [], updatedAt: null}, requestId);
        return send(res, 200, {questionId: draft.questionId, answers: draft.answers, updatedAt: draft.updatedAt}, requestId);
      }
      const input = await body(req);
      if (typeof input.questionId !== 'string' || input.questionId !== questionId || !Array.isArray(input.answers)) throw new HttpError(422, 'VALIDATION_ERROR', '题目草稿参数不完整或题目不一致');
      const answers = input.answers.map(String);
      const updatedAt = new Date().toISOString();
      store.drafts.set(key, {userId, questionId, answers, updatedAt});
      // The legacy table keeps a foreign key to objective questions. Grading
      // rubrics can still use the same client contract, but are memory-backed
      // until their own durable answer-snapshot table is introduced.
      if (store.questions.some(item => item.id === questionId)) {
        await persist('insert into question_drafts (user_id, question_id, answers, updated_at) values ($1, $2, $3::jsonb, $4) on conflict (user_id, question_id) do update set answers = excluded.answers, updated_at = excluded.updated_at', [dbUserId(userId), questionId, JSON.stringify(answers), updatedAt]);
      }
      return send(res, 200, {saved: true, questionId, answers, updatedAt}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/question-submissions') {
      const userId = requireAuth(req);
      const input = await body(req);
      const idempotencyKey = String(req.headers['idempotency-key'] ?? input.idempotencyKey ?? '').trim() || undefined;
      if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 120)) throw new HttpError(422, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 长度必须为 8 到 120 个字符');
      const questionId = String(input.questionId ?? '').trim();
      if (idempotencyKey) {
        const existing = store.submissions.find(item => item.userId === userId && item.idempotencyKey === idempotencyKey);
        if (existing) {
          const requestedAnswers = existing.questionSnapshot
            ? objectiveAnswerValues(input.answers, existing.questionSnapshot.options.length)
            : Array.isArray(input.answers) ? input.answers.map(item => String(item)) : [];
          if (existing.questionId !== questionId || existing.answers.join(',') !== requestedAnswers.join(',')) throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', '该幂等键已用于其他答题提交');
          return send(res, 200, {submissionId: existing.id, questionId: existing.questionId, correct: existing.correct}, requestId);
        }
      }
      const question = store.questions.find(item => item.id === questionId);
      const subjective = questionId.startsWith('subjective-');
      if ((!question && !subjective) || !Array.isArray(input.answers)) throw new HttpError(422, 'VALIDATION_ERROR', '题目或答案无效');
      if (question && !isPublishedQuestion(question)) throw new HttpError(404, 'NOT_FOUND', '题目不存在');

      // Resolve an existing request before touching the question or mistake
      // counters. This makes retries safe even when the caller has lost the
      // original response.

      let answers: string[];
      let correct = false;
      let snapshot: QuestionSubmissionSnapshot | undefined;
      if (question) {
        answers = objectiveAnswerValues(input.answers, question.options.length);
        if (!['multiple', 'indeterminate'].includes(question.questionType ?? 'single') && answers.length > 1) throw new HttpError(422, 'VALIDATION_ERROR', '判断题和单选题只能选择一个答案');
        correct = objectiveAnswersEqual(answers, questionAnswerIndexes(question));
        snapshot = questionSnapshot(question);
      } else {
        answers = input.answers.map(item => String(item));
      }
      const submission = {id: randomUUID(), userId, questionId, answers, correct, createdAt: new Date().toISOString(), ...(snapshot ? {questionSnapshot: snapshot} : {}), ...(idempotencyKey ? {idempotencyKey} : {})};
      store.submissions.unshift(submission);
      await persist('insert into question_submissions (id, user_id, question_id, answers, score, question_snapshot, idempotency_key) values ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7) on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing', [submission.id, dbUserId(userId), question ? questionId : null, JSON.stringify(submission.answers), question ? (correct ? 1 : 0) : null, snapshot ? JSON.stringify(snapshot) : null, idempotencyKey ?? null]);
      if (question && !correct) {
        const lastAnswer = answers.join(',');
        const old = store.mistakes.find(item => item.userId === userId && item.questionId === questionId);
        if (old) { old.wrongCount += 1; old.lastAnswer = lastAnswer; old.resolved = false; }
        else store.mistakes.unshift({id: `mistake:${questionId}`, userId, questionId, wrongCount: 1, lastAnswer, resolved: false});
        await persist('insert into mistakes (user_id, question_id, wrong_count, last_answer, resolved_at) values ($1, $2, 1, $3, null) on conflict (user_id, question_id) do update set wrong_count = mistakes.wrong_count + 1, last_answer = excluded.last_answer, resolved_at = null', [dbUserId(userId), questionId, lastAnswer]);
      }
      return send(res, 200, {submissionId: submission.id, questionId, correct}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/question-records') {
      const userId = requireAuth(req);
      const rawPage = url.searchParams.get('page');
      const rawPageSize = url.searchParams.get('pageSize');
      const subjectId = url.searchParams.get('subjectId')?.trim() || undefined;
      const mode = url.searchParams.get('mode')?.trim() || undefined;
      const base = store.submissions
        .filter(item => item.userId === userId)
        .map(item => {
          const question = store.questions.find(candidate => candidate.id === item.questionId);
          const derivedMode = item.questionId.startsWith('subjective-') ? 'subjective' : 'objective';
          return {
            ...item,
            ...(question?.subjectId ? {subjectId: question.subjectId} : {}),
            mode: derivedMode,
            title: question?.stem ? `题目 ${question.id}` : `题目 ${item.questionId}`,
            total: 1,
            correctCount: item.correct ? 1 : 0,
          };
        })
        .filter(item => !subjectId || item.subjectId === subjectId)
        .filter(item => !mode || item.mode === mode);
      // Keep the original array response for legacy RN clients that do not
      // request pagination. New clients opt into a stable page contract.
      if (rawPage == null && rawPageSize == null && !subjectId && !mode) {
        return send(res, 200, base, requestId);
      }
      const page = parsePositiveInteger(rawPage, 1, 1, 1_000_000, 'page');
      const pageSize = parsePositiveInteger(rawPageSize, 20, 1, 50, 'pageSize');
      const start = (page - 1) * pageSize;
      const answered = base.reduce((sum, item) => sum + item.total, 0);
      const correct = base.reduce((sum, item) => sum + item.correctCount, 0);
      return send(res, 200, {
        items: base.slice(start, start + pageSize),
        page,
        pageSize,
        total: base.length,
        answered,
        correct,
      }, requestId);
    }
    if (req.method === 'GET' && path === '/v1/learning/question-records') {
      const userId = requireAuth(req);
      const userLearningTasks = store.learningTasks.filter(task =>
        store.learningPlans.some(plan => plan.id === task.planId && plan.userId === userId));
      const learningSessionIds = new Set(store.objectiveSessions
        .filter(item => item.userId === userId && (item.learningTaskId || userLearningTasks.some(task =>
          task.contentType === 'assessment'
            ? task.contentId === item.paperId
            : task.contentType === 'question' && Boolean(task.contentId) && item.questionIds.includes(task.contentId!))))
        .map(item => item.id));
      const records = store.objectiveReports
        .filter(report => report.userId === userId && learningSessionIds.has(report.sessionId))
        .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
        .flatMap(report => report.results.map((result, index) => ({
          id: `${report.id}:${result.questionId}:${index}`,
          questionId: result.questionId,
          answers: result.answers,
          correct: result.correct,
          createdAt: report.submittedAt,
          analysis: result.analysis,
          ...(result.subjectId ? {subjectId: result.subjectId} : {}),
          mode: report.mode,
          title: report.title,
          total: 1,
          correctCount: result.correct ? 1 : 0,
        })));
      return send(res, 200, records, requestId);
    }
    const reportMatch = path.match(/^\/v1\/question-submissions\/([^/]+)\/report$/);
    if (reportMatch && req.method === 'GET') {
      const userId = requireAuth(req);
      const submission = store.submissions.find(item => item.id === reportMatch[1] && item.userId === userId);
      if (!submission) throw new HttpError(404, 'NOT_FOUND', '答题记录不存在');
      // Prefer the immutable metadata captured at submission time. Older rows
      // may not have a snapshot and are allowed to fall back to the live row.
      const question = store.questions.find(item => item.id === submission.questionId);
      const snapshot = submission.questionSnapshot ?? (question ? questionSnapshot(question) : undefined);
      return send(res, 200, {
        ...submission,
        ...(snapshot ? {
          ...(snapshot.subjectId ? {subjectId: snapshot.subjectId} : {}),
          stem: snapshot.stem,
          options: snapshot.options,
          ...(snapshot.questionType ? {questionType: snapshot.questionType} : {}),
          version: snapshot.version,
          correctAnswers: questionAnswerIndexes(snapshot).map(String),
        } : {}),
        analysis: snapshot?.analysis ?? '',
      }, requestId);
    }
    if (req.method === 'POST' && (path === '/v1/ai/conversations' || path === '/v1/ai/sessions')) {
      const userId = requireAuth(req);
      const input = await body(req);
      const clientRequestId = String(req.headers['idempotency-key'] ?? input.clientRequestId ?? '').trim() || undefined;
      if (clientRequestId && (clientRequestId.length < 8 || clientRequestId.length > 160)) throw new HttpError(422, 'IDEMPOTENCY_KEY_INVALID', '会话幂等键长度必须为 8 到 160 个字符');
      if (clientRequestId) {
        const existingId = store.aiSessionRequestKeys.get(`${userId}:${clientRequestId}`);
        if (existingId) return send(res, 200, aiSessionView(aiSessionFor(existingId, userId)), requestId);
      }
      const title = String(input.title ?? '新对话').trim();
      if (!title || title.length > 160) throw new HttpError(422, 'VALIDATION_ERROR', '会话标题不能为空且不能超过 160 个字符');
      const now = new Date().toISOString();
      const session: AISession = {id: `ai-session-${randomUUID()}`, userId, title, ...(clientRequestId ? {clientRequestId} : {}), createdAt: now, updatedAt: now};
      store.aiSessions.unshift(session);
      if (clientRequestId) store.aiSessionRequestKeys.set(`${userId}:${clientRequestId}`, session.id);
      await persist('insert into ai_sessions (id, user_id, title, client_request_id, created_at, updated_at) values ($1, $2, $3, $4, $5, $5)', [session.id, dbUserId(userId), session.title, session.clientRequestId ?? null, now]);
      return send(res, 201, aiSessionView(session), requestId);
    }
    const aiConversationMatch = path.match(/^\/v1\/ai\/(?:conversations|sessions)\/([^/]+)$/);
    if (aiConversationMatch && req.method === 'GET') {
      const userId = requireAuth(req);
      return send(res, 200, aiSessionView(aiSessionFor(decodeURIComponent(aiConversationMatch[1]), userId), true), requestId);
    }
    if (aiConversationMatch && req.method === 'PATCH') {
      const userId = requireAuth(req); const session = aiSessionFor(decodeURIComponent(aiConversationMatch[1]), userId); const input = await body(req); const title = String(input.title ?? '').trim();
      if (!title || title.length > 160) throw new HttpError(422, 'VALIDATION_ERROR', '会话标题不能为空且不能超过 160 个字符');
      session.title = title; session.updatedAt = new Date().toISOString();
      await persist('update ai_sessions set title = $1, updated_at = $2 where id = $3 and user_id = $4 and deleted_at is null', [session.title, session.updatedAt, session.id, dbUserId(userId)]);
      return send(res, 200, aiSessionView(session), requestId);
    }
    if (aiConversationMatch && req.method === 'DELETE') {
      const userId = requireAuth(req); const session = aiSessionFor(decodeURIComponent(aiConversationMatch[1]), userId); session.deletedAt = new Date().toISOString(); session.updatedAt = session.deletedAt;
      await persist('update ai_sessions set deleted_at = $1, updated_at = $1 where id = $2 and user_id = $3 and deleted_at is null', [session.deletedAt, session.id, dbUserId(userId)]);
      return send(res, 200, {deleted: true, id: session.id}, requestId);
    }
    const aiMessagesMatch = path.match(/^\/v1\/ai\/(?:conversations|sessions)\/([^/]+)\/messages$/);
    if (aiMessagesMatch && req.method === 'GET') {
      const userId = requireAuth(req); const session = aiSessionFor(decodeURIComponent(aiMessagesMatch[1]), userId);
      return send(res, 200, {items: store.aiMessages.filter(item => item.sessionId === session.id).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), total: store.aiMessages.filter(item => item.sessionId === session.id).length}, requestId);
    }
    if (aiMessagesMatch && req.method === 'POST') {
      const userId = requireAuth(req); const session = aiSessionFor(decodeURIComponent(aiMessagesMatch[1]), userId); const input = await body(req);
      const content = String(input.content ?? input.prompt ?? '').trim();
      if (!content || content.length > 12_000) throw new HttpError(422, 'VALIDATION_ERROR', '问题不能为空且不能超过 12000 个字符');
      const clientRequestId = String(req.headers['idempotency-key'] ?? input.clientRequestId ?? '').trim() || undefined;
      if (clientRequestId && (clientRequestId.length < 8 || clientRequestId.length > 160)) throw new HttpError(422, 'IDEMPOTENCY_KEY_INVALID', '消息幂等键长度必须为 8 到 160 个字符');
      if (clientRequestId) {
        const assistantId = store.aiMessageRequestKeys.get(`${session.id}:${clientRequestId}`);
        if (assistantId) {
          const assistant = store.aiMessages.find(item => item.id === assistantId);
          const userMessage = store.aiMessages.find(item => item.sessionId === session.id && item.clientRequestId === clientRequestId && item.role === 'user');
          if (assistant) return send(res, 200, {session: aiSessionView(session), userMessage, assistantMessage: assistant}, requestId);
        }
      }
      try {
        assertAIQuota(userId);
      } catch (error) {
        await recordAIUsage({userId, sessionId: session.id, provider: aiAdapter.name, feature: 'conversation', status: 'blocked_quota', errorCode: error instanceof HttpError ? error.code : 'AI_QUOTA_EXCEEDED'});
        throw error;
      }
      let result: Awaited<ReturnType<typeof aiAdapter.reply>>;
      try {
        result = await aiAdapter.reply(content);
      } catch (error) {
        await recordAIUsage({userId, sessionId: session.id, provider: aiAdapter.name, feature: 'conversation', status: 'failed', errorCode: 'ADAPTER_UNAVAILABLE'});
        throw adapterFailure(aiAdapter.name, error);
      }
      const reply = String(result.reply ?? '').trim();
      if (!reply) throw new HttpError(502, 'AI_INVALID_RESPONSE', 'AI 返回内容为空');
      const now = new Date().toISOString();
      const userMessage: AIMessage = {id: `ai-message-${randomUUID()}`, sessionId: session.id, role: 'user', content, ...(clientRequestId ? {clientRequestId} : {}), createdAt: now};
      const assistantMessage: AIMessage = {id: `ai-message-${randomUUID()}`, sessionId: session.id, role: 'assistant', content: reply, ...(clientRequestId ? {clientRequestId: `${clientRequestId}:assistant`} : {}), createdAt: new Date(Date.now() + 1).toISOString()};
      store.aiMessages.push(userMessage, assistantMessage); session.updatedAt = assistantMessage.createdAt;
      if (clientRequestId) store.aiMessageRequestKeys.set(`${session.id}:${clientRequestId}`, assistantMessage.id);
      await persist('insert into ai_messages (id, session_id, role, content, client_request_id, created_at) values ($1, $2, $3, $4, $5, $6), ($7, $2, $8, $9, $10, $11)', [userMessage.id, session.id, userMessage.role, userMessage.content, userMessage.clientRequestId ?? null, userMessage.createdAt, assistantMessage.id, assistantMessage.role, assistantMessage.content, assistantMessage.clientRequestId ?? null, assistantMessage.createdAt]);
      await persist('update ai_sessions set updated_at = $1 where id = $2 and user_id = $3 and deleted_at is null', [session.updatedAt, session.id, dbUserId(userId)]);
      await recordAIUsage({userId, sessionId: session.id, messageId: assistantMessage.id, provider: aiAdapter.name, model: result.model, feature: 'conversation', status: 'completed', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costMinor: result.costMinor});
      await recordAIRisk(result, {userId, sessionId: session.id, messageId: assistantMessage.id});
      return send(res, 201, {session: aiSessionView(session), userMessage, assistantMessage}, requestId);
    }
    if (req.method === 'GET' && (path === '/v1/ai/conversations' || path === '/v1/ai/sessions')) {
      const userId = requireAuth(req); const limit = parsePositiveInteger(url.searchParams.get('limit'), 20, 1, 100, 'limit'); const cursor = parsePositiveInteger(url.searchParams.get('cursor'), 0, 0, 1_000_000, 'cursor');
      const all = store.aiSessions.filter(item => item.userId === userId && !item.deletedAt).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)); const items = all.slice(cursor, cursor + limit).map(item => aiSessionView(item));
      return send(res, 200, {items, total: all.length, ...(cursor + limit < all.length ? {nextCursor: String(cursor + limit)} : {})}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/ai/reply') {
      const userId = requireAuth(req); const input = await body(req); const prompt = String(input.prompt ?? '').trim();
      if (!prompt) throw new HttpError(422, 'VALIDATION_ERROR', '问题不能为空');
      try {
        assertAIQuota(userId);
      } catch (error) {
        await recordAIUsage({userId, provider: aiAdapter.name, feature: 'reply', status: 'blocked_quota', errorCode: error instanceof HttpError ? error.code : 'AI_QUOTA_EXCEEDED'});
        throw error;
      }
      try {
        const result = await aiAdapter.reply(prompt);
        await recordAIUsage({userId, provider: aiAdapter.name, model: result.model, feature: 'reply', status: 'completed', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costMinor: result.costMinor});
        await recordAIRisk(result, {userId});
        return send(res, 200, result, requestId);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        await recordAIUsage({userId, provider: aiAdapter.name, feature: 'reply', status: 'failed', errorCode: 'ADAPTER_UNAVAILABLE'});
        throw adapterFailure(aiAdapter.name, error);
      }
    }
    if (req.method === 'POST' && path === '/v1/media/prepare') {
      requireAuth(req); const input = await body(req); const kind = String(input.kind ?? 'media'); const courseId = String(input.courseId ?? '');
      if (!courseId || !store.courses.some(item => item.id === courseId)) throw new HttpError(404, 'NOT_FOUND', '课程不存在');
      try { return send(res, 200, await mediaAdapter.prepare(courseId, kind), requestId); } catch (error) { throw adapterFailure(mediaAdapter.name, error); }
    }
    if (req.method === 'GET' && path === '/v1/courses') {
      const userId = requireAuth(req);
      const progress = new Map(store.courseProgress.filter(item => item.userId === userId).map(item => [item.courseId, item.progress]));
      const now = Date.now();
      const entitlement = new Map(store.entitlements.filter(item => item.userId === userId && (!item.expiresAt || Date.parse(item.expiresAt) > now)).map(item => [item.courseId, item]));
      return send(res, 200, store.courses.filter(course => isPublishedCourse(course) && entitlement.has(course.id)).map(course => {
        const access = entitlement.get(course.id);
        return {
          ...course,
          progress: progress.get(course.id) ?? 0,
          hasAccess: Boolean(access),
          ...(access?.sourceOrderId ? {sourceOrderId: access.sourceOrderId} : {}),
          ...(access?.expiresAt ? {expiresAt: access.expiresAt} : {}),
        };
      }), requestId);
    }
    const courseMatch = path.match(/^\/v1\/courses\/([^/]+)$/);
    if (courseMatch && req.method === 'GET') {
      const userId = requireAuth(req);
      const course = store.courses.find(item => item.id === courseMatch[1] && isPublishedCourse(item));
      if (!course) throw new HttpError(404, 'NOT_FOUND', '课程不存在');
      const progress = store.courseProgress.find(item => item.userId === userId && item.courseId === course.id);
      const entitlement = store.entitlements.find(item => item.userId === userId && item.courseId === course.id && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()));
      if (!entitlement) throw new HttpError(404, 'COURSE_NOT_AVAILABLE', '课程不存在或暂无学习权限');
      const sections = store.courseSections.filter(section => section.courseId === course.id).sort((a, b) => a.sortOrder - b.sortOrder).map(section => ({...section, lessons: store.courseLessons.filter(lesson => lesson.sectionId === section.id).sort((a, b) => a.sortOrder - b.sortOrder).map(lesson => { const live = lesson.mediaKind === 'live' ? store.liveSessions.find(item => item.lessonId === lesson.id) : undefined; if (!live) return lesson; const liveSession = {id: live.id, courseId: live.courseId, lessonId: live.lessonId, title: live.title, teacher: live.teacher, startsAt: live.startsAt, endsAt: live.endsAt, status: live.status, provider: live.provider ?? 'tencent', replayAvailable: Boolean(live.recordingVideoId), ...(entitlement ? {playUrl: live.playUrl, recordingUrl: live.recordingUrl} : {})}; return {...lesson, liveSession}; })}));
      return send(res, 200, {
        ...course,
        progress: progress?.progress ?? 0,
        hasAccess: Boolean(entitlement),
        ...(entitlement?.sourceOrderId ? {sourceOrderId: entitlement.sourceOrderId} : {}),
        ...(entitlement?.expiresAt ? {expiresAt: entitlement.expiresAt} : {}),
        sections,
      }, requestId);
    }
    const entitlementMatch = path.match(/^\/v1\/courses\/([^/]+)\/entitlement$/);
    if (entitlementMatch && req.method === 'GET') {
      const userId = requireAuth(req);
      const course = store.courses.find(item => item.id === entitlementMatch[1] && isPublishedCourse(item));
      if (!course) throw new HttpError(404, 'NOT_FOUND', '课程不存在');
      const entitlement = store.entitlements.find(item => item.userId === userId && item.courseId === course.id);
      const active = entitlement && (!entitlement.expiresAt || Date.parse(entitlement.expiresAt) > Date.now());
      return send(res, 200, {
        hasAccess: Boolean(active),
        courseId: course.id,
        ...(entitlement?.sourceOrderId ? {sourceOrderId: entitlement.sourceOrderId} : {}),
        ...(entitlement?.expiresAt ? {expiresAt: entitlement.expiresAt} : {}),
      }, requestId);
    }
    const progressMatch = path.match(/^\/v1\/courses\/([^/]+)\/progress$/);
    if (progressMatch && req.method === 'POST') {
      const userId = requireAuth(req); const course = store.courses.find(item => item.id === progressMatch[1]);
      if (!course) throw new HttpError(404, 'NOT_FOUND', '课程不存在');
      if (!isPublishedCourse(course)) throw new HttpError(404, 'COURSE_NOT_AVAILABLE', '课程当前不可学习'); if (!store.entitlements.some(item => item.userId === userId && item.courseId === course.id && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()))) throw new HttpError(403, 'COURSE_ACCESS_REQUIRED', '请先开通该课程的学习权限');
      const input = await body(req); const current = store.courseProgress.find(item => item.userId === userId && item.courseId === course.id);
      const rawProgress = input.progress === undefined ? current?.progress ?? 0 : Number(input.progress);
      if (!Number.isFinite(rawProgress) || rawProgress < 0 || rawProgress > 100) throw new HttpError(422, 'VALIDATION_ERROR', '课程进度必须是 0 到 100 的数字');
      const nextProgress = Math.max(0, Math.min(100, rawProgress)); const updatedAt = new Date().toISOString();
      if (current) { current.progress = nextProgress; current.updatedAt = updatedAt; } else store.courseProgress.push({userId, courseId: course.id, progress: nextProgress, updatedAt});
      await persist('insert into user_course_progress (user_id, course_id, progress, updated_at) values ($1, $2, $3, $4) on conflict (user_id, course_id) do update set progress = excluded.progress, updated_at = excluded.updated_at', [dbUserId(userId), course.id, nextProgress, updatedAt]);
      return send(res, 200, {courseId: course.id, progress: nextProgress, updatedAt}, requestId);
    }

    if (req.method === 'POST' && path === '/v1/learning/activities') {
      const userId = requireAuth(req); const input = await body(req);
      const idempotencyKey = String(req.headers['idempotency-key'] ?? input.idempotencyKey ?? '').trim() || undefined;
      if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 160)) throw new HttpError(422, 'IDEMPOTENCY_KEY_INVALID', '学习活动幂等键长度必须为 8 到 160 个字符');
      if (idempotencyKey) {
        const existing = store.learningActivities.find(item => item.userId === userId && item.idempotencyKey === idempotencyKey);
        if (existing) {
          const candidate = validateLearningActivity({...input, idempotencyKey}, userId);
          if (existing.kind !== candidate.kind || existing.durationSeconds !== candidate.durationSeconds || existing.quantity !== candidate.quantity || existing.courseId !== candidate.courseId || existing.taskId !== candidate.taskId || existing.questionId !== candidate.questionId) throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', '学习活动幂等键已用于其他内容');
          return send(res, 200, existing, requestId);
        }
      }
      const activity = validateLearningActivity({...input, ...(idempotencyKey ? {idempotencyKey} : {})}, userId);
      if (activity.taskId) {
        const task = store.learningTasks.find(item => item.id === activity.taskId);
        const ownsTask = task && store.learningPlans.some(plan => plan.id === task.planId && plan.userId === userId);
        if (!ownsTask) throw new HttpError(404, 'TASK_NOT_FOUND', '学习任务不存在');
      }
      const now = new Date().toISOString();
      store.learningActivities.unshift(activity);
      if (activity.idempotencyKey) store.learningActivityKeys.add(learningActivityKey(userId, activity.idempotencyKey));
      await persist('insert into learning_activities (id, user_id, kind, subject_id, course_id, task_id, question_id, duration_seconds, quantity, idempotency_key, occurred_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing', [activity.id, dbUserId(userId), activity.kind, activity.subjectId ?? null, activity.courseId ?? null, activity.taskId ?? null, activity.questionId ?? null, activity.durationSeconds, activity.quantity, activity.idempotencyKey ?? null, activity.occurredAt]);
      return send(res, 201, activity, requestId);
    }
    if (req.method === 'GET' && path === '/v1/learning/activities') {
      const userId = requireAuth(req); const period = url.searchParams.get('period') ?? 'week'; const {start, end} = reportWindow(period); const startMs = start.getTime(); const endMs = end.getTime();
      const kind = url.searchParams.get('kind'); if (kind && !['question', 'course', 'task', 'reading'].includes(kind)) throw new HttpError(422, 'VALIDATION_ERROR', '活动类型不正确');
      const all = store.learningActivities.filter(item => item.userId === userId && Date.parse(item.occurredAt) >= startMs && Date.parse(item.occurredAt) <= endMs && (!kind || item.kind === kind)).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
      const limit = parsePositiveInteger(url.searchParams.get('limit'), 50, 1, 200, 'limit'); const cursor = parsePositiveInteger(url.searchParams.get('cursor'), 0, 0, 1_000_000, 'cursor'); const items = all.slice(cursor, cursor + limit);
      return send(res, 200, {items, total: all.length, durationSeconds: all.reduce((sum, item) => sum + item.durationSeconds, 0), quantity: all.reduce((sum, item) => sum + item.quantity, 0), ...(cursor + limit < all.length ? {nextCursor: String(cursor + limit)} : {})}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/learning/diagnostic') {
      const userId = requireAuth(req); const access = hasLearningCoachAccess(userId); const attempt = store.learningDiagnosticAttempts.find(item => item.userId === userId); const form = store.learningDiagnosticForms.find(item => item.id === 'initial-assessment');
      if (!access) return send(res, 200, {access: 'locked', productId: 'deen-private-coach', completed: false, form: form ? publicLearningDiagnosticForm(form) : undefined, dimensions: activeLearningDiagnosticDimensions().map(item => ({code: item.code, label: item.label})), questions: []}, requestId);
      const questions = form?.status === 'published' ? store.learningDiagnosticQuestions.filter(question => question.formId === form.id && question.status === 'published').sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)).map(publicLearningDiagnosticQuestion) : [];
      const classType = learningClassTypeForUser(userId);
      const assignment = attempt ? store.learningTeacherAssignments.find(item => item.attemptId === attempt.id) : undefined;
      return send(res, 200, {access: 'granted', productId: 'deen-private-coach', completed: Boolean(attempt), classType: classType ? publicLearningClassType(classType) : undefined, form: form ? publicLearningDiagnosticForm(form) : undefined, dimensions: activeLearningDiagnosticDimensions().map(item => ({code: item.code, label: item.label})), questions: attempt ? [] : questions, ...(attempt ? {result: {attemptId: attempt.id, scores: attempt.scores, submittedAt: attempt.submittedAt, assignment: assignment ? publicLearningTeacherAssignment(assignment) : undefined}} : {})}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/learning/diagnostic/submit') {
      const userId = requireAuth(req);
      if (!hasLearningCoachAccess(userId)) throw new HttpError(403, 'LEARNING_COACH_ACCESS_REQUIRED', '请先购买得恩私教后再开始学习诊断');
      const existing = store.learningDiagnosticAttempts.find(item => item.userId === userId);
      if (existing) throw new HttpError(409, 'DIAGNOSTIC_ALREADY_COMPLETED', '首次学习诊断已经完成');
      const input = await body(req); const attempt = scoreLearningDiagnostic(input, userId);
      if (!Number.isFinite(Date.parse(attempt.startedAt)) || Date.parse(attempt.startedAt) > Date.parse(attempt.submittedAt)) throw new HttpError(422, 'VALIDATION_ERROR', '诊断开始时间不正确');
      const classType = learningClassTypeForUser(userId);
      const stage = resolveLearningStage(attempt.scores, classType?.id);
      const teacher = stage ? activeTeacherForStage(stage.id) : undefined;
      const assignment: LearningTeacherAssignment = {id: randomUUID(), userId, attemptId: attempt.id, ...(classType ? {classTypeId: classType.id} : {}), ...(stage ? {stageId: stage.id} : {}), ...(teacher ? {teacherId: teacher.id} : {}), scores: attempt.scores, status: stage && teacher ? 'assigned' : 'pending', reason: stage ? teacher ? '首次诊断完成后按班型阶段自动分配' : '该班型阶段暂无启用师资，等待管理员配置' : '该班型未命中已启用阶段，等待管理员配置', createdAt: attempt.submittedAt, updatedAt: attempt.submittedAt};
      await infrastructure.transaction([
        {text: 'insert into learning_diagnostic_attempts (id, user_id, status, question_snapshot, answers, scores, started_at, submitted_at) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)', values: [attempt.id, dbUserId(userId), attempt.status, JSON.stringify(attempt.questionSnapshot), JSON.stringify(attempt.answers), JSON.stringify(attempt.scores), attempt.startedAt, attempt.submittedAt]},
        {text: 'insert into learning_teacher_assignments (id, user_id, attempt_id, class_type_id, stage_id, teacher_id, scores, status, reason, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $10)', values: [assignment.id, dbUserId(userId), assignment.attemptId, assignment.classTypeId ?? null, assignment.stageId ?? null, assignment.teacherId ?? null, JSON.stringify(assignment.scores), assignment.status, assignment.reason ?? null, assignment.createdAt]},
      ]);
      store.learningDiagnosticAttempts.unshift(attempt);
      store.learningTeacherAssignments.unshift(assignment);
      // The diagnostic result is the source of truth. If plan persistence is
      // temporarily unavailable, keep the completed diagnosis and let the
      // authenticated plans endpoint retry generation on the next read.
      try { await ensureAutoLearningPlan(userId, assignment.classTypeId, assignment.stageId); } catch { /* retry on GET /learning/plans */ }
      return send(res, 201, {attemptId: attempt.id, scores: attempt.scores, submittedAt: attempt.submittedAt, assignment: publicLearningTeacherAssignment(assignment)}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/learning/plans') { const userId = requireAuth(req); const attempt = store.learningDiagnosticAttempts.find(item => item.userId === userId); const assignment = attempt ? store.learningTeacherAssignments.find(item => item.attemptId === attempt.id) : undefined; await ensureAutoLearningPlan(userId, assignment?.classTypeId, assignment?.stageId); return send(res, 200, store.learningPlans.filter(item => item.userId === userId), requestId); }
    if (req.method === 'POST' && path === '/v1/learning/plans') {
      const userId = requireAuth(req);
      if (config.nodeEnv === 'production' && hasLearningCoachAccess(userId)) {
        throw new HttpError(403, 'LEARNING_PLAN_MANAGED_BY_BACKEND', '得恩私教学习计划由后台同步管理，用户不能手动创建');
      }
      const input = await body(req);
      const title = String(input.title ?? '').trim();
      if (!title || title.length > 160) throw new HttpError(422, 'VALIDATION_ERROR', '计划标题不能为空且不能超过 160 个字符');
      const today = new Date().toISOString().slice(0, 10);
      const startDate = planDate(input.startDate, '开始日期', today);
      const endDate = planDate(input.endDate, '结束日期', planDate(undefined, '开始日期', today));
      assertPlanDateRange(startDate, endDate);
      const dailyMinutes = planMinutes(input.dailyMinutes);
      const plan = {id: `plan-${randomUUID()}`, userId, title, dailyMinutes, startDate, endDate, status: 'active' as const};
      store.learningPlans.unshift(plan);
      await persist('insert into learning_plans (id, user_id, title, daily_minutes, start_date, end_date, status) values ($1, $2, $3, $4, $5, $6, $7)', [plan.id, dbUserId(userId), plan.title, plan.dailyMinutes, plan.startDate, plan.endDate, plan.status]);
      return send(res, 201, plan, requestId);
    }
    const planMatch = path.match(/^\/v1\/learning\/plans\/([^/]+)$/);
    if (planMatch && req.method === 'PATCH') {
      const userId = requireAuth(req);
      if (config.nodeEnv === 'production' && hasLearningCoachAccess(userId)) {
        throw new HttpError(403, 'LEARNING_PLAN_MANAGED_BY_BACKEND', '得恩私教学习计划由后台同步管理，用户不能手动修改');
      }
      const plan = store.learningPlans.find(item => item.id === planMatch[1] && item.userId === userId);
      if (!plan) throw new HttpError(404, 'NOT_FOUND', '学习计划不存在');
      const input = await body(req);
      const keys = ['title', 'dailyMinutes', 'startDate', 'endDate', 'status'];
      if (!keys.some(key => Object.prototype.hasOwnProperty.call(input, key))) throw new HttpError(422, 'VALIDATION_ERROR', '至少提供一项计划修改内容');
      const title = input.title === undefined ? plan.title : String(input.title).trim();
      if (!title || title.length > 160) throw new HttpError(422, 'VALIDATION_ERROR', '计划标题不能为空且不能超过 160 个字符');
      const dailyMinutes = planMinutes(input.dailyMinutes, plan.dailyMinutes);
      const startDate = planDate(input.startDate, '开始日期', plan.startDate);
      const endDate = planDate(input.endDate, '结束日期', plan.endDate);
      assertPlanDateRange(startDate, endDate);
      const status = input.status === undefined ? plan.status : String(input.status);
      if (!['active', 'completed', 'archived'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '计划状态不正确');
      plan.title = title; plan.dailyMinutes = dailyMinutes; plan.startDate = startDate; plan.endDate = endDate; plan.status = status as typeof plan.status;
      await persist('update learning_plans set title = $1, daily_minutes = $2, start_date = $3, end_date = $4, status = $5, updated_at = now() where id = $6 and user_id = $7', [plan.title, plan.dailyMinutes, plan.startDate, plan.endDate, plan.status, plan.id, dbUserId(userId)]);
      return send(res, 200, plan, requestId);
    }
    if (planMatch && req.method === 'DELETE') {
      const userId = requireAuth(req);
      if (config.nodeEnv === 'production' && hasLearningCoachAccess(userId)) {
        throw new HttpError(403, 'LEARNING_PLAN_MANAGED_BY_BACKEND', '得恩私教学习计划由后台同步管理，用户不能手动删除');
      }
      const plan = store.learningPlans.find(item => item.id === planMatch[1] && item.userId === userId);
      if (!plan) throw new HttpError(404, 'NOT_FOUND', '学习计划不存在');
      store.learningPlans = store.learningPlans.filter(item => item !== plan);
      store.learningTasks = store.learningTasks.filter(item => item.planId !== plan.id);
      await persist('delete from learning_plans where id = $1 and user_id = $2', [plan.id, dbUserId(userId)]);
      return send(res, 200, {deleted: true, id: plan.id}, requestId);
    }
    const learningPlanPauseMatch = path.match(/^\/v1\/learning\/plans\/([^/]+)\/(pause|resume)$/);
    if (learningPlanPauseMatch && req.method === 'POST') {
      const userId = requireAuth(req); const plan = store.learningPlans.find(item => item.id === decodePathSegment(learningPlanPauseMatch[1]) && item.userId === userId);
      if (!plan) throw new HttpError(404, 'NOT_FOUND', '学习计划不存在');
      if (learningPlanPauseMatch[2] === 'pause') {
        if (plan.pausedAt) throw new HttpError(409, 'PLAN_ALREADY_PAUSED', '学习计划已经处于暂停状态');
        const input = await body(req); const days = Number(input.days ?? 1); const reason = String(input.reason ?? '用户申请暂停学习').trim();
        if (!Number.isInteger(days) || days < 1 || days > 30 || reason.length < 2 || reason.length > 300) throw new HttpError(422, 'VALIDATION_ERROR', '暂停天数必须为 1-30 天，且需要填写原因');
        const now = new Date().toISOString(); const pausedUntil = addDays(planDateFromNow(), days); await shiftPendingPlanTasks(plan, days, reason);
        plan.pausedAt = now; plan.pausedUntil = pausedUntil; plan.pauseReason = reason; plan.changeReason = reason; plan.updatedAt = now;
        await persist('update learning_plans set paused_at=$1,paused_until=$2,pause_reason=$3,change_reason=$3,updated_at=$4 where id=$5 and user_id=$6', [now, pausedUntil, reason, now, plan.id, dbUserId(userId)]);
        await recordLearningPlanVersion(plan, reason, 'user');
        return send(res, 200, plan, requestId);
      }
      if (!plan.pausedAt) throw new HttpError(409, 'PLAN_NOT_PAUSED', '学习计划当前没有暂停');
      const input = await body(req); const reason = String(input.reason ?? '用户恢复学习').trim(); if (reason.length < 2 || reason.length > 300) throw new HttpError(422, 'VALIDATION_ERROR', '请填写恢复原因');
      const now = new Date().toISOString(); plan.pausedAt = undefined; plan.pausedUntil = undefined; plan.pauseReason = undefined; plan.version = (plan.version ?? 1) + 1; plan.changeReason = reason; plan.updatedAt = now;
      await persist('update learning_plans set paused_at=null,paused_until=null,pause_reason=null,change_reason=$1,version=$2,updated_at=$3 where id=$4 and user_id=$5', [reason, plan.version, now, plan.id, dbUserId(userId)]);
      await recordLearningPlanVersion(plan, reason, 'user'); return send(res, 200, plan, requestId);
    }
    if (req.method === 'GET' && path === '/v1/learning/tasks') {
      const userId = requireAuth(req); const userPlans = store.learningPlans.filter(item => item.userId === userId); const plans = new Set(userPlans.map(item => item.id)); const today = Date.now();
      for (const plan of userPlans) { try { await rebalanceLearningPlan(plan); } catch { /* retry on the next read */ } }
      const tasks = store.learningTasks.filter(item => plans.has(item.planId));
      for (const task of tasks) {
        const plan = userPlans.find(item => item.id === task.planId);
        const config = plan?.stageId ? stagePlanConfig(plan.stageId) : undefined;
        // Existing prerequisite rules control normal access. An approved early
        // access window is recorded for the client and admin workflow; it does
        // not tighten the existing prerequisite behavior for scheduled tasks.
        const dateUnlocked = true;
        task.locked = !dateUnlocked || !learningTaskIsUnlocked(task, tasks.filter(item => item.planId === task.planId), config);
      }
      for (const task of tasks) { const previous = task.status; normalizeLearningTask(task, today); if (task.status !== previous) await persist('update learning_tasks set status = $1 where id = $2', [task.status, task.id]); }
      return send(res, 200, tasks, requestId);
    }
    if (req.method === 'GET' && path === '/v1/learning/early-access') {
      const userId = requireAuth(req);
      const plans = store.learningPlans.filter(item => item.userId === userId);
      return send(res, 200, plans.map(plan => ({
        planId: plan.id,
        earlyUnlockedThrough: plan.earlyUnlockedThrough,
        eligibleThrough: earlyAccessRequestTarget(plan, store.learningTasks),
        request: store.learningEarlyAccessRequests.find(item => item.planId === plan.id && ['pending', 'approved'].includes(item.status)),
      })), requestId);
    }
    const earlyAccessRequestMatch = path.match(/^\/v1\/learning\/plans\/([^/]+)\/early-access$/);
    if (earlyAccessRequestMatch && req.method === 'POST') {
      const userId = requireAuth(req);
      const plan = store.learningPlans.find(item => item.id === decodePathSegment(earlyAccessRequestMatch[1]) && item.userId === userId);
      if (!plan) throw new HttpError(404, 'NOT_FOUND', '学习计划不存在');
      const target = earlyAccessRequestTarget(plan, store.learningTasks);
      if (!target) throw new HttpError(409, 'EARLY_ACCESS_NOT_ELIGIBLE', '请先完成当天全部任务后再申请提前学习');
      const existing = store.learningEarlyAccessRequests.find(item => item.planId === plan.id && item.status === 'pending');
      if (existing) return send(res, 200, existing, requestId);
      const id = `early-access-${randomUUID()}`; const now = new Date().toISOString(); const input = await body(req);
      const request = {id, userId, planId: plan.id, requestedThrough: target, status: 'pending' as const, reason: String(input.reason ?? '').trim() || undefined, createdAt: now};
      store.learningEarlyAccessRequests.unshift(request);
      await persist('insert into learning_early_access_requests (id,user_id,plan_id,requested_through,status,reason,created_at) values ($1,$2,$3,$4,$5,$6,$7)', [id, dbUserId(userId), plan.id, target, request.status, request.reason ?? null, now]);
      return send(res, 201, request, requestId);
    }
    const subjectiveQuestionMatch = path.match(/^\/v1\/learning\/questions\/subjective\/([^/]+)$/);
    if (subjectiveQuestionMatch && req.method === 'GET') {
      requireAuth(req);
      const question = store.learningQuestionBankQuestions.find(item => item.id === decodePathSegment(subjectiveQuestionMatch[1]) && item.category === 'subjective' && item.status === 'published');
      if (!question) throw new HttpError(404, 'LEARNING_QUESTION_NOT_FOUND', '主观题不存在或尚未发布');
      return send(res, 200, {id: question.id, title: question.stem, subjectId: question.subjectId, stem: question.stem, caseMaterial: question.caseMaterial, subQuestions: question.subQuestions.map(item => ({id: item.id, prompt: item.prompt, score: item.score})), estimatedMinutes: question.estimatedMinutes, difficulty: question.difficulty}, requestId);
    }
    const subjectiveSubmitMatch = path.match(/^\/v1\/learning\/tasks\/([^/]+)\/subjective-submit$/);
    if (subjectiveSubmitMatch && req.method === 'POST') {
      const userId = requireAuth(req); const plans = new Set(store.learningPlans.filter(item => item.userId === userId).map(item => item.id));
      const task = store.learningTasks.find(item => item.id === decodePathSegment(subjectiveSubmitMatch[1]) && plans.has(item.planId));
      if (!task || task.contentType !== 'subjective' || !task.contentId) throw new HttpError(404, 'NOT_FOUND', '主观题学习任务不存在');
      const plan = store.learningPlans.find(item => item.id === task.planId); const config = plan?.stageId ? stagePlanConfig(plan.stageId) : undefined;
      if (!learningTaskIsUnlocked(task, store.learningTasks.filter(item => item.planId === task.planId), config)) throw new HttpError(409, 'LEARNING_TASK_LOCKED', '请先完成前置学习内容');
      const question = store.learningQuestionBankQuestions.find(item => item.id === task.contentId && item.category === 'subjective' && item.status === 'published');
      if (!question) throw new HttpError(409, 'LEARNING_QUESTION_NOT_FOUND', '关联主观题已下架');
      const input = await body(req); const answers = Array.isArray(input.answers) ? input.answers : [];
      const answerMap = new Map(answers.filter(item => item && typeof item === 'object').map((item: any) => [String(item.subQuestionId), String(item.text ?? '').trim()]));
      if (question.subQuestions.some(item => (answerMap.get(item.id) ?? '').length < 1)) throw new HttpError(422, 'VALIDATION_ERROR', '请完成每个小问后再提交');
      const submitted = store.learningSubjectiveSubmissions.find(item => item.userId === userId && item.taskId === task.id);
      if (!submitted) {
        const submittedAt = new Date().toISOString(); const submission = {id: `learning-subjective-${randomUUID()}`, userId, taskId: task.id, questionId: question.id, answers: question.subQuestions.map(item => ({subQuestionId: item.id, text: answerMap.get(item.id) ?? ''})), submittedAt};
        await persist('insert into learning_subjective_submissions (id, user_id, task_id, question_id, answers, submitted_at) values ($1, $2, $3, $4, $5::jsonb, $6) on conflict (user_id, task_id) do nothing', [submission.id, dbUserId(userId), submission.taskId, submission.questionId, JSON.stringify(submission.answers), submittedAt]);
        store.learningSubjectiveSubmissions.unshift(submission);
      }
      if (task.status !== 'done') { const completedAt = new Date().toISOString(); task.status = 'done'; task.completedAt = completedAt; await persist('update learning_tasks set status = $1, completed_at = $2 where id = $3', ['done', completedAt, task.id]); }
      return send(res, 200, task, requestId);
    }
    const taskMatch = path.match(/^\/v1\/learning\/tasks\/([^/]+)\/(complete|check-in)$/);
    if (taskMatch && req.method === 'POST') {
      const userId = requireAuth(req); const plans = new Set(store.learningPlans.filter(item => item.userId === userId).map(item => item.id)); const task = store.learningTasks.find(item => item.id === taskMatch[1] && plans.has(item.planId));
      if (!task) throw new HttpError(404, 'NOT_FOUND', '学习任务不存在');
      const plan = store.learningPlans.find(item => item.id === task.planId);
      const config = plan?.stageId ? stagePlanConfig(plan.stageId) : undefined;
      if (!learningTaskIsUnlocked(task, store.learningTasks.filter(item => item.planId === task.planId), config)) throw new HttpError(409, 'LEARNING_TASK_LOCKED', '请先完成前置学习内容');
      if (task.status === 'done') return send(res, 200, task, requestId);
      let cardRecall: typeof task.cardRecall;
      if (task.contentType === 'card') {
        const card = store.learningCards.find(item => item.id === task.contentId && item.status === 'published');
        if (!card) throw new HttpError(409, 'CARD_UNAVAILABLE', '卡片已调整，请刷新后重试');
        if (card.recallItems.length) {
          const input = await body(req);
          if (input.cardVersion !== card.version) throw new HttpError(409, 'CARD_VERSION_CHANGED', '卡片已更新，请重新打开学习');
          const ratings = input.recallRatings;
          if (!Array.isArray(ratings) || ratings.length !== card.recallItems.length ||
              new Set(ratings.map(item => item?.index)).size !== card.recallItems.length ||
              ratings.some(item => !Number.isInteger(item?.index) || item.index < 0 || item.index >= card.recallItems.length || !['remembered', 'uncertain', 'forgotten'].includes(item?.rating))) {
            throw new HttpError(422, 'CARD_RATINGS_REQUIRED', '请为每个挖空选择熟练度');
          }
          cardRecall = {version: card.version, items: card.recallItems.map((item, index) => ({id: item.id, prompt: item.prompt, answer: item.answer, rating: ratings.find(entry => entry.index === index).rating}))};
        }
      }
      const completedAt = new Date().toISOString();
      await persist('update learning_tasks set status = $1, completed_at = $2, card_recall = $5::jsonb where id = $3 and plan_id = any($4::text[])', ['done', completedAt, task.id, [...plans], cardRecall ? JSON.stringify(cardRecall) : null]);
      task.status = 'done'; task.completedAt = completedAt; task.cardRecall = cardRecall;
      if (cardRecall) {
        const priority = cardRecall.items.some(item => item.rating === 'forgotten') ? 1 : cardRecall.items.some(item => item.rating === 'uncertain') ? 3 : 7;
        const plan = store.learningPlans.find(item => item.id === task.planId);
        const dueDate = addDays(dateOnly(completedAt), priority);
        const duplicate = store.learningTasks.some(item => item.planId === task.planId && item.contentType === 'card' && item.contentId === task.contentId && item.status !== 'done' && item.dueDate === dueDate);
        if (plan && !duplicate && dueDate <= plan.endDate) {
          const reviewTask = {id: `task-review-${randomUUID()}`, planId: task.planId, title: `复习${task.title.replace(/^完成/, '')}`, description: priority === 1 ? '上次主动回忆未记住，建议次日复习' : priority === 3 ? '上次主动回忆不熟悉，建议三日后复习' : '巩固复习，建议七日后回顾', dueDate, minutes: Math.max(5, Math.min(task.minutes, 20)), status: 'todo' as const, contentType: 'card' as const, contentId: task.contentId};
          store.learningTasks.push(reviewTask);
          await persist('insert into learning_tasks (id,plan_id,title,description,due_date,minutes,status,content_type,content_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [reviewTask.id, reviewTask.planId, reviewTask.title, reviewTask.description, reviewTask.dueDate, reviewTask.minutes, reviewTask.status, reviewTask.contentType, reviewTask.contentId]);
        }
      }
      return send(res, 200, task, requestId);
    }
    if (path === '/v1/learning/inquiries' && req.method === 'GET') {
      const userId = requireAuth(req);
      return send(res, 200, store.learningInquiries.filter(item => item.userId === userId).map(({clientRequestId, repliedBy, userId: _, ...item}) => item), requestId);
    }
    if (path === '/v1/learning/inquiries' && req.method === 'POST') {
      const userId = requireAuth(req); const input = await body(req);
      const reportId = String(input.reportId ?? ''); const questionId = String(input.questionId ?? '');
      const reason = String(input.reason ?? '').trim(); const clientRequestId = String(input.clientRequestId ?? '').trim();
      if (reason.length < 2 || reason.length > 5000 || !clientRequestId || clientRequestId.length > 200) throw new HttpError(422, 'VALIDATION_ERROR', '请填写 2 到 5000 字的错因或疑问');
      const report = store.objectiveReports.find(item => item.id === reportId && item.userId === userId);
      const question = report?.results.find(item => item.questionId === questionId);
      if (!report || !question) throw new HttpError(404, 'REPORT_QUESTION_NOT_FOUND', '答题报告中没有这道题');
      const existing = store.learningInquiries.find(item => item.userId === userId && item.clientRequestId === clientRequestId);
      if (existing) {
        if (existing.reportId !== reportId || existing.questionId !== questionId || existing.reason !== reason) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '请求内容已变化，请重新提交');
        return send(res, 200, existing, requestId);
      }
      const item: Store['learningInquiries'][number] = {id: `inquiry-${randomUUID()}`, userId, reportId, questionId, question: structuredClone(question), reason, status: 'pending', createdAt: new Date().toISOString(), clientRequestId};
      await persist('insert into learning_inquiries (id,user_id,report_id,question_id,question_snapshot,reason,status,created_at,client_request_id) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)', [item.id, dbUserId(userId), reportId, questionId, JSON.stringify(item.question), reason, item.status, item.createdAt, clientRequestId]);
      store.learningInquiries.unshift(item);
      return send(res, 201, item, requestId);
    }
    if (path === '/v1/admin/learning-inquiries' && req.method === 'GET') {
      requireAdmin(req, 'learning.questions.read');
      return send(res, 200, store.learningInquiries.map(item => ({...item, studentName: store.profiles.get(item.userId)?.name ?? '学员'})), requestId);
    }
    const inquiryReply = path.match(/^\/v1\/admin\/learning-inquiries\/([^/]+)\/reply$/);
    if (inquiryReply && req.method === 'POST') {
      const admin = requireAdmin(req, 'learning.questions.write');
      const item = store.learningInquiries.find(item => item.id === decodePathSegment(inquiryReply[1]));
      if (!item) throw new HttpError(404, 'INQUIRY_NOT_FOUND', '答疑不存在');
      const input = await body(req); const reply = String(input.reply ?? '').trim();
      const teacherName = String(input.teacherName ?? '').trim();
      if (reply.length < 2 || reply.length > 10000 || teacherName.length < 1 || teacherName.length > 80) throw new HttpError(422, 'VALIDATION_ERROR', '请填写老师姓名及 2 到 10000 字回复');
      const repliedAt = new Date().toISOString();
      await persistAdminMutation([{text: 'update learning_inquiries set reply=$1,teacher_name=$2,replied_by=$3,replied_at=$4,status=$5 where id=$6', values: [reply, teacherName, admin.adminId, repliedAt, 'answered', item.id]}], [admin.adminId, 'learning.inquiry.reply', 'learning_inquiry', item.id, '回复学员错因答疑', requestId]);
      Object.assign(item, {reply, teacherName, repliedBy: admin.adminId, repliedAt, status: 'answered'});
      return send(res, 200, item, requestId);
    }
    if (req.method === 'GET' && path === '/v1/learning/report') {
      const userId = requireAuth(req); const period = url.searchParams.get('period') ?? 'week'; const {start, end} = reportWindow(period);
      const startMs = start.getTime(); const endMs = end.getTime(); const inWindow = (value: string | undefined) => { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) && parsed >= startMs && parsed <= endMs; };
      const userLearningTasks = store.learningTasks.filter(task =>
        store.learningPlans.some(plan => plan.id === task.planId && plan.userId === userId));
      const learningSessionIds = new Set(store.objectiveSessions
        .filter(item => item.userId === userId && (item.learningTaskId || userLearningTasks.some(task =>
          task.contentType === 'assessment'
            ? task.contentId === item.paperId
            : task.contentType === 'question' && Boolean(task.contentId) && item.questionIds.includes(task.contentId!))))
        .map(item => item.id));
      const learningReports = store.objectiveReports
        .filter(item => item.userId === userId && learningSessionIds.has(item.sessionId) && inWindow(item.submittedAt));
      // Development fixtures predate the task/session association. Keep their
      // report contract useful without weakening production's strict scope.
      const fixtureFallback = process.env.DEBAO_TEST_FIXTURES === 'true' && learningSessionIds.size === 0;
      const submissions = fixtureFallback
          ? store.submissions.filter(item => item.userId === userId && inWindow(item.createdAt))
          : learningReports.flatMap(report => report.results.map(result => ({
              questionId: result.questionId,
              correct: result.correct,
              createdAt: report.submittedAt,
              questionSnapshot: {subjectId: result.subjectId},
            })));
      const correct = submissions.filter(item => item.correct).length;
      const activities = store.learningActivities.filter(item => item.userId === userId && inWindow(item.occurredAt));
      const activityDurationSeconds = activities.reduce((sum, item) => sum + item.durationSeconds, 0);
      const activityQuantity = activities.reduce((sum, item) => sum + item.quantity, 0);
      const plans = new Set(store.learningPlans.filter(item => item.userId === userId).map(item => item.id)); const tasks = store.learningTasks.filter(item => plans.has(item.planId));
      for (const task of tasks) { const previous = task.status; normalizeLearningTask(task); if (task.status !== previous) await persist('update learning_tasks set status = $1 where id = $2', [task.status, task.id]); }
      const completedTasks = tasks.filter(item => item.status === 'done' && inWindow(item.completedAt ?? `${item.dueDate}T12:00:00.000Z`));
      const minutes = completedTasks.reduce((sum, item) => sum + item.minutes, 0);
      const subjectSeconds = new Map<string, number>(); for (const activity of activities) if (activity.subjectId) subjectSeconds.set(activity.subjectId, (subjectSeconds.get(activity.subjectId) ?? 0) + activity.durationSeconds);
      const subjectMinutes = new Map([...subjectSeconds.entries()].map(([id, seconds]) => [id, Math.floor(seconds / 60)]));
      const subjectStats = store.subjects.map(subject => { const items = submissions.filter(item => { const question = item.questionSnapshot ?? store.questions.find(candidate => candidate.id === item.questionId); return question?.subjectId === subject.id; }); const subjectCorrect = items.filter(item => item.correct).length; return {subjectId: subject.id, subjectName: subject.name, minutes: subjectMinutes.get(subject.id) ?? 0, answered: items.length, correctRate: items.length ? Math.round(subjectCorrect / items.length * 100) : 0}; });
      const assessmentReports = (fixtureFallback ? store.objectiveReports.filter(item => item.userId === userId && inWindow(item.submittedAt)) : learningReports)
        .filter(item => item.mode === 'exam')
        .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt));
      const weakPointMap = new Map<string, {label: string; subjectId?: string; wrongCount: number; attempts: number; correct: number}>();
      for (const report of assessmentReports) {
        for (const result of report.results) {
          const question = store.learningQuestionBankQuestions.find(item => item.id === result.questionId);
          const subjectId = question?.subjectId ?? result.subjectId;
          const label = question?.subKnowledgePoint ?? question?.knowledgePoint ?? (subjectId ? store.subjects.find(item => item.id === subjectId)?.name : undefined) ?? '未归类考点';
          const key = `${subjectId ?? ''}:${question?.subPointId ?? question?.pointId ?? label}`;
          const current = weakPointMap.get(key) ?? {label, ...(subjectId ? {subjectId} : {}), wrongCount: 0, attempts: 0, correct: 0};
          current.attempts += 1;
          if (result.correct) current.correct += 1; else current.wrongCount += 1;
          weakPointMap.set(key, current);
        }
      }
      const weakKnowledgePoints = [...weakPointMap.values()]
        .map(item => ({...item, correctRate: item.attempts ? Math.round(item.correct / item.attempts * 100) : 0}))
        .filter(item => item.wrongCount > 0)
        .sort((left, right) => right.wrongCount - left.wrongCount || left.correctRate - right.correctRate)
        .slice(0, 8);
      const assessments = assessmentReports.map(report => ({id: report.id, sessionId: report.sessionId, title: report.title, submittedAt: report.submittedAt, score: report.score, maxScore: report.maxScore, correct: report.correct, total: report.total, correctRate: report.total ? Math.round(report.correct / report.total * 100) : 0, subjectStats: report.subjectStats}));
      const trend = new Map<string, {durationSeconds: number; answered: number; correct: number}>();
      for (const activity of activities) { const day = activity.occurredAt.slice(0, 10); const current = trend.get(day) ?? {durationSeconds: 0, answered: 0, correct: 0}; current.durationSeconds += activity.durationSeconds; trend.set(day, current); }
      for (const submission of submissions) { const day = submission.createdAt.slice(0, 10); const current = trend.get(day) ?? {durationSeconds: 0, answered: 0, correct: 0}; current.answered += 1; if (submission.correct) current.correct += 1; trend.set(day, current); }
      const dailyTrend = [...trend.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({date, ...value, minutes: Math.floor(value.durationSeconds / 60), correctRate: value.answered ? Math.round(value.correct / value.answered * 100) : 0}));
      const weakSubjects = subjectStats.filter(item => item.answered > 0).sort((a, b) => a.correctRate - b.correctRate || b.answered - a.answered).slice(0, 3);
      return send(res, 200, {period, minutes: Math.floor(activityDurationSeconds / 60), taskMinutes: minutes, durationSeconds: activityDurationSeconds, activities: activities.length, activityQuantity, answered: submissions.length, correctRate: submissions.length ? Math.round(correct / submissions.length * 100) : 0, subjects: subjectStats, weakSubjects, dailyTrend, assessments, weakKnowledgePoints}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/mistakes') { const userId = requireAuth(req); return send(res, 200, store.mistakes.filter(item => item.userId === userId && !item.resolved).map(item => ({...item, question: store.questions.find(question => question.id === item.questionId)})), requestId); }
    const mistakeMatch = path.match(/^\/v1\/mistakes\/([^/]+)$/);
    if (mistakeMatch && req.method === 'DELETE') { const userId = requireAuth(req); const mistake = store.mistakes.find(item => item.id === mistakeMatch[1] && item.userId === userId); if (mistake) { mistake.resolved = true; await persist('update mistakes set resolved_at = now() where user_id = $1 and question_id = $2', [dbUserId(userId), mistake.questionId]); } return send(res, 200, {resolved: true}, requestId); }
    if (req.method === 'GET' && path === '/v1/favorites') { const userId = requireAuth(req); return send(res, 200, store.favorites.filter(item => item.userId === userId).map(item => ({...item, question: store.questions.find(question => question.id === item.questionId)})), requestId); }
    if (req.method === 'POST' && path === '/v1/favorites') { const userId = requireAuth(req); const input = await body(req); const questionId = String(input.questionId ?? ''); if (!store.questions.some(item => item.id === questionId)) throw new HttpError(404, 'NOT_FOUND', '题目不存在'); const existing = store.favorites.find(item => item.userId === userId && item.questionId === questionId); const favorite = existing ?? {id: `favorite:${questionId}`, userId, questionId, createdAt: new Date().toISOString()}; if (!existing) { store.favorites.unshift(favorite); await persist('insert into favorites (user_id, question_id, created_at) values ($1, $2, $3) on conflict (user_id, question_id) do nothing', [dbUserId(userId), questionId, favorite.createdAt]); } return send(res, existing ? 200 : 201, favorite, requestId); }
    const favoriteMatch = path.match(/^\/v1\/favorites\/([^/]+)$/);
    if (favoriteMatch && req.method === 'DELETE') { const userId = requireAuth(req); const favorite = store.favorites.find(item => item.id === favoriteMatch[1] && item.userId === userId); store.favorites = store.favorites.filter(item => !(item.id === favoriteMatch[1] && item.userId === userId)); if (favorite) await persist('delete from favorites where user_id = $1 and question_id = $2', [dbUserId(userId), favorite.questionId]); return send(res, 200, {removed: true}, requestId); }
    if (req.method === 'GET' && path === '/v1/legal-favorites') {
      const userId = requireAuth(req);
      return send(res, 200, store.legalFavorites.filter(item => item.userId === userId), requestId);
    }
    if (req.method === 'POST' && path === '/v1/legal-favorites') {
      const userId = requireAuth(req);
      const input = await body(req);
      const documentId = String(input.documentId ?? input.legalDocumentId ?? '').trim();
      if (!documentId) throw new HttpError(422, 'VALIDATION_ERROR', '法条文档不能为空');
      const document = store.legalDocuments.find(item => item.id === documentId && (item.status === undefined || item.status === 'published'));
      if (!document) throw new HttpError(404, 'LEGAL_DOCUMENT_NOT_FOUND', '法条不存在或暂不可收藏');
      const existing = store.legalFavorites.find(item => item.userId === userId && item.legalDocumentId === document.id);
      if (existing) return send(res, 200, existing, requestId);
      const favorite: LegalFavorite = {
        id: randomUUID(),
        userId,
        legalDocumentId: document.id,
        documentVersion: document.version ?? 1,
        article: document.article,
        title: document.title,
        content: document.content,
        subjectId: legalSubjectId(document),
        effectiveFrom: document.effectiveFrom,
        createdAt: new Date().toISOString(),
      };
      store.legalFavorites.unshift(favorite);
      await persist('insert into legal_favorites (id, user_id, legal_document_id, document_version, article, title, content, subject_id, effective_from, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (user_id, legal_document_id) do nothing', [favorite.id, dbUserId(userId), favorite.legalDocumentId, favorite.documentVersion, favorite.article, favorite.title, favorite.content, favorite.subjectId ?? null, favorite.effectiveFrom ?? null, favorite.createdAt]);
      return send(res, 201, favorite, requestId);
    }
    const legalFavoriteMatch = path.match(/^\/v1\/legal-favorites\/([^/]+)$/);
    if (legalFavoriteMatch && req.method === 'DELETE') {
      const userId = requireAuth(req);
      const favorite = store.legalFavorites.find(item => item.id === legalFavoriteMatch[1] && item.userId === userId);
      store.legalFavorites = store.legalFavorites.filter(item => !(item.id === legalFavoriteMatch[1] && item.userId === userId));
      if (favorite) await persist('delete from legal_favorites where id = $1 and user_id = $2', [favorite.id, dbUserId(userId)]);
      return send(res, 200, {removed: Boolean(favorite)}, requestId);
    }
    const attachmentPreflightPath = ['/v1/attachments/preflight', '/v1/uploads/preflight', '/v1/grading/attachments/preflight'].includes(path);
    if (req.method === 'POST' && attachmentPreflightPath) {
      const userId = requireAuth(req); const input = await body(req); const upload = validateAttachmentMeta(input, userId);
      store.attachmentUploads.unshift(upload);
      await persist('insert into attachment_uploads (id, user_id, filename, content_type, size_bytes, sha256, status, upload_token_hash, expires_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [upload.id, dbUserId(userId), upload.filename, upload.contentType, upload.sizeBytes, upload.sha256 ?? null, upload.status, tokenHash(upload.uploadToken), upload.expiresAt, upload.createdAt]);
      return send(res, 201, {...upload, uploadUrl: `local://debao/uploads/${upload.id}`, method: 'PUT', headers: {'x-upload-token': upload.uploadToken}}, requestId);
    }
    const attachmentMatch = path.match(/^\/v1\/(?:attachments|uploads|grading\/attachments)\/([^/]+)$/);
    if (attachmentMatch && req.method === 'GET') {
      const userId = requireAuth(req); const upload = attachmentFor(decodeURIComponent(attachmentMatch[1]), userId);
      return send(res, 200, upload, requestId);
    }
    const attachmentCompleteMatch = path.match(/^\/v1\/(?:attachments|uploads|grading\/attachments)\/([^/]+)\/complete$/);
    if (attachmentCompleteMatch && req.method === 'POST') {
      const userId = requireAuth(req); const upload = attachmentFor(decodeURIComponent(attachmentCompleteMatch[1]), userId); const input = await body(req); const providedToken = String(req.headers['x-upload-token'] ?? input.uploadToken ?? '').trim();
      const expectedTokenHash = (upload as InternalAttachmentUpload)[ATTACHMENT_TOKEN_HASH] ?? tokenHash(upload.uploadToken);
      if (!providedToken || tokenHash(providedToken) !== expectedTokenHash) throw new HttpError(403, 'ATTACHMENT_TOKEN_INVALID', '附件上传凭证无效');
      if (upload.status === 'expired') throw new HttpError(409, 'ATTACHMENT_EXPIRED', '附件上传凭证已过期');
      if (upload.status === 'rejected') throw new HttpError(409, 'ATTACHMENT_REJECTED', '附件已被拒绝');
      if (input.sha256 !== undefined && String(input.sha256) !== upload.sha256) throw new HttpError(422, 'ATTACHMENT_CHECKSUM_MISMATCH', '附件校验值不一致');
      if (upload.status === 'completed') return send(res, 200, upload, requestId);
      upload.status = 'completed'; upload.completedAt = new Date().toISOString();
      await persist('update attachment_uploads set status = $1, completed_at = $2 where id = $3 and user_id = $4 and status = $5', [upload.status, upload.completedAt, upload.id, dbUserId(userId), 'pending']);
      return send(res, 200, upload, requestId);
    }
    if (attachmentMatch && req.method === 'DELETE') {
      const userId = requireAuth(req); const upload = attachmentFor(decodeURIComponent(attachmentMatch[1]), userId);
      if (upload.status === 'completed') {
        const used = store.gradingSubmissions.some(submission => submission.userId === userId && submission.answers.some(answer => answer.attachments.includes(upload.id)));
        if (used) throw new HttpError(409, 'ATTACHMENT_IN_USE', '附件已用于提交，不能删除');
      }
      upload.status = 'rejected';
      await persist('update attachment_uploads set status = $1 where id = $2 and user_id = $3', [upload.status, upload.id, dbUserId(userId)]);
      return send(res, 200, {deleted: true, id: upload.id}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/grading/questions') {
      requireAuth(req); const subjectId = url.searchParams.get('subjectId'); const items = store.gradingRubrics.filter(item => item.status === 'published' && (!subjectId || item.subjectId === subjectId)).map(publicGradingQuestion); return send(res, 200, {items, total: items.length}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/grading/papers') {
      requireAuth(req); const subjectId = url.searchParams.get('subjectId'); const items = store.gradingPapers.filter(item => item.status === 'published' && (!subjectId || item.subjectId === subjectId)).map(paper => ({...paper, questionCount: paper.questionIds.length})); return send(res, 200, {items, total: items.length}, requestId);
    }
    const gradingPaperDetail = path.match(/^\/v1\/grading\/papers\/([^/]+)$/);
    if (gradingPaperDetail && req.method === 'GET') {
      requireAuth(req); const paper = store.gradingPapers.find(item => item.id === gradingPaperDetail[1] && item.status === 'published'); if (!paper) throw new HttpError(404, 'GRADING_PAPER_NOT_FOUND', '批改套卷不存在'); const questions = paper.questionIds.map(questionId => store.gradingRubrics.find(item => item.questionId === questionId && item.status === 'published')).filter((item): item is typeof store.gradingRubrics[number] => Boolean(item)).map(publicGradingQuestion); return send(res, 200, {...paper, questionCount: questions.length, questions}, requestId);
    }
    const gradingQuestionDetail = path.match(/^\/v1\/grading\/questions\/([^/]+)$/);
    if (gradingQuestionDetail && req.method === 'GET') { requireAuth(req); const rubric = store.gradingRubrics.find(item => item.id === gradingQuestionDetail[1] || item.questionId === gradingQuestionDetail[1]); if (!rubric || rubric.status !== 'published') throw new HttpError(404, 'GRADING_QUESTION_NOT_FOUND', '可批改题目不存在'); return send(res, 200, {...publicGradingQuestion(rubric), points: rubric.points}, requestId); }
    if (req.method === 'POST' && path === '/v1/grading/submissions' && req.headers['idempotency-key']) {
      const userId = requireAuth(req); const input = await body(req); const questionId = String(input.questionId ?? ''); const rubric = store.gradingRubrics.find(item => item.questionId === questionId && item.status === 'published');
      if (!rubric) throw new HttpError(422, 'GRADING_QUESTION_NOT_FOUND', '该题目当前不可提交批改');
      const key = String(req.headers['idempotency-key']).trim(); if (key.length < 8 || key.length > 120) throw new HttpError(422, 'VALIDATION_ERROR', 'Idempotency-Key 格式不正确');
      const existing = store.gradingSubmissions.find(item => item.userId === userId && item.idempotencyKey === key); if (existing) return send(res, 200, publicGradingSubmission(existing), requestId);
      const balance = store.gradingCredits.get(userId) ?? 0; if (balance < 1) throw new HttpError(403, 'GRADING_CREDITS_INSUFFICIENT', '批改次数不足，请先购买或领取批改权益');
      if (!Array.isArray(input.answers) || input.answers.length !== rubric.subQuestions.length) throw new HttpError(422, 'VALIDATION_ERROR', '请完整提交每个小问的答案');
      const answers = (input.answers as unknown[]).map((raw, index) => { const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {text: raw}; const text = String(value.text ?? '').trim(); const attachments = Array.isArray(value.attachments) ? value.attachments.map(String) : []; if (!text && attachments.length === 0) throw new HttpError(422, 'VALIDATION_ERROR', `第 ${index + 1} 小问不能为空`); return {subQuestionId: String(value.subQuestionId ?? rubric.subQuestions[index].id), text, attachments}; });
      validateSubmissionAttachments(answers, userId);
      const requestedPaperId = typeof input.paperId === 'string' ? input.paperId : undefined; const paper = requestedPaperId ? store.gradingPapers.find(item => item.id === requestedPaperId && item.status === 'published') : store.gradingPapers.find(item => item.status === 'published' && item.questionIds.includes(questionId)); if (requestedPaperId && !paper) throw new HttpError(422, 'GRADING_PAPER_NOT_FOUND', '批改套卷不存在'); if (paper && !paper.questionIds.includes(questionId)) throw new HttpError(422, 'GRADING_PAPER_QUESTION_MISMATCH', '题目不属于该批改套卷');
      const now = new Date().toISOString(); const item: GradingSubmission = {id: `gsub-${randomUUID()}`, userId, paperId: paper?.id, questionId, rubricId: rubric.id, questionVersion: rubric.questionVersion, idempotencyKey: key, answerHash: gradingAnswerHash(questionId, rubric.questionVersion, answers), answers, status: 'submitted', createdAt: now, updatedAt: now};
      const nextBalance = balance - 1; store.gradingCredits.set(userId, nextBalance); const creditEntry = {id: `gcredit-${randomUUID()}`, userId, submissionId: item.id, delta: -1, balanceAfter: nextBalance, createdAt: now}; store.gradingCreditLedger.unshift(creditEntry);
      store.gradingSubmissions.unshift(item); gradingEvent(item.id, 'submitted', 'user', userId, {questionVersion: rubric.questionVersion});
      await persist('insert into grading_submissions (id, user_id, grading_paper_id, question_id, rubric_id, question_version, idempotency_key, answer_hash, answers_snapshot, status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $11)', [item.id, dbUserId(userId), item.paperId ?? null, item.questionId, item.rubricId, item.questionVersion, item.idempotencyKey, item.answerHash, JSON.stringify(item.answers), item.status, now]);
      await persist('insert into grading_credit_accounts (user_id, balance) values ($1, $2) on conflict (user_id) do update set balance = excluded.balance, updated_at = now()', [dbUserId(userId), nextBalance]); await persist('insert into grading_credit_ledger (id, user_id, submission_id, delta, balance_after, created_at) values ($1, $2, $3, $4, $5, $6)', [creditEntry.id, dbUserId(userId), item.id, creditEntry.delta, creditEntry.balanceAfter, creditEntry.createdAt]);
      const run: GradingAIRun = {id: `airun-${randomUUID()}`, submissionId: item.id, provider: aiAdapter.name, status: 'queued', createdAt: now}; store.gradingAiRuns.unshift(run); gradingStatus(item, 'ai_queued');
      if (aiAdapter.name === 'unconfigured') { run.status = 'failed'; run.failureReason = 'AI provider 未配置'; item.aiFailureReason = run.failureReason; gradingStatus(item, 'ai_failed'); gradingEvent(item.id, 'ai_failed', 'system', undefined, {reason: run.failureReason}); }
      else {
        gradingStatus(item, 'ai_processing'); run.status = 'processing';
        try {
          const response = await aiAdapter.reply(JSON.stringify({questionVersion: rubric.questionVersion, gradingBasis: rubric.gradingBasis, points: rubric.points, answers})); const parsed = JSON.parse(response.reply.replace(/^```json\s*|```$/g, '').trim()) as Record<string, unknown>; const pointResults = Array.isArray(parsed.pointResults) ? parsed.pointResults as Array<Record<string, unknown>> : []; const allowed = new Set(rubric.points.map(point => point.id));
          if (pointResults.some(point => !allowed.has(String(point.pointId)))) throw new Error('AI 返回了未知采分点');
          const suggestedScore = Number(parsed.totalSuggestedScore ?? pointResults.reduce((sum, point) => sum + Number(point.suggestedScore ?? 0), 0)); if (!Number.isFinite(suggestedScore) || suggestedScore < 0 || suggestedScore > rubric.totalScore) throw new Error('AI 返回分数超出范围');
          run.status = 'completed'; run.suggestedScore = suggestedScore; run.result = {pointResults: pointResults.map(point => ({pointId: String(point.pointId), suggestedScore: Number(point.suggestedScore ?? 0), status: (['hit', 'partial', 'miss'].includes(String(point.status)) ? String(point.status) : 'miss') as 'hit' | 'partial' | 'miss', evidence: String(point.evidence ?? '')})), feedback: String(parsed.feedback ?? ''), needsHumanAttention: Boolean(parsed.needsHumanAttention)}; run.completedAt = new Date().toISOString(); gradingStatus(item, 'ai_completed'); gradingStatus(item, 'manual_queued'); const assignment: GradingAssignment = {id: `gassign-${randomUUID()}`, submissionId: item.id, status: 'available', createdAt: new Date().toISOString()}; store.gradingAssignments.unshift(assignment); item.currentAssignmentId = assignment.id; gradingEvent(item.id, 'ai_completed', 'system', undefined, {provider: run.provider}); await persist('insert into grading_assignments (id, submission_id, status, created_at) values ($1, $2, $3, $4)', [assignment.id, assignment.submissionId, assignment.status, assignment.createdAt]);
        } catch (error) { run.status = 'failed'; run.failureReason = error instanceof Error ? error.message : 'AI 返回格式无效'; item.aiFailureReason = run.failureReason; gradingStatus(item, 'ai_failed'); gradingEvent(item.id, 'ai_failed', 'system', undefined, {reason: run.failureReason}); }
      }
      await persist('update grading_submissions set status = $1, updated_at = now() where id = $2', [item.status, item.id]); await persist('insert into grading_ai_runs (id, submission_id, provider, status, result, suggested_score, failure_reason, completed_at) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)', [run.id, run.submissionId, run.provider, run.status, run.result ? JSON.stringify(run.result) : null, run.suggestedScore ?? null, run.failureReason ?? null, run.completedAt ?? null]);
      return send(res, 201, {...publicGradingSubmission(item), ai: {status: run.status, failureReason: run.failureReason}}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/grading/submissions/v2') { const userId = requireAuth(req); return send(res, 200, store.gradingSubmissions.filter(item => item.userId === userId).map(publicGradingSubmission), requestId); }
    const gradingReportMatch = path.match(/^\/v1\/grading\/submissions\/([^/]+)\/report$/);
    if (gradingReportMatch && req.method === 'GET') { const userId = requireAuth(req); const submission = store.gradingSubmissions.find(item => item.id === gradingReportMatch[1] && item.userId === userId); if (!submission) throw new HttpError(404, 'NOT_FOUND', '批改记录不存在'); const report = store.gradingReports.find(item => item.id === submission.latestReportId); if (!report) throw new HttpError(404, 'REPORT_NOT_PUBLISHED', '批改报告尚未发布'); return send(res, 200, publicReport(report), requestId); }
    if (req.method === 'POST' && path === '/v1/grader/auth/login') { const input = await body(req); const username = String(input.username ?? '').trim(); const password = String(input.password ?? ''); const account = store.graderAccounts.find(item => item.username === username && item.status === 'active'); const valid = account && ((account.passwordHash.startsWith('local:') && account.passwordHash.slice(6) === password) || (!account.passwordHash.startsWith('local:') && passwordMatches(password, account.passwordHash))); if (!account || !valid) throw new HttpError(401, 'GRADER_LOGIN_FAILED', '批改人员账号或密码错误'); const token = `grader-${randomBytes(32).toString('base64url')}`; store.graderSessions.set(token, {graderId: account.id, expiresAt: new Date(Date.now() + 8 * 3600000).toISOString()}); return send(res, 200, {accessToken: token, expiresIn: 28800, grader: {id: account.id, username: account.username, displayName: account.displayName, subjectIds: account.subjectIds}}, requestId); }
    if (req.method === 'POST' && path === '/v1/grader/auth/logout') { const account = requireGrader(req); const token = graderToken(req); if (token) { const session = store.graderSessions.get(token); if (session) session.revokedAt = new Date().toISOString(); } return send(res, 200, {loggedOut: true, graderId: account.id}, requestId); }
    if (req.method === 'GET' && path === '/v1/grader/me') { const account = requireGrader(req); return send(res, 200, {id: account.id, username: account.username, displayName: account.displayName, subjectIds: account.subjectIds}, requestId); }
    if (req.method === 'GET' && path === '/v1/grader/tasks') { const account = requireGrader(req); const mine = url.searchParams.get('mine') === 'true'; const assignments = store.gradingAssignments.flatMap(item => { const submission = store.gradingSubmissions.find(candidate => candidate.id === item.submissionId); const rubric = submission && store.gradingRubrics.find(candidate => candidate.id === submission.rubricId); if (!submission || !rubric) return []; if (mine ? item.graderId !== account.id : (item.graderId !== account.id || !['available', 'claimed'].includes(item.status))) return []; const paper = submission.paperId ? store.gradingPapers.find(candidate => candidate.id === submission.paperId) : undefined; const ai = store.gradingAiRuns.find(candidate => candidate.submissionId === submission.id); const review = store.gradingReviews.find(candidate => candidate.assignmentId === item.id); return [{...item, submission, rubric: {title: rubric.title, subjectId: rubric.subjectId, totalScore: rubric.totalScore}, paper: paper ? {id: paper.id, title: paper.title} : undefined, ai: ai ? {status: ai.status, suggestedScore: ai.suggestedScore} : undefined, review: review ? {totalScore: review.totalScore, status: review.status} : undefined}]; }); return send(res, 200, {items: assignments, total: assignments.length}, requestId); }
    const graderTaskClaim = path.match(/^\/v1\/grader\/tasks\/([^/]+)\/claim$/);
    if (graderTaskClaim && req.method === 'POST') { const account = requireGrader(req); const assignment = store.gradingAssignments.find(item => item.id === graderTaskClaim[1]); if (!assignment || assignment.status !== 'available') throw new HttpError(409, 'GRADING_ALREADY_CLAIMED', '任务已被其他批改老师领取'); const submission = store.gradingSubmissions.find(item => item.id === assignment.submissionId); if (!submission || submission.status !== 'manual_queued') throw new HttpError(409, 'GRADING_NOT_READY', '任务当前不可领取'); const rubric = store.gradingRubrics.find(item => item.id === submission.rubricId); if (!rubric || (account.subjectIds.length > 0 && !account.subjectIds.includes(rubric.subjectId))) throw new HttpError(403, 'GRADER_SUBJECT_FORBIDDEN', '当前账号没有该科目权限'); assignment.status = 'claimed'; assignment.graderId = account.id; assignment.claimedAt = new Date().toISOString(); assignment.dueAt = new Date(Date.now() + 24 * 3600000).toISOString(); gradingStatus(submission, 'manual_claimed'); submission.currentAssignmentId = assignment.id; gradingEvent(submission.id, 'manual_claimed', 'grader', account.id); await persist('update grading_assignments set status = $1, grader_id = $2, claimed_at = $3, due_at = $4 where id = $5 and status = \'available\'', [assignment.status, account.id, assignment.claimedAt, assignment.dueAt, assignment.id]); await persist('update grading_submissions set status = $1, current_assignment_id = $2, updated_at = now() where id = $3', [submission.status, assignment.id, submission.id]); return send(res, 200, assignment, requestId); }
    const graderTaskDetail = path.match(/^\/v1\/grader\/tasks\/([^/]+)$/);
    if (graderTaskDetail && req.method === 'GET') { const account = requireGrader(req); const assignment = store.gradingAssignments.find(item => item.id === graderTaskDetail[1] && item.graderId === account.id); if (!assignment) throw new HttpError(404, 'NOT_FOUND', '批改任务不存在'); const submission = store.gradingSubmissions.find(item => item.id === assignment.submissionId); const rubric = submission && store.gradingRubrics.find(item => item.id === submission.rubricId); const ai = submission && store.gradingAiRuns.find(item => item.submissionId === submission.id); const review = store.gradingReviews.find(item => item.assignmentId === assignment.id); return send(res, 200, {assignment, submission, rubric: rubric ? {...rubric, gradingBasis: rubric.gradingBasis, points: rubric.points} : undefined, ai: ai?.result ? {status: ai.status, suggestedScore: ai.suggestedScore, result: ai.result} : {status: ai?.status}, review}, requestId); }
    const graderTaskReturn = path.match(/^\/v1\/grader\/tasks\/([^/]+)\/return$/);
    if (graderTaskReturn && req.method === 'POST') { const account = requireGrader(req); const assignment = store.gradingAssignments.find(item => item.id === graderTaskReturn[1] && item.graderId === account.id && item.status === 'claimed'); if (!assignment) throw new HttpError(404, 'NOT_FOUND', '可退回任务不存在'); const input = await body(req); const reason = String(input.reason ?? '').trim(); if (reason.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '退回原因不能为空'); assignment.status = 'returned'; assignment.returnReason = reason; const submission = store.gradingSubmissions.find(item => item.id === assignment.submissionId); if (submission) { gradingStatus(submission, 'manual_returned'); await persist('update grading_submissions set status = $1, updated_at = now() where id = $2', [submission.status, submission.id]); } await persist('update grading_assignments set status = $1, return_reason = $2 where id = $3', [assignment.status, reason, assignment.id]); gradingEvent(assignment.submissionId, 'manual_returned', 'grader', account.id, {reason}); return send(res, 200, assignment, requestId); }
    const graderTaskReview = path.match(/^\/v1\/grader\/tasks\/([^/]+)\/review$/);
    if (graderTaskReview && req.method === 'POST') { const account = requireGrader(req); const assignment = store.gradingAssignments.find(item => item.id === graderTaskReview[1] && item.graderId === account.id && item.status === 'claimed'); if (!assignment) throw new HttpError(404, 'NOT_FOUND', '可提交任务不存在'); const submission = store.gradingSubmissions.find(item => item.id === assignment.submissionId); if (!submission) throw new HttpError(404, 'NOT_FOUND', '批改记录不存在'); const rubric = store.gradingRubrics.find(item => item.id === submission.rubricId); if (!rubric) throw new HttpError(500, 'GRADING_RUBRIC_MISSING', '题目批改依据不存在'); const input = await body(req); const totalScore = Number(input.totalScore); const feedback = String(input.feedback ?? '').trim(); const improvementAdvice = String(input.improvementAdvice ?? '').trim(); const pointResults = Array.isArray(input.pointResults) ? input.pointResults as Array<Record<string, unknown>> : []; const answerAnnotations = Array.isArray(input.answerAnnotations) ? input.answerAnnotations as Array<Record<string, unknown>> : []; if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > rubric.totalScore || !feedback || !improvementAdvice || pointResults.length !== rubric.points.length) throw new HttpError(422, 'VALIDATION_ERROR', '请完成所有采分点、分数、评语和改进建议'); const normalizedPoints = pointResults.map(point => { const configured = rubric.points.find(item => item.id === String(point.pointId)); const status = String(point.status); const score = Number(point.score); if (!configured || !['hit', 'partial', 'missed'].includes(status) || !Number.isFinite(score) || score < 0 || score > configured.maxScore || (status === 'missed' && score !== 0)) throw new HttpError(422, 'VALIDATION_ERROR', '采分点状态或分数无效'); return {pointId: configured.id, score, status: status as 'hit' | 'partial' | 'missed', comment: point.comment ? String(point.comment).trim() : undefined, evidence: point.evidence ? String(point.evidence).trim() : undefined}; }); const normalizedAnnotations = answerAnnotations.map((annotation, index) => { const subQuestionId = String(annotation.subQuestionId ?? ''); const answer = submission.answers.find(item => item.subQuestionId === subQuestionId); const start = Number(annotation.start); const end = Number(annotation.end); const type = String(annotation.type); const scoreDelta = annotation.scoreDelta === undefined ? undefined : Number(annotation.scoreDelta); if (!answer || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > answer.text.length || !['correct', 'score', 'error', 'highlight', 'comment'].includes(type) || (['score', 'error'].includes(type) && (!Number.isFinite(scoreDelta) || scoreDelta === 0))) throw new HttpError(422, 'VALIDATION_ERROR', `第 ${index + 1} 条答案批注无效`); return {id: String(annotation.id ?? `annotation-${randomUUID()}`), subQuestionId, start, end, quote: answer.text.slice(start, end), type: type as 'correct' | 'score' | 'error' | 'highlight' | 'comment', comment: annotation.comment ? String(annotation.comment).trim() : undefined, scoreDelta}; }); const missedPointIds = normalizedPoints.filter(point => point.status === 'missed').map(point => point.pointId);
      const review: GradingReview = {id: `greview-${randomUUID()}`, submissionId: submission.id, assignmentId: assignment.id, graderId: account.id, totalScore, pointResults: normalizedPoints, answerAnnotations: normalizedAnnotations, missedPointIds, feedback, improvementAdvice, aiOverrideReason: input.aiOverrideReason ? String(input.aiOverrideReason) : undefined, status: 'submitted', createdAt: new Date().toISOString()}; store.gradingReviews.unshift(review); assignment.status = 'submitted'; assignment.submittedAt = review.createdAt; gradingStatus(submission, 'manual_submitted'); gradingEvent(submission.id, 'manual_submitted', 'grader', account.id, {reviewId: review.id}); await persist('update grading_assignments set status = $1, submitted_at = $2 where id = $3', [assignment.status, assignment.submittedAt, assignment.id]); await persist('update grading_submissions set status = $1, updated_at = now() where id = $2', [submission.status, submission.id]); await persist('insert into grading_reviews (id, submission_id, assignment_id, grader_id, total_score, point_results, answer_annotations, missed_point_ids, feedback, improvement_advice, ai_override_reason, status, created_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::text[],$9,$10,$11,$12,$13)', [review.id, review.submissionId, review.assignmentId, review.graderId, review.totalScore, JSON.stringify(review.pointResults), JSON.stringify(review.answerAnnotations), review.missedPointIds, review.feedback, review.improvementAdvice, review.aiOverrideReason ?? null, review.status, review.createdAt]); return send(res, 201, review, requestId); }
    if (req.method === 'GET' && path === '/v1/grader/stats') { const account = requireGrader(req); const mine = store.gradingAssignments.filter(item => item.graderId === account.id); const submitted = mine.filter(item => item.status === 'submitted'); const today = new Date().toISOString().slice(0, 10); const metrics = gradingMetrics(store.gradingEvents.filter(event => event.actorId === account.id)); return send(res, 200, {graderId: account.id, todayCompleted: submitted.filter(item => item.submittedAt?.startsWith(today)).length, totalCompleted: submitted.length, inProgress: mine.filter(item => item.status === 'claimed').length, returned: mine.filter(item => item.status === 'returned').length, hourlyCompleted: metrics.hourlyCompleted}, requestId); }
    if (req.method === 'GET' && path === '/v1/grading/submissions') { const userId = requireAuth(req); return send(res, 200, [...store.gradingSubmissions.filter(item => item.userId === userId).map(publicGradingSubmission), ...store.grading.filter(item => item.userId === userId)], requestId); }
    if (req.method === 'POST' && path === '/v1/grading/submissions') { const userId = requireAuth(req); const input = await body(req); if (!input.fileUrl && !input.questionId) throw new HttpError(422, 'VALIDATION_ERROR', '请提交答题文件或题目答案'); const item: {id: string; userId: string; questionId?: string; fileUrl?: string; status: 'queued' | 'processing'; createdAt: string} = {id: `grade-${randomUUID()}`, userId, questionId: typeof input.questionId === 'string' ? input.questionId : undefined, fileUrl: typeof input.fileUrl === 'string' ? input.fileUrl : undefined, status: 'queued', createdAt: new Date().toISOString()}; let queued; try { queued = await gradingAdapter.enqueue(item.id); } catch (error) { throw adapterFailure(gradingAdapter.name, error); } item.status = queued.status === 'processing' ? 'processing' : 'queued'; store.grading.unshift(item); await persist('insert into grading_submissions (id, user_id, question_id, file_url, status, created_at) values ($1, $2, $3, $4, $5, $6)', [item.id, dbUserId(userId), item.questionId ?? null, item.fileUrl ?? null, item.status, item.createdAt]); return send(res, 201, {...item, adapter: gradingAdapter.name}, requestId); }
    const gradingMatch = path.match(/^\/v1\/grading\/submissions\/([^/]+)$/);
    if (gradingMatch && req.method === 'GET') { const userId = requireAuth(req); const advanced = store.gradingSubmissions.find(entry => entry.id === gradingMatch[1] && entry.userId === userId); if (advanced) return send(res, 200, {...publicGradingSubmission(advanced), report: advanced.latestReportId ? store.gradingReports.find(item => item.id === advanced.latestReportId) : undefined}, requestId); }
    if (gradingMatch && req.method === 'GET') { const userId = requireAuth(req); const item = store.grading.find(entry => entry.id === gradingMatch[1] && entry.userId === userId); if (!item) throw new HttpError(404, 'NOT_FOUND', '批改记录不存在'); return send(res, 200, item, requestId); }
    const gradingRetryMatch = path.match(/^\/v1\/grading\/submissions\/([^/]+)\/retry$/);
    if (gradingRetryMatch && req.method === 'POST') { const userId = requireAuth(req); const item = store.grading.find(entry => entry.id === gradingRetryMatch[1] && entry.userId === userId); if (!item) throw new HttpError(404, 'NOT_FOUND', '批改记录不存在'); item.status = 'queued'; await persist('update grading_submissions set status = \'queued\', completed_at = null where id = $1 and user_id = $2', [item.id, dbUserId(userId)]); return send(res, 200, item, requestId); }
    if (req.method === 'GET' && path === '/v1/announcements') {
      const userId = requireAuth(req); const all = store.announcements.filter(item => announcementFeedVisibleTo(item, userId)).sort(compareAnnouncements).map(item => publicAnnouncement(item, userId));
      const pageSize = parsePositiveInteger(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'), 20, 1, 100, 'limit'); const cursor = parsePositiveInteger(url.searchParams.get('cursor'), 0, 0, 1_000_000, 'cursor');
      if (!url.searchParams.has('cursor') && !url.searchParams.has('limit') && !url.searchParams.has('pageSize')) return send(res, 200, all, requestId);
      return send(res, 200, {items: all.slice(cursor, cursor + pageSize), total: all.length, ...(cursor + pageSize < all.length ? {nextCursor: String(cursor + pageSize)} : {})}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/home') {
      const userId = optionalUserId(req);
      const now = Date.now();
      const banners = store.banners.filter(item =>
        (!item.startsAt || Date.parse(item.startsAt) <= now) &&
        (!item.endsAt || Date.parse(item.endsAt) > now) && (item.position ?? 'home-primary') === 'home-primary' && (!item.requiresLogin || Boolean(userId))).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      const announcements = store.announcements.filter(item => announcementFeedVisibleTo(item, userId, now)).sort(compareAnnouncements).slice(0, 3).map(item => publicAnnouncement(item, userId));
      const hotPosts = store.forumPosts
        .filter(item => item.status === 'published')
        .sort((a, b) => b.likes - a.likes)
        .slice(0, 3)
        .map(item => ({
          id: item.id,
          title: item.title,
          body: item.body,
          author: item.userName,
          createdAt: item.createdAt,
          likeCount: item.likes,
        }));
      const activeEntitlements = new Map(store.entitlements.filter(item => item.userId === userId && (!item.expiresAt || Date.parse(item.expiresAt) > now)).map(item => [item.courseId, item]));
      const hotCourses = store.courses.filter(course => isPublishedCourse(course) && course.isHot === true).sort((a, b) => (a.hotSortOrder ?? 0) - (b.hotSortOrder ?? 0)).slice(0, 3).map(course => {
        const access = activeEntitlements.get(course.id);
        return {
          ...course,
          progress: store.courseProgress.find(item => item.userId === userId && item.courseId === course.id)?.progress ?? 0,
          hasAccess: Boolean(access),
          ...(access?.sourceOrderId ? {sourceOrderId: access.sourceOrderId} : {}),
          ...(access?.expiresAt ? {expiresAt: access.expiresAt} : {}),
        };
      });
      const settings = await adminSettingsView();
      return send(res, 200, {
        banners,
        announcements,
        hotCourses,
        hotPosts,
        featuredProduct: (() => {const product = store.products.find(isSellableProduct); return product ? {...product, sold: productSales(product.id)} : null;})(),
        exam: await configuredExam(),
        featureFlags: settings.featureFlags,
      }, requestId);
    }
    if (req.method === 'GET' && path === '/v1/materials') { const items = store.courseLessons.filter(item => item.mediaKind === 'document' && Boolean(item.mediaReference || item.handoutReference)).map(item => ({id: item.id, title: item.title, category: item.materialCategory ?? '未分类', kind: item.materialKind ?? 'material', reference: item.mediaReference ?? item.handoutReference, content: item.articleContent ?? '', downloadable: item.materialKind === 'material' && item.downloadable === true})); return send(res, 200, items, requestId); }
    const courseMaterialMatch = path.match(/^\/v1\/course-materials\/([a-f0-9-]+)\.(pdf|doc|docx|mp3|m4a|wav|ogg|mp4|webm|mov)$/);
    if (courseMaterialMatch && req.method === 'GET') {
      requireAuth(req);
      const extension = courseMaterialMatch[2];
      const contentTypes: Record<string, string> = {pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime'};
      const filePath = join(process.env.DEBAO_UPLOAD_DIR ?? join(process.cwd(), 'uploads'), 'course-materials', `${courseMaterialMatch[1]}.${extension}`);
      const lesson = store.courseLessons.find(item => item.mediaReference === `/v1/course-materials/${courseMaterialMatch[1]}.${extension}` || item.handoutReference === `/v1/course-materials/${courseMaterialMatch[1]}.${extension}`);
      if (lesson && (lesson.materialKind === 'article' || lesson.downloadable !== true)) throw new HttpError(403, 'MATERIAL_DOWNLOAD_DISABLED', '该资料未开放下载');
      let fileStat; try { fileStat = await stat(filePath); } catch { throw new HttpError(404, 'MATERIAL_NOT_FOUND', '课程资料不存在'); }
      res.writeHead(200, {'content-type': contentTypes[extension], 'content-length': String(fileStat.size), 'content-disposition': extension === 'pdf' ? 'inline' : 'attachment', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff'}); createReadStream(filePath).pipe(res); return;
    }
    if (req.method === 'POST' && path === '/v1/admin/course-materials/upload') {
      const admin = requireAdmin(req, 'courses.write'); const contentType = String(req.headers['content-type'] ?? '').split(';')[0].toLowerCase();
      const supported: Record<string, {extension: string; maxBytes: number}> = {'application/pdf': {extension: 'pdf', maxBytes: 100 * 1024 * 1024}, 'application/msword': {extension: 'doc', maxBytes: 100 * 1024 * 1024}, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {extension: 'docx', maxBytes: 100 * 1024 * 1024}, 'audio/mpeg': {extension: 'mp3', maxBytes: 500 * 1024 * 1024}, 'audio/mp4': {extension: 'm4a', maxBytes: 500 * 1024 * 1024}, 'audio/wav': {extension: 'wav', maxBytes: 500 * 1024 * 1024}, 'audio/ogg': {extension: 'ogg', maxBytes: 500 * 1024 * 1024}, 'video/mp4': {extension: 'mp4', maxBytes: 1024 * 1024 * 1024}, 'video/webm': {extension: 'webm', maxBytes: 1024 * 1024 * 1024}, 'video/quicktime': {extension: 'mov', maxBytes: 1024 * 1024 * 1024}};
      const config = supported[contentType]; if (!config) throw new HttpError(422, 'MATERIAL_TYPE_INVALID', '仅支持 PDF、Word、音频或视频文件');
      const declaredSize = Number(req.headers['content-length'] ?? 0); if (declaredSize > config.maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '课程素材超过大小限制');
      const id = randomUUID(); const directory = join(process.env.DEBAO_UPLOAD_DIR ?? join(process.cwd(), 'uploads'), 'course-materials'); await mkdir(directory, {recursive: true}); const sizeBytes = await storeBinaryBody(req, join(directory, `${id}.${config.extension}`), config.maxBytes);
      let filename = `课程素材.${config.extension}`; try { filename = decodeURIComponent(String(req.headers['x-file-name'] ?? '')) || filename; } catch { /* fallback */ }
      const reference = `/v1/course-materials/${id}.${config.extension}`;
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1,$2,$3,$4,$5,$6)', [admin.adminId, 'course.material.upload', 'course_material', id, `${filename}:${sizeBytes}`, requestId]);
      return send(res, 201, {id, filename, sizeBytes, contentType, reference}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/products') { return send(res, 200, store.products.filter(isSellableProduct).map(product => ({...product, sold: productSales(product.id)})), requestId); }
    const productMatch = path.match(/^\/v1\/products\/([^/]+)$/);
    if (productMatch && req.method === 'GET') { return send(res, 200, {...productFor(productMatch[1], true), sold: productSales(productMatch[1])}, requestId); }
    if (req.method === 'GET' && path === '/v1/law/search') {
      requireAuth(req);
      const query = (url.searchParams.get('q') ?? '').trim();
      const subjectId = url.searchParams.get('subjectId')?.trim() || undefined;
      if (!query) throw new HttpError(422, 'VALIDATION_ERROR', '搜索关键词不能为空');
      const results = store.legalDocuments
        .filter(item => item.status === undefined || item.status === 'published')
        .map(item => ({...item, subjectId: legalSubjectId(item)}))
        .filter(item => !subjectId || item.subjectId === subjectId)
        .filter(item => `${item.title}${item.article}${item.content}`.includes(query));
      return send(res, 200, {items: results, total: results.length, query, ...(subjectId ? {subjectId} : {})}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/forum/posts') {
      const scope = url.searchParams.get('scope') ?? 'all';
      const userId = scope === 'all' ? optionalUserId(req) : requireAuth(req);
      const limit = forumLimit(url.searchParams.get('limit')); const cursor = decodeForumCursor(url.searchParams.get('cursor')); const category = url.searchParams.get('category');
      if (category && !FORUM_CATEGORIES.includes(category as ForumCategory)) throw new HttpError(422, 'VALIDATION_ERROR', '帖子分类不正确');
      if (!['all', 'mine', 'favorites'].includes(scope)) throw new HttpError(422, 'VALIDATION_ERROR', 'scope 必须是 all、mine 或 favorites');
      const filtered = store.forumPosts
        .filter(item => item.status === 'published' && !item.deletedAt)
        .filter(item => !category || item.category === category)
        .filter(item => scope !== 'mine' || item.userId === userId)
        .filter(item => scope !== 'favorites' || store.forumFavorites.has(forumRelationKey(item.id, userId)))
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id))
        .filter(item => isAfterDescendingCursor(item, cursor));
      const page = filtered.slice(0, limit); const last = page.at(-1);
      return send(res, 200, {items: page.map(item => publicForumPost(item, userId)), ...(filtered.length > limit && last ? {nextCursor: encodeForumCursor(last.createdAt, last.id)} : {})}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/forum/posts') {
      const userId = requireAuth(req); assertCommunityAllowed(userId); const input = await body(req); const title = String(input.title ?? '').trim(); const postBody = String(input.body ?? '').trim(); const category = String(input.category ?? '');
      if (title.length < 4 || title.length > 80) throw new HttpError(422, 'VALIDATION_ERROR', '帖子标题需为 4 到 80 个字');
      if (postBody.length < 10 || postBody.length > 5000) throw new HttpError(422, 'VALIDATION_ERROR', '帖子正文需为 10 到 5000 个字');
      if (!FORUM_CATEGORIES.includes(category as ForumCategory)) throw new HttpError(422, 'VALIDATION_ERROR', '请选择正确的帖子分类');
      const recent = store.forumPosts.filter(item => item.userId === userId && Date.now() - Date.parse(item.createdAt) < 3_600_000).length;
      if (recent >= 5) throw new HttpError(429, 'FORUM_POST_RATE_LIMITED', '发帖过于频繁，请稍后再试', {retryAfter: 3600});
      const now = new Date().toISOString(); const post: ForumPost = {id: `post-${randomUUID()}`, userId, userName: profileFor(userId).name, category: category as ForumCategory, title, body: postBody, likes: 0, status: 'published', createdAt: now, updatedAt: now};
      store.forumPosts.unshift(post);
      await persist('insert into forum_posts (id, user_id, category, title, body, likes, status, created_at, updated_at) values ($1, $2, $3, $4, $5, 0, \'published\', $6, $6)', [post.id, dbUserId(userId), post.category, post.title, post.body, post.createdAt]);
      return send(res, 201, publicForumPost(post, userId), requestId);
    }
    const forumPostMatch = path.match(/^\/v1\/forum\/posts\/([^/]+)$/);
    if (forumPostMatch && req.method === 'GET') { const userId = requireAuth(req); return send(res, 200, publicForumPost(activeForumPost(forumPostMatch[1]), userId), requestId); }
    if (forumPostMatch && req.method === 'DELETE') {
      const userId = requireAuth(req); const post = activeForumPost(forumPostMatch[1]); if (post.userId !== userId) throw new HttpError(403, 'FORUM_DELETE_FORBIDDEN', '只能删除自己发布的帖子');
      post.deletedAt = new Date().toISOString(); post.updatedAt = post.deletedAt;
      await persist('update forum_posts set deleted_at = $1, updated_at = $1 where id = $2 and user_id = $3 and deleted_at is null', [post.deletedAt, post.id, dbUserId(userId)]);
      return send(res, 200, {deleted: true}, requestId);
    }
    const forumLikeMatch = path.match(/^\/v1\/forum\/posts\/([^/]+)\/like$/);
    if (forumLikeMatch && req.method === 'POST') {
      const userId = requireAuth(req); const post = activeForumPost(forumLikeMatch[1]); const key = forumRelationKey(post.id, userId); const liked = !store.forumLikes.has(key);
      if (liked) { store.forumLikes.add(key); post.likes += 1; await persist('insert into forum_post_likes (post_id, user_id) values ($1, $2) on conflict (post_id, user_id) do nothing', [post.id, dbUserId(userId)]); }
      else { store.forumLikes.delete(key); post.likes = Math.max(0, post.likes - 1); await persist('delete from forum_post_likes where post_id = $1 and user_id = $2', [post.id, dbUserId(userId)]); }
      await persist('update forum_posts set likes = $1, updated_at = now() where id = $2', [post.likes, post.id]);
      return send(res, 200, publicForumPost(post, userId), requestId);
    }
    const forumFavoriteMatch = path.match(/^\/v1\/forum\/posts\/([^/]+)\/favorite$/);
    if (forumFavoriteMatch && req.method === 'POST') {
      const userId = requireAuth(req); const post = activeForumPost(forumFavoriteMatch[1]); const key = forumRelationKey(post.id, userId); const favorited = !store.forumFavorites.has(key);
      if (favorited) { store.forumFavorites.add(key); await persist('insert into forum_post_favorites (post_id, user_id) values ($1, $2) on conflict (post_id, user_id) do nothing', [post.id, dbUserId(userId)]); }
      else { store.forumFavorites.delete(key); await persist('delete from forum_post_favorites where post_id = $1 and user_id = $2', [post.id, dbUserId(userId)]); }
      return send(res, 200, publicForumPost(post, userId), requestId);
    }
    const forumReportMatch = path.match(/^\/v1\/forum\/posts\/([^/]+)\/report$/);
    if (forumReportMatch && req.method === 'POST') { const userId = requireAuth(req); const post = activeForumPost(forumReportMatch[1]); const input = await body(req); const reason = String(input.reason ?? '').trim(); if (reason.length < 2 || reason.length > 200) throw new HttpError(422, 'VALIDATION_ERROR', '举报理由需为 2 到 200 个字'); const duplicate = store.communityReports.find(item => item.postId === post.id && item.reporterUserId === userId && item.status === 'pending'); if (duplicate) return send(res, 200, publicForumReport(duplicate), requestId); const report = {id: randomUUID(), postId: post.id, reporterUserId: userId, reason, status: 'pending' as const, createdAt: new Date().toISOString()}; store.communityReports.unshift(report); await persist('insert into community_reports (id, post_id, reporter_user_id, reason, status, created_at) values ($1, $2, $3, $4, $5, $6)', [report.id, post.id, dbUserId(userId), reason, report.status, report.createdAt]); return send(res, 201, publicForumReport(report), requestId); }
    const forumCommentsMatch = path.match(/^\/v1\/forum\/posts\/([^/]+)\/comments$/);
    if (forumCommentsMatch && req.method === 'GET') {
      const userId = requireAuth(req); const post = activeForumPost(forumCommentsMatch[1]); const limit = forumLimit(url.searchParams.get('limit')); const cursor = decodeForumCursor(url.searchParams.get('cursor'));
      const filtered = store.forumComments.filter(item => item.postId === post.id && !item.deletedAt).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)).filter(item => isAfterAscendingCursor(item, cursor));
      const page = filtered.slice(0, limit); const last = page.at(-1);
      return send(res, 200, {items: page.map(item => publicForumComment(item, userId)), ...(filtered.length > limit && last ? {nextCursor: encodeForumCursor(last.createdAt, last.id)} : {})}, requestId);
    }
    if (forumCommentsMatch && req.method === 'POST') {
      const userId = requireAuth(req); assertCommunityAllowed(userId); const post = activeForumPost(forumCommentsMatch[1]); const input = await body(req); const commentBody = String(input.body ?? '').trim();
      if (commentBody.length < 1 || commentBody.length > 1000) throw new HttpError(422, 'VALIDATION_ERROR', '评论需为 1 到 1000 个字');
      const recent = store.forumComments.filter(item => item.userId === userId && Date.now() - Date.parse(item.createdAt) < 3_600_000).length;
      if (recent >= 20) throw new HttpError(429, 'FORUM_COMMENT_RATE_LIMITED', '评论过于频繁，请稍后再试', {retryAfter: 3600});
      const comment: ForumComment = {id: `comment-${randomUUID()}`, postId: post.id, userId, userName: profileFor(userId).name, body: commentBody, createdAt: new Date().toISOString()}; store.forumComments.push(comment);
      await persist('insert into forum_comments (id, post_id, user_id, body, created_at) values ($1, $2, $3, $4, $5)', [comment.id, comment.postId, dbUserId(userId), comment.body, comment.createdAt]);
      return send(res, 201, publicForumComment(comment, userId), requestId);
    }
    const forumCommentMatch = path.match(/^\/v1\/forum\/comments\/([^/]+)$/);
    if (forumCommentMatch && req.method === 'DELETE') {
      const userId = requireAuth(req); const comment = store.forumComments.find(item => item.id === forumCommentMatch[1] && !item.deletedAt); if (!comment) throw new HttpError(404, 'FORUM_COMMENT_NOT_FOUND', '评论不存在或已删除'); if (comment.userId !== userId) throw new HttpError(403, 'FORUM_DELETE_FORBIDDEN', '只能删除自己的评论');
      activeForumPost(comment.postId); comment.deletedAt = new Date().toISOString(); await persist('update forum_comments set deleted_at = $1 where id = $2 and user_id = $3 and deleted_at is null', [comment.deletedAt, comment.id, dbUserId(userId)]); return send(res, 200, {deleted: true}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/learning-admin/auth/login') { const input = await body(req); const username = String(input.username ?? '').trim(); const password = String(input.password ?? ''); if (username !== config.learningAdminUsername || password !== config.learningAdminPassword) throw new HttpError(401, 'LEARNING_ADMIN_INVALID_CREDENTIALS', '学习中心管理员账号或密码错误'); const account: AdminAccount = {id: learningAdminId, username, displayName: '学习中心管理员', role: 'learning_admin', permissions: ['dashboard.read', 'learning.diagnostics.read', 'learning.diagnostics.write', 'learning.diagnostics.publish', 'learning.questions.read', 'learning.questions.write', 'learning.questions.publish', 'learning.users.read', 'learning.stages.read', 'learning.stages.write'], passwordHash: config.learningAdminPassword, mfaEnabled: false}; return send(res, 200, await issueAdminSession(res, account, requestId, req), requestId); }
    if (req.method === 'POST' && path === '/v1/grading-admin/auth/login') { const input = await body(req); const username = String(input.username ?? '').trim(); const password = String(input.password ?? ''); if (username !== config.gradingAdminUsername || password !== config.gradingAdminPassword) throw new HttpError(401, 'GRADING_ADMIN_INVALID_CREDENTIALS', '批改管理员账号或密码错误'); const account: AdminAccount = {id: gradingAdminId, username, displayName: '批改管理员', role: 'grading_admin', permissions: ['dashboard.read', 'grading.read', 'grading.assign', 'grading.claim', 'grading.submit', 'grading.publish', 'grading.review'], passwordHash: config.gradingAdminPassword, mfaEnabled: false}; return send(res, 200, await issueAdminSession(res, account, requestId, req), requestId); }
    if (req.method === 'POST' && path === '/v1/admin/auth/login') {
      const input = await body(req); const username = String(input.username ?? '').trim(); const password = String(input.password ?? '');
      if (!username || !password) throw new HttpError(422, 'VALIDATION_ERROR', '账号和密码不能为空');
      const account = await adminAccountForLogin(username);
      if (!account || !passwordMatches(password, account.passwordHash)) { if (config.nodeEnv === 'production') await persist('insert into admin_login_events (admin_user_id, username, success, reason, ip, user_agent) values ($1, $2, false, $3, $4, $5)', [account?.id ?? null, username, 'invalid_credentials', req.socket.remoteAddress ?? null, req.headers['user-agent'] ?? null]); throw new HttpError(401, 'ADMIN_INVALID_CREDENTIALS', '管理员账号或密码错误'); }
      if (account.mfaEnabled) { if (!account.mfaSecret) throw new HttpError(503, 'ADMIN_MFA_NOT_CONFIGURED', '管理员 MFA 密钥不可用，请联系超级管理员重置'); const challengeToken = randomBytes(24).toString('base64url'); adminMfaChallenges.set(challengeToken, {account, expiresAt: Date.now() + 5 * 60_000}); return send(res, 200, {mfaRequired: true, challengeToken, expiresIn: 300}, requestId); }
      if (config.adminMfaRequired) { const secret = newAdminMfaSecret(); const challengeToken = randomBytes(24).toString('base64url'); adminMfaChallenges.set(challengeToken, {account, enrollmentSecret: secret, expiresAt: Date.now() + 10 * 60_000}); return send(res, 200, {mfaRequired: true, enrollmentRequired: true, challengeToken, secret, otpAuthUri: adminOtpUri(account.username, secret), expiresIn: 600}, requestId); }
      if (config.nodeEnv === 'production') await persist('insert into admin_login_events (admin_user_id, username, success, reason, ip, user_agent) values ($1, $2, true, $3, $4, $5)', [account.id, username, 'password', req.socket.remoteAddress ?? null, req.headers['user-agent'] ?? null]);
      return send(res, 200, await issueAdminSession(res, account, requestId, req), requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/auth/mfa/verify') {
      const input = await body(req); const challengeToken = String(input.challengeToken ?? ''); const code = String(input.code ?? ''); const challenge = adminMfaChallenges.get(challengeToken); if (!challenge || challenge.expiresAt <= Date.now()) throw new HttpError(401, 'ADMIN_MFA_EXPIRED', 'MFA 验证已过期，请重新登录'); const secret = challenge.enrollmentSecret ?? challenge.account.mfaSecret; if (!secret || !totpValid(secret, code)) throw new HttpError(401, 'ADMIN_MFA_INVALID', 'MFA 验证码错误'); adminMfaChallenges.delete(challengeToken);
      if (challenge.enrollmentSecret) { if (config.nodeEnv === 'production') await persist('update admin_users set mfa_enabled = true, mfa_secret_enc = $1, updated_at = now() where id = $2', [encryptAdminSecret(secret), challenge.account.id]); else developmentAdminMfaSecret = secret; challenge.account.mfaEnabled = true; challenge.account.mfaSecret = secret; }
      if (config.nodeEnv === 'production') await persist('insert into admin_login_events (admin_user_id, username, success, reason, ip, user_agent) values ($1, $2, true, $3, $4, $5)', [challenge.account.id, challenge.account.username, challenge.enrollmentSecret ? 'mfa_enrolled' : 'mfa', req.socket.remoteAddress ?? null, req.headers['user-agent'] ?? null]);
      return send(res, 200, await issueAdminSession(res, challenge.account, requestId, req), requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/me/mfa/enroll') { const session = requireAdmin(req); const account = await adminAccountForLogin(session.username); if (!account) throw new HttpError(404, 'ADMIN_NOT_FOUND', '管理员不存在'); const secret = newAdminMfaSecret(); const challengeToken = randomBytes(24).toString('base64url'); adminMfaChallenges.set(challengeToken, {account, enrollmentSecret: secret, expiresAt: Date.now() + 10 * 60_000}); return send(res, 200, {mfaRequired: true, enrollmentRequired: true, challengeToken, secret, otpAuthUri: adminOtpUri(account.username, secret), expiresIn: 600}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/auth/logout') {
      const session = requireAdmin(req); const token = cookieValue(req, adminCookie); if (token) { const current = adminSessions.get(token); if (current) current.revokedAt = new Date().toISOString(); }
      if (config.nodeEnv === 'production' && token) await persist('update admin_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [tokenHash(token)]);
      (res as ServerResponse & {debaoHeaders?: Record<string, string>}).debaoHeaders = {'set-cookie': `${adminCookie}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`, 'access-control-allow-credentials': 'true'};
      return send(res, 200, {loggedOut: true, adminId: session.adminId}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/me') {
      const session = requireAdmin(req); return send(res, 200, {id: session.adminId, name: session.displayName, role: session.role, permissions: session.permissions, expiresAt: session.expiresAt}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/navigation') {
      const session = requireAdmin(req); return send(res, 200, {items: [{key: '/dashboard', label: '工作台', permission: 'dashboard.read'}, {key: '/users', label: '用户与权益', permission: 'users.read'}, {key: '/content/questions', label: '题目管理', permission: 'content.questions.read'}, {key: '/content/subjects', label: '科目章节', permission: 'content.questions.read'}, {key: '/content/papers', label: '试卷管理', permission: 'content.questions.read'}, {key: '/content/imports', label: '内容导入', permission: 'content.questions.read'}, {key: '/content/laws', label: '法条管理', permission: 'content.questions.read'}, {key: '/courses', label: '课程管理', permission: 'courses.read'}, {key: '/courses/audio', label: '音频课程库', permission: 'courses.read'}, {key: '/courses/video', label: '视频课程库', permission: 'courses.read'}, {key: '/courses/live-sessions', label: '直播排期', permission: 'courses.read'}, {key: '/learning/records', label: '学习记录', permission: 'courses.read'}, {key: '/learning/plans', label: '学习计划', permission: 'courses.read'}, {key: '/grading', label: '批改队列', permission: 'courses.read'}, {key: '/grading/accounts', label: '批改老师账号', permission: 'grading.assign'}, {key: '/commerce/products', label: '商品管理', permission: 'products.read'}, {key: '/commerce/orders', label: '订单管理', permission: 'orders.read'}, {key: '/commerce/refunds', label: '退款售后', permission: 'refunds.read'}, {key: '/commerce/entitlements', label: '权益记录', permission: 'orders.read'}, {key: '/community/posts', label: '帖子管理', permission: 'community.read'}, {key: '/community/comments', label: '评论管理', permission: 'community.read'}, {key: '/community/reports', label: '举报审核', permission: 'community.read'}, {key: '/community/rules', label: '社区规则', permission: 'community.read'}, {key: '/operations/banners', label: 'Banner 管理', permission: 'operations.read'}, {key: '/operations/announcements', label: '公告管理', permission: 'operations.read'}, {key: '/operations/templates', label: '消息模板', permission: 'operations.read'}, {key: '/operations/push-jobs', label: '推送任务', permission: 'operations.read'}, {key: '/ai/quotas', label: 'AI 配额', permission: 'ai.read'}, {key: '/ai/flags', label: 'AI 风险记录', permission: 'ai.read'}, {key: '/ai/usage', label: 'AI 用量', permission: 'ai.read'}, {key: '/analytics', label: '数据分析', permission: 'analytics.read'}, {key: '/system/admins', label: '管理员', permission: 'system.admins.read'}, {key: '/system/audit-logs', label: '审计日志', permission: 'audit.read'}, {key: '/system/settings', label: '系统配置', permission: 'system.settings.read'}, {key: '/system/health', label: '服务状态', permission: 'system.health.read'}].filter(item => session.permissions.includes('*') || session.permissions.includes(item.permission))}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/admins') {
      requireAdmin(req);
      if (config.nodeEnv === 'production') { const result = await infrastructure.query<{id: string; username: string; name: string; role: string; status: string; mfa_enabled: boolean; last_login_at?: string}>('select au.id, au.username, au.display_name as name, coalesce(min(ar.code), \'unassigned\') as role, au.status, au.mfa_enabled, au.last_login_at from admin_users au left join admin_user_roles aur on aur.admin_user_id = au.id left join admin_roles ar on ar.id = aur.role_id group by au.id order by au.created_at asc'); const items = (result?.rows ?? []).map(item => ({...item, mfaEnabled: item.mfa_enabled, lastLoginAt: item.last_login_at})); return send(res, 200, {items, total: items.length}, requestId); }
      return send(res, 200, {items: [{id: adminId, username: config.adminUsername, name: '得宝管理员', role: 'super_admin', status: 'active', mfaEnabled: Boolean(developmentAdminMfaSecret), lastLoginAt: null}], total: 1}, requestId);
    }
    const adminMfaResetMatch = path.match(/^\/v1\/admin\/admins\/([^/]+)\/mfa\/reset$/);
    if (adminMfaResetMatch && req.method === 'POST') { const session = requireAdmin(req); const input = await body(req); const reason = String(input.reason ?? '').trim(); const confirmation = String(input.confirmation ?? ''); if (reason.length < 4 || confirmation !== 'RESET') throw new HttpError(422, 'VALIDATION_ERROR', '请填写至少 4 个字的原因并输入 RESET 确认'); const targetId = adminMfaResetMatch[1]; if (config.nodeEnv === 'production') { const result = await infrastructure.query('update admin_users set mfa_enabled = false, mfa_secret_enc = null, updated_at = now() where id = $1', [targetId]); if (!result?.rowCount) throw new HttpError(404, 'ADMIN_NOT_FOUND', '管理员不存在'); await persist('update admin_sessions set revoked_at = now() where admin_user_id = $1 and revoked_at is null', [targetId]); } else { if (targetId !== adminId) throw new HttpError(404, 'ADMIN_NOT_FOUND', '管理员不存在'); developmentAdminMfaSecret = undefined; } for (const current of adminSessions.values()) if (current.adminId === targetId) current.revokedAt = new Date().toISOString(); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [session.adminId, 'admin.mfa.reset', 'admin_user', targetId, reason, requestId]); return send(res, 200, {reset: true, nextLoginEnrollmentRequired: config.adminMfaRequired}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/roles') {
      requireAdmin(req);
      return send(res, 200, {items: adminRoleCatalog, total: adminRoleCatalog.length}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/dashboard') {
      requireAdmin(req);
      const dayStart = Date.now() - 86400000;
      const paidAmount = store.orders.filter(item => item.status === 'paid').reduce((sum, item) => sum + item.amount, 0);
      const refundAmount = store.refunds.filter(item => item.status === 'completed').reduce((sum, item) => sum + item.amount, 0);
      const reports = store.communityReports.filter(item => item.status === 'pending' || item.status === 'processing').length;
      return send(res, 200, {users: store.profiles.size, activeUsers: store.sessions.size, answeredToday: store.submissions.filter(item => Date.parse(item.createdAt) > dayStart).length, paidAmount, refundAmount, reports}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/users') {
      const admin = requireAdmin(req); const input = await body(req); const name = String(input.name ?? '').trim(); const phone = String(input.phone ?? '').trim(); const examYear = String(input.examYear ?? '').trim();
      if (name.length < 2 || name.length > 80) throw new HttpError(422, 'VALIDATION_ERROR', '用户昵称长度必须为 2 到 80 个字符');
      if (!/^1\d{10}$/.test(phone)) throw new HttpError(422, 'VALIDATION_ERROR', '请输入有效的 11 位中国大陆手机号');
      if (!/^20\d{2}$/.test(examYear) || Number(examYear) < 2020 || Number(examYear) > 2099) throw new HttpError(422, 'VALIDATION_ERROR', '考试年份必须在 2020 到 2099 之间');
      if ([...store.profiles.values()].some(item => item.phone === phone)) throw new HttpError(409, 'PHONE_ALREADY_BOUND', '该手机号已存在，请直接搜索用户或更换手机号');
      const id = randomUUID(); const profile: UserProfile = {id, name, phone, examYear, studyDays: 0};
      await persistAdminMutation([{
        text: 'insert into users (id, name, phone, exam_year, study_days, created_by_admin) values ($1, $2, $3, $4, $5, $6)',
        values: [id, name, phone, examYear, 0, admin.adminId],
      }], [admin.adminId, 'user.create', 'user', id, '后台手动创建用户', requestId]);
      store.profiles.set(id, profile);
      return send(res, 201, {...publicProfile(profile), role: 'user', permissions: [], sessionCount: 0, courseCount: 0}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/users') {
      requireAdmin(req); const keyword = (url.searchParams.get('keyword') ?? '').trim(); const users = [...store.profiles.values()].filter(item => !keyword || item.name.includes(keyword) || item.id.includes(keyword) || item.phone.includes(keyword)).map(item => ({...publicProfile(item), role: 'user', permissions: [], sessionCount: [...store.sessions.values()].filter(session => session.userId === item.id && !session.revokedAt).length, courseCount: store.entitlements.filter(entry => entry.userId === item.id).length}));
      return send(res, 200, {items: users, total: users.length, page: 1, pageSize: users.length}, requestId);
    }
    const adminUserMatch = path.match(/^\/v1\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && req.method === 'GET') {
      requireAdmin(req);
      const profile = profileFor(internalUserId(adminUserMatch[1]));
      const userId = profile.id;
      const courseById = new Map(store.courses.map(course => [course.id, course]));
      const courseProgress = store.courseProgress.filter(item => item.userId === userId).map(item => {
        const course = courseById.get(item.courseId);
        return {...item, courseTitle: course?.title ?? item.courseId, teacher: course?.teacher, type: course?.type, lessons: course?.lessons};
      }).sort((a, b) => b.progress - a.progress);
      const learningActivities = store.learningActivities.filter(item => item.userId === userId).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
      const userSubmissions = store.submissions.filter(item => item.userId === userId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const userObjectiveSessions = store.objectiveSessions.filter(item => item.userId === userId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const userObjectiveReports = store.objectiveReports.filter(item => item.userId === userId).sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
      const userSubjectiveSubmissions = store.gradingSubmissions.filter(item => item.userId === userId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const subjectiveIds = new Set(userSubjectiveSubmissions.map(item => item.id));
      const userSubjectiveReports = store.gradingReports.filter(item => subjectiveIds.has(item.submissionId)).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
      const subjectiveReportBySubmissionId = new Map(userSubjectiveReports.map(report => [report.submissionId, report]));
      const userPlans = store.learningPlans.filter(item => item.userId === userId);
      const planIds = new Set(userPlans.map(item => item.id));
      const userTasks = store.learningTasks.filter(item => planIds.has(item.planId));
      const studySeconds = learningActivities.reduce((sum, item) => sum + Math.max(0, item.durationSeconds || 0), 0);
      const courseSeconds = learningActivities.filter(item => item.kind === 'course').reduce((sum, item) => sum + Math.max(0, item.durationSeconds || 0), 0);
      const questionSeconds = learningActivities.filter(item => item.kind === 'question').reduce((sum, item) => sum + Math.max(0, item.durationSeconds || 0), 0);
      const objectiveQuestionCount = userObjectiveReports.reduce((sum, item) => sum + item.total, 0);
      const objectiveCorrectCount = userObjectiveReports.reduce((sum, item) => sum + item.correct, 0);
      const subjectiveScoreTotal = userSubjectiveReports.reduce((sum, item) => sum + item.totalScore, 0);
      const subjectiveMaxScore = userSubjectiveReports.reduce((sum, item) => sum + item.maxScore, 0);
      const courseIds = new Set([...courseProgress.map(item => item.courseId), ...store.entitlements.filter(item => item.userId === userId).map(item => item.courseId)]);
      const averageProgress = courseProgress.length ? Math.round(courseProgress.reduce((sum, item) => sum + item.progress, 0) / courseProgress.length) : 0;
      return send(res, 200, {
        ...publicProfile(profile),
        restriction: store.userRestrictions.get(userId),
        sessions: [...store.sessions.values()].filter(session => session.userId === userId).map(session => ({deviceId: session.deviceId, expiresAt: session.expiresAt, revokedAt: session.revokedAt})),
        devices: store.devices.filter(device => device.userId === userId).map(({pushToken: _pushToken, ...device}) => device),
        entitlements: store.entitlements.filter(entry => entry.userId === userId),
        orders: store.orders.filter(order => order.userId === userId),
        courseProgress,
        learningActivities,
        learningSummary: {courseCount: courseIds.size, completedCourseCount: courseProgress.filter(item => item.progress >= 100).length, averageProgress, studyMinutes: Math.round(studySeconds / 60), courseMinutes: Math.round(courseSeconds / 60), questionMinutes: Math.round(questionSeconds / 60)},
        questionStats: {answeredCount: userSubmissions.length, correctCount: userSubmissions.filter(item => item.correct).length, correctRate: userSubmissions.length ? Math.round(userSubmissions.filter(item => item.correct).length / userSubmissions.length * 100) : 0, mistakeCount: store.mistakes.filter(item => item.userId === userId).length, favoriteCount: store.favorites.filter(item => item.userId === userId).length, legalFavoriteCount: store.legalFavorites.filter(item => item.userId === userId).length},
        questionSubmissions: userSubmissions,
        examStats: {objectiveSessionCount: userObjectiveSessions.length, objectiveSubmittedCount: userObjectiveSessions.filter(item => item.status === 'submitted').length, objectiveReportCount: userObjectiveReports.length, objectiveQuestionCount, objectiveCorrectCount, objectiveAverageScore: userObjectiveReports.length ? Math.round(userObjectiveReports.reduce((sum, item) => sum + item.score, 0) / userObjectiveReports.length * 10) / 10 : 0, subjectiveSubmissionCount: userSubjectiveSubmissions.length, subjectivePublishedCount: userSubjectiveReports.length, subjectiveAverageScore: subjectiveMaxScore ? Math.round(subjectiveScoreTotal / subjectiveMaxScore * 100) : 0},
        objectiveSessions: userObjectiveSessions.map(({questions: _questions, answers: _answers, ...session}) => session),
        objectiveReports: userObjectiveReports,
        subjectiveSubmissions: userSubjectiveSubmissions.map(({answers: _answers, ...submission}) => ({...submission, score: subjectiveReportBySubmissionId.get(submission.id)?.totalScore, maxScore: subjectiveReportBySubmissionId.get(submission.id)?.maxScore})),
        subjectiveReports: userSubjectiveReports,
        plans: userPlans,
        tasks: userTasks,
      }, requestId);
    }
    if (adminUserMatch && req.method === 'DELETE') {
      const admin = requireAdmin(req); const userId = internalUserId(decodeURIComponent(adminUserMatch[1])); const profile = profileFor(userId); const input = await body(req); const reason = String(input.reason ?? '').trim(); const confirmation = String(input.confirmation ?? '').trim();
      if (reason.length < 4 || reason.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', '删除原因长度必须为 4 到 500 个字符');
      if (confirmation !== 'DELETE') throw new HttpError(422, 'VALIDATION_ERROR', '请输入 DELETE 确认删除');
      const deletedAt = new Date().toISOString(); const anonymousPhone = `deleted-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      await persistAdminMutation([
        {text: 'update users set name = $1, phone = $2, study_days = 0, avatar_color = null, avatar_url = null, deleted_at = $3, deletion_reason = $4, deleted_by = $5, updated_at = $3 where id = $6 and deleted_at is null', values: ['已删除用户', anonymousPhone, deletedAt, reason, admin.adminId, dbUserId(userId)]},
        {text: 'update refresh_sessions set revoked_at = $1 where user_id = $2 and revoked_at is null', values: [deletedAt, dbUserId(userId)]},
        {text: 'delete from user_identities where user_id = $1', values: [dbUserId(userId)]},
        {text: 'delete from devices where user_id = $1', values: [dbUserId(userId)]},
      ], [admin.adminId, 'user.delete', 'user', userId, reason, requestId]);
      let revokedSessions = 0;
      for (const [access, session] of store.sessions.entries()) {
        if (session.userId !== userId) continue;
        revokedSessions += 1;
        await infrastructure.cacheDelete(`session:${tokenHash(session.refreshToken)}`);
        store.sessions.delete(access);
      }
      store.identities = store.identities.filter(item => item.userId !== userId);
      store.devices = store.devices.filter(item => item.userId !== userId);
      store.userRestrictions.delete(userId);
      store.profiles.delete(userId);
      return send(res, 200, {deleted: true, userId, revokedSessions, retainedBusinessRecords: true, deletedAt, previousName: profile.name}, requestId);
    }
    const restrictionMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/restrictions$/);
    if (restrictionMatch && req.method === 'POST') {
      const admin = requireAdmin(req); const userId = internalUserId(restrictionMatch[1]); profileFor(userId); const input = await body(req); const type = String(input.type ?? 'login'); const reason = String(input.reason ?? '').trim(); const expiresAt = typeof input.expiresAt === 'string' && input.expiresAt.trim() ? input.expiresAt.trim() : undefined; if (!['login', 'community'].includes(type) || reason.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '限制类型和原因不能为空'); if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) throw new HttpError(422, 'VALIDATION_ERROR', '限制截止时间必须是未来的有效时间'); const restriction = {type: type as 'login' | 'community', reason, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined, createdAt: new Date().toISOString()}; store.userRestrictions.set(userId, restriction); await persist('insert into user_restrictions (user_id, restriction_type, reason, expires_at, created_by) values ($1, $2, $3, $4, $5) on conflict (user_id) do update set restriction_type = excluded.restriction_type, reason = excluded.reason, expires_at = excluded.expires_at, lifted_at = null', [dbUserId(userId), restriction.type, restriction.reason, restriction.expiresAt ?? null, admin.adminId]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'user.restrict', 'user', userId, reason, requestId]); return send(res, 200, restriction, requestId);
    }
    if (restrictionMatch && req.method === 'DELETE') {
      const admin = requireAdmin(req); const userId = internalUserId(restrictionMatch[1]); profileFor(userId); const existing = store.userRestrictions.get(userId);
      if (!existing) return send(res, 200, {lifted: false, userId}, requestId);
      store.userRestrictions.delete(userId); await persist('update user_restrictions set lifted_at = now() where user_id = $1 and lifted_at is null', [dbUserId(userId)]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'user.restriction.lift', 'user', userId, 'restriction lifted', requestId]); return send(res, 200, {lifted: true, userId}, requestId);
    }
    const revokeMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/sessions\/revoke$/);
    if (revokeMatch && req.method === 'POST') {
      const admin = requireAdmin(req); const userId = internalUserId(revokeMatch[1]); profileFor(userId); const now = new Date().toISOString(); let count = 0; for (const [access, session] of store.sessions.entries()) { if (session.userId !== userId || session.revokedAt) continue; session.revokedAt = now; count += 1; await infrastructure.cacheDelete(`session:${tokenHash(session.refreshToken)}`); store.sessions.delete(access); } await persist('update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [dbUserId(userId)]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'user.sessions.revoke', 'user', userId, '后台强制下线', requestId]); return send(res, 200, {revoked: count}, requestId);
    }
    const adminEntitlementMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/entitlements\/adjust$/);
    if (adminEntitlementMatch && req.method === 'POST') {
      const admin = requireAdmin(req); const userId = internalUserId(adminEntitlementMatch[1]); profileFor(userId); const input = await body(req); const courseId = String(input.courseId ?? '').trim(); const type = String(input.type ?? 'grant'); const reason = String(input.reason ?? '').trim(); const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim(); if (!courseId || !['grant', 'revoke'].includes(type) || reason.length < 2 || !idempotencyKey) throw new HttpError(422, 'VALIDATION_ERROR', 'courseId、类型、原因和 Idempotency-Key 均不能为空'); if (!store.courses.some(course => course.id === courseId)) throw new HttpError(404, 'NOT_FOUND', '课程不存在'); const existing = store.entitlementAdjustments.find(item => item.id === idempotencyKey); if (existing) return send(res, 200, existing, requestId); const now = new Date().toISOString(); const adjustment = {id: idempotencyKey, userId, courseId, type: type as 'grant' | 'revoke', reason, sourceReference: typeof input.sourceReference === 'string' ? input.sourceReference : undefined, expiresAt: typeof input.expiresAt === 'string' ? input.expiresAt : undefined, createdAt: now}; store.entitlementAdjustments.unshift(adjustment); if (adjustment.type === 'grant' && !store.entitlements.some(item => item.userId === userId && item.courseId === courseId)) store.entitlements.unshift({userId, courseId, sourceOrderId: `manual:${adjustment.id}`, expiresAt: adjustment.expiresAt}); if (adjustment.type === 'revoke') store.entitlements = store.entitlements.filter(item => !(item.userId === userId && item.courseId === courseId)); await persist('insert into entitlement_adjustments (id, user_id, course_id, adjustment_type, reason, source_reference, expires_at, created_by, idempotency_key) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (idempotency_key) do nothing', [adjustment.id, dbUserId(userId), courseId, adjustment.type, adjustment.reason, adjustment.sourceReference ?? null, adjustment.expiresAt ?? null, admin.adminId, idempotencyKey]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'user.entitlement.adjust', 'user', userId, reason, requestId]); return send(res, 200, adjustment, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/content/subjects') {
      requireAdmin(req); return send(res, 200, adminSubjectCatalog.map(subject => ({...subject, status: 'published', objectiveQuestionCount: store.questions.filter(question => question.subjectId === subject.id).length, subjectiveQuestionCount: store.gradingRubrics.filter(rubric => rubric.subjectId === subject.id).length, questionCount: store.questions.filter(question => question.subjectId === subject.id).length + store.gradingRubrics.filter(rubric => rubric.subjectId === subject.id).length})), requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/content/subjects') {
      const admin = requireAdmin(req, 'content.questions.write');
      const input = await body(req);
      const name = String(input.name ?? '').trim();
      if (!name || name.length > 80) throw new HttpError(422, 'VALIDATION_ERROR', '科目名称不正确');
      const subject = {id: `subject-${randomUUID()}`, name, color: '#DDE9FF', questionCount: 0,
        questionType: 'both' as const, chapters: []};
      await persistSubject(subject);
      adminSubjectCatalog.push(subject);
      await persist('insert into admin_audit_logs (admin_user_id,action,resource_type,resource_id,request_id) values ($1,$2,$3,$4,$5)',
        [admin.adminId, 'subject.create', 'subject', subject.id, requestId]);
      return send(res, 201, subject, requestId);
    }
    const adminSubjectMatch = path.match(/^\/v1\/admin\/content\/subjects\/([^/]+)$/);
    if (adminSubjectMatch && req.method === 'DELETE') {
      const admin = requireAdmin(req, 'content.questions.write');
      const subject = adminSubjectCatalog.find(item => item.id === adminSubjectMatch[1]);
      if (!subject) throw new HttpError(404, 'NOT_FOUND', '科目不存在');
      const objectiveCount = store.questions.filter(question => question.subjectId === subject.id).length;
      const subjectiveCount = store.gradingRubrics.filter(rubric => rubric.subjectId === subject.id).length;
      if (objectiveCount || subjectiveCount) throw new HttpError(409, 'SUBJECT_IN_USE', '该科目已关联题目，无法删除，请先移除题目关联');
      adminSubjectCatalog.splice(adminSubjectCatalog.indexOf(subject), 1);
      await persist('delete from subjects where id = $1', [subject.id]);
      await persist('insert into admin_audit_logs (admin_user_id,action,resource_type,resource_id,request_id) values ($1,$2,$3,$4,$5)', [admin.adminId, 'subject.delete', 'subject', subject.id, requestId]);
      return send(res, 200, {deleted: true, id: subject.id}, requestId);
    }
    if (adminSubjectMatch && req.method === 'PATCH') { const admin = requireAdmin(req, 'content.questions.write'); const subject = adminSubjectCatalog.find(item => item.id === adminSubjectMatch[1]); if (!subject) throw new HttpError(404, 'NOT_FOUND', '科目不存在'); const input = await body(req); const name = String(input.name ?? subject.name).trim(); const questionType = String(input.questionType ?? subject.questionType); if (name.length < 1 || !['objective', 'subjective', 'both'].includes(questionType)) throw new HttpError(422, 'VALIDATION_ERROR', '科目名称或题目分类不正确'); subject.name = name; subject.questionType = questionType as typeof subject.questionType; await persistSubject(subject); return send(res, 200, subject, requestId); }
    const adminChapterCreate = path.match(/^\/v1\/admin\/content\/subjects\/([^/]+)\/chapters$/);
    if (adminChapterCreate && req.method === 'POST') { requireAdmin(req, 'content.questions.write'); const subject = adminSubjectCatalog.find(item => item.id === adminChapterCreate[1]); if (!subject) throw new HttpError(404, 'NOT_FOUND', '科目不存在'); const input = await body(req); const name = String(input.name ?? '').trim(); if (!name) throw new HttpError(422, 'VALIDATION_ERROR', '章节名称不能为空'); const chapter = {id: `chapter-${randomUUID()}`, name, questionType: (['objective', 'subjective', 'both'].includes(String(input.questionType)) ? String(input.questionType) : subject.questionType) as 'objective' | 'subjective' | 'both', points: [] as Array<{id: string; name: string}>}; subject.chapters.push(chapter); await persistSubject(subject); return send(res, 201, subject, requestId); }
    const adminChapterMatch = path.match(/^\/v1\/admin\/content\/subjects\/([^/]+)\/chapters\/([^/]+)$/);
    if (adminChapterMatch && req.method === 'DELETE') {
      const admin = requireAdmin(req, 'content.questions.write');
      const subject = adminSubjectCatalog.find(item => item.id === adminChapterMatch[1]);
      const chapter = subject?.chapters.find(item => item.id === adminChapterMatch[2]);
      if (!subject || !chapter) throw new HttpError(404, 'NOT_FOUND', '章节不存在');
      const objectiveCount = store.questions.filter(question => question.chapterId === chapter.id).length;
      const subjectiveCount = store.gradingRubrics.filter(rubric => rubric.chapterId === chapter.id).length;
      if (objectiveCount || subjectiveCount) throw new HttpError(409, 'CHAPTER_IN_USE', '该章节已关联题目，无法删除，请先移除题目关联');
      subject.chapters = subject.chapters.filter(item => item.id !== chapter.id);
      await persistSubject(subject);
      await persist('insert into admin_audit_logs (admin_user_id,action,resource_type,resource_id,request_id) values ($1,$2,$3,$4,$5)', [admin.adminId, 'chapter.delete', 'chapter', chapter.id, requestId]);
      return send(res, 200, {deleted: true, id: chapter.id}, requestId);
    }
    if (adminChapterMatch && req.method === 'PATCH') { requireAdmin(req, 'content.questions.write'); const subject = adminSubjectCatalog.find(item => item.id === adminChapterMatch[1]); const chapter = subject?.chapters.find(item => item.id === adminChapterMatch[2]); if (!subject || !chapter) throw new HttpError(404, 'NOT_FOUND', '章节不存在'); const input = await body(req); if (input.name !== undefined) chapter.name = String(input.name).trim(); if (input.questionType !== undefined && ['objective', 'subjective', 'both'].includes(String(input.questionType))) chapter.questionType = String(input.questionType) as typeof chapter.questionType; if (!chapter.name) throw new HttpError(422, 'VALIDATION_ERROR', '章节名称不能为空'); await persistSubject(subject); return send(res, 200, subject, requestId); }
    const adminPointCreate = path.match(/^\/v1\/admin\/content\/subjects\/([^/]+)\/chapters\/([^/]+)\/points$/);
    if (adminPointCreate && req.method === 'POST') { requireAdmin(req, 'content.questions.write'); const subject = adminSubjectCatalog.find(item => item.id === adminPointCreate[1]); const chapter = subject?.chapters.find(item => item.id === adminPointCreate[2]); if (!subject || !chapter) throw new HttpError(404, 'NOT_FOUND', '章节不存在'); const input = await body(req); const name = String(input.name ?? '').trim(); if (!name) throw new HttpError(422, 'VALIDATION_ERROR', '考点名称不能为空'); chapter.points.push({id: `point-${randomUUID()}`, name}); return send(res, 201, subject, requestId); }
    const adminPointMatch = path.match(/^\/v1\/admin\/content\/subjects\/([^/]+)\/chapters\/([^/]+)\/points\/([^/]+)$/);
    if (adminPointMatch && req.method === 'DELETE') {
      const admin = requireAdmin(req, 'content.questions.write');
      const subject = adminSubjectCatalog.find(item => item.id === adminPointMatch[1]);
      const chapter = subject?.chapters.find(item => item.id === adminPointMatch[2]);
      const point = chapter?.points.find(item => item.id === adminPointMatch[3]);
      if (!subject || !chapter || !point) throw new HttpError(404, 'NOT_FOUND', '考点不存在');
      const objectiveCount = store.questions.filter(question => question.pointId === point.id).length;
      const subjectiveCount = store.gradingRubrics.filter(rubric => rubric.pointId === point.id).length;
      if (objectiveCount || subjectiveCount) throw new HttpError(409, 'POINT_IN_USE', '该考点已关联题目，无法删除，请先移除题目关联');
      chapter.points = chapter.points.filter(item => item.id !== point.id);
      await persistSubject(subject);
      await persist('insert into admin_audit_logs (admin_user_id,action,resource_type,resource_id,request_id) values ($1,$2,$3,$4,$5)', [admin.adminId, 'point.delete', 'point', point.id, requestId]);
      return send(res, 200, {deleted: true, id: point.id}, requestId);
    }
    if (adminPointMatch && req.method === 'PATCH') { requireAdmin(req, 'content.questions.write'); const subject = adminSubjectCatalog.find(item => item.id === adminPointMatch[1]); const chapter = subject?.chapters.find(item => item.id === adminPointMatch[2]); const point = chapter?.points.find(item => item.id === adminPointMatch[3]); if (!subject || !chapter || !point) throw new HttpError(404, 'NOT_FOUND', '考点不存在'); const input = await body(req); const name = String(input.name ?? '').trim(); if (!name) throw new HttpError(422, 'VALIDATION_ERROR', '考点名称不能为空'); point.name = name; await persistSubject(subject); return send(res, 200, subject, requestId); }
    const normalizeObjectivePaper = (paper: typeof store.papers[number]) => ({...paper, questionKind: 'objective' as const, questionCount: paper.questionIds.length});
    const normalizeSubjectivePaper = (paper: typeof store.gradingPapers[number]) => ({
      id: paper.id,
      name: paper.title,
      year: paper.year ?? '',
      volume: '主观题卷',
      mode: 'real',
      durationMinutes: paper.questionIds.reduce((sum, id) => sum + (store.gradingRubrics.find(rubric => rubric.questionId === id)?.suggestedMinutes ?? 0), 0),
      totalScore: paper.totalScore,
      questionIds: paper.questionIds,
      questionKind: 'subjective' as const,
      subjectId: paper.subjectId,
      questionCount: paper.questionIds.length,
      status: paper.status,
      version: 1,
      updatedAt: paper.updatedAt,
    });
    if (req.method === 'GET' && path === '/v1/admin/content/papers') {
      requireAdmin(req);
      const items = [...store.papers.map(normalizeObjectivePaper), ...store.gradingPapers.map(normalizeSubjectivePaper)]
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
      return send(res, 200, {items, total: items.length}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/content/papers') {
      const admin = requireAdmin(req);
      const input = await body(req);
      const name = String(input.name ?? '').trim();
      const year = String(input.year ?? '').trim();
      const questionKind = String(input.questionKind ?? 'objective');
      const totalScore = Number(input.totalScore);
      const questionIds = Array.isArray(input.questionIds) ? [...new Set(input.questionIds.map(String))] : [];
      if (name.length < 3 || name.length > 200 || !/^20\d{2}$/.test(year) || !['objective', 'subjective'].includes(questionKind) || !Number.isInteger(totalScore) || totalScore < 1 || totalScore > 1000 || questionIds.length < 1) {
        throw new HttpError(422, 'VALIDATION_ERROR', '试卷名称、年份、类型、总分或题目配置不正确');
      }
      const now = new Date().toISOString();
      if (questionKind === 'subjective') {
        const subjectId = String(input.subjectId ?? '').trim();
        const subject = adminSubjectCatalog.find(item => item.id === subjectId);
        const questions = questionIds.map(id => store.gradingRubrics.find(rubric => rubric.questionId === id));
        if (!subject || questions.some(question => !question || question.subjectId !== subjectId)) throw new HttpError(422, 'VALIDATION_ERROR', '主观题试卷的科目与所选题目不匹配');
        const paper = {id: `grading-paper-${randomUUID()}`, title: name, subjectId, year, totalScore, questionIds, status: 'draft' as const, createdAt: now, updatedAt: now};
        store.gradingPapers.unshift(paper);
        await persist('insert into grading_papers (id, title, subject_id, exam_year, total_score, question_ids, status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $8)', [paper.id, paper.title, paper.subjectId, paper.year, paper.totalScore, JSON.stringify(paper.questionIds), paper.status, now]);
        await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'subjective-paper.create', 'grading_paper', paper.id, requestId]);
        return send(res, 201, normalizeSubjectivePaper(paper), requestId);
      }
      const volume = String(input.volume ?? '').trim();
      const mode = String(input.mode ?? 'real');
      const durationMinutes = Number(input.durationMinutes);
      if (!volume || !['real', 'mock', 'chapter', 'marketing', 'advanced'].includes(mode) || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600 || questionIds.some(id => !store.questions.some(question => question.id === id))) {
        throw new HttpError(422, 'VALIDATION_ERROR', '客观题试卷的卷别、模式、时长或所选题目不正确');
      }
      const productId = mode === 'advanced' ? String(input.productId ?? '').trim() : undefined; if (mode === 'advanced' && (!productId || !store.products.some(item => item.id === productId))) throw new HttpError(422, 'VALIDATION_ERROR', '进阶考试必须绑定有效付费商品'); const paper = {id: `paper-${randomUUID()}`, name, year, volume, mode, durationMinutes, totalScore, questionIds, ...(productId ? {productId} : {}), status: 'draft' as const, version: 1, updatedAt: now};
      store.papers.unshift(paper);
      await persist('insert into content_papers (id, name, exam_year, volume, mode, duration_minutes, total_score, question_ids, product_id, status, version, created_by, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)', [paper.id, name, year, volume, mode, durationMinutes, totalScore, JSON.stringify(questionIds), paper.productId ?? null, paper.status, paper.version, admin.adminId, now]);
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'paper.create', 'paper', paper.id, requestId]);
      return send(res, 201, normalizeObjectivePaper(paper), requestId);
    }
    const adminPaperMatch = path.match(/^\/v1\/admin\/content\/papers\/([^/]+)$/);
    if (adminPaperMatch && req.method === 'PATCH') {
      const admin = requireAdmin(req);
      const objectivePaper = store.papers.find(item => item.id === adminPaperMatch[1]);
      const subjectivePaper = store.gradingPapers.find(item => item.id === adminPaperMatch[1]);
      if (!objectivePaper && !subjectivePaper) throw new HttpError(404, 'NOT_FOUND', '试卷不存在');
      const input = await body(req);
      const paper = objectivePaper ?? subjectivePaper!;
      if (input.updatedAt !== paper.updatedAt) throw new HttpError(409, 'STALE_VERSION', '试卷已被其他管理员更新，请刷新后重试');
      if (objectivePaper) {
        if (input.questionKind && input.questionKind !== 'objective') throw new HttpError(422, 'VALIDATION_ERROR', '试卷类型创建后不可更改');
        const questionIds = input.questionIds === undefined ? objectivePaper.questionIds : Array.isArray(input.questionIds) ? [...new Set(input.questionIds.map(String))] : [];
        if (questionIds.length < 1 || questionIds.some(id => !store.questions.some(question => question.id === id))) throw new HttpError(422, 'VALIDATION_ERROR', '客观题试卷包含不存在或错误类型的题目');
        objectivePaper.name = input.name === undefined ? objectivePaper.name : String(input.name).trim();
        objectivePaper.year = input.year === undefined ? objectivePaper.year : String(input.year).trim();
        objectivePaper.volume = input.volume === undefined ? objectivePaper.volume : String(input.volume).trim();
        objectivePaper.mode = input.mode === undefined ? objectivePaper.mode : String(input.mode); const requestedProductId = input.productId === undefined ? objectivePaper.productId : String(input.productId).trim() || undefined; if (objectivePaper.mode === 'advanced' && (!requestedProductId || !store.products.some(item => item.id === requestedProductId))) throw new HttpError(422, 'VALIDATION_ERROR', '进阶考试必须绑定有效付费商品'); objectivePaper.productId = objectivePaper.mode === 'advanced' ? requestedProductId : undefined;
        objectivePaper.durationMinutes = input.durationMinutes === undefined ? objectivePaper.durationMinutes : Number(input.durationMinutes);
        objectivePaper.questionIds = questionIds;
        objectivePaper.totalScore = input.totalScore === undefined ? objectivePaper.totalScore : Number(input.totalScore);
        if (objectivePaper.name.length < 3 || !/^20\d{2}$/.test(objectivePaper.year) || !objectivePaper.volume || !['real', 'mock', 'chapter', 'marketing', 'advanced'].includes(objectivePaper.mode) || !Number.isInteger(objectivePaper.durationMinutes) || objectivePaper.durationMinutes < 1 || objectivePaper.durationMinutes > 600 || !Number.isInteger(objectivePaper.totalScore) || objectivePaper.totalScore < 1) throw new HttpError(422, 'VALIDATION_ERROR', '客观题试卷信息不正确');
        if (objectivePaper.status === 'published') { objectivePaper.status = 'draft'; objectivePaper.version += 1; }
        objectivePaper.updatedAt = new Date().toISOString();
        await persist('update content_papers set name = $1, exam_year = $2, volume = $3, mode = $4, duration_minutes = $5, total_score = $6, question_ids = $7::jsonb, product_id = $8, status = $9, version = $10, updated_at = $11 where id = $12', [objectivePaper.name, objectivePaper.year, objectivePaper.volume, objectivePaper.mode, objectivePaper.durationMinutes, objectivePaper.totalScore, JSON.stringify(objectivePaper.questionIds), objectivePaper.productId ?? null, objectivePaper.status, objectivePaper.version, objectivePaper.updatedAt, objectivePaper.id]);
        await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'paper.edit', 'paper', objectivePaper.id, requestId]);
        return send(res, 200, normalizeObjectivePaper(objectivePaper), requestId);
      }
      if (input.questionKind && input.questionKind !== 'subjective') throw new HttpError(422, 'VALIDATION_ERROR', '试卷类型创建后不可更改');
      const questionIds = input.questionIds === undefined ? subjectivePaper!.questionIds : Array.isArray(input.questionIds) ? [...new Set(input.questionIds.map(String))] : [];
      const subjectId = input.subjectId === undefined ? subjectivePaper!.subjectId : String(input.subjectId).trim();
      const questions = questionIds.map(id => store.gradingRubrics.find(rubric => rubric.questionId === id));
      if (!adminSubjectCatalog.some(item => item.id === subjectId) || questionIds.length < 1 || questions.some(question => !question || question.subjectId !== subjectId)) throw new HttpError(422, 'VALIDATION_ERROR', '主观题试卷的科目与所选题目不匹配');
      subjectivePaper!.title = input.name === undefined ? subjectivePaper!.title : String(input.name).trim();
      subjectivePaper!.year = input.year === undefined ? subjectivePaper!.year : String(input.year).trim();
      subjectivePaper!.subjectId = subjectId;
      subjectivePaper!.questionIds = questionIds;
      subjectivePaper!.totalScore = input.totalScore === undefined ? subjectivePaper!.totalScore : Number(input.totalScore);
      if (subjectivePaper!.title.length < 3 || !/^20\d{2}$/.test(subjectivePaper!.year ?? '') || !Number.isInteger(subjectivePaper!.totalScore) || subjectivePaper!.totalScore < 1) throw new HttpError(422, 'VALIDATION_ERROR', '主观题试卷信息不正确');
      if (subjectivePaper!.status === 'published') subjectivePaper!.status = 'draft';
      subjectivePaper!.updatedAt = new Date().toISOString();
      await persist('update grading_papers set title = $1, subject_id = $2, exam_year = $3, total_score = $4, question_ids = $5::jsonb, status = $6, updated_at = $7 where id = $8', [subjectivePaper!.title, subjectivePaper!.subjectId, subjectivePaper!.year, subjectivePaper!.totalScore, JSON.stringify(subjectivePaper!.questionIds), subjectivePaper!.status, subjectivePaper!.updatedAt, subjectivePaper!.id]);
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'subjective-paper.edit', 'grading_paper', subjectivePaper!.id, requestId]);
      return send(res, 200, normalizeSubjectivePaper(subjectivePaper!), requestId);
    }
    const adminPaperPublishMatch = path.match(/^\/v1\/admin\/content\/papers\/([^/]+)\/publish$/);
    if (adminPaperPublishMatch && req.method === 'POST') {
      const admin = requireAdmin(req);
      const objectivePaper = store.papers.find(item => item.id === adminPaperPublishMatch[1]);
      const subjectivePaper = store.gradingPapers.find(item => item.id === adminPaperPublishMatch[1]);
      const paper = objectivePaper ?? subjectivePaper;
      if (!paper) throw new HttpError(404, 'NOT_FOUND', '试卷不存在');
      if (!paper.questionIds.length) throw new HttpError(422, 'VALIDATION_ERROR', '试卷至少需要一道题目才能发布');
      paper.status = 'published';
      paper.updatedAt = new Date().toISOString();
      if (objectivePaper) await persist('update content_papers set status = $1, updated_at = $2 where id = $3', [objectivePaper.status, objectivePaper.updatedAt, objectivePaper.id]);
      else await persist('update grading_papers set status = $1, updated_at = $2 where id = $3', [subjectivePaper!.status, subjectivePaper!.updatedAt, subjectivePaper!.id]);
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, objectivePaper ? 'paper.publish' : 'subjective-paper.publish', objectivePaper ? 'paper' : 'grading_paper', paper.id, requestId]);
      return send(res, 200, objectivePaper ? normalizeObjectivePaper(objectivePaper) : normalizeSubjectivePaper(subjectivePaper!), requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/content/imports') { requireAdmin(req); const items = adminImports.map(({validRecords: _records, idempotencyKey: _key, ...item}) => item); return send(res, 200, {items, total: items.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/content/imports') {
      const admin = requireAdmin(req); const input = await body(req); const filename = String(input.filename ?? '').trim(); const format = String(input.format ?? '').toLowerCase(); const questionKind = String(input.questionKind ?? ''); const legacySubjectId = String(input.subjectId ?? '').trim(); const legacyChapterId = String(input.chapterId ?? '').trim(); const legacyPointId = String(input.pointId ?? '').trim(); const records = Array.isArray(input.records) ? input.records : []; const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim();
      if (!filename || !['xlsx', 'json', 'csv'].includes(format) || !['objective', 'subjective'].includes(questionKind) || idempotencyKey.length < 8 || idempotencyKey.length > 120 || records.length < 1 || records.length > 5000) throw new HttpError(422, 'VALIDATION_ERROR', '文件、题型、记录（1-5000 条）和有效 Idempotency-Key 均不能为空');
      if (legacySubjectId && (legacyChapterId || legacyPointId)) {
        const subject = adminSubjectCatalog.find(item => item.id === legacySubjectId);
        const legacyChapter = subject?.chapters.find(item => item.id === legacyChapterId && (item.questionType === questionKind || item.questionType === 'both'));
        const legacyPoint = legacyChapter?.points.find(item => item.id === legacyPointId);
        if (!legacyChapter || !legacyPoint) throw new HttpError(422, 'VALIDATION_ERROR', '科目、题型、章节或考点不匹配');
      }
      const existing = adminImports.find(item => item.idempotencyKey === idempotencyKey); if (existing) { const {validRecords: _records, idempotencyKey: _key, ...publicJob} = existing; return send(res, 200, publicJob, requestId); }
      const validRecords: AdminImportJob['validRecords'] = []; const errors: AdminImportJob['errors'] = []; let warningCount = 0;
      records.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push({row: index + 2, message: '记录必须是对象'}); return; }
        const record = raw as Record<string, unknown>;
        const subjectValue = String(record.subjectId ?? record.subject ?? record.subjectName ?? legacySubjectId).trim();
        const subject = adminSubjectCatalog.find(item => item.id === subjectValue || item.name === subjectValue);
        const chapterValue = String(record.chapterId ?? record.chapter ?? record.chapterName ?? legacyChapterId).trim();
        const pointValue = String(record.pointId ?? record.point ?? record.pointName ?? legacyPointId).trim();
        const chapter = subject?.chapters.find(item => (item.id === chapterValue || item.name === chapterValue) && (item.questionType === questionKind || item.questionType === 'both'));
        const point = chapter?.points.find(item => item.id === pointValue || item.name === pointValue);
        if (!subject || !chapter || !point) { errors.push({row: index + 2, message: '科目、章节或考点不存在，或与题型不匹配'}); return; }
        if (questionKind === 'objective') {
          const stem = String(record.stem ?? '').trim(); const options = Array.isArray(record.options) ? record.options.map(String).map(item => item.trim()).filter(Boolean) : []; const analysis = String(record.analysis ?? '').trim();
          let choices: ReturnType<typeof normalizeQuestionChoices> | undefined; try { choices = normalizeQuestionChoices(record, options); } catch { choices = undefined; }
          if (stem.length < 5 || stem.length > 5000 || options.length < 2 || options.length > 8 || !choices || !analysis) { errors.push({row: index + 2, message: '题干、选项、答案或解析格式错误'}); return; }
          if (store.questions.some(item => item.stem === stem) || validRecords.some(item => item.kind === 'objective' && item.stem === stem)) warningCount += 1;
          else validRecords.push({kind: 'objective', subjectId: subject.id, chapterId: chapter.id, pointId: point.id, stem, options, ...choices, analysis, source: typeof record.source === 'string' ? record.source.trim() : filename});
          return;
        }
        const title = String(record.title ?? '').trim(); const caseMaterial = String(record.caseMaterial ?? '').trim(); const subQuestion = String(record.subQuestion ?? '').trim(); const gradingBasis = String(record.gradingBasis ?? '').trim(); const totalScore = Number(record.totalScore); const suggestedMinutes = Number(record.suggestedMinutes ?? 60);
        if (title.length < 2 || title.length > 200 || caseMaterial.length < 5 || !subQuestion || !gradingBasis || !Number.isFinite(totalScore) || totalScore <= 0 || totalScore > 1000 || !Number.isInteger(suggestedMinutes) || suggestedMinutes < 1 || suggestedMinutes > 600) { errors.push({row: index + 2, message: '标题、案情、设问、批改依据、总分或建议用时格式错误'}); return; }
        if (store.gradingRubrics.some(item => item.title === title && item.caseMaterial === caseMaterial) || validRecords.some(item => item.kind === 'subjective' && item.title === title && item.caseMaterial === caseMaterial)) warningCount += 1;
        else validRecords.push({kind: 'subjective', subjectId: subject.id, chapterId: chapter.id, pointId: point.id, title, caseMaterial, subQuestion, gradingBasis, totalScore, suggestedMinutes});
      });
      const job: AdminImportJob = {id: randomUUID(), filename, format: format as AdminImportJob['format'], questionKind: questionKind as AdminImportJob['questionKind'], subjectId: legacySubjectId, chapterId: '', pointId: '', status: 'preflight', successCount: validRecords.length, warningCount, errorCount: errors.length, errors, validRecords, idempotencyKey, createdAt: new Date().toISOString()}; adminImports.unshift(job); await persist('insert into admin_import_jobs (id, admin_user_id, resource_type, filename, question_kind, import_format, subject_id, chapter_id, point_id, status, success_count, warning_count, error_count, valid_records, errors, idempotency_key, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17)', [job.id, admin.adminId, `${questionKind}_questions`, filename, job.questionKind, job.format, legacySubjectId || null, null, null, job.status, job.successCount, job.warningCount, job.errorCount, JSON.stringify(job.validRecords), JSON.stringify(job.errors), job.idempotencyKey, job.createdAt]); const {validRecords: _records, idempotencyKey: _key, ...publicJob} = job; return send(res, 201, publicJob, requestId);
    }
    const adminImportConfirmMatch = path.match(/^\/v1\/admin\/content\/imports\/([^/]+)\/confirm$/);
    if (adminImportConfirmMatch && req.method === 'POST') {
      const admin = requireAdmin(req); const job = adminImports.find(item => item.id === adminImportConfirmMatch[1]);
      if (!job) throw new HttpError(404, 'NOT_FOUND', '导入任务不存在');
      if (job.status === 'completed') { const {validRecords: _records, idempotencyKey: _key, ...publicJob} = job; return send(res, 200, publicJob, requestId); }
      if (job.errorCount > 0) throw new HttpError(409, 'IMPORT_HAS_ERRORS', '预检存在错误，请修正文件后重新导入');
      const now = new Date().toISOString();
      for (const record of job.validRecords) {
        if (record.kind === 'objective') {
          const question: Question = {id: `q-${randomUUID()}`, subjectId: record.subjectId, chapterId: record.chapterId, pointId: record.pointId, stem: record.stem, options: record.options, answer: record.answer, answerIndexes: record.answerIndexes, questionType: record.questionType, analysis: record.analysis, source: record.source, status: 'draft', version: 1, updatedAt: now};
          store.questions.unshift(question);
          await persist('insert into questions (id, subject_id, chapter_id, point_id, stem, options, answer, answer_indexes, question_type, analysis, type, status, version, source, updated_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)', [question.id, question.subjectId, question.chapterId, question.pointId, question.stem, JSON.stringify(question.options), question.answer, JSON.stringify(question.answerIndexes ?? [question.answer]), question.questionType, question.analysis, 'objective', question.status, question.version, question.source ?? job.filename, now]);
          continue;
        }
        const questionId = `q-${randomUUID()}`; const rubricId = `rubric-${randomUUID()}`; const subQuestionId = `subq-${randomUUID()}`; const rubricPointId = `rpoint-${randomUUID()}`;
        await persist('insert into questions (id, subject_id, chapter_id, point_id, stem, options, answer, analysis, type, status, version, source, updated_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)', [questionId, record.subjectId, record.chapterId, record.pointId, record.title, '[]', null, record.gradingBasis, 'subjective', 'draft', 1, job.filename, now]);
        const rubric: GradingRubric = {id: rubricId, questionId, questionVersion: 1, title: record.title, subjectId: record.subjectId, chapterId: record.chapterId, pointId: record.pointId, caseMaterial: record.caseMaterial, subQuestions: [{id: subQuestionId, prompt: record.subQuestion, maxScore: record.totalScore}], gradingBasis: record.gradingBasis, totalScore: record.totalScore, suggestedMinutes: record.suggestedMinutes, allowedAnswerTypes: ['text', 'image', 'pdf'], points: [{id: rubricPointId, title: '综合评分', description: record.gradingBasis, maxScore: record.totalScore, sortOrder: 1, keywords: [], legalReferences: []}], status: 'draft', createdAt: now, updatedAt: now};
        store.gradingRubrics.unshift(rubric);
        await persist('insert into grading_rubrics (id, question_id, question_version, title, subject_id, chapter_id, point_id, case_material, sub_questions, grading_basis, total_score, suggested_minutes, allowed_answer_types, status, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15)', [rubric.id, rubric.questionId, rubric.questionVersion, rubric.title, rubric.subjectId, rubric.chapterId, rubric.pointId, rubric.caseMaterial, JSON.stringify(rubric.subQuestions), rubric.gradingBasis, rubric.totalScore, rubric.suggestedMinutes, JSON.stringify(rubric.allowedAnswerTypes), rubric.status, rubric.updatedAt]);
        await persist('insert into grading_rubric_points (id, rubric_id, title, description, max_score, sort_order, keywords, legal_references) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)', [rubricPointId, rubric.id, '综合评分', record.gradingBasis, record.totalScore, 1, '[]', '[]']);
      }
      job.status = 'completed'; job.completedAt = now;
      await persist('update admin_import_jobs set status = $1, completed_at = $2 where id = $3', [job.status, now, job.id]);
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1,$2,$3,$4,$5,$6)', [admin.adminId, `${job.questionKind}.questions.import`, 'admin_import_job', job.id, `${job.successCount} imported, ${job.warningCount} duplicates skipped`, requestId]);
      const {validRecords: _records, idempotencyKey: _key, ...publicJob} = job; return send(res, 200, publicJob, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/content/laws') { requireAdmin(req); return send(res, 200, {items: store.legalDocuments, total: store.legalDocuments.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/content/laws') { const admin = requireAdmin(req); const input = await body(req); const title = String(input.title ?? '').trim(); const article = String(input.article ?? '').trim(); const content = String(input.content ?? '').trim(); const effectiveFrom = String(input.effectiveFrom ?? ''); if (title.length < 2 || article.length < 2 || content.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new HttpError(422, 'VALIDATION_ERROR', '法条名称、条号、正文或生效日期不正确'); const now = new Date().toISOString(); const law = {id: `law-${randomUUID()}`, title, article, content, documentCode: typeof input.documentCode === 'string' ? input.documentCode.trim() : undefined, sourceUrl: typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() : undefined, effectiveFrom, status: 'draft' as const, version: 1, updatedAt: now}; store.legalDocuments.unshift(law); await persist('insert into legal_documents (id, title, article, content, document_code, source_url, effective_from, status, version, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [law.id, title, article, content, law.documentCode ?? null, law.sourceUrl ?? null, effectiveFrom, law.status, law.version, now]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'law.create', 'legal_document', law.id, requestId]); return send(res, 201, law, requestId); }
    const adminLawMatch = path.match(/^\/v1\/admin\/content\/laws\/([^/]+)$/);
    if (adminLawMatch && req.method === 'PATCH') { const admin = requireAdmin(req); const law = store.legalDocuments.find(item => item.id === adminLawMatch[1]); if (!law) throw new HttpError(404, 'NOT_FOUND', '法条不存在'); if (law.status !== 'draft') throw new HttpError(409, 'LAW_NOT_EDITABLE', '已发布或已失效版本不可直接覆盖，请新建版本'); const input = await body(req); if (input.updatedAt !== law.updatedAt) throw new HttpError(409, 'STALE_VERSION', '法条已被其他管理员更新，请刷新后重试'); law.title = input.title === undefined ? law.title : String(input.title).trim(); law.article = input.article === undefined ? law.article : String(input.article).trim(); law.content = input.content === undefined ? law.content : String(input.content).trim(); if (law.title.length < 2 || law.article.length < 2 || law.content.length < 10) throw new HttpError(422, 'VALIDATION_ERROR', '法条内容不正确'); law.updatedAt = new Date().toISOString(); await persist('update legal_documents set title = $1, article = $2, content = $3, updated_at = $4 where id = $5', [law.title, law.article, law.content, law.updatedAt, law.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'law.edit', 'legal_document', law.id, requestId]); return send(res, 200, law, requestId); }
    const adminLawPublishMatch = path.match(/^\/v1\/admin\/content\/laws\/([^/]+)\/publish$/);
    if (adminLawPublishMatch && req.method === 'POST') { const admin = requireAdmin(req); const law = store.legalDocuments.find(item => item.id === adminLawPublishMatch[1]); if (!law) throw new HttpError(404, 'NOT_FOUND', '法条不存在'); law.status = 'published'; law.updatedAt = new Date().toISOString(); await persist('update legal_documents set status = $1, updated_at = $2 where id = $3', [law.status, law.updatedAt, law.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'law.publish', 'legal_document', law.id, requestId]); return send(res, 200, law, requestId); }
    const adminLawDisableMatch = path.match(/^\/v1\/admin\/content\/laws\/([^/]+)\/disable$/);
    if (adminLawDisableMatch && req.method === 'POST') { const admin = requireAdmin(req); const law = store.legalDocuments.find(item => item.id === adminLawDisableMatch[1]); if (!law) throw new HttpError(404, 'NOT_FOUND', '法条不存在'); const input = await body(req); const reason = String(input.reason ?? '').trim(); if (reason.length < 4 || input.confirmation !== 'DISABLE') throw new HttpError(422, 'VALIDATION_ERROR', '请填写至少 4 个字的原因并输入 DISABLE 确认'); law.status = 'disabled'; law.effectiveTo = typeof input.effectiveTo === 'string' ? input.effectiveTo : new Date().toISOString().slice(0, 10); law.updatedAt = new Date().toISOString(); await persist('update legal_documents set status = $1, effective_to = $2, updated_at = $3 where id = $4', [law.status, law.effectiveTo, law.updatedAt, law.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'law.disable', 'legal_document', law.id, reason, requestId]); return send(res, 200, law, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/questions') {
      requireAdmin(req); const keyword = (url.searchParams.get('keyword') ?? '').trim(); const status = url.searchParams.get('status'); const subjectId = url.searchParams.get('subjectId'); const chapterId = url.searchParams.get('chapterId'); const pointId = url.searchParams.get('pointId'); const questionType = url.searchParams.get('questionType'); const page = parsePositiveInteger(url.searchParams.get('page'), 1, 1, 1_000_000, 'page'); const pageSize = parsePositiveInteger(url.searchParams.get('pageSize'), 20, 1, 100, 'pageSize'); const filtered = store.questions.filter(question => (!keyword || question.stem.includes(keyword) || question.id.includes(keyword)) && (!status || question.status === status) && (!questionType || (question.questionType ?? 'single') === questionType) && questionMatchesSubject(question, subjectId) && (!chapterId || question.chapterId === chapterId) && (!pointId || question.pointId === pointId)); const items = filtered.slice((page - 1) * pageSize, page * pageSize); return send(res, 200, {items, total: filtered.length, page, pageSize}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/questions') {
      requireAdmin(req); const input = await body(req); const stem = String(input.stem ?? '').trim(); const options = Array.isArray(input.options) ? input.options.map(String).map(item => item.trim()).filter(Boolean) : []; const analysis = String(input.analysis ?? '').trim(); const subjectId = typeof input.subjectId === 'string' ? input.subjectId.trim() : undefined; const chapterId = typeof input.chapterId === 'string' ? input.chapterId.trim() : undefined; const pointId = typeof input.pointId === 'string' ? input.pointId.trim() : undefined; const taxonomySubject = adminSubjectCatalog.find(item => item.id === subjectId); const taxonomyChapter = taxonomySubject?.chapters.find(item => item.id === chapterId && (item.questionType === 'objective' || item.questionType === 'both')); const taxonomyPoint = taxonomyChapter?.points.find(item => item.id === pointId);
      if (stem.length < 5 || stem.length > 5000 || options.length < 2 || !analysis || !taxonomySubject || !taxonomyChapter || !taxonomyPoint) throw new HttpError(422, 'VALIDATION_ERROR', '题目内容、科目、章节或考点格式不正确');
      const choices = normalizeQuestionChoices(input, options);
      const now = new Date().toISOString(); const question: Question = {id: `q-${randomUUID()}`, subjectId, chapterId, pointId, stem, options, ...choices, analysis, status: 'draft', version: 1, source: typeof input.source === 'string' ? input.source.trim() : undefined, updatedAt: now}; store.questions.unshift(question);
      await persist('insert into questions (id, subject_id, chapter_id, point_id, stem, options, answer, answer_indexes, question_type, analysis, type, status, version, source, updated_at) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15) on conflict (id) do nothing', [question.id, question.subjectId ?? null, question.chapterId ?? null, question.pointId ?? null, question.stem, JSON.stringify(question.options), question.answer, question.answerIndexes?.length ? JSON.stringify(question.answerIndexes) : null, question.questionType, question.analysis, 'objective', question.status, question.version, question.source ?? null, now]); return send(res, 201, question, requestId);
    }
    const adminQuestionTaxonomy = path.match(/^\/v1\/admin\/questions\/([^/]+)\/taxonomy$/);
    if (adminQuestionTaxonomy && req.method === 'PATCH') { requireAdmin(req, 'content.questions.write'); const question = store.questions.find(item => item.id === adminQuestionTaxonomy[1]); if (!question) throw new HttpError(404, 'NOT_FOUND', '题目不存在'); const input = await body(req); const subjectId = typeof input.subjectId === 'string' ? input.subjectId.trim() : question.subjectId; const subject = adminSubjectCatalog.find(item => item.id === subjectId); const chapterId = typeof input.chapterId === 'string' ? input.chapterId.trim() : undefined; const chapter = chapterId ? subject?.chapters.find(item => item.id === chapterId && (item.questionType === 'objective' || item.questionType === 'both')) : undefined; const pointId = typeof input.pointId === 'string' ? input.pointId.trim() : undefined; if (!subject || !chapter || !pointId || !chapter.points.some(item => item.id === pointId)) throw new HttpError(422, 'VALIDATION_ERROR', '请选择有效的客观题科目、章节和考点'); question.subjectId = subject.id; question.chapterId = chapterId; question.pointId = pointId; question.updatedAt = new Date().toISOString(); await persist('update questions set subject_id = $1, chapter_id = $2, point_id = $3, updated_at = $4 where id = $5', [question.subjectId, question.chapterId, question.pointId, question.updatedAt, question.id]); return send(res, 200, question, requestId); }
    const adminQuestionEdit = path.match(/^\/v1\/admin\/questions\/([^/]+)$/);
    if (adminQuestionEdit && req.method === 'PATCH') {
      const admin = requireAdmin(req); const question = store.questions.find(item => item.id === adminQuestionEdit[1]); if (!question) throw new HttpError(404, 'NOT_FOUND', '题目不存在'); const input = await body(req); const stem = input.stem === undefined ? question.stem : String(input.stem).trim(); const options = input.options === undefined ? question.options : (Array.isArray(input.options) ? input.options.map(String).map(item => item.trim()).filter(Boolean) : []); const choices = normalizeQuestionChoices(input, options, question); const answer = choices.answer; const analysis = input.analysis === undefined ? question.analysis : String(input.analysis).trim(); const requestedSubjectId = input.subjectId; const subjectId = requestedSubjectId === undefined ? question.subjectId : requestedSubjectId === null || (typeof requestedSubjectId === 'string' && requestedSubjectId.trim() === '') ? undefined : typeof requestedSubjectId === 'string' ? requestedSubjectId.trim() : undefined; const invalidSubject = requestedSubjectId !== undefined && requestedSubjectId !== null && typeof requestedSubjectId !== 'string'; if (stem.length < 5 || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length || !analysis || invalidSubject || (subjectId && !store.subjects.some(subject => subject.id === subjectId))) throw new HttpError(422, 'VALIDATION_ERROR', '题目内容、答案或科目格式不正确'); const before = {...question}; const wasPublished = question.status === 'published'; question.subjectId = subjectId; question.stem = stem; question.options = options; question.answer = answer; question.answerIndexes = choices.answerIndexes; question.questionType = choices.questionType; question.analysis = analysis; question.status = wasPublished ? 'draft' : question.status; question.version = wasPublished ? (question.version ?? 1) + 1 : question.version; question.updatedAt = new Date().toISOString(); const history = adminQuestionHistory.get(question.id) ?? []; history.unshift({version: before.version ?? 1, status: before.status ?? 'draft', ...(before.subjectId ? {subjectId: before.subjectId} : {}), stem: before.stem, options: before.options, answer: before.answer, ...(before.answerIndexes?.length ? {answerIndexes: before.answerIndexes} : {}), ...(before.questionType ? {questionType: before.questionType} : {}), analysis: before.analysis, updatedAt: before.updatedAt}); adminQuestionHistory.set(question.id, history); await persist('update questions set subject_id = $1, stem = $2, options = $3::jsonb, answer = $4, answer_indexes = $5::jsonb, question_type = $6, analysis = $7, status = $8, version = $9, updated_at = $10 where id = $11', [question.subjectId ?? null, question.stem, JSON.stringify(question.options), question.answer, question.answerIndexes?.length ? JSON.stringify(question.answerIndexes) : null, question.questionType, question.analysis, question.status, question.version ?? 1, question.updatedAt, question.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'question.edit', 'question', question.id, requestId]); return send(res, 200, question, requestId);
    }
    const adminQuestionVersions = path.match(/^\/v1\/admin\/questions\/([^/]+)\/versions$/);
    if (adminQuestionVersions && req.method === 'GET') { requireAdmin(req); const question = store.questions.find(item => item.id === adminQuestionVersions[1]); if (!question) throw new HttpError(404, 'NOT_FOUND', '题目不存在'); const history = adminQuestionHistory.get(question.id) ?? []; return send(res, 200, {items: [{version: question.version ?? 1, status: question.status ?? 'draft', ...(question.subjectId ? {subjectId: question.subjectId} : {}), stem: question.stem, options: question.options, answer: question.answer, ...(question.answerIndexes?.length ? {answerIndexes: question.answerIndexes} : {}), ...(question.questionType ? {questionType: question.questionType} : {}), analysis: question.analysis, updatedAt: question.updatedAt}, ...history], total: history.length + 1}, requestId); }
    const adminQuestionMatch = path.match(/^\/v1\/admin\/questions\/([^/]+)\/publish$/);
    if (adminQuestionMatch && req.method === 'POST') {
      requireAdmin(req); const question = store.questions.find(item => item.id === adminQuestionMatch[1]); if (!question) throw new HttpError(404, 'NOT_FOUND', '题目不存在'); const taxonomySubject = adminSubjectCatalog.find(item => item.id === question.subjectId); const taxonomyChapter = taxonomySubject?.chapters.find(item => item.id === question.chapterId && (item.questionType === 'objective' || item.questionType === 'both')); if (!taxonomyChapter?.points.some(item => item.id === question.pointId)) throw new HttpError(422, 'TAXONOMY_REQUIRED', '发布前必须选择客观题科目、章节和考点'); if (question.status === 'published') return send(res, 200, question, requestId); question.status = 'published'; question.version = (question.version ?? 1) + 1; question.updatedAt = new Date().toISOString(); await persist('update questions set status = $1, version = $2, updated_at = $3 where id = $4', [question.status, question.version, question.updatedAt, question.id]); return send(res, 200, question, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/content/questions/subjective') {
      requireAdmin(req, 'content.questions.read'); const keyword = (url.searchParams.get('keyword') ?? '').trim(); const status = url.searchParams.get('status'); const subjectId = url.searchParams.get('subjectId'); const chapterId = url.searchParams.get('chapterId'); const pointId = url.searchParams.get('pointId');
      const items = store.gradingRubrics.filter(rubric => (!keyword || rubric.title.includes(keyword) || rubric.questionId.includes(keyword)) && (!status || rubric.status === status) && (!subjectId || rubric.subjectId === subjectId) && (!chapterId || rubric.chapterId === chapterId) && (!pointId || rubric.pointId === pointId)).map(rubric => ({id: rubric.id, questionId: rubric.questionId, title: rubric.title, subjectId: rubric.subjectId, chapterId: rubric.chapterId, pointId: rubric.pointId, caseMaterial: rubric.caseMaterial, totalScore: rubric.totalScore, suggestedMinutes: rubric.suggestedMinutes, status: rubric.status, version: rubric.questionVersion, updatedAt: rubric.updatedAt, publishedAt: rubric.publishedAt}));
      return send(res, 200, {items, total: items.length}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/courses') { requireAdmin(req); return send(res, 200, {items: store.courses.map(course => ({...course, status: course.status ?? 'published', studentCount: store.entitlements.filter(item => item.courseId === course.id).length})), total: store.courses.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/courses') { const admin = requireAdmin(req); const input = await body(req); const title = String(input.title ?? '').trim(); const teacher = String(input.teacher ?? '').trim(); const type = String(input.type ?? 'video'); const lessons = Number(input.lessons ?? 0); const productId = String(input.productId ?? '').trim() || undefined; if (title.length < 2 || !teacher || !['video', 'audio', 'live', 'mixed'].includes(type) || !Number.isInteger(lessons) || lessons < 1 || productId && !store.products.some(item => item.id === productId)) throw new HttpError(422, 'VALIDATION_ERROR', '课程信息不完整'); const now = new Date().toISOString(); const isHot = input.isHot === true; const hotSortOrder = Number(input.hotSortOrder ?? 0); if (!Number.isInteger(hotSortOrder) || hotSortOrder < 0) throw new HttpError(422, 'VALIDATION_ERROR', '热门排序必须是非负整数'); const course = {id: `c-${randomUUID()}`, title, teacher, type: type as 'video' | 'audio' | 'live' | 'mixed', progress: 0, lessons, accent: '#4C4BEA', ...(productId ? {productId} : {}), isHot, hotSortOrder, status: 'draft' as const, updatedAt: now}; store.courses.unshift(course); await persist('insert into courses (id, title, teacher, type, progress, lessons, accent, status, product_id, is_hot, hot_sort_order, updated_at) values ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10, $11)', [course.id, course.title, course.teacher, course.type, course.lessons, course.accent, course.status, course.productId ?? null, course.isHot, course.hotSortOrder, now]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'course.create', 'course', course.id, requestId]); return send(res, 201, course, requestId); }
    const adminCourseEdit = path.match(/^\/v1\/admin\/courses\/([^/]+)$/); if (adminCourseEdit && req.method === 'PATCH') { const admin = requireAdmin(req); const course = store.courses.find(item => item.id === decodePathSegment(adminCourseEdit[1])); if (!course) throw new HttpError(404, 'NOT_FOUND', '课程不存在'); const input = await body(req); const isHot = input.isHot === undefined ? course.isHot === true : input.isHot === true; const hotSortOrder = input.hotSortOrder === undefined ? course.hotSortOrder ?? 0 : Number(input.hotSortOrder); if (!Number.isInteger(hotSortOrder) || hotSortOrder < 0) throw new HttpError(422, 'VALIDATION_ERROR', '热门排序必须是非负整数'); course.isHot = isHot; course.hotSortOrder = hotSortOrder; course.updatedAt = new Date().toISOString(); await persist('update courses set is_hot=$1, hot_sort_order=$2, updated_at=$3 where id=$4', [isHot, hotSortOrder, course.updatedAt, course.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'course.hot.update', 'course', course.id, requestId]); return send(res, 200, course, requestId); }
    const adminCoursePublish = path.match(/^\/v1\/admin\/courses\/([^/]+)\/publish$/); if (adminCoursePublish && req.method === 'POST') { const admin = requireAdmin(req); const course = store.courses.find(item => item.id === adminCoursePublish[1]); if (!course) throw new HttpError(404, 'NOT_FOUND', '课程不存在'); if (!store.courseSections.some(item => item.courseId === course.id)) throw new HttpError(422, 'COURSE_STRUCTURE_REQUIRED', '课程至少需要一个章节才能发布'); course.status = 'published'; course.updatedAt = new Date().toISOString(); await persist('update courses set status = $1, updated_at = $2 where id = $3', [course.status, course.updatedAt, course.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'course.publish', 'course', course.id, requestId]); return send(res, 200, course, requestId); }
    const adminCourseSections = path.match(/^\/v1\/admin\/courses\/([^/]+)\/sections$/);
    if (adminCourseSections && req.method === 'GET') { requireAdmin(req); return send(res, 200, {items: store.courseSections.filter(item => item.courseId === adminCourseSections[1]).map(section => ({...section, lessons: store.courseLessons.filter(lesson => lesson.sectionId === section.id)}))}, requestId); }
    if (adminCourseSections && req.method === 'POST') { const admin = requireAdmin(req); const course = store.courses.find(item => item.id === adminCourseSections[1]); const input = await body(req); const title = String(input.title ?? '').trim(); if (!course || title.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '课程或章节名称不正确'); const now = new Date().toISOString(); const section = {id: `section-${randomUUID()}`, courseId: course.id, title, sortOrder: Number(input.sortOrder ?? store.courseSections.filter(item => item.courseId === course.id).length), updatedAt: now}; store.courseSections.push(section); await persist('insert into course_sections (id, course_id, title, sort_order, updated_at) values ($1, $2, $3, $4, $5)', [section.id, section.courseId, section.title, section.sortOrder, now]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'course.section.create', 'course_section', section.id, requestId]); return send(res, 201, section, requestId); }
    const adminCourseLessons = path.match(/^\/v1\/admin\/courses\/([^/]+)\/lessons$/);
    if (adminCourseLessons && req.method === 'POST') { const admin = requireAdmin(req); const input = await body(req); const sectionId = String(input.sectionId ?? ''); const section = store.courseSections.find(item => item.id === sectionId && item.courseId === adminCourseLessons[1]); const title = String(input.title ?? '').trim(); const mediaKind = String(input.mediaKind ?? 'video'); if (!section || title.length < 2 || !['video', 'audio', 'live', 'document'].includes(mediaKind)) throw new HttpError(422, 'VALIDATION_ERROR', '课时信息不正确'); const handoutReference = typeof input.handoutReference === 'string' ? input.handoutReference.trim() : undefined; const now = new Date().toISOString(); const materialKind: 'article' | 'material' = input.materialKind === 'article' ? 'article' : 'material'; const materialCategory = typeof input.materialCategory === 'string' ? input.materialCategory.trim() || undefined : undefined; const downloadable = materialKind === 'material' && input.downloadable === true; const articleContent = typeof input.articleContent === 'string' ? input.articleContent.trim() : undefined; const lesson = {id: `lesson-${randomUUID()}`, sectionId, title, mediaKind: mediaKind as 'video' | 'audio' | 'live' | 'document', mediaReference: typeof input.mediaReference === 'string' ? input.mediaReference.trim() : undefined, handoutReference, durationSeconds: Number(input.durationSeconds ?? 0), trialEnabled: input.trialEnabled === true, sortOrder: Number(input.sortOrder ?? store.courseLessons.filter(item => item.sectionId === sectionId).length), materialCategory, materialKind, downloadable, articleContent, updatedAt: now}; store.courseLessons.push(lesson); await persist('insert into course_lessons (id, section_id, title, media_kind, media_reference, handout_reference, duration_seconds, trial_enabled, sort_order, material_category, material_kind, downloadable, article_content, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)', [lesson.id, lesson.sectionId, lesson.title, lesson.mediaKind, lesson.mediaReference ?? null, lesson.handoutReference ?? null, lesson.durationSeconds, lesson.trialEnabled, lesson.sortOrder, lesson.materialCategory ?? null, lesson.materialKind, lesson.downloadable, lesson.articleContent ?? null, now]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'course.lesson.create', 'course_lesson', lesson.id, requestId]); return send(res, 201, lesson, requestId); }
    const adminCourseLesson = path.match(/^\/v1\/admin\/courses\/([^/]+)\/lessons\/([^/]+)$/);
    if (adminCourseLesson && req.method === 'PATCH') {
      const admin = requireAdmin(req);
      const input = await body(req);
      const lesson = store.courseLessons.find(item => item.id === adminCourseLesson[2]);
      const section = lesson && store.courseSections.find(item => item.id === lesson.sectionId && item.courseId === adminCourseLesson[1]);
      if (!lesson || !section) throw new HttpError(404, 'NOT_FOUND', '课时不存在');
      const updated = {...lesson, updatedAt: new Date().toISOString()};
      if (input.title !== undefined) {
        if (typeof input.title !== 'string' || input.title.trim().length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '课时名称不正确');
        updated.title = input.title.trim();
      }
      for (const field of ['mediaReference', 'handoutReference'] as const) {
        if (input[field] !== undefined) {
          if (typeof input[field] !== 'string') throw new HttpError(422, 'VALIDATION_ERROR', '文件引用格式不正确');
          updated[field] = input[field].trim() || undefined;
        }
      }
      if (input.durationSeconds !== undefined) {
        if (typeof input.durationSeconds !== 'number' || !Number.isInteger(input.durationSeconds) || input.durationSeconds < 0) throw new HttpError(422, 'VALIDATION_ERROR', '时长必须为非负整数秒');
        updated.durationSeconds = input.durationSeconds;
      }
      if (input.trialEnabled !== undefined) {
        if (typeof input.trialEnabled !== 'boolean') throw new HttpError(422, 'VALIDATION_ERROR', '试看设置不正确');
        updated.trialEnabled = input.trialEnabled;
      }
      await persist('update course_lessons set title = $1, media_reference = $2, handout_reference = $3, duration_seconds = $4, trial_enabled = $5, updated_at = $6 where id = $7', [updated.title, updated.mediaReference ?? null, updated.handoutReference ?? null, updated.durationSeconds, updated.trialEnabled, updated.updatedAt, updated.id]);
      Object.assign(lesson, updated);
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'course.lesson.update', 'course_lesson', lesson.id, requestId]);
      return send(res, 200, lesson, requestId);
    }
    const adminRubricMatch = path.match(/^\/v1\/admin\/content\/questions\/([^/]+)\/grading-rubric$/);
    if (adminRubricMatch && req.method === 'GET') { requireAdmin(req, 'content.questions.read'); const rubric = store.gradingRubrics.find(item => item.questionId === adminRubricMatch[1] || item.id === adminRubricMatch[1]); if (!rubric) throw new HttpError(404, 'NOT_FOUND', '题目批改依据不存在'); return send(res, 200, rubric, requestId); }
    if (adminRubricMatch && ['POST', 'PATCH'].includes(req.method ?? '')) { const admin = requireAdmin(req, 'content.questions.write'); const input = await body(req); const existing = store.gradingRubrics.find(item => item.questionId === adminRubricMatch[1] || item.id === adminRubricMatch[1]); const base: any = existing ?? {id: `rubric-${randomUUID()}`, questionId: adminRubricMatch[1], questionVersion: Number(input.questionVersion ?? 1), createdAt: new Date().toISOString()}; const rubric = {...base, title: String(input.title ?? base.title ?? '').trim(), subjectId: String(input.subjectId ?? base.subjectId ?? ''), chapterId: input.chapterId === undefined ? base.chapterId : String(input.chapterId || '') || undefined, pointId: input.pointId === undefined ? base.pointId : String(input.pointId || '') || undefined, caseMaterial: String(input.caseMaterial ?? base.caseMaterial ?? '').trim(), subQuestions: Array.isArray(input.subQuestions) ? input.subQuestions as Array<{id: string; prompt: string; maxScore: number}> : (base.subQuestions ?? []), gradingBasis: String(input.gradingBasis ?? base.gradingBasis ?? '').trim(), totalScore: Number(input.totalScore ?? base.totalScore ?? 0), suggestedMinutes: Number(input.suggestedMinutes ?? base.suggestedMinutes ?? 60), allowedAnswerTypes: (Array.isArray(input.allowedAnswerTypes) ? input.allowedAnswerTypes : (base.allowedAnswerTypes ?? ['text'])) as Array<'text' | 'image' | 'pdf'>, points: Array.isArray(input.points) ? input.points as typeof base.points : (base.points ?? []), status: (input.status ?? base.status ?? 'draft') as typeof base.status, updatedAt: new Date().toISOString(), versionReason: input.versionReason ? String(input.versionReason) : base.versionReason, publishedAt: base.publishedAt}; const errors = validateRubric(rubric); if (errors.length && rubric.status === 'published') throw new HttpError(422, 'RUBRIC_INCOMPLETE', errors.join('；')); if (!rubric.title || !rubric.subjectId || !rubric.caseMaterial || !rubric.gradingBasis) throw new HttpError(422, 'VALIDATION_ERROR', '题目标题、科目、案情和批改依据不能为空'); if (rubric.status === 'published') rubric.publishedAt = new Date().toISOString(); if (existing) Object.assign(existing, rubric); else store.gradingRubrics.unshift(rubric); await persist('insert into grading_rubrics (id, question_id, question_version, title, subject_id, chapter_id, point_id, case_material, sub_questions, grading_basis, total_score, suggested_minutes, allowed_answer_types, status, version_reason, updated_at, published_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,$16,$17) on conflict (id) do update set title = excluded.title, subject_id = excluded.subject_id, chapter_id = excluded.chapter_id, point_id = excluded.point_id, case_material = excluded.case_material, sub_questions = excluded.sub_questions, grading_basis = excluded.grading_basis, total_score = excluded.total_score, suggested_minutes = excluded.suggested_minutes, allowed_answer_types = excluded.allowed_answer_types, status = excluded.status, version_reason = excluded.version_reason, updated_at = excluded.updated_at, published_at = excluded.published_at', [rubric.id, rubric.questionId, rubric.questionVersion, rubric.title, rubric.subjectId, rubric.chapterId ?? null, rubric.pointId ?? null, rubric.caseMaterial, JSON.stringify(rubric.subQuestions), rubric.gradingBasis, rubric.totalScore, rubric.suggestedMinutes, JSON.stringify(rubric.allowedAnswerTypes), rubric.status, rubric.versionReason ?? null, rubric.updatedAt, rubric.publishedAt ?? null]); await persist('delete from grading_rubric_points where rubric_id = $1', [rubric.id]); for (const point of rubric.points) await persist('insert into grading_rubric_points (id, rubric_id, title, description, max_score, sort_order, keywords, legal_references) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)', [point.id, rubric.id, point.title, point.description, point.maxScore, point.sortOrder, JSON.stringify(point.keywords), JSON.stringify(point.legalReferences)]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1,$2,$3,$4,$5,$6)', [admin.adminId, existing ? 'grading.rubric.update' : 'grading.rubric.create', 'grading_rubric', rubric.id, rubric.versionReason ?? null, requestId]); return send(res, existing ? 200 : 201, rubric, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/grader-accounts') { requireAdmin(req, 'grading.assign'); return send(res, 200, {items: store.graderAccounts.map(item => ({id: item.id, username: item.username, displayName: item.displayName, subjectIds: item.subjectIds, status: item.status})), total: store.graderAccounts.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/grader-accounts') { const admin = requireAdmin(req, 'grading.assign'); const input = await body(req); const username = String(input.username ?? '').trim(); const displayName = String(input.displayName ?? '').trim(); const password = String(input.password ?? ''); const subjectIds = Array.isArray(input.subjectIds) ? input.subjectIds.map(String).map(value => value.trim()).filter(Boolean) : []; if (!/^[a-zA-Z0-9_.-]{3,80}$/.test(username) || displayName.length < 2 || password.length < 8) throw new HttpError(422, 'VALIDATION_ERROR', '账号、姓名或密码不符合要求'); if (store.graderAccounts.some(item => item.username === username)) throw new HttpError(409, 'GRADER_USERNAME_EXISTS', '批改账号已存在'); const account: GraderAccount = {id: randomUUID(), username, displayName, passwordHash: config.nodeEnv === 'development' ? `local:${password}` : passwordHash(password), status: 'active', subjectIds, createdAt: new Date().toISOString()}; store.graderAccounts.push(account); await persist('insert into grader_accounts (id, username, display_name, password_hash, status, subject_ids, created_at, updated_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$7)', [account.id, account.username, account.displayName, account.passwordHash, account.status, JSON.stringify(account.subjectIds), account.createdAt]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1,$2,$3,$4,$5,$6)', [admin.adminId, 'grader.create', 'grader_account', account.id, `subjects:${account.subjectIds.join(',')}`, requestId]); return send(res, 201, {id: account.id, username: account.username, displayName: account.displayName, subjectIds: account.subjectIds, status: account.status}, requestId); }
    const adminGraderAccountMatch = path.match(/^\/v1\/admin\/grader-accounts\/([^/]+)$/); if (adminGraderAccountMatch && req.method === 'PATCH') { const admin = requireAdmin(req, 'grading.assign'); const account = store.graderAccounts.find(item => item.id === decodePathSegment(adminGraderAccountMatch[1])); if (!account) throw new HttpError(404, 'GRADER_NOT_FOUND', '批改老师不存在'); const input = await body(req); if (input.displayName !== undefined) { const displayName = String(input.displayName).trim(); if (displayName.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '姓名不符合要求'); account.displayName = displayName; } if (input.subjectIds !== undefined) { if (!Array.isArray(input.subjectIds)) throw new HttpError(422, 'VALIDATION_ERROR', '科目权限格式不正确'); account.subjectIds = input.subjectIds.map(String).map(value => value.trim()).filter(Boolean); } if (input.password !== undefined) { const password = String(input.password); if (password.length < 8) throw new HttpError(422, 'VALIDATION_ERROR', '密码至少 8 位'); account.passwordHash = config.nodeEnv === 'development' ? `local:${password}` : passwordHash(password); } if (input.status !== undefined) { const status = String(input.status); if (status !== 'active' && status !== 'disabled') throw new HttpError(422, 'VALIDATION_ERROR', '账号状态不正确'); account.status = status; } await persist('update grader_accounts set display_name = $1, password_hash = $2, status = $3, subject_ids = $4::jsonb, updated_at = now() where id = $5', [account.displayName, account.passwordHash, account.status, JSON.stringify(account.subjectIds), account.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1,$2,$3,$4,$5)', [admin.adminId, 'grader.update', 'grader_account', account.id, requestId]); return send(res, 200, {id: account.id, username: account.username, displayName: account.displayName, subjectIds: account.subjectIds, status: account.status}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/grading') { const admin = requireAdmin(req); return send(res, 200, {items: store.gradingSubmissions.map(item => ({...publicGradingSubmission(item), assignment: store.gradingAssignments.find(a => a.id === item.currentAssignmentId), report: store.gradingReports.find(r => r.id === item.latestReportId)})), legacyItems: store.grading, total: store.gradingSubmissions.length + store.grading.length}, requestId); }
    const adminGradingDetailV2 = path.match(/^\/v1\/admin\/grading\/(?!stats$)([^/]+)$/);
    if (adminGradingDetailV2 && req.method === 'GET') { requireAdmin(req); const submission = store.gradingSubmissions.find(item => item.id === adminGradingDetailV2[1]); if (!submission) throw new HttpError(404, 'NOT_FOUND', '批改任务不存在'); return send(res, 200, {submission: {...submission, ...publicGradingSubmission(submission)}, assignment: store.gradingAssignments.find(item => item.id === submission.currentAssignmentId), rubric: store.gradingRubrics.find(item => item.id === submission.rubricId), aiRuns: store.gradingAiRuns.filter(item => item.submissionId === submission.id), assignments: store.gradingAssignments.filter(item => item.submissionId === submission.id), reviews: store.gradingReviews.filter(item => item.submissionId === submission.id), reports: store.gradingReports.filter(item => item.submissionId === submission.id), events: store.gradingEvents.filter(item => item.submissionId === submission.id)}, requestId); }
    const adminSelfReview = path.match(/^\/v1\/admin\/grading\/([^/]+)\/self-review$/); if (adminSelfReview && req.method === 'POST') { const admin = requireAdmin(req, 'grading.submit'); const submission = store.gradingSubmissions.find(item => item.id === adminSelfReview[1]); if (!submission) throw new HttpError(404, 'NOT_FOUND', '批改任务不存在'); if (!['manual_queued', 'manual_returned', 'manual_expired'].includes(submission.status)) throw new HttpError(409, 'GRADING_NOT_SELF_REVIEWABLE', '当前状态不能由批改管理员自批'); const rubric = store.gradingRubrics.find(item => item.id === submission.rubricId); if (!rubric) throw new HttpError(409, 'GRADING_RUBRIC_MISSING', '批改依据不存在'); const input = await body(req); const totalScore = Number(input.totalScore); const feedback = String(input.feedback ?? '').trim(); const improvementAdvice = String(input.improvementAdvice ?? '').trim(); if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > rubric.totalScore || feedback.length < 2 || improvementAdvice.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '分数、评语和改进建议不能为空'); let assignment = store.gradingAssignments.find(item => item.id === submission.currentAssignmentId && ['available', 'claimed'].includes(item.status)); if (!assignment) { assignment = {id: `gassign-${randomUUID()}`, submissionId: submission.id, status: 'claimed', claimedAt: new Date().toISOString(), createdAt: new Date().toISOString()}; store.gradingAssignments.unshift(assignment); submission.currentAssignmentId = assignment.id; await persist('insert into grading_assignments (id, submission_id, status, claimed_at, created_at) values ($1,$2,$3,$4,$5)', [assignment.id, assignment.submissionId, assignment.status, assignment.claimedAt, assignment.createdAt]); } assignment.status = 'submitted'; assignment.submittedAt = new Date().toISOString(); const review: GradingReview = {id: `greview-${randomUUID()}`, submissionId: submission.id, assignmentId: assignment.id, reviewerType: 'admin', reviewerAdminId: admin.adminId, totalScore, pointResults: Array.isArray(input.pointResults) ? input.pointResults as GradingReview['pointResults'] : [], answerAnnotations: Array.isArray(input.answerAnnotations) ? input.answerAnnotations as GradingReview['answerAnnotations'] : [], missedPointIds: Array.isArray(input.missedPointIds) ? input.missedPointIds.map(String) : [], feedback, improvementAdvice, status: 'submitted', createdAt: new Date().toISOString()}; store.gradingReviews.unshift(review); gradingStatus(submission, 'manual_submitted'); gradingEvent(submission.id, 'manual_submitted', 'admin', admin.adminId, {reviewId: review.id, reviewerType: 'admin'}); await persist('update grading_assignments set status = $1, submitted_at = $2 where id = $3', [assignment.status, assignment.submittedAt, assignment.id]); await persist('update grading_submissions set status = $1, updated_at = now() where id = $2', [submission.status, submission.id]); await persist('insert into grading_reviews (id, submission_id, assignment_id, grader_id, reviewer_type, reviewer_admin_id, total_score, point_results, answer_annotations, missed_point_ids, feedback, improvement_advice, status, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::text[],$11,$12,$13,$14)', [review.id, review.submissionId, review.assignmentId, null, review.reviewerType, review.reviewerAdminId, review.totalScore, JSON.stringify(review.pointResults), JSON.stringify(review.answerAnnotations), review.missedPointIds, review.feedback, review.improvementAdvice, review.status, review.createdAt]); return send(res, 201, review, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/grading/stats') { requireAdmin(req); const submissions = store.gradingSubmissions; const completed = submissions.filter(item => item.status === 'published').length; const metrics = gradingMetrics(); return send(res, 200, {total: submissions.length, byStatus: Object.fromEntries([...new Set(submissions.map(item => item.status))].map(status => [status, submissions.filter(item => item.status === status).length])), completed, availableTasks: store.gradingAssignments.filter(item => item.status === 'available').length, claimedTasks: store.gradingAssignments.filter(item => item.status === 'claimed').length, hourlyCompleted: metrics.hourlyCompleted, dailyCompleted: metrics.dailyCompleted, graderStats: store.graderAccounts.map(account => ({graderId: account.id, displayName: account.displayName, completed: store.gradingAssignments.filter(item => item.graderId === account.id && item.status === 'submitted').length}))}, requestId); }
    const adminGradingQueueManual = path.match(/^\/v1\/admin\/grading\/([^/]+)\/queue-manual$/); if (adminGradingQueueManual && req.method === 'POST') { const admin = requireAdmin(req, 'grading.assign'); const submission = store.gradingSubmissions.find(item => item.id === adminGradingQueueManual[1]); if (!submission) throw new HttpError(404, 'NOT_FOUND', '批改任务不存在'); if (!['ai_failed', 'ai_completed'].includes(submission.status)) throw new HttpError(409, 'GRADING_NOT_QUEUEABLE', '当前状态不能转人工批改'); const assignment = store.gradingAssignments.find(item => item.submissionId === submission.id && ['available', 'claimed'].includes(item.status)); if (assignment) return send(res, 200, assignment, requestId); gradingStatus(submission, 'manual_queued'); const created: GradingAssignment = {id: `gassign-${randomUUID()}`, submissionId: submission.id, status: 'available', createdAt: new Date().toISOString()}; store.gradingAssignments.unshift(created); submission.currentAssignmentId = created.id; gradingEvent(submission.id, 'manual_queued', 'admin', admin.adminId); await persist('insert into grading_assignments (id, submission_id, status, created_at) values ($1,$2,$3,$4)', [created.id, created.submissionId, created.status, created.createdAt]); return send(res, 201, created, requestId); }
    const adminGradingAssign = path.match(/^\/v1\/admin\/grading\/([^/]+)\/(assign|reassign)$/);
    if (adminGradingAssign && req.method === 'POST') {
      const admin = requireAdmin(req, 'grading.assign'); const submission = store.gradingSubmissions.find(item => item.id === adminGradingAssign[1]); if (!submission) throw new HttpError(404, 'NOT_FOUND', '批改任务不存在');
      if (!['manual_queued', 'manual_claimed', 'manual_returned', 'manual_expired'].includes(submission.status)) throw new HttpError(409, 'GRADING_NOT_ASSIGNABLE', '当前状态不可分发或改派');
      const input = await body(req); const graderId = String(input.graderId ?? '').trim(); const grader = store.graderAccounts.find(item => item.id === graderId && item.status === 'active'); if (!grader) throw new HttpError(422, 'GRADER_NOT_FOUND', '批改老师不存在或已停用'); const rubric = store.gradingRubrics.find(item => item.id === submission.rubricId); if (!rubric || (grader.subjectIds.length > 0 && !grader.subjectIds.includes(rubric.subjectId))) throw new HttpError(403, 'GRADER_SUBJECT_FORBIDDEN', '该批改老师没有对应科目权限');
      const dueAtValue = input.dueAt ? new Date(String(input.dueAt)) : new Date(Date.now() + 24 * 3600000); if (Number.isNaN(dueAtValue.getTime()) || dueAtValue.getTime() <= Date.now()) throw new HttpError(422, 'VALIDATION_ERROR', '截止时间必须是未来时间'); const reason = String(input.reason ?? '').trim(); if (reason.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '分发原因不能为空');
      const oldAssignments = store.gradingAssignments.filter(item => item.submissionId === submission.id && ['available', 'claimed'].includes(item.status)); for (const old of oldAssignments) { old.status = 'cancelled'; await persist('update grading_assignments set status = $1 where id = $2', [old.status, old.id]); }
      const now = new Date().toISOString(); const assignment: GradingAssignment = {id: `gassign-${randomUUID()}`, submissionId: submission.id, graderId, status: 'available', dueAt: dueAtValue.toISOString(), createdAt: now}; store.gradingAssignments.unshift(assignment); submission.currentAssignmentId = assignment.id; if (submission.status !== 'manual_queued') gradingStatus(submission, 'manual_queued'); gradingEvent(submission.id, adminGradingAssign[2] === 'reassign' ? 'manual_reassigned' : 'manual_assigned', 'admin', admin.adminId, {graderId, dueAt: assignment.dueAt, reason}); await persist('insert into grading_assignments (id, submission_id, grader_id, status, claimed_at, due_at, created_at) values ($1,$2,$3,$4,$5,$6,$7)', [assignment.id, assignment.submissionId, assignment.graderId, assignment.status, null, assignment.dueAt, assignment.createdAt]); await persist('update grading_submissions set status = $1, current_assignment_id = $2, updated_at = now() where id = $3', [submission.status, submission.currentAssignmentId, submission.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1,$2,$3,$4,$5,$6)', [admin.adminId, adminGradingAssign[2] === 'reassign' ? 'grading.reassign' : 'grading.assign', 'grading_submission', submission.id, reason, requestId]); return send(res, 200, assignment, requestId);
    }
    const adminGradingPublish = path.match(/^\/v1\/admin\/grading\/([^/]+)\/publish$/); if (adminGradingPublish && req.method === 'POST') { const admin = requireAdmin(req, 'grading.publish'); const submission = store.gradingSubmissions.find(item => item.id === adminGradingPublish[1]); if (!submission) throw new HttpError(404, 'NOT_FOUND', '批改任务不存在'); const review = store.gradingReviews.find(item => item.submissionId === submission.id && item.status === 'submitted'); const rubric = store.gradingRubrics.find(item => item.id === submission.rubricId); if (!review || !rubric) throw new HttpError(409, 'GRADING_REVIEW_REQUIRED', '人工复核尚未提交'); const version = store.gradingReports.filter(item => item.submissionId === submission.id).length + 1; const report: GradingReport = {id: `greport-${randomUUID()}`, submissionId: submission.id, reviewId: review.id, version, totalScore: review.totalScore, maxScore: rubric.totalScore, answers: submission.answers, pointResults: review.pointResults.map(point => { const config = rubric.points.find(item => item.id === point.pointId); return {pointId: point.pointId, title: config?.title ?? point.pointId, score: point.score, maxScore: config?.maxScore ?? point.score, status: point.status, comment: point.comment, evidence: point.evidence}; }), answerAnnotations: review.answerAnnotations, missedPointIds: review.missedPointIds, feedback: review.feedback, improvementAdvice: review.improvementAdvice, publishedBy: admin.adminId, publishedAt: new Date().toISOString()}; store.gradingReports.unshift(report); review.status = 'approved'; review.reviewedAt = report.publishedAt; review.reviewedBy = admin.adminId; gradingStatus(submission, 'published'); submission.latestReportId = report.id; gradingEvent(submission.id, 'published', 'admin', admin.adminId, {reportId: report.id, version}); await persist('insert into grading_reports (id, submission_id, review_id, version, total_score, max_score, answers_snapshot, point_results, answer_annotations, missed_point_ids, feedback, improvement_advice, published_by, published_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::text[],$11,$12,$13,$14)', [report.id, report.submissionId, report.reviewId, report.version, report.totalScore, report.maxScore, JSON.stringify(report.answers), JSON.stringify(report.pointResults), JSON.stringify(report.answerAnnotations), report.missedPointIds, report.feedback, report.improvementAdvice, admin.adminId, report.publishedAt]); return send(res, 200, report, requestId); }
    const adminGradingRecall = path.match(/^\/v1\/admin\/grading\/([^/]+)\/recall$/); if (adminGradingRecall && req.method === 'POST') { const admin = requireAdmin(req, 'grading.publish'); const submission = store.gradingSubmissions.find(item => item.id === adminGradingRecall[1]); if (!submission) throw new HttpError(404, 'NOT_FOUND', '批改任务不存在'); if (submission.status !== 'published') throw new HttpError(409, 'GRADING_NOT_PUBLISHED', '只有已发布的批改结果可以收回'); const input = await body(req); const reason = String(input.reason ?? '').trim(); if (reason.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '收回原因不能为空'); const old = store.gradingAssignments.find(item => item.id === submission.currentAssignmentId); if (old) { old.status = 'cancelled'; await persist('update grading_assignments set status = $1 where id = $2', [old.status, old.id]); } const assignment: GradingAssignment = {id: `gassign-${randomUUID()}`, submissionId: submission.id, status: 'available', createdAt: new Date().toISOString()}; store.gradingAssignments.unshift(assignment); submission.currentAssignmentId = assignment.id; gradingStatus(submission, 'manual_queued'); gradingEvent(submission.id, 'manual_recalled', 'admin', admin.adminId, {reason, previousReportId: submission.latestReportId}); await persist('insert into grading_assignments (id, submission_id, status, created_at) values ($1,$2,$3,$4)', [assignment.id, assignment.submissionId, assignment.status, assignment.createdAt]); await persist('update grading_submissions set status = $1, current_assignment_id = $2, updated_at = now() where id = $3', [submission.status, submission.currentAssignmentId, submission.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1,$2,$3,$4,$5,$6)', [admin.adminId, 'grading.recall', 'grading_submission', submission.id, reason, requestId]); return send(res, 200, {assignment, status: submission.status, previousReportId: submission.latestReportId}, requestId); }
    const adminGradingClaim = path.match(/^\/v1\/admin\/grading\/([^/]+)\/claim$/); if (adminGradingClaim && req.method === 'POST') { const admin = requireAdmin(req); const item = store.grading.find(entry => entry.id === adminGradingClaim[1]); if (!item) throw new HttpError(404, 'NOT_FOUND', '批改任务不存在'); if (item.status !== 'queued' || item.assignedAdminId) throw new HttpError(409, 'GRADING_ALREADY_CLAIMED', '任务已被其他管理员领取'); item.status = 'processing'; item.assignedAdminId = admin.adminId; item.claimedAt = new Date().toISOString(); item.version = (item.version ?? 1) + 1; await persist('update grading_submissions set status = $1, assigned_admin_id = $2, claimed_at = $3, version = $4 where id = $5 and status = \'queued\' and assigned_admin_id is null', [item.status, admin.adminId, item.claimedAt, item.version, item.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'grading.claim', 'grading_submission', item.id, requestId]); return send(res, 200, item, requestId); }
    const adminGradingSubmit = path.match(/^\/v1\/admin\/grading\/([^/]+)\/submit$/); if (adminGradingSubmit && req.method === 'POST') { const admin = requireAdmin(req); const item = store.grading.find(entry => entry.id === adminGradingSubmit[1]); if (!item) throw new HttpError(404, 'NOT_FOUND', '批改任务不存在'); if (item.assignedAdminId !== admin.adminId || item.status !== 'processing') throw new HttpError(409, 'GRADING_NOT_ASSIGNED', '只能提交自己领取中的任务'); const input = await body(req); const score = Number(input.score); const feedback = String(input.feedback ?? '').trim(); if (!Number.isFinite(score) || score < 0 || score > 100 || feedback.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '分数或评语不正确'); item.score = score; item.feedback = feedback; item.status = 'completed'; item.version = (item.version ?? 1) + 1; await persist('update grading_submissions set status = $1, score = $2, feedback = $3, version = $4 where id = $5 and assigned_admin_id = $6', [item.status, score, feedback, item.version, item.id, admin.adminId]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'grading.submit', 'grading_submission', item.id, requestId]); return send(res, 200, item, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/courses/live-sessions') { requireAdmin(req); return send(res, 200, {items: store.liveSessions, total: store.liveSessions.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/webhooks/tencent/live') { const secret = process.env.TENCENT_LIVE_CALLBACK_SECRET; if (!secret || req.headers['x-live-callback-secret'] !== secret) throw new HttpError(401, 'UNAUTHORIZED', '直播回调鉴权失败'); const input = await body(req); const providerRoomId = String(input.providerRoomId ?? input.streamName ?? '').trim(); const session = store.liveSessions.find(item => item.providerRoomId === providerRoomId); if (!session) return send(res, 202, {accepted: true, matched: false}, requestId); const event = String(input.event ?? input.status ?? ''); if (['publish', 'online', 'live'].includes(event)) session.status = 'live'; else if (['record', 'recorded', 'completed', 'offline'].includes(event)) { session.status = 'completed'; if (typeof input.recordingUrl === 'string') session.recordingUrl = input.recordingUrl.trim() || undefined; } session.updatedAt = new Date().toISOString(); await persist('update live_sessions set status = $1, recording_url = $2, updated_at = $3 where id = $4', [session.status, session.recordingUrl ?? null, session.updatedAt, session.id]); return send(res, 200, {accepted: true, matched: true, status: session.status}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/courses/live-sessions') { const admin = requireAdmin(req); const input = await body(req); const courseId = String(input.courseId ?? '').trim(); const lessonId = String(input.lessonId ?? '').trim(); const course = store.courses.find(item => item.id === courseId); const lesson = store.courseLessons.find(item => item.id === lessonId); const section = lesson && store.courseSections.find(item => item.id === lesson.sectionId && item.courseId === courseId); const title = String(input.title ?? '').trim(); const teacher = String(input.teacher ?? '').trim(); const startsAt = String(input.startsAt ?? ''); const endsAt = String(input.endsAt ?? ''); if (!course || !lesson || !section || lesson.mediaKind !== 'live' || title.length < 2 || teacher.length < 2 || !Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) throw new HttpError(422, 'VALIDATION_ERROR', '直播场次或直播课件信息不正确'); const now = new Date().toISOString(); const session = {id: `live-${randomUUID()}`, courseId, lessonId, title, teacher, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), providerRoomId: typeof input.providerRoomId === 'string' ? input.providerRoomId.trim() || undefined : undefined, status: 'scheduled' as const, notificationStatus: 'unavailable' as const, playUrl: typeof input.playUrl === 'string' ? input.playUrl.trim() || undefined : undefined, recordingUrl: undefined, updatedAt: now}; store.liveSessions.unshift(session); await persist('insert into live_sessions (id, course_id, lesson_id, title, teacher, starts_at, ends_at, provider_room_id, play_url, recording_url, status, notification_status, created_by, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [session.id, courseId, lessonId, title, teacher, session.startsAt, session.endsAt, session.providerRoomId ?? null, session.playUrl ?? null, null, session.status, session.notificationStatus, admin.adminId, now]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1,$2,$3,$4,$5)', [admin.adminId, 'course.live_session.create', 'live_session', session.id, requestId]); return send(res, 201, session, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/learning/records') { requireAdmin(req); const items = store.submissions.map(item => ({...item, eventType: 'question_submission'})); return send(res, 200, {items, total: items.length}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/learning/early-access') {
      requireAdmin(req, 'learning.stages.read');
      return send(res, 200, {items: store.learningEarlyAccessRequests.map(item => ({...item, plan: store.learningPlans.find(plan => plan.id === item.planId)})), total: store.learningEarlyAccessRequests.length}, requestId);
    }
    const adminEarlyAccessMatch = path.match(/^\/v1\/admin\/learning\/early-access\/([^/]+)\/(approve|reject)$/);
    if (adminEarlyAccessMatch && req.method === 'POST') {
      const admin = requireAdmin(req, 'learning.stages.write');
      const request = store.learningEarlyAccessRequests.find(item => item.id === decodePathSegment(adminEarlyAccessMatch[1]));
      if (!request) throw new HttpError(404, 'NOT_FOUND', '提前学习申请不存在');
      if (request.status !== 'pending') throw new HttpError(409, 'EARLY_ACCESS_ALREADY_REVIEWED', '该申请已经处理');
      const input = await body(req); const reason = String(input.reason ?? '').trim();
      request.status = adminEarlyAccessMatch[2] === 'approve' ? 'approved' : 'rejected'; request.reviewedBy = admin.adminId; request.reviewedAt = new Date().toISOString();
      const plan = store.learningPlans.find(item => item.id === request.planId);
      if (request.status === 'approved' && plan) { plan.earlyUnlockedThrough = request.requestedThrough; await persist('update learning_plans set early_unlocked_through=$1,updated_at=$2 where id=$3', [plan.earlyUnlockedThrough, request.reviewedAt, plan.id]); }
      await persist('update learning_early_access_requests set status=$1,reviewed_by=$2,reviewed_at=$3,reason=coalesce(nullif($4,\'\'),reason) where id=$5', [request.status, admin.adminId, request.reviewedAt, reason, request.id]);
      await persist('insert into admin_audit_logs (admin_user_id,action,resource_type,resource_id,reason,request_id) values ($1,$2,$3,$4,$5,$6)', [admin.adminId, `learning.early_access.${request.status}`, 'learning_early_access_request', request.id, reason || request.status, requestId]);
      return send(res, 200, {...request, plan}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/learning/plans') { requireAdmin(req, 'learning.stages.read'); return send(res, 200, {items: store.learningPlans.map(plan => ({...plan, taskCount: store.learningTasks.filter(task => task.planId === plan.id).length})), total: store.learningPlans.length}, requestId); }
    const adminLearningPlanDetail = path.match(/^\/v1\/admin\/learning\/plans\/([^/]+)$/);
    if (adminLearningPlanDetail && req.method === 'GET') {
      requireAdmin(req, 'learning.stages.read');
      const plan = store.learningPlans.find(item => item.id === decodePathSegment(adminLearningPlanDetail[1]));
      if (!plan) throw new HttpError(404, 'NOT_FOUND', '学习计划不存在');
      const tasks = store.learningTasks.filter(item => item.planId === plan.id).map(normalizeLearningTask);
      const versions = store.learningPlanVersions.filter(item => item.planId === plan.id).slice(0, 20);
      return send(res, 200, {plan, tasks, versions}, requestId);
    }
    const adminLearningPlanUpdate = path.match(/^\/v1\/admin\/learning\/plans\/([^/]+)$/);
    if (adminLearningPlanUpdate && req.method === 'PATCH') {
      const admin = requireAdmin(req, 'learning.stages.write');
      const plan = store.learningPlans.find(item => item.id === decodePathSegment(adminLearningPlanUpdate[1]));
      if (!plan) throw new HttpError(404, 'NOT_FOUND', '学习计划不存在');
      const input = await body(req); const reason = String(input.reason ?? '').trim();
      if (reason.length < 2 || reason.length > 300) throw new HttpError(422, 'VALIDATION_ERROR', '请填写 2-300 字的调整原因');
      const updated = {...plan};
      if (input.title !== undefined) { if (typeof input.title !== 'string' || input.title.trim().length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '计划名称不正确'); updated.title = input.title.trim(); }
      if (input.dailyMinutes !== undefined) { const dailyMinutes = Number(input.dailyMinutes); if (!Number.isInteger(dailyMinutes) || dailyMinutes < 1 || dailyMinutes > 1440) throw new HttpError(422, 'VALIDATION_ERROR', '每日学习时长必须为 1-1440 分钟'); updated.dailyMinutes = dailyMinutes; }
      if (input.startDate !== undefined) updated.startDate = planDate(input.startDate, '开始日期', plan.startDate);
      if (input.endDate !== undefined) updated.endDate = planDate(input.endDate, '结束日期', plan.endDate);
      assertPlanDateRange(updated.startDate, updated.endDate);
      updated.version = (plan.version ?? 1) + 1; updated.changeReason = reason; updated.updatedAt = new Date().toISOString();
      await persistAdminMutation([{text: 'update learning_plans set title=$1,daily_minutes=$2,start_date=$3,end_date=$4,version=$5,change_reason=$6,updated_at=$7 where id=$8', values: [updated.title, updated.dailyMinutes, updated.startDate, updated.endDate, updated.version, updated.changeReason, updated.updatedAt, updated.id]}], [admin.adminId, 'learning.plan.adjust', 'learning_plan', updated.id, reason, requestId]);
      Object.assign(plan, updated); await recordLearningPlanVersion(plan, reason, 'admin', admin.adminId, requestId);
      return send(res, 200, plan, requestId);
    }
    const adminLearningPlanTaskUpdate = path.match(/^\/v1\/admin\/learning\/plans\/([^/]+)\/tasks\/([^/]+)$/);
    if (adminLearningPlanTaskUpdate && req.method === 'PATCH') {
      const admin = requireAdmin(req, 'learning.stages.write');
      const plan = store.learningPlans.find(item => item.id === decodePathSegment(adminLearningPlanTaskUpdate[1]));
      const task = store.learningTasks.find(item => item.id === decodePathSegment(adminLearningPlanTaskUpdate[2]) && item.planId === plan?.id);
      if (!plan || !task) throw new HttpError(404, 'NOT_FOUND', '学习任务不存在');
      const input = await body(req); const reason = String(input.reason ?? '').trim();
      if (reason.length < 2 || reason.length > 300) throw new HttpError(422, 'VALIDATION_ERROR', '请填写 2-300 字的调整原因');
      const updatedTask = {...task};
      if (input.title !== undefined) { if (typeof input.title !== 'string' || input.title.trim().length < 1) throw new HttpError(422, 'VALIDATION_ERROR', '任务名称不正确'); updatedTask.title = input.title.trim(); }
      if (input.dueDate !== undefined) updatedTask.dueDate = planDate(input.dueDate, '任务日期', task.dueDate);
      if (updatedTask.dueDate < plan.startDate || updatedTask.dueDate > plan.endDate) throw new HttpError(422, 'VALIDATION_ERROR', '任务日期必须在学习计划起止日期内');
      if (input.minutes !== undefined) { const minutes = Number(input.minutes); if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new HttpError(422, 'VALIDATION_ERROR', '任务时长必须为 1-1440 分钟'); updatedTask.minutes = minutes; }
      updatedTask.status = task.status === 'done' ? task.status : 'todo'; const now = new Date().toISOString(); const updatedPlan = {...plan, version: (plan.version ?? 1) + 1, changeReason: reason, updatedAt: now};
      await persistAdminMutation([
        {text: 'update learning_tasks set title=$1,due_date=$2,minutes=$3,status=$4 where id=$5', values: [updatedTask.title, updatedTask.dueDate, updatedTask.minutes, updatedTask.status, task.id]},
        {text: 'update learning_plans set version=$1,change_reason=$2,updated_at=$3 where id=$4', values: [updatedPlan.version, reason, now, plan.id]},
      ], [admin.adminId, 'learning.plan.task.adjust', 'learning_plan', plan.id, reason, requestId]);
      Object.assign(task, updatedTask); Object.assign(plan, updatedPlan);
      await recordLearningPlanVersion(plan, reason, 'admin', admin.adminId, requestId);
      return send(res, 200, task, requestId);
    }
    const learningCardAssetMatch = path.match(/^\/v1\/learning-card-assets\/([a-f0-9-]+)\.(jpg|jpeg|png|webp|gif|html|pdf)$/);
    if (learningCardAssetMatch && req.method === 'GET') {
      const extension = learningCardAssetMatch[2];
      const contentTypes: Record<string, string> = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', html: 'text/html; charset=utf-8', pdf: 'application/pdf'};
      const filePath = join(process.env.DEBAO_UPLOAD_DIR ?? join(process.cwd(), 'uploads'), 'learning-card-assets', `${learningCardAssetMatch[1]}.${extension}`);
      let fileStat; try { fileStat = await stat(filePath); } catch { throw new HttpError(404, 'CARD_ASSET_NOT_FOUND', '卡片素材不存在'); }
      const securityHeaders = extension === 'html' ? {'content-security-policy': "sandbox; default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:", 'x-content-type-options': 'nosniff'} : {'x-content-type-options': 'nosniff'};
      res.writeHead(200, {'content-type': contentTypes[extension], 'content-length': String(fileStat.size), 'cache-control': 'public, max-age=31536000, immutable', ...securityHeaders}); createReadStream(filePath).pipe(res); return;
    }
    const learningCardPublicMatch = path.match(/^\/v1\/learning\/cards\/([^/]+)$/);
    if (learningCardPublicMatch && req.method === 'GET') {
      requireAuth(req);
      const card = store.learningCards.find(item => item.id === decodePathSegment(learningCardPublicMatch[1]) && item.status === 'published');
      if (!card) throw new HttpError(404, 'LEARNING_CARD_NOT_FOUND', '学习卡片不存在或尚未发布');
      return send(res, 200, card, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-cards/assets') {
      const admin = requireAdmin(req); const contentType = String(req.headers['content-type'] ?? '').split(';')[0].toLowerCase();
      const supported: Record<string, {extension: string; type: 'image' | 'html' | 'pdf'; maxBytes: number}> = {
        'image/jpeg': {extension: 'jpg', type: 'image', maxBytes: 15 * 1024 * 1024}, 'image/png': {extension: 'png', type: 'image', maxBytes: 15 * 1024 * 1024}, 'image/webp': {extension: 'webp', type: 'image', maxBytes: 15 * 1024 * 1024}, 'image/gif': {extension: 'gif', type: 'image', maxBytes: 15 * 1024 * 1024}, 'text/html': {extension: 'html', type: 'html', maxBytes: 10 * 1024 * 1024}, 'application/xhtml+xml': {extension: 'html', type: 'html', maxBytes: 10 * 1024 * 1024}, 'application/pdf': {extension: 'pdf', type: 'pdf', maxBytes: 30 * 1024 * 1024},
      };
      const assetConfig = supported[contentType]; if (!assetConfig) throw new HttpError(422, 'CARD_ASSET_TYPE_INVALID', '仅支持 JPG、PNG、WebP、GIF 图片、HTML 或 PDF 文件');
      const declaredSize = Number(req.headers['content-length'] ?? 0); if (declaredSize > assetConfig.maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `${assetConfig.type === 'image' ? '图片' : assetConfig.type === 'pdf' ? 'PDF' : 'HTML'}文件不能超过 ${assetConfig.maxBytes / 1024 / 1024} MB`);
      const id = randomUUID(); const directory = join(process.env.DEBAO_UPLOAD_DIR ?? join(process.cwd(), 'uploads'), 'learning-card-assets'); await mkdir(directory, {recursive: true}); const sizeBytes = await storeBinaryBody(req, join(directory, `${id}.${assetConfig.extension}`), assetConfig.maxBytes);
      const rawName = String(req.headers['x-file-name'] ?? ''); let filename = `卡片素材.${assetConfig.extension}`; try { filename = decodeURIComponent(rawName) || filename; } catch { /* use fallback */ }
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1,$2,$3,$4,$5,$6)', [admin.adminId, 'learning_card.asset.upload', 'learning_card_asset', id, `${assetConfig.type}:${filename}:${sizeBytes}`, requestId]);
      return send(res, 201, {id, type: assetConfig.type, filename, sizeBytes, contentType, reference: `/v1/learning-card-assets/${id}.${assetConfig.extension}`}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/learning-cards') {
      requireAdmin(req); const status = url.searchParams.get('status'); const contentType = url.searchParams.get('contentType'); const keyword = String(url.searchParams.get('keyword') ?? '').trim().toLowerCase();
      const items = [...store.learningCards].filter(item => (!status || item.status === status) && (!contentType || item.contentType === contentType) && (!keyword || `${item.title} ${item.description ?? ''}`.toLowerCase().includes(keyword))).sort((left, right) => left.sortOrder - right.sortOrder || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      return send(res, 200, {items, total: items.length, stats: {total: store.learningCards.length, draft: store.learningCards.filter(item => item.status === 'draft').length, published: store.learningCards.filter(item => item.status === 'published').length, disabled: store.learningCards.filter(item => item.status === 'disabled').length}}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-cards') {
      const admin = requireAdmin(req); const card = validateLearningCardInput(await body(req));
      await persistAdminMutation([{text: 'insert into learning_cards (id,title,description,content_type,assets,recall_items,knowledge_point_ids,sort_order,status,version,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$11,$12,$12)', values: [card.id, card.title, card.description ?? null, card.contentType, JSON.stringify(card.assets), JSON.stringify(card.recallItems), JSON.stringify(card.knowledgePointIds ?? []), card.sortOrder, card.status, card.version, admin.adminId, card.createdAt]}], [admin.adminId, 'learning_card.create', 'learning_card', card.id, '创建学习卡片', requestId]);
      store.learningCards.unshift(card); return send(res, 201, card, requestId);
    }
    const learningCardMatch = path.match(/^\/v1\/admin\/learning-cards\/([^/]+)$/);
    if (learningCardMatch && req.method === 'PATCH') {
      const admin = requireAdmin(req); const id = decodePathSegment(learningCardMatch[1]); const existing = store.learningCards.find(item => item.id === id); if (!existing) throw new HttpError(404, 'LEARNING_CARD_NOT_FOUND', '卡片不存在'); const updated = validateLearningCardInput(await body(req), existing); updated.status = 'draft'; updated.version = existing.version + 1; updated.publishedAt = undefined;
      await persistAdminMutation([{text: 'update learning_cards set title=$1,description=$2,content_type=$3,assets=$4::jsonb,recall_items=$5::jsonb,knowledge_point_ids=$6::jsonb,sort_order=$7,status=$8,version=$9,updated_by=$10,updated_at=$11,published_at=null where id=$12', values: [updated.title, updated.description ?? null, updated.contentType, JSON.stringify(updated.assets), JSON.stringify(updated.recallItems), JSON.stringify(updated.knowledgePointIds ?? []), updated.sortOrder, updated.status, updated.version, admin.adminId, updated.updatedAt, id]}], [admin.adminId, 'learning_card.edit', 'learning_card', id, '编辑学习卡片并保存为草稿', requestId]);
      Object.assign(existing, updated); return send(res, 200, existing, requestId);
    }
    if (learningCardMatch && req.method === 'DELETE') {
      const admin = requireAdmin(req); const id = decodePathSegment(learningCardMatch[1]); const existing = store.learningCards.find(item => item.id === id); if (!existing) throw new HttpError(404, 'LEARNING_CARD_NOT_FOUND', '卡片不存在'); if (existing.status !== 'draft') throw new HttpError(409, 'LEARNING_CARD_NOT_DRAFT', '只有草稿卡片可以删除');
      await persistAdminMutation([{text: 'delete from learning_cards where id=$1', values: [id]}], [admin.adminId, 'learning_card.delete', 'learning_card', id, '删除学习卡片草稿', requestId]); store.learningCards = store.learningCards.filter(item => item.id !== id); return send(res, 200, {deleted: true, id}, requestId);
    }
    const learningCardAction = path.match(/^\/v1\/admin\/learning-cards\/([^/]+)\/(publish|disable)$/);
    if (learningCardAction && req.method === 'POST') {
      const admin = requireAdmin(req); const id = decodePathSegment(learningCardAction[1]); const action = learningCardAction[2]; const card = store.learningCards.find(item => item.id === id); if (!card) throw new HttpError(404, 'LEARNING_CARD_NOT_FOUND', '卡片不存在'); const input = await body(req); const now = new Date().toISOString();
      if (action === 'publish') { if (!card.knowledgePointIds?.length) throw new HttpError(422, 'LEARNING_KNOWLEDGE_POINTS_REQUIRED', '发布卡片前请至少关联一个考点或知识点'); card.status = 'published'; card.publishedAt = now; } else { const reason = String(input.reason ?? '').trim(); if (reason.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '请填写停用原因'); card.status = 'disabled'; }
      card.updatedAt = now; card.version += 1; await persistAdminMutation([{text: 'update learning_cards set status=$1,version=$2,published_at=$3,updated_by=$4,updated_at=$5 where id=$6', values: [card.status, card.version, card.publishedAt ?? null, admin.adminId, now, id]}], [admin.adminId, `learning_card.${action}`, 'learning_card', id, action === 'publish' ? '发布学习卡片' : String(input.reason), requestId]); return send(res, 200, card, requestId);
    }
    const learningQuestionMediaMatch = path.match(/^\/v1\/learning-question-media\/([a-f0-9-]+)\.(mp3|m4a|wav|ogg|mp4|webm|mov)$/);
    if (learningQuestionMediaMatch && req.method === 'GET') {
      const contentTypes: Record<string, string> = {mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime'};
      const filePath = join(process.env.DEBAO_UPLOAD_DIR ?? join(process.cwd(), 'uploads'), 'learning-question-media', `${learningQuestionMediaMatch[1]}.${learningQuestionMediaMatch[2]}`);
      let fileStat; try { fileStat = await stat(filePath); } catch { throw new HttpError(404, 'MEDIA_NOT_FOUND', '讲解音视频不存在'); }
      const headers = {'content-type': contentTypes[learningQuestionMediaMatch[2]], 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*'};
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range); if (!match) throw new HttpError(416, 'RANGE_INVALID', '媒体分段范围不正确');
        const start = Number(match[1]); const end = match[2] ? Math.min(Number(match[2]), fileStat.size - 1) : fileStat.size - 1; if (start > end || start >= fileStat.size) throw new HttpError(416, 'RANGE_INVALID', '媒体分段范围超出文件大小');
        res.writeHead(206, {...headers, 'content-range': `bytes ${start}-${end}/${fileStat.size}`, 'content-length': String(end - start + 1)}); createReadStream(filePath, {start, end}).pipe(res); return;
      }
      res.writeHead(200, {...headers, 'content-length': String(fileStat.size)}); createReadStream(filePath).pipe(res); return;
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-question-bank/media') {
      const admin = requireAdmin(req); const contentType = String(req.headers['content-type'] ?? '').split(';')[0].toLowerCase();
      const extensions: Record<string, {extension: string; type: 'audio' | 'video'; maxBytes: number}> = {
        'audio/mpeg': {extension: 'mp3', type: 'audio', maxBytes: 100 * 1024 * 1024}, 'audio/mp4': {extension: 'm4a', type: 'audio', maxBytes: 100 * 1024 * 1024}, 'audio/x-m4a': {extension: 'm4a', type: 'audio', maxBytes: 100 * 1024 * 1024}, 'audio/wav': {extension: 'wav', type: 'audio', maxBytes: 100 * 1024 * 1024}, 'audio/x-wav': {extension: 'wav', type: 'audio', maxBytes: 100 * 1024 * 1024}, 'audio/ogg': {extension: 'ogg', type: 'audio', maxBytes: 100 * 1024 * 1024},
        'video/mp4': {extension: 'mp4', type: 'video', maxBytes: 500 * 1024 * 1024}, 'video/webm': {extension: 'webm', type: 'video', maxBytes: 500 * 1024 * 1024}, 'video/quicktime': {extension: 'mov', type: 'video', maxBytes: 500 * 1024 * 1024},
      };
      const config = extensions[contentType]; if (!config) throw new HttpError(422, 'MEDIA_TYPE_INVALID', '仅支持 MP3、M4A、WAV、OGG、MP4、WebM 或 MOV 文件');
      const declaredSize = Number(req.headers['content-length'] ?? 0); if (declaredSize > config.maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `讲解${config.type === 'audio' ? '音频' : '视频'}不能超过 ${config.maxBytes / 1024 / 1024} MB`);
      const id = randomUUID(); const directory = join(process.env.DEBAO_UPLOAD_DIR ?? join(process.cwd(), 'uploads'), 'learning-question-media'); await mkdir(directory, {recursive: true}); const sizeBytes = await storeBinaryBody(req, join(directory, `${id}.${config.extension}`), config.maxBytes);
      const rawName = String(req.headers['x-file-name'] ?? ''); let originalName = `讲解文件.${config.extension}`; try { originalName = decodeURIComponent(rawName) || originalName; } catch { /* use fallback */ }
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1,$2,$3,$4,$5,$6)', [admin.adminId, 'learning_question.media.upload', 'learning_question_media', id, `${config.type}:${originalName}:${sizeBytes}`, requestId]);
      return send(res, 201, {id, type: config.type, filename: originalName, sizeBytes, contentType, reference: `/v1/learning-question-media/${id}.${config.extension}`}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/learning-question-bank/questions') {
      requireAdmin(req);
      const category = url.searchParams.get('category');
      const questionType = url.searchParams.get('questionType');
      const subject = url.searchParams.get('subject');
      const subjectId = url.searchParams.get('subjectId');
      const chapterId = url.searchParams.get('chapterId');
      const pointId = url.searchParams.get('pointId');
      const subPointId = url.searchParams.get('subPointId');
      const status = url.searchParams.get('status');
      const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();
      const all = store.learningQuestionBankQuestions;
      const items = [...all].filter(item => (!category || item.category === category) && (!questionType || item.questionType === questionType) && (!subject || item.subject === subject) && (!subjectId || item.subjectId === subjectId) && (!chapterId || item.chapterId === chapterId) && (!pointId || item.pointId === pointId) && (!subPointId || item.subPointId === subPointId) && (!status || item.status === status) && (!keyword || `${item.id} ${item.stem} ${item.subject} ${item.columnName} ${item.knowledgePoint} ${item.subKnowledgePoint ?? ''}`.toLowerCase().includes(keyword))).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id));
      const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
      const taxonomyNodes = store.learningQuestionTaxonomyNodes.filter(node => !category || node.category === category);
      return send(res, 200, {items, total: items.length, stats: {total: all.length, objective: all.filter(item => item.category === 'objective').length, subjective: all.filter(item => item.category === 'subjective').length, draft: all.filter(item => item.status === 'draft').length, published: all.filter(item => item.status === 'published').length, disabled: all.filter(item => item.status === 'disabled').length}, taxonomy: {subjects: unique(items.map(item => item.subject)), columns: unique(items.map(item => item.columnName)), knowledgePoints: unique(items.map(item => item.knowledgePoint)), subKnowledgePoints: unique(items.map(item => item.subKnowledgePoint ?? ''))}, taxonomyNodes}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/learning-assessment-papers') { requireAdmin(req, 'learning.questions.read'); return send(res, 200, {items: store.learningAssessmentPapers, total: store.learningAssessmentPapers.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/learning-assessment-papers') {
      const admin = requireAdmin(req, 'learning.questions.write'); const input = await body(req); const title = String(input.title ?? '').trim(); const subjectId = String(input.subjectId ?? '').trim(); const questionIds = Array.isArray(input.questionIds) ? [...new Set(input.questionIds.map(String).map(id => id.trim()).filter(Boolean))] : []; const durationMinutes = Number(input.durationMinutes ?? 60);
      if (title.length < 2 || !subjectId || !questionIds.length || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 300) throw new HttpError(422, 'VALIDATION_ERROR', '学习中心试卷信息不完整');
      const subject = store.learningQuestionTaxonomyNodes.find(node => node.id === subjectId && node.category === 'objective' && node.type === 'subject' && node.status === 'active');
      if (!subject) throw new HttpError(422, 'SUBJECT_NOT_FOUND', '请选择有效的学习中心客观题科目');
      const selectedQuestions = questionIds.map(id => store.learningQuestionBankQuestions.find(question => question.id === id));
      if (selectedQuestions.some(question => !question || question.category !== 'objective' || question.status !== 'published')) throw new HttpError(422, 'LEARNING_CONTENT_NOT_FOUND', '试卷只能选择已发布的学习中心客观题');
      if (selectedQuestions.some(question => question?.subjectId !== subjectId)) throw new HttpError(422, 'SUBJECT_QUESTION_MISMATCH', '所选题目必须属于当前科目');
      const now = new Date().toISOString(); const paper = {id: `learning-paper-${randomUUID()}`, title, subjectId, questionIds, durationMinutes, status: 'draft' as const, createdAt: now, updatedAt: now};
      await persistAdminMutation([{text: 'insert into learning_assessment_papers (id,title,subject_id,question_ids,duration_minutes,status,created_by,created_at,updated_at) values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$8)', values: [paper.id, paper.title, paper.subjectId, JSON.stringify(paper.questionIds), paper.durationMinutes, paper.status, admin.adminId, now]}], [admin.adminId, 'learning_assessment_paper.create', 'learning_assessment_paper', paper.id, '创建学习中心单科测试试卷', requestId]); store.learningAssessmentPapers.unshift(paper); return send(res, 201, paper, requestId);
    }
    const learningAssessmentPaperAction = path.match(/^\/v1\/admin\/learning-assessment-papers\/([^/]+)\/(publish|archive)$/);
    if (learningAssessmentPaperAction && req.method === 'POST') { const admin = requireAdmin(req, 'learning.questions.publish'); const paper = store.learningAssessmentPapers.find(item => item.id === decodePathSegment(learningAssessmentPaperAction[1])); if (!paper) throw new HttpError(404, 'NOT_FOUND', '学习中心试卷不存在'); paper.status = learningAssessmentPaperAction[2] === 'publish' ? 'published' : 'archived'; paper.updatedAt = new Date().toISOString(); await persistAdminMutation([{text: 'update learning_assessment_papers set status=$1,updated_at=$2 where id=$3', values: [paper.status, paper.updatedAt, paper.id]}], [admin.adminId, `learning_assessment_paper.${paper.status}`, 'learning_assessment_paper', paper.id, '更新学习中心试卷状态', requestId]); return send(res, 200, paper, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/learning-question-bank/taxonomy') {
      requireAdmin(req);
      const category = url.searchParams.get('category') as LearningQuestionCategory | null;
      const type = url.searchParams.get('type') as LearningQuestionTaxonomyNodeType | null;
      const parentId = url.searchParams.get('parentId');
      if (category && !['objective', 'subjective'].includes(category)) throw new HttpError(422, 'VALIDATION_ERROR', '题库分类不正确');
      if (type && !['subject', 'chapter', 'point', 'subpoint'].includes(type)) throw new HttpError(422, 'VALIDATION_ERROR', '目录类型不正确');
      const items = store.learningQuestionTaxonomyNodes.filter(node => (!category || node.category === category) && (!type || node.type === type) && (!parentId || node.parentId === parentId)).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'));
      return send(res, 200, {items, total: items.length}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-question-bank/taxonomy') {
      const admin = requireAdmin(req); const input = await body(req);
      const category = String(input.category ?? '') as LearningQuestionCategory; const type = String(input.type ?? '') as LearningQuestionTaxonomyNodeType; const parentId = String(input.parentId ?? '').trim() || undefined; const code = String(input.code ?? '').trim().toLowerCase(); const name = String(input.name ?? '').trim(); const sortOrder = Number(input.sortOrder ?? 0);
      if (!['objective', 'subjective'].includes(category) || !['subject', 'chapter', 'point', 'subpoint'].includes(type) || !/^[a-z][a-z0-9_-]{1,99}$/.test(code) || name.length < 1 || name.length > 160 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 99999) throw new HttpError(422, 'VALIDATION_ERROR', '目录信息不正确');
      const expectedParent: Record<LearningQuestionTaxonomyNodeType, LearningQuestionTaxonomyNodeType | undefined> = {subject: undefined, chapter: 'subject', point: 'chapter', subpoint: 'point'};
      const parent = parentId ? store.learningQuestionTaxonomyNodes.find(node => node.id === parentId && node.category === category && node.type === expectedParent[type] && node.status === 'active') : undefined;
      if (expectedParent[type] && !parent) throw new HttpError(422, 'VALIDATION_ERROR', '上级目录不存在或分类不匹配');
      if (!expectedParent[type] && parentId) throw new HttpError(422, 'VALIDATION_ERROR', '科目不能设置上级目录');
      if (store.learningQuestionTaxonomyNodes.some(node => node.category === category && node.type === type && node.code === code)) throw new HttpError(409, 'LEARNING_TAXONOMY_CODE_EXISTS', '当前题库中已存在相同编码');
      const now = new Date().toISOString(); const node: LearningQuestionTaxonomyNode = {id: `lqt-${randomUUID()}`, category, type, ...(parentId ? {parentId} : {}), code, name, sortOrder, status: 'active', createdAt: now, updatedAt: now};
      await persistAdminMutation([{text: 'insert into learning_question_taxonomy_nodes (id,category,node_type,parent_id,code,name,sort_order,status,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$10)', values: [node.id, node.category, node.type, node.parentId ?? null, node.code, node.name, node.sortOrder, node.status, admin.adminId, now]}], [admin.adminId, 'learning_question_taxonomy.create', 'learning_question_taxonomy', node.id, '创建题库知识目录', requestId]);
      store.learningQuestionTaxonomyNodes.push(node); return send(res, 201, node, requestId);
    }
    const adminLearningTaxonomyNode = path.match(/^\/v1\/admin\/learning-question-bank\/taxonomy\/([^/]+)$/);
    if (adminLearningTaxonomyNode && req.method === 'PATCH') {
      const admin = requireAdmin(req); const node = store.learningQuestionTaxonomyNodes.find(item => item.id === decodePathSegment(adminLearningTaxonomyNode[1])); if (!node) throw new HttpError(404, 'LEARNING_TAXONOMY_NOT_FOUND', '知识目录不存在'); const input = await body(req); const name = input.name === undefined ? node.name : String(input.name).trim(); const code = input.code === undefined ? node.code : String(input.code).trim().toLowerCase(); const sortOrder = input.sortOrder === undefined ? node.sortOrder : Number(input.sortOrder); const status = input.status === undefined ? node.status : String(input.status) as 'active' | 'disabled'; if (!/^[a-z][a-z0-9_-]{1,99}$/.test(code) || name.length < 1 || name.length > 160 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 99999 || !['active', 'disabled'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '目录信息不正确'); if (store.learningQuestionTaxonomyNodes.some(item => item.id !== node.id && item.category === node.category && item.type === node.type && item.code === code)) throw new HttpError(409, 'LEARNING_TAXONOMY_CODE_EXISTS', '当前题库中已存在相同编码'); const updatedAt = new Date().toISOString(); await persistAdminMutation([{text: 'update learning_question_taxonomy_nodes set code=$1,name=$2,sort_order=$3,status=$4,updated_by=$5,updated_at=$6 where id=$7', values: [code, name, sortOrder, status, admin.adminId, updatedAt, node.id]}], [admin.adminId, 'learning_question_taxonomy.edit', 'learning_question_taxonomy', node.id, '编辑题库知识目录', requestId]); Object.assign(node, {code, name, sortOrder, status, updatedAt}); return send(res, 200, node, requestId);
    }
    if (adminLearningTaxonomyNode && req.method === 'DELETE') {
      const admin = requireAdmin(req); const node = store.learningQuestionTaxonomyNodes.find(item => item.id === decodePathSegment(adminLearningTaxonomyNode[1])); if (!node) throw new HttpError(404, 'LEARNING_TAXONOMY_NOT_FOUND', '知识目录不存在'); if (store.learningQuestionTaxonomyNodes.some(item => item.parentId === node.id)) throw new HttpError(409, 'LEARNING_TAXONOMY_HAS_CHILDREN', '请先处理下级目录'); if (store.learningQuestionBankQuestions.some(item => item.subjectId === node.id || item.chapterId === node.id || item.pointId === node.id || item.subPointId === node.id)) throw new HttpError(409, 'LEARNING_TAXONOMY_IN_USE', '该目录已有题目使用，不能删除'); await persistAdminMutation([{text: 'delete from learning_question_taxonomy_nodes where id=$1', values: [node.id]}], [admin.adminId, 'learning_question_taxonomy.delete', 'learning_question_taxonomy', node.id, '删除题库知识目录', requestId]); store.learningQuestionTaxonomyNodes = store.learningQuestionTaxonomyNodes.filter(item => item.id !== node.id); return send(res, 200, {deleted: true, id: node.id}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-question-bank/questions') {
      const admin = requireAdmin(req); const input = await body(req); const question = validateLearningQuestionBankInput(input); const values = [question.id, question.category, question.questionType, question.subject, question.subjectId, question.columnName, question.chapterId, question.knowledgePoint, question.pointId, question.subKnowledgePoint ?? null, question.subPointId ?? null, question.difficulty, question.stem, JSON.stringify(question.options), JSON.stringify(question.correctAnswers), question.analysis, question.caseMaterial ?? null, JSON.stringify(question.subQuestions), question.estimatedMinutes, question.source ?? null, question.sourceYear ?? null, JSON.stringify(question.usageScenes), question.status, question.version, admin.adminId, question.createdAt];
      await persistAdminMutation([{text: 'insert into learning_question_bank_questions (id,category,question_type,subject,subject_id,column_name,chapter_id,knowledge_point,point_id,sub_knowledge_point,subpoint_id,difficulty,stem,options,correct_answers,analysis,case_material,sub_questions,estimated_minutes,source,source_year,usage_scenes,status,version,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18::jsonb,$19,$20,$21,$22::jsonb,$23,$24,$25,$25,$26,$26)', values}, learningQuestionExplanationMediaUpdate(question, admin.adminId)], [admin.adminId, 'learning_question.create', 'learning_question', question.id, '创建学习题库题目', requestId]);
      store.learningQuestionBankQuestions.unshift(question); return send(res, 201, question, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-question-bank/questions/import') {
      const admin = requireAdmin(req); const input = await body(req); const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
      if (!rawQuestions.length || rawQuestions.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', '单次导入题目数量必须为 1 到 500 道');
      const questions = rawQuestions.map((raw, index) => { try { return validateLearningQuestionBankInput(raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}); } catch (error) { if (error instanceof HttpError) throw new HttpError(error.status, error.code, `第 ${index + 2} 行：${error.message}`); throw error; } });
      const duplicateStem = questions.find((question, index) => questions.findIndex(item => item.stem === question.stem) !== index);
      if (duplicateStem) throw new HttpError(422, 'VALIDATION_ERROR', `导入文件内存在重复题干：${duplicateStem.stem.slice(0, 60)}`);
      const statements: SqlStatement[] = questions.flatMap(question => [{text: 'insert into learning_question_bank_questions (id,category,question_type,subject,subject_id,column_name,chapter_id,knowledge_point,point_id,sub_knowledge_point,subpoint_id,difficulty,stem,options,correct_answers,analysis,case_material,sub_questions,estimated_minutes,source,source_year,usage_scenes,status,version,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18::jsonb,$19,$20,$21,$22::jsonb,$23,$24,$25,$25,$26,$26)', values: [question.id, question.category, question.questionType, question.subject, question.subjectId, question.columnName, question.chapterId, question.knowledgePoint, question.pointId, question.subKnowledgePoint ?? null, question.subPointId ?? null, question.difficulty, question.stem, JSON.stringify(question.options), JSON.stringify(question.correctAnswers), question.analysis, question.caseMaterial ?? null, JSON.stringify(question.subQuestions), question.estimatedMinutes, question.source ?? null, question.sourceYear ?? null, JSON.stringify(question.usageScenes), question.status, question.version, admin.adminId, question.createdAt]}, learningQuestionExplanationMediaUpdate(question, admin.adminId)]);
      await persistAdminMutation(statements, [admin.adminId, 'learning_question.import', 'learning_question', `batch-${randomUUID()}`, `Excel 批量导入 ${questions.length} 道题`, requestId]);
      store.learningQuestionBankQuestions.unshift(...questions); return send(res, 201, {items: questions, imported: questions.length}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-question-bank/questions/bulk') {
      const admin = requireAdmin(req); const input = await body(req); const action = String(input.action ?? ''); const ids = Array.isArray(input.ids) ? [...new Set(input.ids.map(String).filter(Boolean))] : [];
      if (!['publish', 'disable', 'delete', 'move'].includes(action) || !ids.length || ids.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', '请选择 1 到 500 道题并指定有效批量操作');
      const questions = ids.map(id => store.learningQuestionBankQuestions.find(item => item.id === id));
      if (questions.some(item => !item)) throw new HttpError(404, 'LEARNING_QUESTION_NOT_FOUND', '所选题目中有题目不存在，请刷新后重试');
      const selectedQuestions = questions as LearningQuestionBankQuestion[]; const now = new Date().toISOString(); const statements: SqlStatement[] = []; const movedQuestions = new Map<string, LearningQuestionBankQuestion>();
      if (action === 'publish') {
        requireAdmin(req, 'learning.questions.publish'); selectedQuestions.forEach(question => { validateLearningQuestionBankInput(question as unknown as Record<string, unknown>, question); statements.push({text: 'update learning_question_bank_questions set status=$1,published_at=$2,updated_by=$3,updated_at=$2 where id=$4', values: ['published', now, admin.adminId, question.id]}); });
      } else if (action === 'disable') {
        requireAdmin(req, 'learning.questions.publish'); const reason = String(input.reason ?? '').trim(); if (reason.length < 2 || reason.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', '请填写 2 到 500 个字的停用原因'); selectedQuestions.forEach(question => statements.push({text: 'update learning_question_bank_questions set status=$1,updated_by=$2,updated_at=$3 where id=$4', values: ['disabled', admin.adminId, now, question.id]}));
      } else if (action === 'delete') {
        if (selectedQuestions.some(question => question.status === 'published')) throw new HttpError(409, 'LEARNING_QUESTION_PUBLISHED', '批量删除前请先停用已发布题目'); selectedQuestions.forEach(question => statements.push({text: 'delete from learning_question_bank_questions where id=$1', values: [question.id]}));
      } else {
        const target = input.target && typeof input.target === 'object' ? input.target as Record<string, unknown> : {}; selectedQuestions.forEach(question => { const updated = validateLearningQuestionBankInput({...question, ...target}, question); updated.status = 'draft'; updated.version = question.version + 1; updated.updatedAt = now; delete updated.publishedAt; movedQuestions.set(question.id, updated); statements.push({text: 'insert into learning_question_bank_versions (id,question_id,version,snapshot,created_by,created_at) values ($1,$2,$3,$4::jsonb,$5,$6) on conflict (question_id,version) do nothing', values: [`lqbv-${randomUUID()}`, question.id, question.version, JSON.stringify(question), admin.adminId, now]}, {text: 'update learning_question_bank_questions set subject=$1,subject_id=$2,column_name=$3,chapter_id=$4,knowledge_point=$5,point_id=$6,sub_knowledge_point=$7,subpoint_id=$8,status=$9,version=$10,updated_by=$11,updated_at=$12,published_at=null where id=$13', values: [updated.subject, updated.subjectId, updated.columnName, updated.chapterId, updated.knowledgePoint, updated.pointId, updated.subKnowledgePoint ?? null, updated.subPointId ?? null, updated.status, updated.version, admin.adminId, now, question.id]}); });
      }
      await persistAdminMutation(statements, [admin.adminId, `learning_question.bulk_${action}`, 'learning_question', `bulk-${randomUUID()}`, `批量${action} ${ids.length} 道题${action === 'disable' ? `：${String(input.reason).trim()}` : ''}`, requestId]);
      if (action === 'delete') store.learningQuestionBankQuestions = store.learningQuestionBankQuestions.filter(question => !ids.includes(question.id)); else selectedQuestions.forEach(question => { if (action === 'publish') Object.assign(question, {status: 'published', publishedAt: now, updatedAt: now}); else if (action === 'disable') Object.assign(question, {status: 'disabled', updatedAt: now}); else { const moved = movedQuestions.get(question.id); if (moved) Object.assign(question, moved); } });
      return send(res, 200, {action, affected: ids.length}, requestId);
    }
    const adminLearningQuestionVersions = path.match(/^\/v1\/admin\/learning-question-bank\/questions\/([^/]+)\/versions$/);
    if (adminLearningQuestionVersions && req.method === 'GET') {
      requireAdmin(req); const questionId = decodePathSegment(adminLearningQuestionVersions[1]); const question = store.learningQuestionBankQuestions.find(item => item.id === questionId); if (!question) throw new HttpError(404, 'LEARNING_QUESTION_NOT_FOUND', '题目不存在');
      const history = await infrastructure.query<{id: string; version: number; snapshot: LearningQuestionBankQuestion; created_at: Date | string}>('select id,version,snapshot,created_at from learning_question_bank_versions where question_id=$1 order by version desc', [questionId]);
      const items = [{id: `current-${question.id}`, version: question.version, snapshot: question, createdAt: question.updatedAt, current: true}, ...(history?.rows ?? []).filter(row => Number(row.version) !== question.version).map(row => ({id: row.id, version: Number(row.version), snapshot: row.snapshot, createdAt: new Date(row.created_at).toISOString(), current: false}))];
      return send(res, 200, {items, total: items.length}, requestId);
    }
    const adminLearningQuestionCopy = path.match(/^\/v1\/admin\/learning-question-bank\/questions\/([^/]+)\/copy$/);
    if (adminLearningQuestionCopy && req.method === 'POST') {
      const admin = requireAdmin(req); const source = store.learningQuestionBankQuestions.find(item => item.id === decodePathSegment(adminLearningQuestionCopy[1])); if (!source) throw new HttpError(404, 'LEARNING_QUESTION_NOT_FOUND', '题目不存在'); const now = new Date().toISOString(); const copy: LearningQuestionBankQuestion = {...structuredClone(source), id: `lqb-${randomUUID()}`, status: 'draft', version: 1, createdAt: now, updatedAt: now, publishedAt: undefined};
      await persistAdminMutation([{text: 'insert into learning_question_bank_questions (id,category,question_type,subject,subject_id,column_name,chapter_id,knowledge_point,point_id,sub_knowledge_point,subpoint_id,difficulty,stem,options,correct_answers,analysis,case_material,sub_questions,estimated_minutes,source,source_year,usage_scenes,status,version,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18::jsonb,$19,$20,$21,$22::jsonb,$23,$24,$25,$25,$26,$26)', values: [copy.id, copy.category, copy.questionType, copy.subject, copy.subjectId, copy.columnName, copy.chapterId, copy.knowledgePoint, copy.pointId, copy.subKnowledgePoint ?? null, copy.subPointId ?? null, copy.difficulty, copy.stem, JSON.stringify(copy.options), JSON.stringify(copy.correctAnswers), copy.analysis, copy.caseMaterial ?? null, JSON.stringify(copy.subQuestions), copy.estimatedMinutes, copy.source ?? null, copy.sourceYear ?? null, JSON.stringify(copy.usageScenes), copy.status, copy.version, admin.adminId, now]}, learningQuestionExplanationMediaUpdate(copy, admin.adminId)], [admin.adminId, 'learning_question.copy', 'learning_question', copy.id, `复制题目 ${source.id}`, requestId]); store.learningQuestionBankQuestions.unshift(copy); return send(res, 201, copy, requestId);
    }
    const adminLearningQuestion = path.match(/^\/v1\/admin\/learning-question-bank\/questions\/([^/]+)$/);
    if (adminLearningQuestion && req.method === 'PATCH') {
      const admin = requireAdmin(req); const question = store.learningQuestionBankQuestions.find(item => item.id === decodePathSegment(adminLearningQuestion[1])); if (!question) throw new HttpError(404, 'LEARNING_QUESTION_NOT_FOUND', '题目不存在'); const input = await body(req); const updated = validateLearningQuestionBankInput(input, question); updated.status = 'draft'; updated.version = question.version + 1; delete updated.publishedAt;
      await persistAdminMutation([{text: 'insert into learning_question_bank_versions (id,question_id,version,snapshot,created_by,created_at) values ($1,$2,$3,$4::jsonb,$5,$6) on conflict (question_id,version) do nothing', values: [`lqbv-${randomUUID()}`, question.id, question.version, JSON.stringify(question), admin.adminId, updated.updatedAt]}, {text: 'update learning_question_bank_questions set category=$1,question_type=$2,subject=$3,subject_id=$4,column_name=$5,chapter_id=$6,knowledge_point=$7,point_id=$8,sub_knowledge_point=$9,subpoint_id=$10,difficulty=$11,stem=$12,options=$13::jsonb,correct_answers=$14::jsonb,analysis=$15,case_material=$16,sub_questions=$17::jsonb,estimated_minutes=$18,source=$19,source_year=$20,usage_scenes=$21::jsonb,status=$22,version=$23,updated_by=$24,updated_at=$25,published_at=null where id=$26', values: [updated.category, updated.questionType, updated.subject, updated.subjectId, updated.columnName, updated.chapterId, updated.knowledgePoint, updated.pointId, updated.subKnowledgePoint ?? null, updated.subPointId ?? null, updated.difficulty, updated.stem, JSON.stringify(updated.options), JSON.stringify(updated.correctAnswers), updated.analysis, updated.caseMaterial ?? null, JSON.stringify(updated.subQuestions), updated.estimatedMinutes, updated.source ?? null, updated.sourceYear ?? null, JSON.stringify(updated.usageScenes), updated.status, updated.version, admin.adminId, updated.updatedAt, updated.id]}, learningQuestionExplanationMediaUpdate(updated, admin.adminId)], [admin.adminId, 'learning_question.edit', 'learning_question', question.id, '编辑题目后回到草稿', requestId]);
      Object.assign(question, updated); return send(res, 200, question, requestId);
    }
    if (adminLearningQuestion && req.method === 'DELETE') {
      const admin = requireAdmin(req); const question = store.learningQuestionBankQuestions.find(item => item.id === decodePathSegment(adminLearningQuestion[1])); if (!question) throw new HttpError(404, 'LEARNING_QUESTION_NOT_FOUND', '题目不存在'); if (question.status === 'published') throw new HttpError(409, 'LEARNING_QUESTION_PUBLISHED', '已发布题目请先停用再删除'); await persistAdminMutation([{text: 'delete from learning_question_bank_questions where id=$1', values: [question.id]}], [admin.adminId, 'learning_question.delete', 'learning_question', question.id, '删除未发布题目', requestId]); store.learningQuestionBankQuestions = store.learningQuestionBankQuestions.filter(item => item.id !== question.id); return send(res, 200, {deleted: true, id: question.id}, requestId);
    }
    const adminLearningQuestionAction = path.match(/^\/v1\/admin\/learning-question-bank\/questions\/([^/]+)\/(publish|disable)$/);
    if (adminLearningQuestionAction && req.method === 'POST') {
      const admin = requireAdmin(req); const question = store.learningQuestionBankQuestions.find(item => item.id === decodePathSegment(adminLearningQuestionAction[1])); if (!question) throw new HttpError(404, 'LEARNING_QUESTION_NOT_FOUND', '题目不存在'); const input = await body(req); const action = adminLearningQuestionAction[2]; if (action === 'disable') { const reason = String(input.reason ?? '').trim(); if (reason.length < 2 || reason.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', '请填写 2 到 500 个字的停用原因'); question.status = 'disabled'; question.updatedAt = new Date().toISOString(); await persistAdminMutation([{text: 'update learning_question_bank_questions set status=$1,updated_by=$2,updated_at=$3 where id=$4', values: [question.status, admin.adminId, question.updatedAt, question.id]}], [admin.adminId, 'learning_question.disable', 'learning_question', question.id, reason, requestId]); return send(res, 200, question, requestId); }
      validateLearningQuestionBankInput(question as unknown as Record<string, unknown>, question); question.status = 'published'; question.publishedAt = new Date().toISOString(); question.updatedAt = question.publishedAt; await persistAdminMutation([{text: 'update learning_question_bank_questions set status=$1,published_at=$2,updated_by=$3,updated_at=$2 where id=$4', values: [question.status, question.publishedAt, admin.adminId, question.id]}], [admin.adminId, 'learning_question.publish', 'learning_question', question.id, '发布学习题库题目', requestId]); return send(res, 200, question, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-coach/class-types') {
      const admin = requireAdmin(req); const input = await body(req); const code = String(input.code ?? '').trim().toLowerCase(); const name = String(input.name ?? '').trim(); const productId = String(input.productId ?? '').trim() || undefined; const description = String(input.description ?? '').trim() || undefined; const endDate = planDate(input.endDate, '班型结束日期', '2099-12-31'); const sortOrder = Number(input.sortOrder ?? (store.learningClassTypes.length + 1) * 10); if (!/^[a-z][a-z0-9_-]{1,79}$/.test(code) || name.length < 2 || name.length > 80 || description && description.length > 240 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999 || store.learningClassTypes.some(item => item.code === code)) throw new HttpError(422, 'VALIDATION_ERROR', '班型信息不正确'); const now = new Date().toISOString(); const classType: LearningClassType = {id: `class-${randomUUID()}`, code, name, ...(productId ? {productId} : {}), ...(description ? {description} : {}), endDate, sortOrder, status: 'active', createdAt: now, updatedAt: now}; await persistAdminMutation([{text: 'insert into learning_class_types (id,code,name,product_id,description,end_date,sort_order,status,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$10)', values: [classType.id, classType.code, classType.name, classType.productId ?? null, classType.description ?? null, classType.endDate, classType.sortOrder, classType.status, admin.adminId, now]}], [admin.adminId, 'learning_class_type.create', 'learning_class_type', classType.id, '创建学习班型', requestId]); store.learningClassTypes.push(classType); return send(res, 201, publicLearningClassType(classType), requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/learning-coach/class-types') {
      requireAdmin(req); const items = [...store.learningClassTypes].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)).map(item => ({...publicLearningClassType(item), stageCount: store.learningStages.filter(stage => stage.classTypeId === item.id).length})); return send(res, 200, {items, total: items.length}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/learning-coach/products') {
      requireAdmin(req); const items = store.products.map(item => ({id: item.id, name: item.name, category: item.category, price: item.price, originalPrice: item.originalPrice, sold: item.sold, benefits: item.benefits, status: item.status, updatedAt: item.updatedAt})); return send(res, 200, {items, total: items.length}, requestId);
    }
    const adminLearningClassType = path.match(/^\/v1\/admin\/learning-coach\/class-types\/([^/]+)$/);
    if (adminLearningClassType && req.method === 'PATCH') {
      const admin = requireAdmin(req); const classType = store.learningClassTypes.find(item => item.id === decodePathSegment(adminLearningClassType[1])); if (!classType) throw new HttpError(404, 'LEARNING_CLASS_TYPE_NOT_FOUND', '学习班型不存在'); const input = await body(req); const name = input.name === undefined ? classType.name : String(input.name).trim(); const productId = input.productId === undefined ? classType.productId : String(input.productId).trim() || undefined; const description = input.description === undefined ? classType.description : String(input.description).trim() || undefined; const endDate = input.endDate === undefined ? classType.endDate : planDate(input.endDate, '班型结束日期', classType.endDate); const sortOrder = input.sortOrder === undefined ? classType.sortOrder : Number(input.sortOrder); const status = input.status === undefined ? classType.status : String(input.status); if (name.length < 2 || name.length > 80 || description && description.length > 240 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999 || !['active', 'disabled'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '学习班型信息不正确'); const updatedAt = new Date().toISOString(); await persistAdminMutation([{text: 'update learning_class_types set name=$1,product_id=$2,description=$3,end_date=$4,sort_order=$5,status=$6,updated_by=$7,updated_at=$8 where id=$9', values: [name, productId ?? null, description ?? null, endDate, sortOrder, status, admin.adminId, updatedAt, classType.id]}], [admin.adminId, 'learning_class_type.edit', 'learning_class_type', classType.id, '编辑学习班型', requestId]); Object.assign(classType, {name, productId, description, endDate, sortOrder, status, updatedAt}); return send(res, 200, publicLearningClassType(classType), requestId);
    }
    if (adminLearningClassType && req.method === 'DELETE') {
      const admin = requireAdmin(req); const classType = store.learningClassTypes.find(item => item.id === decodePathSegment(adminLearningClassType[1])); if (!classType) throw new HttpError(404, 'LEARNING_CLASS_TYPE_NOT_FOUND', '学习班型不存在'); if (store.learningStages.some(stage => stage.classTypeId === classType.id)) throw new HttpError(409, 'LEARNING_CLASS_TYPE_IN_USE', '该班型已有学习阶段，请先处理阶段'); await persistAdminMutation([{text: 'delete from learning_class_types where id=$1', values: [classType.id]}], [admin.adminId, 'learning_class_type.delete', 'learning_class_type', classType.id, '删除学习班型', requestId]); store.learningClassTypes = store.learningClassTypes.filter(item => item.id !== classType.id); return send(res, 200, {deleted: true, id: classType.id}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/learning-coach/stages') {
      requireAdmin(req); const classTypeId = url.searchParams.get('classTypeId') ?? undefined; const items = [...store.learningStages].filter(stage => !classTypeId || stage.classTypeId === classTypeId).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)).map(stage => ({...publicLearningStage(stage), teacherCount: (stage.teacherIds?.length ? stage.teacherIds.length : store.learningTeachers.filter(teacher => teacher.stageId === stage.id).length)})); return send(res, 200, {items, total: items.length}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-coach/stages') {
      const admin = requireAdmin(req); const input = await body(req); const classTypeId = String(input.classTypeId ?? 'class-deen-private-coach').trim(); const classType = store.learningClassTypes.find(item => item.id === classTypeId && item.status === 'active'); const code = String(input.code ?? '').trim().toLowerCase(); const name = String(input.name ?? '').trim(); const description = String(input.description ?? '').trim() || undefined; const sortOrder = Number(input.sortOrder ?? (store.learningStages.filter(item => item.classTypeId === classTypeId).length + 1) * 10); const conditions = Array.isArray(input.conditions) ? input.conditions.map((raw: any) => ({dimension: String(raw.dimension ?? ''), operator: String(raw.operator ?? ''), value: Number(raw.value), ...(raw.upperValue !== undefined ? {upperValue: Number(raw.upperValue)} : {})})) : [];
      const validConditions = conditions.length === 0 || conditions.every(condition => activeLearningDiagnosticDimensions().some(item => item.code === condition.dimension) && ['gte', 'lte', 'between'].includes(condition.operator) && Number.isFinite(condition.value) && condition.value >= 0 && condition.value <= 100 && (condition.operator !== 'between' || condition.upperValue !== undefined && Number.isFinite(condition.upperValue) && condition.upperValue >= condition.value && condition.upperValue <= 100));
      if (!classType || !/^[a-z][a-z0-9_-]{1,79}$/.test(code) || name.length < 2 || name.length > 80 || description && description.length > 240 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999 || !validConditions || store.learningStages.some(item => item.classTypeId === classTypeId && item.code === code)) throw new HttpError(422, 'VALIDATION_ERROR', '学习阶段信息或画像匹配条件不正确');
      const now = new Date().toISOString(); const requestedTeacherIds = Array.isArray(input.teacherIds) ? [...new Set(input.teacherIds.map(String).map((id: string) => id.trim()).filter(Boolean))] : []; const validTeacherIds = requestedTeacherIds.every((id: string) => store.learningTeachers.some(teacher => teacher.id === id && teacher.status === 'active')); if (!validTeacherIds) throw new HttpError(422, 'VALIDATION_ERROR', '所选老师不存在或已停用'); const stage: LearningStage = {id: `stage-${randomUUID()}`, classTypeId, code, name, ...(description ? {description} : {}), conditions: conditions as LearningStageCondition[], teacherIds: requestedTeacherIds, sortOrder, status: 'active', createdAt: now, updatedAt: now}; await persistAdminMutation([{text: 'insert into learning_stages (id,class_type_id,code,name,description,conditions,teacher_ids,sort_order,status,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$10,$11,$11)', values: [stage.id, stage.classTypeId, stage.code, stage.name, stage.description ?? null, JSON.stringify(stage.conditions), JSON.stringify(stage.teacherIds), stage.sortOrder, stage.status, admin.adminId, now]}], [admin.adminId, 'learning_stage.create', 'learning_stage', stage.id, '创建学习阶段', requestId]); store.learningStages.push(stage); return send(res, 201, publicLearningStage(stage), requestId);
    }
    const adminLearningStage = path.match(/^\/v1\/admin\/learning-coach\/stages\/([^/]+)$/);
    if (adminLearningStage && req.method === 'PATCH') {
      const admin = requireAdmin(req); const stage = store.learningStages.find(item => item.id === decodePathSegment(adminLearningStage[1])); if (!stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '学习阶段不存在'); const input = await body(req); const name = input.name === undefined ? stage.name : String(input.name).trim(); const description = input.description === undefined ? stage.description : String(input.description).trim() || undefined; const sortOrder = input.sortOrder === undefined ? stage.sortOrder : Number(input.sortOrder); const status = input.status === undefined ? stage.status : String(input.status); const teacherIds = input.teacherIds === undefined ? (stage.teacherIds ?? []) : Array.isArray(input.teacherIds) ? [...new Set(input.teacherIds.map(String).map((id: string) => id.trim()).filter(Boolean))] : []; const conditions = input.conditions === undefined ? stage.conditions : Array.isArray(input.conditions) ? input.conditions.map((raw: any) => ({dimension: String(raw.dimension ?? ''), operator: String(raw.operator ?? ''), value: Number(raw.value), ...(raw.upperValue !== undefined ? {upperValue: Number(raw.upperValue)} : {})})) : [];
       const validConditions = conditions.length === 0 || conditions.every((condition: any) => activeLearningDiagnosticDimensions().some(item => item.code === condition.dimension) && ['gte', 'lte', 'between'].includes(condition.operator) && Number.isFinite(condition.value) && condition.value >= 0 && condition.value <= 100 && (condition.operator !== 'between' || condition.upperValue !== undefined && Number.isFinite(condition.upperValue) && condition.upperValue >= condition.value && condition.upperValue <= 100));
      const validTeacherIds = teacherIds.every((id: string) => store.learningTeachers.some(teacher => teacher.id === id && teacher.status === 'active')); if (name.length < 2 || name.length > 80 || description && description.length > 240 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999 || !['active', 'disabled'].includes(status) || !validConditions || !validTeacherIds) throw new HttpError(422, 'VALIDATION_ERROR', '学习阶段信息或画像匹配条件不正确'); const updatedAt = new Date().toISOString(); await persistAdminMutation([{text: 'update learning_stages set name=$1,description=$2,conditions=$3::jsonb,teacher_ids=$4::jsonb,sort_order=$5,status=$6,updated_by=$7,updated_at=$8 where id=$9', values: [name, description ?? null, JSON.stringify(conditions), JSON.stringify(teacherIds), sortOrder, status, admin.adminId, updatedAt, stage.id]}], [admin.adminId, 'learning_stage.edit', 'learning_stage', stage.id, '编辑学习阶段', requestId]); Object.assign(stage, {name, description, conditions, teacherIds, sortOrder, status, updatedAt}); return send(res, 200, publicLearningStage(stage), requestId);
    }
    if (adminLearningStage && req.method === 'DELETE') {
      const admin = requireAdmin(req); const stage = store.learningStages.find(item => item.id === decodePathSegment(adminLearningStage[1])); if (!stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '学习阶段不存在'); if (store.learningTeachers.some(item => item.stageId === stage.id)) throw new HttpError(409, 'LEARNING_STAGE_IN_USE', '该阶段已有师资，不能删除，请先处理该阶段师资'); await persistAdminMutation([{text: 'delete from learning_stages where id=$1', values: [stage.id]}], [admin.adminId, 'learning_stage.delete', 'learning_stage', stage.id, '删除学习阶段', requestId]); store.learningStages = store.learningStages.filter(item => item.id !== stage.id); return send(res, 200, {deleted: true, id: stage.id}, requestId);
    }
    const adminStagePlan = path.match(/^\/v1\/admin\/learning-coach\/stages\/([^/]+)\/plan$/);
    if (adminStagePlan && req.method === 'GET') {
      requireAdmin(req); const stage = store.learningStages.find(item => item.id === decodePathSegment(adminStagePlan[1])); if (!stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '学习阶段不存在');
      return send(res, 200, {stage: publicLearningStage(stage), config: stagePlanConfig(stage.id), items: store.learningStagePlanItems.filter(item => item.stageId === stage.id).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))}, requestId);
    }
    const adminStagePlanPreview = path.match(/^\/v1\/admin\/learning-coach\/stages\/([^/]+)\/plan\/preview$/);
    if (adminStagePlanPreview && req.method === 'POST') {
      requireAdmin(req); const stage = store.learningStages.find(item => item.id === decodePathSegment(adminStagePlanPreview[1])); if (!stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '学习阶段不存在'); const input = await body(req); const current = stagePlanConfig(stage.id); const classType = stage.classTypeId ? store.learningClassTypes.find(item => item.id === stage.classTypeId) : undefined;
      const config = {...current, totalMinutes: input.totalMinutes === undefined ? current.totalMinutes : Number(input.totalMinutes), weekdayMinMinutes: input.weekdayMinMinutes === undefined ? current.weekdayMinMinutes : Number(input.weekdayMinMinutes), weekdayMaxMinutes: input.weekdayMaxMinutes === undefined ? current.weekdayMaxMinutes : Number(input.weekdayMaxMinutes), weekendMinMinutes: input.weekendMinMinutes === undefined ? current.weekendMinMinutes : Number(input.weekendMinMinutes), weekendMaxMinutes: input.weekendMaxMinutes === undefined ? current.weekendMaxMinutes : Number(input.weekendMaxMinutes), holidayMinMinutes: input.holidayMinMinutes === undefined ? current.holidayMinMinutes : Number(input.holidayMinMinutes), holidayMaxMinutes: input.holidayMaxMinutes === undefined ? current.holidayMaxMinutes : Number(input.holidayMaxMinutes), holidayDates: input.holidayDates === undefined ? current.holidayDates : Array.isArray(input.holidayDates) ? [...new Set(input.holidayDates.map(String))] : [], dailyMinutes: input.dailyMinutes === undefined ? current.dailyMinutes : Number(input.dailyMinutes), minDailyMinutes: input.minDailyMinutes === undefined ? current.minDailyMinutes : Number(input.minDailyMinutes), maxDailyMinutes: input.maxDailyMinutes === undefined ? current.maxDailyMinutes : Number(input.maxDailyMinutes), durationDays: input.durationDays === undefined ? current.durationDays : Number(input.durationDays), studyDays: input.studyDays === undefined ? current.studyDays : Array.isArray(input.studyDays) ? [...new Set(input.studyDays.map(Number))] : [], makeupPolicy: input.makeupPolicy === undefined ? current.makeupPolicy : String(input.makeupPolicy), cardUnlockRule: input.cardUnlockRule === undefined ? current.cardUnlockRule : String(input.cardUnlockRule), questionPushCount: input.questionPushCount === undefined ? current.questionPushCount : Number(input.questionPushCount), questionSelectionStrategy: input.questionSelectionStrategy === undefined ? current.questionSelectionStrategy : String(input.questionSelectionStrategy)};
      const ranges = [[config.weekdayMinMinutes, config.weekdayMaxMinutes], [config.weekendMinMinutes, config.weekendMaxMinutes], [config.holidayMinMinutes, config.holidayMaxMinutes]]; const validHolidayDates = config.holidayDates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)));
      if (!Number.isInteger(config.totalMinutes) || config.totalMinutes < 1 || !Number.isInteger(config.dailyMinutes) || config.dailyMinutes < config.minDailyMinutes || config.dailyMinutes > config.maxDailyMinutes || ranges.some(([min, max]) => !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 1440) || !validHolidayDates || !Number.isInteger(config.durationDays) || config.durationDays < 1 || !config.studyDays.length || config.studyDays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || !['spread', 'weekend'].includes(config.makeupPolicy)) throw new HttpError(422, 'VALIDATION_ERROR', '学习计划规则不正确');
      const startDate = input.startDate === undefined ? new Date().toISOString().slice(0, 10) : planDate(input.startDate, '预览开始日期', new Date().toISOString().slice(0, 10)); const deadline = classType?.endDate; const schedule = buildStagePlanSchedule('preview', stage.id, config as LearningStagePlanConfig, startDate, deadline); const days = new Map<string, number>(); schedule.tasks.forEach(task => days.set(task.dueDate, (days.get(task.dueDate) ?? 0) + task.minutes)); const dailyMinutes = [...days.values()]; const baseline = current.publishedSnapshot ?? current; const changes = (['totalMinutes', 'dailyMinutes', 'minDailyMinutes', 'maxDailyMinutes', 'weekdayMinMinutes', 'weekdayMaxMinutes', 'weekendMinMinutes', 'weekendMaxMinutes', 'holidayMinMinutes', 'holidayMaxMinutes', 'holidayDates', 'durationDays', 'makeupPolicy', 'studyDays'] as const).filter(key => JSON.stringify(baseline[key]) !== JSON.stringify(config[key])).map(key => ({field: key, before: baseline[key], after: config[key]})); const impactedPlans = store.learningPlans.filter(plan => plan.stageId === stage.id && plan.status === 'active'); const impact = {userCount: new Set(impactedPlans.map(plan => plan.userId)).size, planCount: impactedPlans.length, pendingTaskCount: store.learningTasks.filter(task => impactedPlans.some(plan => plan.id === task.planId) && task.status !== 'done').length, manuallyAdjustedCount: impactedPlans.filter(plan => store.learningPlanVersions.some(version => version.planId === plan.id && version.source === 'admin')).length}; return send(res, 200, {stage: publicLearningStage(stage), config, classEndDate: classType?.endDate, changes, impact, startDate, endDate: schedule.endDate, totalMinutes: config.totalMinutes, itemCount: schedule.items.length, taskCount: schedule.tasks.length, availableDays: days.size, maxDailyMinutes: dailyMinutes.length ? Math.max(...dailyMinutes) : 0, minDailyMinutes: dailyMinutes.length ? Math.min(...dailyMinutes) : 0, overDailyLimit: [...days.entries()].filter(([date, value]) => value > dateCapacity(config as LearningStagePlanConfig, date).max).length, incomplete: schedule.incomplete, days: [...days.entries()].map(([date, minutes]) => ({date, minutes, tasks: schedule.tasks.filter(task => task.dueDate === date)}))}, requestId);
    }
    const adminStagePlanWeeklyPreview = path.match(/^\/v1\/admin\/learning-coach\/stages\/([^/]+)\/plan\/weekly-preview$/);
    if (adminStagePlanWeeklyPreview && req.method === 'POST') {
      requireAdmin(req); const stage = store.learningStages.find(item => item.id === decodePathSegment(adminStagePlanWeeklyPreview[1])); if (!stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '学习阶段不存在'); const input = await body(req); const current = stagePlanConfig(stage.id); const classType = stage.classTypeId ? store.learningClassTypes.find(item => item.id === stage.classTypeId) : undefined; const startDate = input.startDate === undefined ? new Date().toISOString().slice(0, 10) : planDate(input.startDate, '预览开始日期', new Date().toISOString().slice(0, 10)); const weekly = buildWeeklyStagePlanSchedule(stage.id, current, startDate, classType?.endDate); const sortedItems = weekly.items.slice().sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)); const days = Array.from({length: 7}, (_, index) => { const date = addDays(startDate, index); const dayItems = sortedItems.filter((item, itemIndex) => { const dayOffset = item.weekDay === undefined ? itemIndex : Math.max(0, item.weekDay - 1); return dayOffset === index; }); return {date, items: dayItems, tasks: weekly.tasks.filter(task => task.dueDate === date)}; }).filter(day => day.date <= weekly.generatedThrough); return send(res, 200, {stage: publicLearningStage(stage), config: current, startDate, generatedThrough: weekly.generatedThrough, endDate: weekly.endDate, incomplete: weekly.incomplete, days}, requestId);
    }
    const adminStagePlanPublish = path.match(/^\/v1\/admin\/learning-coach\/stages\/([^/]+)\/plan\/publish$/);
    if (adminStagePlanPublish && req.method === 'POST') {
      const admin = requireAdmin(req); const input = await body(req); const replanExisting = input.replanExisting === true; const stage = store.learningStages.find(item => item.id === decodePathSegment(adminStagePlanPublish[1])); if (!stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '学习阶段不存在'); const config = stagePlanConfig(stage.id); validateStagePlanKnowledgeLinks(stage.id); const schedule = buildStagePlanSchedule('preview', stage.id, config, new Date().toISOString().slice(0, 10)); if (!schedule.items.length) throw new HttpError(409, 'LEARNING_STAGE_PLAN_EMPTY', '请先添加阶段学习内容'); const publishedAt = new Date().toISOString(); const updated = {...config, status: 'published' as const, version: config.version + (config.status === 'published' ? 0 : 1), publishedAt, publishedSnapshot: undefined, updatedAt: publishedAt}; await persistAdminMutation([{text: 'insert into learning_stage_plan_configs (stage_id,total_minutes,daily_minutes,min_daily_minutes,max_daily_minutes,weekday_min_minutes,weekday_max_minutes,weekend_min_minutes,weekend_max_minutes,holiday_min_minutes,holiday_max_minutes,holiday_dates,study_days,duration_days,makeup_policy,card_unlock_rule,question_push_count,question_selection_strategy,status,version,published_at,published_snapshot,published_by,updated_by,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,null,$22,$22,$21) on conflict (stage_id) do update set total_minutes=excluded.total_minutes,daily_minutes=excluded.daily_minutes,min_daily_minutes=excluded.min_daily_minutes,max_daily_minutes=excluded.max_daily_minutes,weekday_min_minutes=excluded.weekday_min_minutes,weekday_max_minutes=excluded.weekday_max_minutes,weekend_min_minutes=excluded.weekend_min_minutes,weekend_max_minutes=excluded.weekend_max_minutes,holiday_min_minutes=excluded.holiday_min_minutes,holiday_max_minutes=excluded.holiday_max_minutes,holiday_dates=excluded.holiday_dates,study_days=excluded.study_days,duration_days=excluded.duration_days,makeup_policy=excluded.makeup_policy,card_unlock_rule=excluded.card_unlock_rule,question_push_count=excluded.question_push_count,question_selection_strategy=excluded.question_selection_strategy,status=excluded.status,version=excluded.version,published_at=excluded.published_at,published_snapshot=null,published_by=excluded.published_by,updated_by=excluded.updated_by,updated_at=excluded.updated_at', values: [stage.id, updated.totalMinutes, updated.dailyMinutes, updated.minDailyMinutes, updated.maxDailyMinutes, updated.weekdayMinMinutes, updated.weekdayMaxMinutes, updated.weekendMinMinutes, updated.weekendMaxMinutes, updated.holidayMinMinutes, updated.holidayMaxMinutes, JSON.stringify(updated.holidayDates), JSON.stringify(updated.studyDays), updated.durationDays, updated.makeupPolicy, updated.cardUnlockRule, updated.questionPushCount, updated.questionSelectionStrategy, updated.status, updated.version, updated.publishedAt, admin.adminId]}], [admin.adminId, 'learning_stage_plan.publish', 'learning_stage_plan', stage.id, replanExisting ? '发布规则并重排已有未开始任务' : '发布阶段学习计划规则', requestId]); const index = store.learningStagePlanConfigs.findIndex(item => item.stageId === stage.id); if (index >= 0) store.learningStagePlanConfigs[index] = updated; else store.learningStagePlanConfigs.push(updated); if (replanExisting) { for (const plan of store.learningPlans.filter(item => item.stageId === stage.id && item.status === 'active' && !item.pausedAt)) await rebalanceLearningPlan(plan, '阶段计划规则发布后重排', true); } return send(res, 200, {...updated, replanExisting}, requestId);
    }
    if (adminStagePlan && req.method === 'PATCH') {
      const admin = requireAdmin(req); const stage = store.learningStages.find(item => item.id === decodePathSegment(adminStagePlan[1])); if (!stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '学习阶段不存在'); const current = stagePlanConfig(stage.id); const input = await body(req);
      const totalMinutes = input.totalMinutes === undefined ? current.totalMinutes : Number(input.totalMinutes); const dailyMinutes = input.dailyMinutes === undefined ? current.dailyMinutes : Number(input.dailyMinutes); const minDailyMinutes = input.minDailyMinutes === undefined ? current.minDailyMinutes : Number(input.minDailyMinutes); const maxDailyMinutes = input.maxDailyMinutes === undefined ? current.maxDailyMinutes : Number(input.maxDailyMinutes); const weekdayMinMinutes = input.weekdayMinMinutes === undefined ? current.weekdayMinMinutes : Number(input.weekdayMinMinutes); const weekdayMaxMinutes = input.weekdayMaxMinutes === undefined ? current.weekdayMaxMinutes : Number(input.weekdayMaxMinutes); const weekendMinMinutes = input.weekendMinMinutes === undefined ? current.weekendMinMinutes : Number(input.weekendMinMinutes); const weekendMaxMinutes = input.weekendMaxMinutes === undefined ? current.weekendMaxMinutes : Number(input.weekendMaxMinutes); const holidayMinMinutes = input.holidayMinMinutes === undefined ? current.holidayMinMinutes : Number(input.holidayMinMinutes); const holidayMaxMinutes = input.holidayMaxMinutes === undefined ? current.holidayMaxMinutes : Number(input.holidayMaxMinutes); const holidayDates = input.holidayDates === undefined ? current.holidayDates : Array.isArray(input.holidayDates) ? [...new Set(input.holidayDates.map(String))] : []; const durationDays = input.durationDays === undefined ? current.durationDays : Number(input.durationDays); const studyDays = input.studyDays === undefined ? current.studyDays : Array.isArray(input.studyDays) ? [...new Set(input.studyDays.map(Number))] : []; const makeupPolicy = input.makeupPolicy === undefined ? current.makeupPolicy : String(input.makeupPolicy); const cardUnlockRule = input.cardUnlockRule === undefined ? current.cardUnlockRule : String(input.cardUnlockRule); const questionPushCount = input.questionPushCount === undefined ? current.questionPushCount : Number(input.questionPushCount); const questionSelectionStrategy = input.questionSelectionStrategy === undefined ? current.questionSelectionStrategy : String(input.questionSelectionStrategy);
      const ranges = [[weekdayMinMinutes, weekdayMaxMinutes], [weekendMinMinutes, weekendMaxMinutes], [holidayMinMinutes, holidayMaxMinutes]]; const validHolidayDates = holidayDates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)));
      if (!Number.isInteger(totalMinutes) || totalMinutes < 0 || totalMinutes > 10_000_000 || !Number.isInteger(dailyMinutes) || dailyMinutes < 1 || dailyMinutes > 1440 || !Number.isInteger(minDailyMinutes) || minDailyMinutes < 1 || minDailyMinutes > 1440 || !Number.isInteger(maxDailyMinutes) || maxDailyMinutes < minDailyMinutes || maxDailyMinutes > 1440 || dailyMinutes < minDailyMinutes || dailyMinutes > maxDailyMinutes || ranges.some(([min, max]) => !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 1440) || !validHolidayDates || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 730 || !studyDays.length || studyDays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || !['spread', 'weekend'].includes(makeupPolicy) || !['after_course_checkin', 'after_previous_content', 'immediate'].includes(cardUnlockRule) || !Number.isInteger(questionPushCount) || questionPushCount < 1 || questionPushCount > 50 || questionSelectionStrategy !== 'profile') throw new HttpError(422, 'VALIDATION_ERROR', '学习计划规则不正确');
      const updated: LearningStagePlanConfig = {stageId: stage.id, totalMinutes, dailyMinutes, minDailyMinutes, maxDailyMinutes, weekdayMinMinutes, weekdayMaxMinutes, weekendMinMinutes, weekendMaxMinutes, holidayMinMinutes, holidayMaxMinutes, holidayDates, studyDays, durationDays, makeupPolicy: makeupPolicy as LearningStagePlanConfig['makeupPolicy'], cardUnlockRule: cardUnlockRule as LearningStagePlanConfig['cardUnlockRule'], questionPushCount, questionSelectionStrategy: 'profile', status: 'draft', version: current.version + 1, publishedSnapshot: current.publishedSnapshot, updatedAt: new Date().toISOString()};
      await persistAdminMutation([{text: 'insert into learning_stage_plan_configs (stage_id,total_minutes,daily_minutes,min_daily_minutes,max_daily_minutes,weekday_min_minutes,weekday_max_minutes,weekend_min_minutes,weekend_max_minutes,holiday_min_minutes,holiday_max_minutes,holiday_dates,study_days,duration_days,makeup_policy,card_unlock_rule,question_push_count,question_selection_strategy,status,version,published_at,published_snapshot,updated_by,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,null,$21::jsonb,$22,$23) on conflict (stage_id) do update set total_minutes=excluded.total_minutes,daily_minutes=excluded.daily_minutes,min_daily_minutes=excluded.min_daily_minutes,max_daily_minutes=excluded.max_daily_minutes,weekday_min_minutes=excluded.weekday_min_minutes,weekday_max_minutes=excluded.weekday_max_minutes,weekend_min_minutes=excluded.weekend_min_minutes,weekend_max_minutes=excluded.weekend_max_minutes,holiday_min_minutes=excluded.holiday_min_minutes,holiday_max_minutes=excluded.holiday_max_minutes,holiday_dates=excluded.holiday_dates,study_days=excluded.study_days,duration_days=excluded.duration_days,makeup_policy=excluded.makeup_policy,card_unlock_rule=excluded.card_unlock_rule,question_push_count=excluded.question_push_count,question_selection_strategy=excluded.question_selection_strategy,status=excluded.status,version=excluded.version,published_at=null,published_snapshot=excluded.published_snapshot,updated_by=excluded.updated_by,updated_at=excluded.updated_at', values: [updated.stageId, updated.totalMinutes, updated.dailyMinutes, updated.minDailyMinutes, updated.maxDailyMinutes, updated.weekdayMinMinutes, updated.weekdayMaxMinutes, updated.weekendMinMinutes, updated.weekendMaxMinutes, updated.holidayMinMinutes, updated.holidayMaxMinutes, JSON.stringify(updated.holidayDates), JSON.stringify(updated.studyDays), updated.durationDays, updated.makeupPolicy, updated.cardUnlockRule, updated.questionPushCount, updated.questionSelectionStrategy, updated.status, updated.version, JSON.stringify(updated.publishedSnapshot ?? stagePlanSnapshot(current)), admin.adminId, updated.updatedAt]}], [admin.adminId, 'learning_stage_plan.edit', 'learning_stage_plan', stage.id, '编辑阶段学习计划规则，等待发布', requestId]);
      const index = store.learningStagePlanConfigs.findIndex(item => item.stageId === stage.id); if (index >= 0) store.learningStagePlanConfigs[index] = updated; else store.learningStagePlanConfigs.push(updated); return send(res, 200, updated, requestId);
    }
    const adminStagePlanItems = path.match(/^\/v1\/admin\/learning-coach\/stages\/([^/]+)\/plan\/items$/);
    if (adminStagePlanItems && req.method === 'POST') {
      const admin = requireAdmin(req); const stage = store.learningStages.find(item => item.id === decodePathSegment(adminStagePlanItems[1])); if (!stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '学习阶段不存在'); const input = await body(req); const contentType = String(input.contentType ?? 'task'); const title = String(input.title ?? '').trim(); const description = String(input.description ?? '').trim() || undefined; const minutes = input.minutes === undefined || input.minutes === null || input.minutes === '' ? 0 : Number(input.minutes); const weekDay = input.weekDay === undefined || input.weekDay === null || input.weekDay === '' ? undefined : Number(input.weekDay); const questionCount = input.questionCount === undefined || input.questionCount === null || input.questionCount === '' ? undefined : Number(input.questionCount); const sortOrder = Number(input.sortOrder ?? (store.learningStagePlanItems.filter(item => item.stageId === stage.id).length + 1) * 10); const required = input.required === undefined ? true : Boolean(input.required); const contentId = String(input.contentId ?? '').trim() || undefined; const knowledgePointIds = ['course', 'card', 'question', 'subjective'].includes(contentType) && Array.isArray(input.knowledgePointIds) ? [...new Set(input.knowledgePointIds.map(String).map(item => item.trim()).filter(Boolean))] : [];

       if (!['course', 'question', 'subjective', 'assessment', 'card', 'task'].includes(contentType) || title.length < 2 || title.length > 160 || description && description.length > 5000 || contentType === 'course' && !description || ['question', 'subjective'].includes(contentType) && knowledgePointIds.length === 0 || contentType === 'card' && knowledgePointIds.length === 0 && !(contentId && (store.learningCards.find(card => card.id === contentId)?.knowledgePointIds?.length ?? 0) > 0) || knowledgePointIds.length > 50 || knowledgePointIds.some(id => !store.learningQuestionTaxonomyNodes.some(node => node.id === id && node.category === 'objective' && (node.type === 'point' || node.type === 'subpoint') && node.status === 'active')) || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440 || questionCount !== undefined && (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 50) || contentType !== 'question' && questionCount !== undefined || weekDay !== undefined && (!Number.isInteger(weekDay) || weekDay < 1 || weekDay > 7) || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new HttpError(422, 'VALIDATION_ERROR', '阶段学习内容不正确'); validateStagePlanContent(contentType as LearningStagePlanItem['contentType'], contentId); const now = new Date().toISOString(); const item: LearningStagePlanItem = {id: `stage-plan-item-${randomUUID()}`, stageId: stage.id, contentType: contentType as LearningStagePlanItem['contentType'], ...(contentId ? {contentId} : {}), knowledgePointIds, title, ...(description ? {description} : {}), minutes, ...(weekDay === undefined ? {} : {weekDay}), ...(questionCount === undefined ? {} : {questionCount}), sortOrder, required};
       await persistAdminMutation([{text: 'insert into learning_stage_plan_items (id,stage_id,content_type,content_id,knowledge_point_ids,title,description,minutes,week_day,question_count,sort_order,required,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$15)', values: [item.id, item.stageId, item.contentType, item.contentId ?? null, JSON.stringify(item.knowledgePointIds), item.title, item.description ?? null, item.minutes ?? 0, item.weekDay ?? null, item.questionCount ?? null, item.sortOrder, item.required, admin.adminId, now]}], [admin.adminId, 'learning_stage_plan_item.create', 'learning_stage_plan_item', item.id, '创建阶段学习内容', requestId]); store.learningStagePlanItems.push(item); await markStagePlanDraft(stage.id, admin.adminId, requestId, '新增阶段学习内容，等待重新发布'); return send(res, 201, item, requestId);
    }
    const adminStagePlanItem = path.match(/^\/v1\/admin\/learning-coach\/stages\/([^/]+)\/plan\/items\/([^/]+)$/);
    if (adminStagePlanItem && req.method === 'PATCH') {
      const admin = requireAdmin(req); const item = store.learningStagePlanItems.find(candidate => candidate.stageId === decodePathSegment(adminStagePlanItem[1]) && candidate.id === decodePathSegment(adminStagePlanItem[2])); if (!item) throw new HttpError(404, 'LEARNING_STAGE_PLAN_ITEM_NOT_FOUND', '阶段学习内容不存在'); const input = await body(req); const contentType = input.contentType === undefined ? item.contentType : String(input.contentType); const title = input.title === undefined ? item.title : String(input.title).trim(); const description = input.description === undefined ? item.description : String(input.description).trim() || undefined; const minutes = input.minutes === undefined ? (item.minutes ?? 0) : Number(input.minutes); const weekDay = input.weekDay === undefined ? item.weekDay : input.weekDay === null || input.weekDay === '' ? undefined : Number(input.weekDay); const questionCount = contentType === 'question' ? (input.questionCount === undefined ? item.questionCount : input.questionCount === null || input.questionCount === '' ? undefined : Number(input.questionCount)) : undefined; const sortOrder = input.sortOrder === undefined ? item.sortOrder : Number(input.sortOrder); const required = input.required === undefined ? item.required : Boolean(input.required); const contentId = input.contentId === undefined ? item.contentId : String(input.contentId).trim() || undefined; const knowledgePointIds = ['course', 'card', 'question', 'subjective'].includes(contentType) ? (input.knowledgePointIds === undefined ? (item.knowledgePointIds ?? []) : Array.isArray(input.knowledgePointIds) ? [...new Set(input.knowledgePointIds.map(String).map(id => id.trim()).filter(Boolean))] : []) : [];
       if (!['course', 'question', 'subjective', 'assessment', 'card', 'task'].includes(contentType) || title.length < 2 || title.length > 160 || description && description.length > 5000 || contentType === 'course' && !description || ['question', 'subjective'].includes(contentType) && knowledgePointIds.length === 0 || contentType === 'card' && knowledgePointIds.length === 0 && !(contentId && (store.learningCards.find(card => card.id === contentId)?.knowledgePointIds?.length ?? 0) > 0) || knowledgePointIds.length > 50 || knowledgePointIds.some(id => !store.learningQuestionTaxonomyNodes.some(node => node.id === id && node.category === 'objective' && (node.type === 'point' || node.type === 'subpoint') && node.status === 'active')) || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440 || questionCount !== undefined && (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 50) || contentType !== 'question' && questionCount !== undefined || weekDay !== undefined && (!Number.isInteger(weekDay) || weekDay < 1 || weekDay > 7) || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new HttpError(422, 'VALIDATION_ERROR', '阶段学习内容不正确'); validateStagePlanContent(contentType as LearningStagePlanItem['contentType'], contentId); const updatedAt = new Date().toISOString(); Object.assign(item, {contentType, title, description, minutes, weekDay, questionCount, sortOrder, required, contentId, knowledgePointIds, updatedAt}); await persistAdminMutation([{text: 'update learning_stage_plan_items set content_type=$1,content_id=$2,knowledge_point_ids=$3::jsonb,title=$4,description=$5,minutes=$6,week_day=$7,question_count=$8,sort_order=$9,required=$10,updated_by=$11,updated_at=$12 where id=$13', values: [item.contentType, item.contentId ?? null, JSON.stringify(item.knowledgePointIds ?? []), item.title, item.description ?? null, item.minutes ?? 0, item.weekDay ?? null, item.questionCount ?? null, item.sortOrder, item.required, admin.adminId, updatedAt, item.id]}], [admin.adminId, 'learning_stage_plan_item.edit', 'learning_stage_plan_item', item.id, '编辑阶段学习内容', requestId]); await markStagePlanDraft(item.stageId, admin.adminId, requestId, '编辑阶段学习内容，等待重新发布'); return send(res, 200, item, requestId);
    }
    if (adminStagePlanItem && req.method === 'DELETE') {
       const admin = requireAdmin(req); const item = store.learningStagePlanItems.find(candidate => candidate.stageId === decodePathSegment(adminStagePlanItem[1]) && candidate.id === decodePathSegment(adminStagePlanItem[2])); if (!item) throw new HttpError(404, 'LEARNING_STAGE_PLAN_ITEM_NOT_FOUND', '阶段学习内容不存在'); await persistAdminMutation([{text: 'delete from learning_stage_plan_items where id=$1', values: [item.id]}], [admin.adminId, 'learning_stage_plan_item.delete', 'learning_stage_plan_item', item.id, '删除阶段学习内容', requestId]); store.learningStagePlanItems = store.learningStagePlanItems.filter(candidate => candidate.id !== item.id); await markStagePlanDraft(item.stageId, admin.adminId, requestId, '删除阶段学习内容，等待重新发布'); return send(res, 200, {deleted: true, id: item.id}, requestId);
    }
    const adminStageTeachers = path.match(/^\/v1\/admin\/learning-coach\/stages\/([^/]+)\/teachers$/);
    if (req.method === 'GET' && path === '/v1/admin/learning-coach/teachers') {
      requireAdmin(req);
      const subject = (url.searchParams.get('subject') ?? '').trim();
      const status = url.searchParams.get('status') ?? '';
      const items = store.learningTeachers.filter(item => (!subject || item.subject === subject) && (!status || item.status === status)).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)).map(publicLearningTeacher);
      const subjects = [...new Set(store.learningTeachers.map(item => item.subject))].sort((left, right) => left.localeCompare(right));
      return send(res, 200, {items, total: items.length, subjects}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-coach/teachers') {
      const admin = requireAdmin(req); const input = await body(req); const name = String(input.name ?? '').trim(); const subject = String(input.subject ?? '').trim(); const specialty = String(input.specialty ?? '').trim(); const sortOrder = Number(input.sortOrder ?? (store.learningTeachers.length + 1) * 10); if (name.length < 2 || name.length > 80 || subject.length < 1 || subject.length > 120 || specialty.length < 2 || specialty.length > 500 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new HttpError(422, 'VALIDATION_ERROR', '师资信息不正确'); const stageId = String(input.stageId ?? '').trim() || undefined; if (stageId && !store.learningStages.some(item => item.id === stageId)) throw new HttpError(422, 'LEARNING_STAGE_NOT_FOUND', '关联阶段不存在'); const now = new Date().toISOString(); const teacher: LearningTeacher = {id: `teacher-${randomUUID()}`, ...(stageId ? {stageId} : {}), name, subject, specialty, sortOrder, status: 'active', createdAt: now, updatedAt: now}; await persistAdminMutation([{text: 'insert into learning_teachers (id,stage_id,name,subject,specialty,sort_order,status,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$9)', values: [teacher.id, teacher.stageId ?? null, teacher.name, teacher.subject, teacher.specialty, teacher.sortOrder, teacher.status, admin.adminId, now]}], [admin.adminId, 'learning_teacher.create', 'learning_teacher', teacher.id, '创建全局师资', requestId]); store.learningTeachers.push(teacher); return send(res, 201, publicLearningTeacher(teacher), requestId);
    }
    if (adminStageTeachers && req.method === 'GET') {
      requireAdmin(req); const stage = store.learningStages.find(item => item.id === decodePathSegment(adminStageTeachers[1])); if (!stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '学习阶段不存在'); const items = store.learningTeachers.filter(item => stage.teacherIds?.length ? stage.teacherIds.includes(item.id) : item.stageId === stage.id).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)).map(publicLearningTeacher); return send(res, 200, {stage: publicLearningStage(stage), items, total: items.length}, requestId);
    }
    if (adminStageTeachers && req.method === 'POST') {
      const admin = requireAdmin(req); const stage = store.learningStages.find(item => item.id === decodePathSegment(adminStageTeachers[1])); if (!stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '学习阶段不存在'); const input = await body(req); const name = String(input.name ?? '').trim(); const subject = String(input.subject ?? '').trim(); const specialty = String(input.specialty ?? '').trim(); const sortOrder = Number(input.sortOrder ?? (store.learningTeachers.filter(item => item.stageId === stage.id).length + 1) * 10); if (name.length < 2 || name.length > 80 || subject.length < 1 || subject.length > 120 || specialty.length < 2 || specialty.length > 500 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new HttpError(422, 'VALIDATION_ERROR', '师资信息不正确'); const now = new Date().toISOString(); const teacher: LearningTeacher = {id: `teacher-${randomUUID()}`, stageId: stage.id, name, subject, specialty, sortOrder, status: 'active', createdAt: now, updatedAt: now}; await persistAdminMutation([{text: 'insert into learning_teachers (id,stage_id,name,subject,specialty,sort_order,status,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$9)', values: [teacher.id, teacher.stageId, teacher.name, teacher.subject, teacher.specialty, teacher.sortOrder, teacher.status, admin.adminId, now]}], [admin.adminId, 'learning_teacher.create', 'learning_teacher', teacher.id, `为${stage.name}创建师资`, requestId]); store.learningTeachers.push(teacher); return send(res, 201, publicLearningTeacher(teacher), requestId);
    }
    const adminLearningTeacher = path.match(/^\/v1\/admin\/learning-coach\/teachers\/([^/]+)$/);
    if (adminLearningTeacher && req.method === 'PATCH') {
      const admin = requireAdmin(req); const teacher = store.learningTeachers.find(item => item.id === decodePathSegment(adminLearningTeacher[1])); if (!teacher) throw new HttpError(404, 'LEARNING_TEACHER_NOT_FOUND', '师资不存在'); const input = await body(req); const name = input.name === undefined ? teacher.name : String(input.name).trim(); const subject = input.subject === undefined ? teacher.subject : String(input.subject).trim(); const specialty = input.specialty === undefined ? teacher.specialty : String(input.specialty).trim(); const sortOrder = input.sortOrder === undefined ? teacher.sortOrder : Number(input.sortOrder); const status = input.status === undefined ? teacher.status : String(input.status); if (name.length < 2 || name.length > 80 || subject.length < 1 || subject.length > 120 || specialty.length < 2 || specialty.length > 500 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999 || !['active', 'disabled'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '师资信息不正确'); const updatedAt = new Date().toISOString(); await persistAdminMutation([{text: 'update learning_teachers set name=$1,subject=$2,specialty=$3,sort_order=$4,status=$5,updated_by=$6,updated_at=$7 where id=$8', values: [name, subject, specialty, sortOrder, status, admin.adminId, updatedAt, teacher.id]}], [admin.adminId, 'learning_teacher.edit', 'learning_teacher', teacher.id, '编辑阶段师资', requestId]); Object.assign(teacher, {name, subject, specialty, sortOrder, status, updatedAt}); return send(res, 200, publicLearningTeacher(teacher), requestId);
    }
    if (adminLearningTeacher && req.method === 'DELETE') {
      const admin = requireAdmin(req); const teacher = store.learningTeachers.find(item => item.id === decodePathSegment(adminLearningTeacher[1])); if (!teacher) throw new HttpError(404, 'LEARNING_TEACHER_NOT_FOUND', '师资不存在'); await persistAdminMutation([{text: 'delete from learning_teachers where id=$1', values: [teacher.id]}], [admin.adminId, 'learning_teacher.delete', 'learning_teacher', teacher.id, '删除阶段师资', requestId]); store.learningTeachers = store.learningTeachers.filter(item => item.id !== teacher.id); return send(res, 200, {deleted: true, id: teacher.id}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/learning-diagnostic/results') {
      requireAdmin(req, 'learning.diagnostics.read');
      const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();
      const results = store.learningDiagnosticAttempts
        .filter(attempt => {
          if (!keyword) return true;
          const profile = store.profiles.get(attempt.userId);
          return Boolean(profile && `${profile.name} ${profile.phone} ${profile.id}`.toLowerCase().includes(keyword));
        })
        .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
        .map(publicAdminLearningDiagnosticResult);
      const assigned = results.filter(item => item.assignment?.status === 'assigned').length;
      return send(res, 200, {items: results, total: results.length, stats: {total: results.length, assigned, pending: results.length - assigned}}, requestId);
    }
    const adminDiagnosticAssignment = path.match(/^\/v1\/admin\/learning-diagnostic\/results\/([^/]+)\/assignment$/);
    if (adminDiagnosticAssignment && req.method === 'PATCH') {
      const admin = requireAdmin(req, 'learning.diagnostics.write');
      const attempt = store.learningDiagnosticAttempts.find(item => item.id === decodePathSegment(adminDiagnosticAssignment[1]));
      if (!attempt) throw new HttpError(404, 'DIAGNOSTIC_RESULT_NOT_FOUND', '诊断结果不存在');
      const assignment = store.learningTeacherAssignments.find(item => item.attemptId === attempt.id);
      if (!assignment) throw new HttpError(404, 'TEACHER_ASSIGNMENT_NOT_FOUND', '该诊断结果还没有分配记录');
      const input = await body(req);
      const requestedStageId = input.stageId === null || input.stageId === '' ? undefined : String(input.stageId ?? '').trim() || undefined;
      const stageId = input.stageId === null || input.stageId === '' ? undefined : (requestedStageId ?? assignment.stageId);
      const stage = stageId ? store.learningStages.find(item => item.id === stageId && item.status === 'active') : undefined;
      if (stageId && !stage) throw new HttpError(404, 'LEARNING_STAGE_NOT_FOUND', '所选阶段不存在或已停用');
      if (stage && assignment.classTypeId && stage.classTypeId !== assignment.classTypeId) throw new HttpError(422, 'STAGE_CLASS_TYPE_MISMATCH', '所选阶段不属于当前班型');
      const teacherId = input.teacherId === null || input.teacherId === '' ? undefined : String(input.teacherId ?? '').trim() || undefined;
      const teacher = teacherId ? store.learningTeachers.find(item => item.id === teacherId && item.status === 'active') : undefined;
      if (teacherId && !teacher) throw new HttpError(404, 'LEARNING_TEACHER_NOT_FOUND', '所选师资不存在或已停用');
      if (teacher && (!stage || !(stage.teacherIds?.includes(teacher.id) || stage.id === teacher.stageId))) throw new HttpError(422, 'TEACHER_STAGE_MISMATCH', '所选老师不属于当前阶段');
      const updatedAt = new Date().toISOString();
      const status: LearningTeacherAssignment['status'] = teacher ? 'assigned' : 'pending';
      const reason = teacher ? '管理员根据诊断结果手动调整阶段和师资' : stage ? '管理员指定阶段，等待分配老师' : '管理员撤销阶段和老师分配，等待重新安排';
      await persistAdminMutation([{text: 'update learning_teacher_assignments set stage_id=$1,teacher_id=$2,status=$3,reason=$4,updated_at=$5 where id=$6', values: [stage?.id ?? null, teacher?.id ?? null, status, reason, updatedAt, assignment.id]}], [admin.adminId, 'learning_diagnostic.assignment.edit', 'learning_teacher_assignment', assignment.id, reason, requestId]);
      assignment.stageId = stage?.id;
      assignment.teacherId = teacher?.id;
      assignment.status = status;
      assignment.reason = reason;
      assignment.updatedAt = updatedAt;
      return send(res, 200, publicLearningTeacherAssignment(assignment), requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/learning-diagnostic/form') {
      requireAdmin(req); const form = store.learningDiagnosticForms.find(item => item.id === 'initial-assessment'); if (!form) throw new HttpError(404, 'DIAGNOSTIC_FORM_NOT_FOUND', '诊断表单不存在');
      return send(res, 200, {form, publishedQuestionCount: store.learningDiagnosticQuestions.filter(item => item.formId === form.id && item.status === 'published').length, totalQuestionCount: store.learningDiagnosticQuestions.filter(item => item.formId === form.id).length}, requestId);
    }
    if (req.method === 'PATCH' && path === '/v1/admin/learning-diagnostic/form') {
      const admin = requireAdmin(req); const form = store.learningDiagnosticForms.find(item => item.id === 'initial-assessment'); if (!form) throw new HttpError(404, 'DIAGNOSTIC_FORM_NOT_FOUND', '诊断表单不存在'); const input = await body(req);
      const title = input.title === undefined ? form.title : String(input.title).trim(); const subtitle = input.subtitle === undefined ? form.subtitle : String(input.subtitle).trim() || undefined; const description = input.description === undefined ? form.description : String(input.description).trim() || undefined; const estimatedMinutes = input.estimatedMinutes === undefined ? form.estimatedMinutes : Number(input.estimatedMinutes); const submitLabel = input.submitLabel === undefined ? form.submitLabel : String(input.submitLabel).trim(); const successTitle = input.successTitle === undefined ? form.successTitle : String(input.successTitle).trim(); const successDescription = input.successDescription === undefined ? form.successDescription : String(input.successDescription).trim();
      if (title.length < 2 || title.length > 120 || subtitle && subtitle.length > 160 || description && description.length > 1000 || !Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 120 || submitLabel.length < 1 || submitLabel.length > 40 || successTitle.length < 2 || successTitle.length > 120 || successDescription.length < 2 || successDescription.length > 1000) throw new HttpError(422, 'VALIDATION_ERROR', '表单基础信息不正确');
      const updatedAt = new Date().toISOString(); const updated: LearningDiagnosticForm = {...form, title, subtitle, description, estimatedMinutes, submitLabel, successTitle, successDescription, status: 'draft', version: form.version + 1, updatedAt};
      await persistAdminMutation([{text: 'update learning_diagnostic_forms set title=$1, subtitle=$2, description=$3, estimated_minutes=$4, submit_label=$5, success_title=$6, success_description=$7, status=$8, version=$9, updated_by=$10, updated_at=$11, published_at=null where id=$12', values: [updated.title, updated.subtitle ?? null, updated.description ?? null, updated.estimatedMinutes, updated.submitLabel, updated.successTitle, updated.successDescription, updated.status, updated.version, admin.adminId, updated.updatedAt, updated.id]}], [admin.adminId, 'learning_diagnostic.form.edit', 'learning_diagnostic_form', updated.id, '编辑诊断表单并转为草稿', requestId]); Object.assign(form, updated); return send(res, 200, form, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-diagnostic/form/publish') {
      const admin = requireAdmin(req); const form = store.learningDiagnosticForms.find(item => item.id === 'initial-assessment'); if (!form) throw new HttpError(404, 'DIAGNOSTIC_FORM_NOT_FOUND', '诊断表单不存在'); const publishedQuestions = store.learningDiagnosticQuestions.filter(item => item.formId === form.id && item.status === 'published'); if (!publishedQuestions.length) throw new HttpError(409, 'DIAGNOSTIC_FORM_EMPTY', '至少发布一道诊断题后才能发布表单'); publishedQuestions.forEach(assertPublishableLearningDiagnosticQuestion); const publishedAt = new Date().toISOString(); const version = form.status === 'disabled' ? form.version + 1 : form.version; await persistAdminMutation([{text: 'update learning_diagnostic_forms set status=$1, version=$2, published_at=$3, updated_by=$4, updated_at=$3 where id=$5', values: ['published', version, publishedAt, admin.adminId, form.id]}], [admin.adminId, 'learning_diagnostic.form.publish', 'learning_diagnostic_form', form.id, '发布首次学习诊断表单', requestId]); form.status = 'published'; form.version = version; form.publishedAt = publishedAt; form.updatedAt = publishedAt; return send(res, 200, form, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-diagnostic/form/disable') {
      const admin = requireAdmin(req); const form = store.learningDiagnosticForms.find(item => item.id === 'initial-assessment'); if (!form) throw new HttpError(404, 'DIAGNOSTIC_FORM_NOT_FOUND', '诊断表单不存在'); if (form.status !== 'published') throw new HttpError(409, 'DIAGNOSTIC_FORM_NOT_PUBLISHED', '只有已发布的表单可以停用'); const input = await body(req); const reason = String(input.reason ?? '').trim(); if (reason.length < 2 || reason.length > 300) throw new HttpError(422, 'VALIDATION_ERROR', '请填写停用原因'); const updatedAt = new Date().toISOString(); await persistAdminMutation([{text: 'update learning_diagnostic_forms set status=$1, updated_by=$2, updated_at=$3 where id=$4', values: ['disabled', admin.adminId, updatedAt, form.id]}], [admin.adminId, 'learning_diagnostic.form.disable', 'learning_diagnostic_form', form.id, reason, requestId]); form.status = 'disabled'; form.updatedAt = updatedAt; return send(res, 200, form, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/learning-diagnostic/dimensions') { requireAdmin(req); return send(res, 200, {items: [...store.learningDiagnosticDimensions].sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code)), total: store.learningDiagnosticDimensions.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/learning-diagnostic/dimensions') {
      const admin = requireAdmin(req); const input = await body(req); const code = String(input.code ?? '').trim().toLowerCase(); const label = String(input.label ?? '').trim(); const description = String(input.description ?? '').trim() || undefined; const color = String(input.color ?? '').trim() || undefined; const sortOrder = Number(input.sortOrder ?? (store.learningDiagnosticDimensions.length + 1) * 10); if (!/^[a-z][a-z0-9_-]{1,79}$/.test(code) || label.length < 2 || label.length > 80 || description && description.length > 240 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999 || store.learningDiagnosticDimensions.some(item => item.code === code)) throw new HttpError(422, 'VALIDATION_ERROR', '画像维度信息不正确或编码已存在'); const now = new Date().toISOString(); const dimension: LearningDiagnosticDimensionDefinition = {code, label, ...(description ? {description} : {}), ...(color ? {color} : {}), sortOrder, status: 'active', createdAt: now, updatedAt: now}; await persistAdminMutation([{text: 'insert into learning_diagnostic_dimensions (code,label,description,color,sort_order,status,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$8)', values: [dimension.code, dimension.label, dimension.description ?? null, dimension.color ?? null, dimension.sortOrder, dimension.status, admin.adminId, now]}], [admin.adminId, 'learning_diagnostic.dimension.create', 'learning_diagnostic_dimension', dimension.code, '创建画像维度', requestId]); store.learningDiagnosticDimensions.push(dimension); return send(res, 201, dimension, requestId);
    }
    const adminDiagnosticDimension = path.match(/^\/v1\/admin\/learning-diagnostic\/dimensions\/([^/]+)$/);
    if (adminDiagnosticDimension && req.method === 'PATCH') { const admin = requireAdmin(req); const code = decodePathSegment(adminDiagnosticDimension[1]); const dimension = store.learningDiagnosticDimensions.find(item => item.code === code); if (!dimension) throw new HttpError(404, 'DIAGNOSTIC_DIMENSION_NOT_FOUND', '画像维度不存在'); const input = await body(req); const label = input.label === undefined ? dimension.label : String(input.label).trim(); const description = input.description === undefined ? dimension.description : String(input.description).trim() || undefined; const color = input.color === undefined ? dimension.color : String(input.color).trim() || undefined; const sortOrder = input.sortOrder === undefined ? dimension.sortOrder : Number(input.sortOrder); const status = input.status === undefined ? dimension.status : String(input.status); if (label.length < 2 || label.length > 80 || description && description.length > 240 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999 || !['active', 'disabled'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '画像维度信息不正确'); if (status === 'disabled' && store.learningDiagnosticQuestions.some(item => item.dimension === code && item.status === 'published')) throw new HttpError(409, 'DIAGNOSTIC_DIMENSION_IN_USE', '已发布题目正在使用该维度，请先调整题目'); const updatedAt = new Date().toISOString(); await persistAdminMutation([{text: 'update learning_diagnostic_dimensions set label=$1,description=$2,color=$3,sort_order=$4,status=$5,updated_by=$6,updated_at=$7 where code=$8', values: [label, description ?? null, color ?? null, sortOrder, status, admin.adminId, updatedAt, code]}], [admin.adminId, 'learning_diagnostic.dimension.edit', 'learning_diagnostic_dimension', code, '编辑画像维度', requestId]); Object.assign(dimension, {label, ...(description ? {description} : {}), ...(color ? {color} : {}), sortOrder, status, updatedAt}); return send(res, 200, dimension, requestId); }
    if (adminDiagnosticDimension && req.method === 'DELETE') { const admin = requireAdmin(req); const code = decodePathSegment(adminDiagnosticDimension[1]); const dimension = store.learningDiagnosticDimensions.find(item => item.code === code); if (!dimension) throw new HttpError(404, 'DIAGNOSTIC_DIMENSION_NOT_FOUND', '画像维度不存在'); if (store.learningDiagnosticQuestions.some(item => item.dimension === code)) throw new HttpError(409, 'DIAGNOSTIC_DIMENSION_IN_USE', '已有诊断题使用该维度，请停用维度或先调整题目'); await persistAdminMutation([{text: 'delete from learning_diagnostic_dimensions where code=$1', values: [code]}], [admin.adminId, 'learning_diagnostic.dimension.delete', 'learning_diagnostic_dimension', code, '删除画像维度', requestId]); store.learningDiagnosticDimensions = store.learningDiagnosticDimensions.filter(item => item.code !== code); return send(res, 200, {deleted: true, code}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/learning-diagnostic/questions') {
      requireAdmin(req); const status = url.searchParams.get('status'); const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();
      if (status && !['draft', 'published', 'disabled'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '诊断题状态不正确');
      const items = store.learningDiagnosticQuestions.filter(question => (!status || question.status === status) && (!keyword || question.stem.toLowerCase().includes(keyword))).sort((left, right) => left.sortOrder - right.sortOrder || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      const stats = {total: store.learningDiagnosticQuestions.length, draft: store.learningDiagnosticQuestions.filter(question => question.status === 'draft').length, published: store.learningDiagnosticQuestions.filter(question => question.status === 'published').length, disabled: store.learningDiagnosticQuestions.filter(question => question.status === 'disabled').length};
      return send(res, 200, {items, total: items.length, stats}, requestId);
    }
    if (req.method === 'POST' && path === '/v1/admin/learning-diagnostic/questions') {
      const admin = requireAdmin(req); const input = await body(req); const question = validateLearningDiagnosticQuestion(input);
      const statements: SqlStatement[] = [{text: 'insert into learning_diagnostic_questions (id, form_id, stem, description, section, placeholder, validation, question_type, dimension, required, sort_order, status, version, created_by, updated_by, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$14,$15,$15)', values: [question.id, question.formId, question.stem, question.description ?? null, question.section ?? null, question.placeholder ?? null, JSON.stringify(question.validation ?? {}), question.type, question.dimension, question.required, question.sortOrder, question.status, question.version, admin.adminId, question.createdAt]}];
      for (const option of question.options) statements.push({text: 'insert into learning_diagnostic_options (id, question_id, label, score, sort_order) values ($1,$2,$3,$4,$5)', values: [option.id, question.id, option.label, option.score, option.sortOrder]});
      await persistAdminMutation(statements, [admin.adminId, 'learning_diagnostic.create', 'learning_diagnostic_question', question.id, '创建首次学习诊断题', requestId]);
      store.learningDiagnosticQuestions.push(question);
      return send(res, 201, question, requestId);
    }
    const adminDiagnosticQuestion = path.match(/^\/v1\/admin\/learning-diagnostic\/questions\/([^/]+)$/);
    if (adminDiagnosticQuestion && req.method === 'PATCH') {
      const admin = requireAdmin(req); const question = store.learningDiagnosticQuestions.find(item => item.id === decodePathSegment(adminDiagnosticQuestion[1])); if (!question) throw new HttpError(404, 'DIAGNOSTIC_QUESTION_NOT_FOUND', '诊断题不存在');
      const input = await body(req); const updated = validateLearningDiagnosticQuestion(input, question); updated.version = question.version + 1; updated.status = 'draft'; delete updated.publishedAt;
      const statements: SqlStatement[] = [
        {text: 'update learning_diagnostic_questions set form_id=$1, stem=$2, description=$3, section=$4, placeholder=$5, validation=$6::jsonb, question_type=$7, dimension=$8, required=$9, sort_order=$10, status=$11, version=$12, updated_by=$13, updated_at=$14, published_at=null where id=$15', values: [updated.formId, updated.stem, updated.description ?? null, updated.section ?? null, updated.placeholder ?? null, JSON.stringify(updated.validation ?? {}), updated.type, updated.dimension, updated.required, updated.sortOrder, updated.status, updated.version, admin.adminId, updated.updatedAt, updated.id]},
        {text: 'delete from learning_diagnostic_options where question_id = $1', values: [updated.id]},
      ];
      for (const option of updated.options) statements.push({text: 'insert into learning_diagnostic_options (id, question_id, label, score, sort_order) values ($1,$2,$3,$4,$5)', values: [option.id, updated.id, option.label, option.score, option.sortOrder]});
      await persistAdminMutation(statements, [admin.adminId, 'learning_diagnostic.edit', 'learning_diagnostic_question', updated.id, question.status === 'published' ? '编辑已发布题目并转为草稿' : '编辑诊断题', requestId]);
      Object.assign(question, updated);
      return send(res, 200, question, requestId);
    }
    if (adminDiagnosticQuestion && req.method === 'DELETE') {
      const admin = requireAdmin(req); const question = store.learningDiagnosticQuestions.find(item => item.id === decodePathSegment(adminDiagnosticQuestion[1])); if (!question) throw new HttpError(404, 'DIAGNOSTIC_QUESTION_NOT_FOUND', '诊断题不存在'); if (question.status !== 'draft') throw new HttpError(409, 'DIAGNOSTIC_QUESTION_DELETE_FORBIDDEN', '只有草稿诊断题可以删除，已发布题目请先停用并保留历史');
      await persistAdminMutation([{text: 'delete from learning_diagnostic_questions where id = $1 and status = $2', values: [question.id, 'draft']}], [admin.adminId, 'learning_diagnostic.delete', 'learning_diagnostic_question', question.id, '删除草稿诊断题', requestId]);
      store.learningDiagnosticQuestions = store.learningDiagnosticQuestions.filter(item => item.id !== question.id);
      return send(res, 200, {deleted: true, id: question.id}, requestId);
    }
    const adminDiagnosticPublish = path.match(/^\/v1\/admin\/learning-diagnostic\/questions\/([^/]+)\/publish$/);
    if (adminDiagnosticPublish && req.method === 'POST') {
      const admin = requireAdmin(req); const question = store.learningDiagnosticQuestions.find(item => item.id === decodePathSegment(adminDiagnosticPublish[1])); if (!question) throw new HttpError(404, 'DIAGNOSTIC_QUESTION_NOT_FOUND', '诊断题不存在'); if (question.status === 'published') return send(res, 200, question, requestId); assertPublishableLearningDiagnosticQuestion(question);
      const publishedAt = new Date().toISOString(); const version = question.status === 'disabled' ? question.version + 1 : question.version;
      await persistAdminMutation([{text: 'update learning_diagnostic_questions set status=$1, version=$2, published_at=$3, updated_by=$4, updated_at=$3 where id=$5', values: ['published', version, publishedAt, admin.adminId, question.id]}], [admin.adminId, 'learning_diagnostic.publish', 'learning_diagnostic_question', question.id, '发布首次学习诊断题', requestId]);
      question.status = 'published'; question.version = version; question.publishedAt = publishedAt; question.updatedAt = publishedAt;
      return send(res, 200, question, requestId);
    }
    const adminDiagnosticDisable = path.match(/^\/v1\/admin\/learning-diagnostic\/questions\/([^/]+)\/disable$/);
    if (adminDiagnosticDisable && req.method === 'POST') {
      const admin = requireAdmin(req); const question = store.learningDiagnosticQuestions.find(item => item.id === decodePathSegment(adminDiagnosticDisable[1])); if (!question) throw new HttpError(404, 'DIAGNOSTIC_QUESTION_NOT_FOUND', '诊断题不存在'); if (question.status !== 'published') throw new HttpError(409, 'DIAGNOSTIC_QUESTION_NOT_PUBLISHED', '只有已发布的诊断题可以停用');
      const input = await body(req); const reason = String(input.reason ?? '').trim(); if (reason.length < 2 || reason.length > 300) throw new HttpError(422, 'VALIDATION_ERROR', '请填写 2 到 300 个字的停用原因'); const updatedAt = new Date().toISOString();
      await persistAdminMutation([{text: 'update learning_diagnostic_questions set status=$1, updated_by=$2, updated_at=$3 where id=$4', values: ['disabled', admin.adminId, updatedAt, question.id]}], [admin.adminId, 'learning_diagnostic.disable', 'learning_diagnostic_question', question.id, reason, requestId]);
      question.status = 'disabled'; question.updatedAt = updatedAt;
      return send(res, 200, question, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/products') { requireAdmin(req); return send(res, 200, {items: store.products.map(product => ({...product, status: product.status ?? 'on_sale'})), total: store.products.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/products') { const admin = requireAdmin(req); const input = await body(req); const name = String(input.name ?? '').trim(); const category = String(input.category ?? '').trim(); const price = Number(input.price); const originalPrice = Number(input.originalPrice ?? price); if (name.length < 2 || !category || !Number.isFinite(price) || price < 0 || !Number.isFinite(originalPrice) || originalPrice < price) throw new HttpError(422, 'VALIDATION_ERROR', '商品信息不完整'); const product = {id: `p-${randomUUID()}`, name, category, price, originalPrice, sold: 0, accent: '#4C4BEA', benefits: Array.isArray(input.benefits) ? input.benefits.map(String) : [], status: 'draft' as const, updatedAt: new Date().toISOString()}; store.products.unshift(product); await persist('insert into products (id, name, category, price, original_price, sold, accent, benefits, status, updated_at) values ($1, $2, $3, $4, $5, 0, $6, $7::jsonb, $8, $9)', [product.id, product.name, product.category, product.price, product.originalPrice, product.accent, JSON.stringify(product.benefits), product.status, product.updatedAt]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'product.create', 'product', product.id, requestId]); return send(res, 201, product, requestId); }
    const adminPriceHistoryMatch = path.match(/^\/v1\/admin\/products\/([^/]+)\/price-history$/); if (adminPriceHistoryMatch && req.method === 'GET') { requireAdmin(req, 'products.read'); const productId = decodePathSegment(adminPriceHistoryMatch[1]); productFor(productId); const items = adminProductPriceHistory.filter(item => item.productId === productId); return send(res, 200, {items, total: items.length}, requestId); }
    const adminProductEditV2 = path.match(/^\/v1\/admin\/products\/([^/]+)$/); if (adminProductEditV2 && req.method === 'PATCH') {
      const admin = requireAdmin(req, 'products.write'); const product = store.products.find(item => item.id === decodePathSegment(adminProductEditV2[1])); if (!product) throw new HttpError(404, 'NOT_FOUND', '商品不存在'); const input = await body(req);
      if (input.updatedAt !== undefined && input.updatedAt !== product.updatedAt) throw new HttpError(409, 'STALE_VERSION', '商品已被其他管理员更新，请刷新后重试');
      const nextName = input.name === undefined ? product.name : String(input.name).trim(); const nextCategory = input.category === undefined ? product.category : String(input.category).trim(); const nextPrice = input.price === undefined ? product.price : Number(input.price);
      // When a product has no discount (original price equals the previous sale
      // price), a price-only update should keep the invariant originalPrice >=
      // price without forcing clients to send a redundant originalPrice field.
      // An explicitly supplied originalPrice is always validated as-is below.
      const nextOriginalPrice = input.originalPrice === undefined && product.originalPrice < nextPrice ? nextPrice : (input.originalPrice === undefined ? product.originalPrice : Number(input.originalPrice)); const nextStatus = input.status === undefined ? (product.status ?? 'on_sale') : String(input.status); const nextBenefits = input.benefits === undefined ? product.benefits : Array.isArray(input.benefits) ? input.benefits.map(String) : [];
      if (nextName.length < 2 || !nextCategory || !['draft', 'on_sale', 'off_sale', 'archived'].includes(nextStatus) || !Number.isFinite(nextPrice) || nextPrice < 0 || !Number.isFinite(nextOriginalPrice) || nextOriginalPrice < nextPrice) throw new HttpError(422, 'VALIDATION_ERROR', '商品信息或价格不正确');
      const previousPrice = product.price; const priceChanged = previousPrice !== nextPrice; const reason = String(input.priceReason ?? '').trim(); if (priceChanged && reason.length < 4) throw new HttpError(422, 'PRICE_REASON_REQUIRED', '修改价格必须填写至少 4 个字的原因');
      const updatedAt = new Date().toISOString(); const history = priceChanged ? {id: randomUUID(), productId: product.id, price: nextPrice, reason, createdBy: admin.adminId, createdAt: updatedAt} : undefined;
      if (history) await persist('insert into product_price_history (id, product_id, price, reason, created_by, created_at) values ($1, $2, $3, $4, $5, $6)', [history.id, history.productId, history.price, history.reason, history.createdBy, history.createdAt]);
      await persist('update products set name = $1, category = $2, price = $3, original_price = $4, benefits = $5::jsonb, status = $6, updated_at = $7 where id = $8', [nextName, nextCategory, nextPrice, nextOriginalPrice, JSON.stringify(nextBenefits), nextStatus, updatedAt, product.id]);
      product.name = nextName; product.category = nextCategory; product.price = nextPrice; product.originalPrice = nextOriginalPrice; product.status = nextStatus as Product['status']; product.benefits = nextBenefits; product.updatedAt = updatedAt; if (history) adminProductPriceHistory.unshift(history);
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'product.edit', 'product', product.id, priceChanged ? reason : 'product update', requestId]); return send(res, 200, product, requestId);
    }
    const adminProductEdit = path.match(/^\/v1\/admin\/products\/([^/]+)$/); if (adminProductEdit && req.method === 'PATCH') { const admin = requireAdmin(req); const product = store.products.find(item => item.id === adminProductEdit[1]); if (!product) throw new HttpError(404, 'NOT_FOUND', '商品不存在'); const input = await body(req); const price = input.price === undefined ? product.price : Number(input.price); const originalPrice = input.originalPrice === undefined ? product.originalPrice : Number(input.originalPrice); const requestedStatus = input.status === undefined ? (product.status ?? 'on_sale') : String(input.status); if (!['draft', 'on_sale', 'off_sale', 'archived'].includes(requestedStatus)) throw new HttpError(422, 'VALIDATION_ERROR', '商品状态不正确'); if (input.updatedAt !== undefined && input.updatedAt !== product.updatedAt) throw new HttpError(409, 'STALE_VERSION', '商品已被其他管理员更新，请刷新后重试'); if (!Number.isFinite(price) || price < 0 || !Number.isFinite(originalPrice) || originalPrice < price) throw new HttpError(422, 'VALIDATION_ERROR', '价格不正确'); const previousPrice = product.price; product.name = input.name === undefined ? product.name : String(input.name).trim(); product.category = input.category === undefined ? product.category : String(input.category).trim(); product.price = price; product.originalPrice = originalPrice; product.status = requestedStatus as Product['status']; product.benefits = input.benefits === undefined ? product.benefits : Array.isArray(input.benefits) ? input.benefits.map(String) : []; product.updatedAt = new Date().toISOString(); if (previousPrice !== price) { const reason = String(input.priceReason ?? '').trim(); if (reason.length < 4) throw new HttpError(422, 'PRICE_REASON_REQUIRED', '修改价格必须填写至少 4 个字的原因'); await persist('insert into product_price_history (product_id, price, reason, created_by) values ($1, $2, $3, $4)', [product.id, price, reason, admin.adminId]); } await persist('update products set name = $1, category = $2, price = $3, original_price = $4, benefits = $5::jsonb, status = $6, updated_at = $7 where id = $8', [product.name, product.category, product.price, product.originalPrice, JSON.stringify(product.benefits), product.status, product.updatedAt, product.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'product.edit', 'product', product.id, requestId]); return send(res, 200, product, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/products/skus') { requireAdmin(req); const productId = url.searchParams.get('productId'); const items = store.productSkus.filter(item => !productId || item.productId === productId); return send(res, 200, {items, total: items.length}, requestId); }
    const adminSkuCreate = path.match(/^\/v1\/admin\/products\/([^/]+)\/skus$/);
    if (adminSkuCreate && req.method === 'POST') { const admin = requireAdmin(req); const product = store.products.find(item => item.id === adminSkuCreate[1]); if (!product) throw new HttpError(404, 'NOT_FOUND', '商品不存在'); const input = await body(req); const name = String(input.name ?? '').trim(); const price = Number(input.price ?? product.price); const stock = Number(input.stock ?? 0); if (!name || name.length > 160 || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) throw new HttpError(422, 'VALIDATION_ERROR', 'SKU 信息不正确'); const sku: ProductSku = {id: `sku-${randomUUID()}`, productId: product.id, name, price, stock, status: input.status === 'disabled' ? 'disabled' : 'active', attributes: input.attributes && typeof input.attributes === 'object' ? Object.fromEntries(Object.entries(input.attributes as Record<string, unknown>).map(([key, value]) => [key, String(value)])) : {}, updatedAt: new Date().toISOString()}; store.productSkus.unshift(sku); product.skus = [sku, ...(product.skus ?? [])]; await persist('insert into product_skus (id, product_id, name, price, stock, status, attributes, updated_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)', [sku.id, sku.productId, sku.name, sku.price, sku.stock, sku.status, JSON.stringify(sku.attributes), sku.updatedAt]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1,$2,$3,$4,$5)', [admin.adminId, 'product.sku.create', 'product_sku', sku.id, requestId]); return send(res, 201, sku, requestId); }
    const adminSkuEdit = path.match(/^\/v1\/admin\/products\/([^/]+)\/skus\/([^/]+)$/);
    if (adminSkuEdit && req.method === 'PATCH') { const admin = requireAdmin(req); const sku = store.productSkus.find(item => item.id === adminSkuEdit[2] && item.productId === adminSkuEdit[1]); if (!sku) throw new HttpError(404, 'SKU_NOT_FOUND', 'SKU 不存在'); const input = await body(req); const price = input.price === undefined ? sku.price : Number(input.price); const stock = input.stock === undefined ? sku.stock : Number(input.stock); if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) throw new HttpError(422, 'VALIDATION_ERROR', 'SKU 价格或库存不正确'); sku.name = input.name === undefined ? sku.name : String(input.name).trim(); sku.price = price; sku.stock = stock; sku.status = input.status === undefined ? sku.status : String(input.status) as ProductSku['status']; if (!['active', 'disabled'].includes(sku.status) || !sku.name) throw new HttpError(422, 'VALIDATION_ERROR', 'SKU 状态或名称不正确'); sku.attributes = input.attributes === undefined ? sku.attributes : (input.attributes && typeof input.attributes === 'object' ? Object.fromEntries(Object.entries(input.attributes as Record<string, unknown>).map(([key, value]) => [key, String(value)])) : {}); sku.updatedAt = new Date().toISOString(); const product = store.products.find(item => item.id === sku.productId); if (product) product.skus = (product.skus ?? []).map(item => item.id === sku.id ? sku : item); await persist('update product_skus set name = $1, price = $2, stock = $3, status = $4, attributes = $5::jsonb, updated_at = $6 where id = $7 and product_id = $8', [sku.name, sku.price, sku.stock, sku.status, JSON.stringify(sku.attributes), sku.updatedAt, sku.id, sku.productId]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1,$2,$3,$4,$5)', [admin.adminId, 'product.sku.edit', 'product_sku', sku.id, requestId]); return send(res, 200, sku, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/coupons') { requireAdmin(req); return send(res, 200, {items: store.coupons, total: store.coupons.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/coupons') { const admin = requireAdmin(req); const input = await body(req); const code = String(input.code ?? '').trim().toUpperCase(); const type = String(input.type ?? input.discountType ?? 'amount'); const value = Number(input.value ?? input.discountValue); const minAmount = Number(input.minAmount ?? 0); const startsAt = String(input.startsAt ?? new Date().toISOString()); const endsAt = String(input.endsAt ?? '2099-01-01T00:00:00.000Z'); if (!/^[A-Z0-9_-]{3,80}$/.test(code) || !['amount', 'percentage'].includes(type) || !Number.isFinite(value) || value <= 0 || (type === 'percentage' && value > 100) || !Number.isFinite(minAmount) || minAmount < 0 || !Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt) || store.coupons.some(item => item.code === code)) throw new HttpError(422, 'VALIDATION_ERROR', '优惠券信息不正确'); const coupon: Coupon = {code, type: type as Coupon['type'], value, minAmount, maxDiscount: input.maxDiscount === undefined ? undefined : Number(input.maxDiscount), startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), usageLimit: input.usageLimit === undefined ? undefined : Number(input.usageLimit), usedCount: 0, status: 'active'}; if (coupon.maxDiscount !== undefined && (!Number.isFinite(coupon.maxDiscount) || coupon.maxDiscount < 0) || coupon.usageLimit !== undefined && (!Number.isSafeInteger(coupon.usageLimit) || coupon.usageLimit < 1)) throw new HttpError(422, 'VALIDATION_ERROR', '优惠券上限不正确'); store.coupons.unshift(coupon); await persist('insert into coupons (code, discount_type, discount_value, min_amount, max_discount, starts_at, ends_at, usage_limit, used_count, status) values ($1,$2,$3,$4,$5,$6,$7,$8,0,$9)', [coupon.code, coupon.type, coupon.value, coupon.minAmount, coupon.maxDiscount ?? null, coupon.startsAt, coupon.endsAt, coupon.usageLimit ?? null, coupon.status]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1,$2,$3,$4,$5)', [admin.adminId, 'coupon.create', 'coupon', coupon.code, requestId]); return send(res, 201, coupon, requestId); }
    const adminCouponEdit = path.match(/^\/v1\/admin\/coupons\/([^/]+)$/);
    if (adminCouponEdit && req.method === 'PATCH') { const admin = requireAdmin(req); const code = decodeURIComponent(adminCouponEdit[1]).toUpperCase(); const coupon = store.coupons.find(item => item.code === code); if (!coupon) throw new HttpError(404, 'COUPON_NOT_FOUND', '优惠券不存在'); const input = await body(req); if (input.status !== undefined) { const status = String(input.status); if (!['active', 'disabled'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '优惠券状态不正确'); coupon.status = status as Coupon['status']; } if (input.endsAt !== undefined) { const endsAt = Date.parse(String(input.endsAt)); if (!Number.isFinite(endsAt) || endsAt <= Date.parse(coupon.startsAt)) throw new HttpError(422, 'VALIDATION_ERROR', '优惠券结束时间不正确'); coupon.endsAt = new Date(endsAt).toISOString(); } if (input.usageLimit !== undefined) { const limit = Number(input.usageLimit); if (!Number.isSafeInteger(limit) || limit < coupon.usedCount) throw new HttpError(422, 'VALIDATION_ERROR', '优惠券使用上限不正确'); coupon.usageLimit = limit; } await persist('update coupons set status = $1, ends_at = $2, usage_limit = $3 where code = $4', [coupon.status, coupon.endsAt, coupon.usageLimit ?? null, coupon.code]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1,$2,$3,$4,$5)', [admin.adminId, 'coupon.edit', 'coupon', coupon.code, requestId]); return send(res, 200, coupon, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/orders') { requireAdmin(req); return send(res, 200, {items: store.orders, total: store.orders.length}, requestId); }
    const adminOrderDetail = path.match(/^\/v1\/admin\/orders\/([^/]+)$/); if (adminOrderDetail && req.method === 'GET') { requireAdmin(req); const order = store.orders.find(item => item.id === adminOrderDetail[1]); if (!order) throw new HttpError(404, 'NOT_FOUND', '订单不存在'); return send(res, 200, {...order, timeline: store.orderEvents.filter(item => item.orderId === order.id).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), payment: {provider: paymentAdapter.name, status: order.status === 'paid' ? 'paid' : order.status}, refunds: store.refunds.filter(item => item.orderId === order.id).map(publicRefund)}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/refunds') { requireAdmin(req); const items = store.refunds.map(publicRefund); return send(res, 200, {items, total: items.length}, requestId); }
    const refundReviewMatch = path.match(/^\/v1\/admin\/refunds\/([^/]+)\/review$/); if (refundReviewMatch && req.method === 'POST') return await reviewAdminRefund(req, res, refundReviewMatch[1], requestId);
    const refundApproveV2 = path.match(/^\/v1\/admin\/refunds\/([^/]+)\/approve$/); if (refundApproveV2 && req.method === 'POST') return await approveAdminRefund(req, res, refundApproveV2[1], requestId);
    const refundRejectV2 = path.match(/^\/v1\/admin\/refunds\/([^/]+)\/reject$/); if (refundRejectV2 && req.method === 'POST') return await rejectAdminRefund(req, res, refundRejectV2[1], requestId);
    if (req.method === 'GET' && path === '/v1/admin/entitlements') { requireAdmin(req); return send(res, 200, {items: store.entitlements, total: store.entitlements.length}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/community/posts') { requireAdmin(req); return send(res, 200, {items: store.forumPosts, total: store.forumPosts.length}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/community/comments') { requireAdmin(req); return send(res, 200, {items: store.forumComments, total: store.forumComments.length}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/community/rules') { requireAdmin(req); return send(res, 200, {items: adminCommunityRules, total: adminCommunityRules.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/community/rules') { const admin = requireAdmin(req); const input = await body(req); const name = String(input.name ?? '').trim(); const action = String(input.action ?? 'review_and_restrict'); const keywords = Array.isArray(input.keywords) ? input.keywords.map(String).map(item => item.trim()).filter(Boolean) : []; if (name.length < 2 || !['review_and_restrict', 'block', 'warn'].includes(action)) throw new HttpError(422, 'VALIDATION_ERROR', '规则字段不正确'); const rule = {id: `rule-${randomUUID()}`, name, status: 'active', action, keywords, updatedAt: new Date().toISOString()}; adminCommunityRules.unshift(rule); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'community.rule.create', 'community_rule', rule.id, requestId]); return send(res, 201, rule, requestId); }
    const adminRuleEdit = path.match(/^\/v1\/admin\/community\/rules\/([^/]+)$/); if (adminRuleEdit && req.method === 'PATCH') { const admin = requireAdmin(req); const rule = adminCommunityRules.find(item => item.id === adminRuleEdit[1]); if (!rule) throw new HttpError(404, 'NOT_FOUND', '规则不存在'); const input = await body(req); if (input.name !== undefined) rule.name = String(input.name).trim(); if (input.action !== undefined) rule.action = String(input.action); if (input.keywords !== undefined) rule.keywords = Array.isArray(input.keywords) ? input.keywords.map(String).map(item => item.trim()).filter(Boolean) : []; if (typeof rule.name !== 'string' || rule.name.length < 2 || !['review_and_restrict', 'block', 'warn'].includes(String(rule.action))) throw new HttpError(422, 'VALIDATION_ERROR', '规则字段不正确'); rule.updatedAt = new Date().toISOString(); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'community.rule.edit', 'community_rule', rule.id, requestId]); return send(res, 200, rule, requestId); }
    const hidePost = path.match(/^\/v1\/admin\/community\/posts\/([^/]+)\/hide$/); if (hidePost && req.method === 'POST') { const admin = requireAdmin(req, 'community.moderate'); const post = store.forumPosts.find(item => item.id === decodePathSegment(hidePost[1])); if (!post) throw new HttpError(404, 'NOT_FOUND', '帖子不存在'); const input = await body(req); const reason = String(input.reason ?? '').trim(); if (reason.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '隐藏原因不能为空'); const now = new Date().toISOString(); post.deletedAt = now; post.updatedAt = now; const action: Store['communityModerationActions'][number] = {id: randomUUID(), targetType: 'post', targetId: post.id, action: 'hide', reason, createdBy: admin.adminId, createdAt: now}; store.communityModerationActions.unshift(action); await persist('update forum_posts set deleted_at = $1, updated_at = $1 where id = $2 and deleted_at is null', [now, post.id]); await persist('insert into community_moderation_actions (id, target_type, target_id, action, reason, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7)', [action.id, action.targetType, action.targetId, action.action, action.reason, admin.adminId, now]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'community.post.hide', 'forum_post', post.id, reason, requestId]); return send(res, 200, {id: post.id, status: 'hidden', moderationAction: action}, requestId); }
    const hideComment = path.match(/^\/v1\/admin\/community\/comments\/([^/]+)\/hide$/); if (hideComment && req.method === 'POST') { const admin = requireAdmin(req, 'community.moderate'); const comment = store.forumComments.find(item => item.id === decodePathSegment(hideComment[1]) && !item.deletedAt); if (!comment) throw new HttpError(404, 'NOT_FOUND', '评论不存在'); const input = await body(req); const reason = String(input.reason ?? '').trim(); if (reason.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '隐藏原因不能为空'); const now = new Date().toISOString(); comment.deletedAt = now; const action: Store['communityModerationActions'][number] = {id: randomUUID(), targetType: 'comment', targetId: comment.id, action: 'hide', reason, createdBy: admin.adminId, createdAt: now}; store.communityModerationActions.unshift(action); await persist('update forum_comments set deleted_at = $1 where id = $2 and deleted_at is null', [now, comment.id]); await persist('insert into community_moderation_actions (id, target_type, target_id, action, reason, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7)', [action.id, action.targetType, action.targetId, action.action, action.reason, admin.adminId, now]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'community.comment.hide', 'forum_comment', comment.id, reason, requestId]); return send(res, 200, {id: comment.id, status: 'hidden', moderationAction: action}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/community/reports') { requireAdmin(req); return send(res, 200, {items: store.communityReports, total: store.communityReports.length}, requestId); }
    const resolveReport = path.match(/^\/v1\/admin\/community\/reports\/([^/]+)\/resolve$/); if (resolveReport && req.method === 'POST') {
      const admin = requireAdmin(req, 'community.reports.resolve');
      const report = store.communityReports.find(item => item.id === decodePathSegment(resolveReport[1]));
      if (!report) throw new HttpError(404, 'NOT_FOUND', '举报不存在');
      if (report.status === 'resolved' || report.status === 'rejected') return send(res, 200, report, requestId);
      const input = await body(req);
      const resolution = String(input.resolution ?? '').trim();
      if (resolution.length < 2 || resolution.length > 2000) throw new HttpError(422, 'VALIDATION_ERROR', '处理结论长度必须为 2 到 2000 个字符');
      // Validate and apply the action before changing the report state.  This
      // keeps malformed moderation requests from leaving a report marked as
      // resolved while the target remains untouched.
      const moderationAction = await applyCommunityModeration(report, {...input, resolution}, admin.adminId, requestId);
      const now = new Date().toISOString();
      report.status = input.status === 'rejected' && moderationAction.action === 'none' ? 'rejected' : 'resolved';
      report.resolution = resolution;
      report.resolvedAt = now;
      await persist('update community_reports set status = $1, resolution = $2, reviewed_by = $3, resolved_at = $4 where id = $5', [report.status, resolution, admin.adminId, now, report.id]);
      return send(res, 200, {...report, moderationAction}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/community/moderation-actions') {
      requireAdmin(req, 'community.read');
      const targetType = url.searchParams.get('targetType');
      const targetId = url.searchParams.get('targetId');
      const items = store.communityModerationActions.filter(item => (!targetType || item.targetType === targetType) && (!targetId || item.targetId === targetId));
      return send(res, 200, {items, total: items.length}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/announcements/stats') {
      requireAdmin(req);
      const items = store.announcements.map(adminAnnouncement);
      const counts = {draft: 0, scheduled: 0, published: 0, expired: 0, withdrawn: 0};
      let reads = 0;
      let audience = 0;
      for (const item of items) {
        counts[item.status] += 1;
        reads += item.readCount;
        audience += item.audienceCount;
      }
      return send(res, 200, {
        total: items.length,
        ...counts,
        reads,
        audience,
        readRate: audience > 0 ? Math.round((reads / audience) * 10000) / 100 : 0,
      }, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/announcements') {
      requireAdmin(req);
      const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();
      const requestedStatus = url.searchParams.get('status');
      const audienceType = url.searchParams.get('audienceType');
      const pinnedFilter = url.searchParams.get('isPinned');
      if (requestedStatus && !['draft', 'scheduled', 'published', 'expired', 'withdrawn'].includes(requestedStatus)) throw new HttpError(422, 'VALIDATION_ERROR', '公告状态不正确');
      if (audienceType && !['all', 'exam_year'].includes(audienceType)) throw new HttpError(422, 'VALIDATION_ERROR', '公告受众类型不正确');
      if (pinnedFilter && !['true', 'false'].includes(pinnedFilter)) throw new HttpError(422, 'VALIDATION_ERROR', '置顶筛选条件不正确');
      const all = [...store.announcements].map(adminAnnouncement).filter(item =>
        (!requestedStatus || item.status === requestedStatus) &&
        (!audienceType || item.audienceType === audienceType) &&
        (!pinnedFilter || item.isPinned === (pinnedFilter === 'true')) &&
        (!keyword || `${item.title}\n${item.body}`.toLowerCase().includes(keyword)),
      ).sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt) - Date.parse(left.updatedAt ?? left.createdAt));
      const pageSize = parsePositiveInteger(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'), 20, 1, 100, 'limit');
      const page = parsePositiveInteger(url.searchParams.get('page'), 1, 1, 1_000_000, 'page');
      const cursor = parsePositiveInteger(url.searchParams.get('cursor'), (page - 1) * pageSize, 0, 1_000_000, 'cursor');
      if (!['cursor', 'limit', 'page', 'pageSize'].some(key => url.searchParams.has(key))) return send(res, 200, {items: all, total: all.length, page: 1, pageSize: all.length}, requestId);
      return send(res, 200, {items: all.slice(cursor, cursor + pageSize), total: all.length, page: Math.floor(cursor / pageSize) + 1, pageSize, ...(cursor + pageSize < all.length ? {nextCursor: String(cursor + pageSize)} : {})}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/banners') { requireAdmin(req); return send(res, 200, {items: store.banners, total: store.banners.length}, requestId); }
    const adminBannerEditV2 = path.match(/^\/v1\/admin\/banners\/([^/]+)$/);
    if (req.method === 'POST' && path === '/v1/admin/banners') {
      const admin = requireAdmin(req); const input = await body(req);
      const title = String(input.title ?? '').trim(); const imageUrl = String(input.imageUrl ?? '').trim(); const target = String(input.target ?? '').trim();
      const startsAt = String(input.startsAt ?? ''); const endsAtValue = typeof input.endsAt === 'string' && input.endsAt.trim() ? input.endsAt.trim() : undefined;
      const position = String(input.position ?? 'home-primary').trim(); const sortOrder = Number(input.sortOrder ?? 0); const requiresLogin = input.requiresLogin === true;
      if (title.length < 2 || !(imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:image/')) || !target || !startsAt || Number.isNaN(Date.parse(startsAt)) || (endsAtValue && Number.isNaN(Date.parse(endsAtValue))) || !Number.isInteger(sortOrder) || sortOrder < 0 || !position) throw new HttpError(422, 'VALIDATION_ERROR', 'Banner 信息不正确');
      const banner = {id: 'banner-' + randomUUID(), title, imageUrl, target, startsAt: new Date(startsAt).toISOString(), endsAt: endsAtValue ? new Date(endsAtValue).toISOString() : undefined, position, sortOrder, requiresLogin};
      store.banners.unshift(banner);
      await persist('insert into banners (id, title, image_url, target, starts_at, ends_at, position, sort_order, requires_login) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [banner.id, title, imageUrl, target, banner.startsAt, banner.endsAt ?? null, position, sortOrder, requiresLogin]);
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'banner.create', 'banner', banner.id, requestId]);
      return send(res, 201, banner, requestId);
    }
    if (adminBannerEditV2 && req.method === 'PATCH') {
      const admin = requireAdmin(req); const banner = store.banners.find(item => item.id === adminBannerEditV2[1]); if (!banner) throw new HttpError(404, 'NOT_FOUND', 'Banner 不存在');
      const input = await body(req); const title = input.title === undefined ? banner.title : String(input.title).trim(); const imageUrl = input.imageUrl === undefined ? banner.imageUrl : String(input.imageUrl).trim(); const target = input.target === undefined ? banner.target : String(input.target).trim();
      const startsAt = input.startsAt === undefined ? banner.startsAt : String(input.startsAt); const endsAtValue = input.endsAt === undefined ? banner.endsAt : (String(input.endsAt).trim() || undefined); const position = input.position === undefined ? (banner.position ?? 'home-primary') : String(input.position).trim(); const sortOrder = input.sortOrder === undefined ? (banner.sortOrder ?? 0) : Number(input.sortOrder); const requiresLogin = input.requiresLogin === undefined ? (banner.requiresLogin ?? false) : input.requiresLogin === true;
      if (title.length < 2 || !(imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:image/')) || !target || !startsAt || Number.isNaN(Date.parse(startsAt)) || (endsAtValue && Number.isNaN(Date.parse(String(endsAtValue)))) || !Number.isInteger(sortOrder) || sortOrder < 0 || !position) throw new HttpError(422, 'VALIDATION_ERROR', 'Banner 信息不正确');
      Object.assign(banner, {title, imageUrl, target, startsAt: new Date(startsAt).toISOString(), endsAt: endsAtValue ? new Date(String(endsAtValue)).toISOString() : undefined, position, sortOrder, requiresLogin});
      await persist('update banners set title = $1, image_url = $2, target = $3, starts_at = $4, ends_at = $5, position = $6, sort_order = $7, requires_login = $8 where id = $9', [title, imageUrl, target, banner.startsAt, banner.endsAt ?? null, position, sortOrder, requiresLogin, banner.id]);
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'banner.edit', 'banner', banner.id, requestId]);
      return send(res, 200, banner, requestId);
    }
    if (adminBannerEditV2 && req.method === 'DELETE') {
      const admin = requireAdmin(req); const index = store.banners.findIndex(item => item.id === adminBannerEditV2[1]); if (index < 0) throw new HttpError(404, 'NOT_FOUND', 'Banner 不存在');
      const [banner] = store.banners.splice(index, 1); await persist('delete from banners where id = $1', [banner.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, request_id) values ($1, $2, $3, $4, $5)', [admin.adminId, 'banner.delete', 'banner', banner.id, requestId]); return send(res, 200, {deleted: true}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/templates') { requireAdmin(req); const items = adminPushJobs.filter(item => item.resourceType === 'template'); return send(res, 200, {items, total: items.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/templates') {
      const admin = requireAdmin(req); const input = await body(req); const code = String(input.code ?? '').trim(); const channel = String(input.channel ?? '').trim(); const titleTemplate = String(input.titleTemplate ?? '').trim(); const bodyTemplate = String(input.bodyTemplate ?? '').trim();
      if (!/^[a-z0-9_.-]{3,120}$/.test(code) || !['in_app', 'sms', 'push', 'wechat'].includes(channel) || !titleTemplate || !bodyTemplate) throw new HttpError(422, 'VALIDATION_ERROR', '模板字段不正确');
      const variables = [...titleTemplate.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g), ...bodyTemplate.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)].map(match => match[1]);
      if (variables.some(variable => !['name', 'userId', 'examYear'].includes(variable))) throw new HttpError(422, 'TEMPLATE_VARIABLE_UNSUPPORTED', '模板包含未声明的变量，仅支持 name、userId、examYear');
      if (adminPushJobs.some(item => item.resourceType === 'template' && item.code === code)) throw new HttpError(409, 'TEMPLATE_EXISTS', '模板编码已存在');
      const template = {id: randomUUID(), resourceType: 'template', code, channel, titleTemplate, bodyTemplate, status: 'draft', updatedAt: new Date().toISOString(), updatedBy: admin.adminId}; adminPushJobs.unshift(template);
      await persist('insert into notification_templates (id, code, channel, title_template, body_template, status, updated_by) values ($1, $2, $3, $4, $5, $6, $7)', [template.id, code, channel, titleTemplate, bodyTemplate, template.status, admin.adminId]); return send(res, 201, template, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/push-jobs') { requireAdmin(req); const items = adminPushJobs.filter(item => item.resourceType !== 'template').map(pushJobRecord).map(publicPushJob); return send(res, 200, {items, total: items.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/push-jobs') {
      const admin = requireAdmin(req); const input = await body(req); const templateId = decodePathSegment(String(input.templateId ?? '')); const audience = input.audience && typeof input.audience === 'object' && !Array.isArray(input.audience) ? input.audience as Record<string, unknown> : {};
      if (!templateId || !adminPushJobs.some(item => item.id === templateId && item.resourceType === 'template')) throw new HttpError(422, 'VALIDATION_ERROR', '模板不存在');
      for (const userId of [...(Array.isArray(audience.userIds) ? audience.userIds : []), ...(typeof audience.userId === 'string' ? [audience.userId] : [])].map(String)) profileFor(internalUserId(userId));
      const scheduledAt = input.scheduledAt === undefined || input.scheduledAt === null || input.scheduledAt === '' ? undefined : new Date(String(input.scheduledAt));
      if (scheduledAt && (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now())) throw new HttpError(422, 'VALIDATION_ERROR', 'scheduledAt 必须是未来时间');
      const now = new Date().toISOString(); const job: AdminPushJob = {id: randomUUID(), resourceType: 'push_job', templateId, audience, status: pushAdapter.name === 'unconfigured' ? 'blocked_provider' : 'queued', ...(scheduledAt ? {scheduledAt: scheduledAt.toISOString()} : {}), sentCount: 0, failedCount: 0, attempts: 0, createdAt: now, createdBy: admin.adminId, updatedAt: now}; adminPushJobs.unshift(job);
      await persist('insert into push_jobs (id, template_id, audience, status, scheduled_at, sent_count, failed_count, attempts, created_by, created_at, updated_at) values ($1, $2, $3::jsonb, $4, $5, 0, 0, 0, $6, $7, $7)', [job.id, job.templateId, JSON.stringify(audience), job.status, job.scheduledAt ?? null, admin.adminId, now]);
      if (job.status === 'queued' && !job.scheduledAt) queueMicrotask(() => { void processAdminPushJob(job.id); });
      return send(res, 201, publicPushJob(job), requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/ai/providers') {
      requireAdmin(req);
      return send(res, 200, {items: [{name: aiAdapter.name, configured: aiAdapter.name !== 'unconfigured', status: aiAdapter.name === 'unconfigured' ? 'unconfigured' : 'available'}]}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/ai/quotas') {
      requireAdmin(req);
      const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();
      const page = parsePositiveInteger(url.searchParams.get('page'), 1, 1, 1_000_000, 'page');
      const pageSize = parsePositiveInteger(url.searchParams.get('pageSize'), 50, 1, 200, 'pageSize');
      const filtered = [...store.profiles.values()].filter(profile => !keyword || profile.id.toLowerCase().includes(keyword) || profile.name.toLowerCase().includes(keyword) || profile.phone.includes(keyword));
      const items = filtered.slice((page - 1) * pageSize, page * pageSize).map(profile => {
        const quota = aiQuotaFor(profile.id);
        const usage = aiUsageCounts(profile.id);
        return {userId: profile.id, name: profile.name, dailyLimit: quota.dailyLimit, usedToday: usage.usedToday, monthlyLimit: quota.monthlyLimit, usedThisMonth: usage.usedThisMonth, updatedAt: quota.updatedAt, updatedBy: quota.updatedBy};
      });
      return send(res, 200, {items, total: filtered.length, page, pageSize}, requestId);
    }
    const adminQuotaEdit = path.match(/^\/v1\/admin\/ai\/quotas\/([^/]+)$/); if (adminQuotaEdit && req.method === 'PATCH') {
      const admin = requireAdmin(req, 'ai.quotas.write');
      const profile = profileFor(internalUserId(decodePathSegment(adminQuotaEdit[1])));
      const input = await body(req);
      const dailyLimit = Number(input.dailyLimit);
      const monthlyLimit = Number(input.monthlyLimit);
      if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 10000 || !Number.isInteger(monthlyLimit) || monthlyLimit < dailyLimit || monthlyLimit > 100000) throw new HttpError(422, 'VALIDATION_ERROR', '配额范围不正确');
      const reason = String(input.reason ?? '').trim();
      if (reason.length > 1000) throw new HttpError(422, 'VALIDATION_ERROR', '调整原因不能超过 1000 个字符');
      const updatedAt = new Date().toISOString();
      const quota: AIQuota = {userId: profile.id, dailyLimit, monthlyLimit, updatedAt, updatedBy: admin.adminId};
      store.aiQuotas.set(profile.id, quota);
      await persist('insert into ai_quota_settings (user_id, daily_limit, monthly_limit, updated_by, updated_at) values ($1, $2, $3, $4, $5) on conflict (user_id) do update set daily_limit = excluded.daily_limit, monthly_limit = excluded.monthly_limit, updated_by = excluded.updated_by, updated_at = excluded.updated_at', [dbUserId(profile.id), dailyLimit, monthlyLimit, admin.adminId, updatedAt]);
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, before_summary, after_summary, request_id) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)', [admin.adminId, 'ai.quota.update', 'user', profile.id, reason || 'AI quota update', JSON.stringify({}), JSON.stringify({dailyLimit, monthlyLimit}), requestId]);
      const usage = aiUsageCounts(profile.id);
      return send(res, 200, {userId: profile.id, name: profile.name, dailyLimit, usedToday: usage.usedToday, monthlyLimit, usedThisMonth: usage.usedThisMonth, updatedAt, updatedBy: admin.adminId}, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/ai/flags') {
      requireAdmin(req);
      const status = url.searchParams.get('status');
      const userId = url.searchParams.get('userId');
      const risk = url.searchParams.get('risk');
      const fromRaw = url.searchParams.get('from') ?? url.searchParams.get('startDate');
      const toRaw = url.searchParams.get('to') ?? url.searchParams.get('endDate');
      const from = fromRaw ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? `${fromRaw}T00:00:00.000Z` : fromRaw) : undefined;
      const to = toRaw ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? `${toRaw}T23:59:59.999Z` : toRaw) : undefined;
      if ((fromRaw && !Number.isFinite(from)) || (toRaw && !Number.isFinite(to))) throw new HttpError(422, 'VALIDATION_ERROR', '风险记录日期格式不正确');
      if (status && !['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '风险记录状态不正确');
      const items = store.aiRiskFlags.filter(flag => (!status || flag.status === status) && (!userId || flag.userId === internalUserId(userId)) && (!risk || flag.risk === risk) && (!from || Date.parse(flag.createdAt) >= from) && (!to || Date.parse(flag.createdAt) <= to)).map(flag => ({...flag, userName: flag.userId ? store.profiles.get(flag.userId)?.name : undefined}));
      return send(res, 200, {items, total: items.length}, requestId);
    }
    const adminAIRiskMatch = path.match(/^\/v1\/admin\/ai\/flags\/([^/]+)$/); if (adminAIRiskMatch && req.method === 'PATCH') {
      const admin = requireAdmin(req, 'ai.flags.review');
      const flag = store.aiRiskFlags.find(item => item.id === decodePathSegment(adminAIRiskMatch[1]));
      if (!flag) throw new HttpError(404, 'NOT_FOUND', '风险记录不存在');
      const input = await body(req);
      const status = String(input.status ?? '');
      const reason = String(input.reason ?? '').trim();
      if (!['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '风险记录状态不正确');
      if (['resolved', 'dismissed'].includes(status) && reason.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', '关闭风险记录必须填写处理原因');
      flag.status = status as AIRiskFlag['status'];
      flag.reviewedBy = admin.adminId;
      flag.reviewedAt = new Date().toISOString();
      await persist('update ai_risk_flags set status = $1, reviewed_by = $2, reviewed_at = $3 where id = $4', [flag.status, admin.adminId, flag.reviewedAt, flag.id]);
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'ai.risk.review', 'ai_risk_flag', flag.id, reason || status, requestId]);
      return send(res, 200, flag, requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/ai/usage') {
      requireAdmin(req);
      const userIdRaw = url.searchParams.get('userId');
      const provider = url.searchParams.get('provider') || undefined;
      const feature = url.searchParams.get('feature') || undefined;
      const status = url.searchParams.get('status') || undefined;
      const date = url.searchParams.get('date');
      const fromRaw = url.searchParams.get('from') ?? url.searchParams.get('startDate');
      const toRaw = url.searchParams.get('to') ?? url.searchParams.get('endDate');
      const fromText = date ? `${date}T00:00:00.000Z` : fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? `${fromRaw}T00:00:00.000Z` : fromRaw;
      const toText = date ? `${date}T23:59:59.999Z` : toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? `${toRaw}T23:59:59.999Z` : toRaw;
      const from = fromText ? Date.parse(fromText) : undefined;
      const to = toText ? Date.parse(toText) : undefined;
      if ((fromText && !Number.isFinite(from)) || (toText && !Number.isFinite(to))) throw new HttpError(422, 'VALIDATION_ERROR', 'AI 用量日期格式不正确');
      if (from !== undefined && to !== undefined && from > to) throw new HttpError(422, 'VALIDATION_ERROR', '用量起始日期不能晚于结束日期');
      if (status && !['completed', 'failed', 'blocked_quota'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', 'AI 用量状态不正确');
      const groupBy = (url.searchParams.get('groupBy') ?? 'user').split(',').map(item => item.trim()).filter(Boolean);
      const canonicalUserId = userIdRaw ? internalUserId(decodePathSegment(userIdRaw)) : undefined;
      const filteredEvents = store.aiUsage.filter(event => aiUsageInRange(event, from, to) && (!canonicalUserId || event.userId === canonicalUserId) && (!provider || event.provider === provider) && (!feature || event.feature === feature) && (!status || event.status === status));
      const items = aggregateAIUsage(filteredEvents, {from: undefined, to: undefined, userId: canonicalUserId, provider, feature, status, groupBy}).map(item => ({...item, ...(typeof item.userId === 'string' ? {userName: store.profiles.get(item.userId)?.name} : {})}));
      return send(res, 200, {items, total: items.length, eventCount: filteredEvents.length, generatedAt: new Date().toISOString(), filters: {userId: canonicalUserId, provider, feature, status, from: fromText, to: toText, groupBy}}, requestId);
    }
    {
     // Push job detail/retry/cancel endpoints share the worker-backed public
     // shape and live next to the analytics/export routes.
    const adminPushJobMatch = path.match(/^\/v1\/admin\/push-jobs\/([^/]+)$/); if (adminPushJobMatch && req.method === 'GET') { requireAdmin(req); const job = adminPushJobs.map(pushJobRecord).find(item => item.resourceType === 'push_job' && item.id === decodePathSegment(adminPushJobMatch[1])); if (!job) throw new HttpError(404, 'NOT_FOUND', '推送任务不存在'); return send(res, 200, publicPushJob(job), requestId); }
    const adminPushRetry = path.match(/^\/v1\/admin\/push-jobs\/([^/]+)\/retry$/); if (adminPushRetry && req.method === 'POST') { const admin = requireAdmin(req, 'operations.push.write'); const job = adminPushJobs.map(pushJobRecord).find(item => item.resourceType === 'push_job' && item.id === decodePathSegment(adminPushRetry[1])); if (!job) throw new HttpError(404, 'NOT_FOUND', '推送任务不存在'); if (!['failed', 'blocked_provider'].includes(job.status)) throw new HttpError(409, 'PUSH_NOT_RETRYABLE', '当前状态不可重试'); if (pushAdapter.name === 'unconfigured') { job.status = 'blocked_provider'; job.updatedAt = new Date().toISOString(); await persist('update push_jobs set status = $1, updated_at = $2 where id = $3', [job.status, job.updatedAt, job.id]); return send(res, 200, publicPushJob(job), requestId); } job.status = 'queued'; job.lastError = undefined; job.updatedAt = new Date().toISOString(); await persist('update push_jobs set status = $1, last_error = null, updated_at = $2 where id = $3', [job.status, job.updatedAt, job.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'push.retry', 'push_job', job.id, 'manual retry', requestId]); queueMicrotask(() => { void processAdminPushJob(job.id); }); return send(res, 202, publicPushJob(job), requestId); }
    const adminPushCancelV2 = path.match(/^\/v1\/admin\/push-jobs\/([^/]+)\/cancel$/); if (adminPushCancelV2 && req.method === 'POST') { const admin = requireAdmin(req, 'operations.push.write'); const job = adminPushJobs.map(pushJobRecord).find(item => item.resourceType === 'push_job' && item.id === decodePathSegment(adminPushCancelV2[1])); if (!job) throw new HttpError(404, 'NOT_FOUND', '推送任务不存在'); if (!['queued', 'blocked_provider', 'failed'].includes(String(job.status))) throw new HttpError(409, 'PUSH_NOT_CANCELLABLE', '当前状态不可取消'); job.status = 'cancelled'; job.updatedAt = new Date().toISOString(); await persist('update push_jobs set status = $1, updated_at = $2 where id = $3', [job.status, job.updatedAt, job.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'push.cancel', 'push_job', job.id, 'manual cancel', requestId]); return send(res, 200, publicPushJob(job), requestId); }
    if (req.method === 'GET' && path === '/v1/admin/analytics/overview') { requireAdmin(req); return send(res, 200, {users: store.profiles.size, courses: store.courses.length, questions: store.questions.length, orders: store.orders.length, forumPosts: store.forumPosts.length, generatedAt: new Date().toISOString()}, requestId); }
    }
    if (req.method === 'GET' && path === '/v1/admin/exports') { requireAdmin(req); for (const current of adminExportJobs.map(exportJobRecord)) await expireAdminExportIfNeeded(current); const items = adminExportJobs.map(exportJobRecord).map(publicExportJob); return send(res, 200, {items, total: items.length}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/exports') {
      const admin = requireAdmin(req); const input = await body(req); const resourceType = String(input.resourceType ?? '').trim(); const filters = input.filters && typeof input.filters === 'object' && !Array.isArray(input.filters) ? input.filters as Record<string, unknown> : {};
      if (!['analytics_overview', 'users', 'questions', 'orders', 'learning_records', 'community_reports', 'ai_usage'].includes(resourceType)) throw new HttpError(422, 'VALIDATION_ERROR', '不支持的导出资源');
      const now = new Date().toISOString(); const job: AdminExportJob = {id: randomUUID(), resourceType, filters, status: 'queued', createdAt: now, createdBy: admin.adminId, updatedAt: now}; adminExportJobs.unshift(job);
      await persist('insert into admin_export_jobs (id, admin_user_id, resource_type, filters, status, created_at, updated_at) values ($1, $2, $3, $4::jsonb, $5, $6, $6)', [job.id, admin.adminId, resourceType, JSON.stringify(filters), job.status, now]);
      queueMicrotask(() => { void processAdminExportJob(job.id); });
      return send(res, 202, {...publicExportJob(job), note: '导出任务已进入异步队列'}, requestId);
    }
    const adminExportJobMatch = path.match(/^\/v1\/admin\/exports\/([^/]+)$/); if (adminExportJobMatch && req.method === 'GET') { requireAdmin(req); const job = adminExportJobs.map(exportJobRecord).find(item => item.id === decodePathSegment(adminExportJobMatch[1])); if (!job) throw new HttpError(404, 'NOT_FOUND', '导出任务不存在'); await expireAdminExportIfNeeded(job); return send(res, 200, publicExportJob(job), requestId); }
    const adminExportRetry = path.match(/^\/v1\/admin\/exports\/([^/]+)\/retry$/); if (adminExportRetry && req.method === 'POST') { const admin = requireAdmin(req, 'analytics.export'); const job = adminExportJobs.map(exportJobRecord).find(item => item.id === decodePathSegment(adminExportRetry[1])); if (!job) throw new HttpError(404, 'NOT_FOUND', '导出任务不存在'); await expireAdminExportIfNeeded(job); if (!['failed', 'expired'].includes(job.status)) throw new HttpError(409, 'EXPORT_NOT_RETRYABLE', '当前状态不可重试'); job.status = 'queued'; job.errorMessage = undefined; job.content = undefined; job.fileUrl = undefined; job.expiresAt = undefined; job.completedAt = undefined; job.updatedAt = new Date().toISOString(); await persist('update admin_export_jobs set status = $1, file_url = null, expires_at = null, error_message = null, completed_at = null, updated_at = $2 where id = $3', [job.status, job.updatedAt, job.id]); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'export.retry', 'admin_export_job', job.id, 'manual retry', requestId]); queueMicrotask(() => { void processAdminExportJob(job.id); }); return send(res, 202, publicExportJob(job), requestId); }
    const adminExportDownload = path.match(/^\/v1\/admin\/exports\/([^/]+)\/download$/); if (adminExportDownload && req.method === 'GET') { const admin = requireAdmin(req, 'analytics.export'); const job = adminExportJobs.map(exportJobRecord).find(item => item.id === decodePathSegment(adminExportDownload[1])); if (!job) throw new HttpError(404, 'NOT_FOUND', '导出任务不存在'); await expireAdminExportIfNeeded(job); if (job.status === 'expired') throw new HttpError(410, 'EXPORT_EXPIRED', '导出文件已过期，请重新生成'); if (job.status !== 'completed' || !job.content) throw new HttpError(409, 'EXPORT_NOT_READY', '导出文件尚未生成', {status: job.status}); await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, request_id) values ($1, $2, $3, $4, $5, $6)', [admin.adminId, 'export.download', 'admin_export_job', job.id, 'downloaded', requestId]); const headers = (res as ServerResponse & {debaoHeaders?: Record<string, string>}).debaoHeaders ?? {}; res.writeHead(200, {'content-type': job.contentType ?? 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="debao-${job.resourceType}-${job.id}.csv"`, 'cache-control': 'no-store', 'x-request-id': requestId, 'access-control-allow-origin': '*', ...headers}); res.end(job.content); return;
    }
    if (req.method === 'GET' && path === '/v1/admin/overview') { requireAdmin(req); return send(res, 200, {users: store.profiles.size, courses: store.courses.length, products: store.products.length, orders: store.orders.length, submissions: store.submissions.length, gradingQueue: store.grading.filter(item => item.status === 'queued').length}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/audit-logs') { requireAdmin(req, 'audit.read'); return send(res, 200, {items: adminAuditLogs, total: adminAuditLogs.length}, requestId); }
    if (req.method === 'GET' && path === '/v1/admin/settings') { requireAdmin(req, 'system.settings.read'); return send(res, 200, await adminSettingsView(), requestId); }
    if (req.method === 'PATCH' && path === '/v1/admin/settings') {
      const admin = requireAdmin(req, 'system.settings.write');
      const input = await body(req);
      if (input.refundReviewThreshold === undefined && input.examDate === undefined && input.featureFlags === undefined) throw new HttpError(422, 'VALIDATION_ERROR', '至少提供一项配置');
      if (input.featureFlags !== undefined) {
        if (!input.featureFlags || typeof input.featureFlags !== 'object' || Array.isArray(input.featureFlags)) throw new HttpError(422, 'VALIDATION_ERROR', '功能开关格式不正确');
        const flags = input.featureFlags as Record<string, unknown>;
        const allowed = ['objectiveBank', 'objectiveExam', 'studyMaterials', 'hotCourses'];
        const statements = allowed.filter(key => flags[key] !== undefined).map(key => ({text: 'insert into admin_system_settings (setting_key, setting_value, updated_by, updated_at) values ($1, $2, $3, now()) on conflict (setting_key) do update set setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = now()', values: [`feature.${key}`, flags[key] === true ? 'true' : 'false', admin.adminId]}));
        if (statements.length) await persistAdminMutation(statements, [admin.adminId, 'settings.feature_flags.update', 'admin_system_setting', 'feature-flags', JSON.stringify(flags), requestId]);
      }
      if (input.examDate !== undefined) {
        const date = String(input.examDate);
        if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) throw new HttpError(422, 'VALIDATION_ERROR', '考试日期不正确');
        await persistAdminMutation([{text: 'insert into admin_system_settings (setting_key, setting_value, updated_by) values ($1,$2,$3) on conflict (setting_key) do update set setting_value=excluded.setting_value, updated_by=excluded.updated_by, updated_at=now()', values: ['exam_date', date, admin.adminId]}], [admin.adminId, 'settings.exam_date.update', 'admin_system_setting', 'exam_date', date, requestId]);
      }
      if (input.refundReviewThreshold === undefined) return send(res, 200, await adminSettingsView(), requestId);
      const threshold = normalizeRefundReviewThreshold(input.refundReviewThreshold);
      const previous = adminRefundDualReviewThreshold;
      await persist('insert into admin_system_settings (setting_key, setting_value, updated_by, updated_at) values ($1, $2, $3, now()) on conflict (setting_key) do update set setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = now()', ['refund_review_threshold', String(threshold), admin.adminId]);
      adminRefundDualReviewThreshold = threshold;
      await persist('insert into admin_audit_logs (admin_user_id, action, resource_type, resource_id, reason, before_summary, after_summary, request_id) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)', [admin.adminId, 'settings.refund_review_threshold.update', 'admin_system_setting', 'refund_review_threshold', `退款复核阈值由 ${previous} 调整为 ${threshold}`, JSON.stringify({refundReviewThreshold: previous}), JSON.stringify({refundReviewThreshold: threshold}), requestId]);
      return send(res, 200, await adminSettingsView(), requestId);
    }
    if (req.method === 'GET' && path === '/v1/admin/health') { requireAdmin(req, 'system.health.read'); const status = await infrastructure.status(); return send(res, 200, {api: 'ok', database: status.postgresConfigured ? (status.postgresReachable ? 'available' : 'unreachable') : 'unconfigured', redis: status.redisConfigured ? (status.redisReachable ? 'available' : 'unreachable') : 'unconfigured', providers: {ai: aiAdapter.name, push: pushAdapter.name}}, requestId); }
    if (req.method === 'POST' && path === '/v1/admin/push/test') { requireAdmin(req); const input = await body(req); const token = String(input.deviceToken ?? ''); if (!token) throw new HttpError(422, 'VALIDATION_ERROR', 'deviceToken 不能为空'); try { return send(res, 200, await pushAdapter.send(token, String(input.title ?? '得宝通知'), String(input.body ?? '测试推送')), requestId); } catch (error) { throw adapterFailure(pushAdapter.name, error); } }
    if (req.method === 'POST' && path === '/v1/admin/announcements') {
      const admin = requireAdmin(req);
      const input = await body(req);
      const title = String(input.title ?? '').trim();
      const announcementBody = String(input.body ?? '').trim();
      if (title.length < 2 || title.length > 160) throw new HttpError(422, 'VALIDATION_ERROR', '公告标题长度必须为 2 到 160 个字符');
      if (announcementBody.length < 2 || announcementBody.length > 10_000) throw new HttpError(422, 'VALIDATION_ERROR', '公告正文长度必须为 2 到 10000 个字符');
      const startsAt = announcementTimestamp(input.startsAt, '开始时间');
      const endsAt = announcementTimestamp(input.endsAt, '结束时间');
      validateAnnouncementWindow(startsAt, endsAt);
      const {audienceType, audienceValue} = announcementAudience(input);
      const deepLink = announcementLink(input.deepLink);
      validateAnnouncementTarget(deepLink);
      const now = new Date().toISOString();
      const requestedStatus = input.status === undefined ? 'draft' : String(input.status);
      if (requestedStatus !== 'draft' && requestedStatus !== 'published') throw new HttpError(422, 'VALIDATION_ERROR', '公告保存方式不正确');
      const publishRequested = requestedStatus === 'published';
      if (publishRequested && endsAt && Date.parse(endsAt) <= Date.now()) throw new HttpError(422, 'VALIDATION_ERROR', '发布公告的结束时间必须晚于当前时间');
      const status: Announcement['status'] = publishRequested ? (startsAt && Date.parse(startsAt) > Date.now() ? 'scheduled' : 'published') : 'draft';
      const effectiveStartsAt = status === 'published' && !startsAt ? now : startsAt;
      const announcement: Announcement = {
        id: `a-${randomUUID()}`,
        title,
        body: announcementBody,
        status,
        startsAt: effectiveStartsAt,
        endsAt,
        isPinned: input.isPinned === true,
        audienceType,
        audienceValue,
        deepLink,
        publishedAt: status === 'published' ? now : undefined,
        updatedAt: now,
        createdAt: now,
      };
      await persistAnnouncementMutation([{
        text: 'insert into announcements (id, title, body, status, starts_at, ends_at, is_pinned, audience_type, audience_value, deep_link, published_at, updated_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        values: [announcement.id, announcement.title, announcement.body, announcement.status, announcement.startsAt ?? null, announcement.endsAt ?? null, announcement.isPinned, announcement.audienceType, announcement.audienceValue ?? null, announcement.deepLink ?? null, announcement.publishedAt ?? null, announcement.updatedAt, announcement.createdAt],
      }], [admin.adminId, 'announcement.create', 'announcement', announcement.id, status === 'draft' ? '保存草稿' : status === 'scheduled' ? '设置定时发布' : '立即发布', requestId]);
      store.announcements.unshift(announcement);
      return send(res, 201, adminAnnouncement(announcement), requestId);
    }
    const adminAnnouncementEdit = path.match(/^\/v1\/admin\/announcements\/([^/]+)$/);
    if (adminAnnouncementEdit && req.method === 'PATCH') {
      const admin = requireAdmin(req);
      const announcement = store.announcements.find(item => item.id === decodeURIComponent(adminAnnouncementEdit[1]));
      if (!announcement) throw new HttpError(404, 'NOT_FOUND', '公告不存在');
      const currentStatus = announcementEffectiveStatus(announcement);
      if (!['draft', 'scheduled'].includes(currentStatus)) throw new HttpError(409, 'ANNOUNCEMENT_NOT_EDITABLE', '只有草稿或未到发布时间的公告可以编辑');
      const input = await body(req);
      const title = input.title === undefined ? announcement.title : String(input.title).trim();
      const announcementBody = input.body === undefined ? announcement.body : String(input.body).trim();
      if (title.length < 2 || title.length > 160) throw new HttpError(422, 'VALIDATION_ERROR', '公告标题长度必须为 2 到 160 个字符');
      if (announcementBody.length < 2 || announcementBody.length > 10_000) throw new HttpError(422, 'VALIDATION_ERROR', '公告正文长度必须为 2 到 10000 个字符');
      const startsAt = input.startsAt === undefined ? announcement.startsAt : announcementTimestamp(input.startsAt, '开始时间');
      const endsAt = input.endsAt === undefined ? announcement.endsAt : announcementTimestamp(input.endsAt, '结束时间');
      validateAnnouncementWindow(startsAt, endsAt);
      const {audienceType, audienceValue} = announcementAudience(input, announcement);
      const deepLink = announcementLink(input.deepLink, announcement.deepLink);
      validateAnnouncementTarget(deepLink);
      const now = new Date().toISOString();
      if (currentStatus === 'scheduled' && (!startsAt || Date.parse(startsAt) <= Date.now())) {
        throw new HttpError(422, 'VALIDATION_ERROR', '定时公告的开始时间必须晚于当前时间；如需立即发布请使用“立即发布”');
      }
      const nextStatus: Announcement['status'] = currentStatus === 'scheduled' ? 'scheduled' : 'draft';
      if (nextStatus !== 'draft' && endsAt && Date.parse(endsAt) <= Date.now()) throw new HttpError(422, 'VALIDATION_ERROR', '发布公告的结束时间必须晚于当前时间');
      const nextAnnouncement: Announcement = {...announcement,
        title,
        body: announcementBody,
        startsAt,
        endsAt,
        isPinned: input.isPinned === undefined ? announcement.isPinned : input.isPinned === true,
        audienceType,
        audienceValue,
        deepLink,
        status: nextStatus,
        publishedAt: announcement.publishedAt,
        updatedAt: now,
      };
      await persistAnnouncementMutation([{
        text: 'update announcements set title = $1, body = $2, status = $3, starts_at = $4, ends_at = $5, is_pinned = $6, audience_type = $7, audience_value = $8, deep_link = $9, published_at = $10, updated_at = $11 where id = $12',
        values: [nextAnnouncement.title, nextAnnouncement.body, nextAnnouncement.status, nextAnnouncement.startsAt ?? null, nextAnnouncement.endsAt ?? null, nextAnnouncement.isPinned, nextAnnouncement.audienceType, nextAnnouncement.audienceValue ?? null, nextAnnouncement.deepLink ?? null, nextAnnouncement.publishedAt ?? null, nextAnnouncement.updatedAt, nextAnnouncement.id],
      }], [admin.adminId, 'announcement.edit', 'announcement', announcement.id, '修改公告内容或投放配置', requestId]);
      Object.assign(announcement, nextAnnouncement);
      return send(res, 200, adminAnnouncement(announcement), requestId);
    }
    if (adminAnnouncementEdit && req.method === 'DELETE') {
      const admin = requireAdmin(req);
      const index = store.announcements.findIndex(item => item.id === decodeURIComponent(adminAnnouncementEdit[1]));
      if (index < 0) throw new HttpError(404, 'NOT_FOUND', '公告不存在');
      const announcement = store.announcements[index];
      if (announcementEffectiveStatus(announcement) !== 'draft') throw new HttpError(409, 'ANNOUNCEMENT_NOT_DELETABLE', '只有草稿可以删除，定时或已发布公告请使用撤回');
      await persistAnnouncementMutation([{
        text: 'delete from announcements where id = $1',
        values: [announcement.id],
      }], [admin.adminId, 'announcement.delete', 'announcement', announcement.id, '删除草稿', requestId]);
      store.announcements.splice(index, 1);
      return send(res, 200, {deleted: true}, requestId);
    }
    const adminAnnouncementPublish = path.match(/^\/v1\/admin\/announcements\/([^/]+)\/publish$/);
    if (adminAnnouncementPublish && req.method === 'POST') {
      const admin = requireAdmin(req);
      const announcement = store.announcements.find(item => item.id === decodeURIComponent(adminAnnouncementPublish[1]));
      if (!announcement) throw new HttpError(404, 'NOT_FOUND', '公告不存在');
      const currentStatus = announcementEffectiveStatus(announcement);
      if (!['draft', 'scheduled'].includes(currentStatus)) throw new HttpError(409, 'ANNOUNCEMENT_NOT_PUBLISHABLE', '当前公告状态不可发布');
      const input = await body(req);
      const now = new Date().toISOString();
      const startsAt = input.publishNow === true || !announcement.startsAt ? now : announcement.startsAt;
      if (announcement.endsAt && Date.parse(announcement.endsAt) <= Date.now()) throw new HttpError(422, 'VALIDATION_ERROR', '结束时间必须晚于当前时间');
      const status: Announcement['status'] = Date.parse(startsAt) > Date.now() ? 'scheduled' : 'published';
      const nextAnnouncement: Announcement = {...announcement, startsAt, status, publishedAt: status === 'published' ? now : undefined, updatedAt: now};
      await persistAnnouncementMutation([{
        text: 'update announcements set status = $1, starts_at = $2, published_at = $3, updated_at = $4 where id = $5',
        values: [nextAnnouncement.status, nextAnnouncement.startsAt ?? null, nextAnnouncement.publishedAt ?? null, nextAnnouncement.updatedAt, nextAnnouncement.id],
      }], [admin.adminId, 'announcement.publish', 'announcement', announcement.id, status === 'scheduled' ? '确认定时发布' : '立即发布', requestId]);
      Object.assign(announcement, nextAnnouncement);
      return send(res, 200, adminAnnouncement(announcement), requestId);
    }
    const adminAnnouncementWithdraw = path.match(/^\/v1\/admin\/announcements\/([^/]+)\/withdraw$/);
    if (adminAnnouncementWithdraw && req.method === 'POST') {
      const admin = requireAdmin(req);
      const announcement = store.announcements.find(item => item.id === decodeURIComponent(adminAnnouncementWithdraw[1]));
      if (!announcement) throw new HttpError(404, 'NOT_FOUND', '公告不存在');
      const currentStatus = announcementEffectiveStatus(announcement);
      if (!['scheduled', 'published'].includes(currentStatus)) throw new HttpError(409, 'ANNOUNCEMENT_NOT_WITHDRAWABLE', '只有定时中或已发布公告可以撤回');
      const input = await body(req);
      const reason = String(input.reason ?? '').trim();
      if (reason.length < 2 || reason.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', '撤回原因长度必须为 2 到 500 个字符');
      const now = new Date().toISOString();
      const nextAnnouncement: Announcement = {...announcement, status: 'withdrawn', withdrawnAt: now, withdrawalReason: reason, updatedAt: now};
      await persistAnnouncementMutation([{
        text: 'update announcements set status = $1, withdrawn_at = $2, withdrawal_reason = $3, updated_at = $4 where id = $5',
        values: [nextAnnouncement.status, nextAnnouncement.withdrawnAt, nextAnnouncement.withdrawalReason, nextAnnouncement.updatedAt, nextAnnouncement.id],
      }], [admin.adminId, 'announcement.withdraw', 'announcement', announcement.id, reason, requestId]);
      Object.assign(announcement, nextAnnouncement);
      return send(res, 200, adminAnnouncement(announcement), requestId);
    }
    if (req.method === 'GET' && path === '/v1/orders') {
      const userId = requireAuth(req); await expirePendingOrders(); const all = store.orders.filter(item => item.userId === userId); const status = url.searchParams.get('status');
      if (status && !['paid', 'pending', 'closed', 'cancelled', 'refund_requested', 'refunded'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', '订单状态不正确');
      const filtered = status ? all.filter(item => item.status === status) : all; const limit = parsePositiveInteger(url.searchParams.get('limit'), 50, 1, 100, 'limit'); const cursor = parsePositiveInteger(url.searchParams.get('cursor'), 0, 0, 1_000_000, 'cursor');
      if (!url.searchParams.has('limit') && !url.searchParams.has('cursor') && !url.searchParams.has('status')) return send(res, 200, filtered, requestId);
      return send(res, 200, {items: filtered.slice(cursor, cursor + limit), total: filtered.length, ...(cursor + limit < filtered.length ? {nextCursor: String(cursor + limit)} : {})}, requestId);
    }
    const orderEventsMatch = path.match(/^\/v1\/orders\/([^/]+)\/events$/);
    if (orderEventsMatch && req.method === 'GET') { const userId = requireAuth(req); const order = orderFor(decodeURIComponent(orderEventsMatch[1]), userId); return send(res, 200, {items: store.orderEvents.filter(item => item.orderId === order.id).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), total: store.orderEvents.filter(item => item.orderId === order.id).length}, requestId); }
    const orderCancelMatch = path.match(/^\/v1\/orders\/([^/]+)\/cancel$/);
    if (orderCancelMatch && req.method === 'POST') {
      const userId = requireAuth(req); const order = orderFor(decodeURIComponent(orderCancelMatch[1]), userId); if (order.status !== 'pending') throw new HttpError(409, 'ORDER_NOT_CANCELLABLE', '当前订单状态不可取消');
      order.status = 'cancelled'; order.closedAt = new Date().toISOString(); await restoreOrderInventory(order); await recordOrderEvent({id: `oe-${randomUUID()}`, orderId: order.id, type: 'cancelled', actor: 'user', metadata: {}, createdAt: order.closedAt}); await persist('update orders set status = $1, closed_at = $2 where id = $3 and user_id = $4 and status = $5', [order.status, order.closedAt, order.id, dbUserId(userId), 'pending']); return send(res, 200, order, requestId);
    }
    const orderRefundMatch = path.match(/^\/v1\/orders\/([^/]+)\/refund$/);
    if (orderRefundMatch && req.method === 'POST') {
      const userId = requireAuth(req); const order = orderFor(decodeURIComponent(orderRefundMatch[1]), userId); if (order.status !== 'paid') throw new HttpError(409, 'ORDER_NOT_REFUNDABLE', '只有已支付订单可以申请退款');
      const existing = store.refunds.find(item => item.orderId === order.id && ['requested', 'reviewing', 'completed'].includes(item.status)); if (existing) return send(res, 200, existing, requestId);
      const input = await body(req); const reason = String(input.reason ?? '').trim(); if (reason.length < 2 || reason.length > 500) throw new HttpError(422, 'VALIDATION_ERROR', '退款原因长度必须为 2 到 500 个字符'); const now = new Date().toISOString();
      const refund = {id: `refund-${randomUUID()}`, orderId: order.id, userId, reason, amount: order.amount, status: 'requested' as const, createdAt: now}; store.refunds.unshift(refund); order.status = 'refund_requested'; await recordOrderEvent({id: `oe-${randomUUID()}`, orderId: order.id, type: 'refund_requested', actor: 'user', metadata: {refundId: refund.id, reason}, createdAt: now}); await persist('insert into refund_requests (id, order_id, user_id, reason, amount, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$7)', [refund.id, order.id, dbUserId(userId), reason, refund.amount, refund.status, now]); await persist('update orders set status = $1 where id = $2 and user_id = $3', [order.status, order.id, dbUserId(userId)]); return send(res, 201, refund, requestId);
    }
    if (req.method === 'GET' && path === '/v1/refunds') { const userId = requireAuth(req); const items = store.refunds.filter(item => item.userId === userId); return send(res, 200, {items, total: items.length}, requestId); }
    const orderMatch = path.match(/^\/v1\/orders\/([^/]+)$/);
    if (orderMatch && req.method === 'GET') { const userId = requireAuth(req); const order = orderFor(decodeURIComponent(orderMatch[1]), userId); return send(res, 200, {...order, timeline: store.orderEvents.filter(item => item.orderId === order.id).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))}, requestId); }
    if (req.method === 'POST' && path === '/v1/orders') {
      const userId = requireAuth(req); const input = await body(req); const product = productFor(String(input.productId ?? ''), true); const clientRequestId = String(req.headers['idempotency-key'] ?? input.clientRequestId ?? '').trim(); if (!clientRequestId || clientRequestId.length > 160) throw new HttpError(422, 'VALIDATION_ERROR', 'clientRequestId 不能为空且不能超过 160 个字符'); const existing = store.orders.find(order => order.clientRequestId === clientRequestId);
      if (existing) { if (existing.userId !== userId || existing.productId !== product.id || (input.skuId !== undefined && existing.skuId !== String(input.skuId))) throw new HttpError(409, 'ORDER_IDEMPOTENCY_CONFLICT', 'clientRequestId 已用于其他订单'); return send(res, 200, existing, requestId); }
      const sku = productSkuFor(product.id, input.skuId === undefined ? undefined : String(input.skuId), true); const baseAmount = sku?.price ?? product.price; const {coupon, discount} = couponFor(input.couponCode === undefined ? undefined : String(input.couponCode), baseAmount); const amount = Math.max(0, Math.round((baseAmount - discount) * 100) / 100); const now = new Date().toISOString();
      const order: Order = {id: `DB${Date.now()}-${randomUUID().slice(0, 6)}`, userId, productId: product.id, ...(sku ? {skuId: sku.id} : {}), ...(coupon ? {couponCode: coupon.code} : {}), ...(discount ? {discountAmount: discount} : {}), clientRequestId, productName: product.name, amount, status: 'pending', createdAt: now, expiresAt: new Date(Date.now() + PENDING_ORDER_TTL_MS).toISOString()}; if (sku) await reserveOrderInventory(sku, now); store.orders.unshift(order); await recordOrderEvent({id: `oe-${randomUUID()}`, orderId: order.id, type: 'created', actor: 'user', metadata: {productId: product.id, skuId: sku?.id, couponCode: coupon?.code, baseAmount, discount}, createdAt: now}); await persist('insert into orders (id, user_id, product_id, amount, status, client_request_id, sku_id, coupon_code, discount_amount, expires_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing', [order.id, dbUserId(userId), order.productId, order.amount, order.status, order.clientRequestId, order.skuId ?? null, order.couponCode ?? null, order.discountAmount ?? 0, order.expiresAt, order.createdAt]); return send(res, 201, order, requestId);
    }
    const payMatch = path.match(/^\/v1\/orders\/([^/]+)\/pay$/);
    if (payMatch && req.method === 'POST') {
      const userId = requireAuth(req); const order = orderFor(decodeURIComponent(payMatch[1]), userId); await expirePendingOrders(); if (order.status === 'paid') return send(res, 200, {status: 'paid', transactionId: `EXISTING-${order.id}`}, requestId); if (order.status !== 'pending') throw new HttpError(409, 'ORDER_STATE_CHANGED', '订单当前状态不能支付');
      let result; try { result = await paymentAdapter.pay(order.id, order.amount); } catch (error) { throw adapterFailure(paymentAdapter.name, error); }
      if (result.status === 'paid') { order.status = 'paid'; order.paidAt = new Date().toISOString(); const course = store.courses.find(item => item.productId === order.productId); const courseId = course?.id ?? (order.productId === 'p1' ? 'c1' : order.productId === 'p2' ? 'c3' : 'c2'); if (!store.entitlements.some(item => item.userId === userId && item.courseId === courseId)) store.entitlements.unshift({userId, courseId, sourceOrderId: order.id}); if (order.couponCode) { const coupon = store.coupons.find(item => item.code === order.couponCode); if (coupon) { coupon.usedCount += 1; await persist('update coupons set used_count = used_count + 1 where code = $1', [coupon.code]); } } await recordOrderEvent({id: `oe-${randomUUID()}`, orderId: order.id, type: 'paid', actor: 'provider', metadata: {transactionId: result.transactionId}, createdAt: order.paidAt}); await persist('update orders set status = $1, paid_at = $2 where id = $3 and user_id = $4', ['paid', order.paidAt, order.id, dbUserId(userId)]); await persist('insert into course_entitlements (user_id, course_id, source_order_id) values ($1, $2, $3) on conflict (user_id, course_id) do nothing', [dbUserId(userId), courseId, order.id]); }
      return send(res, 200, result, requestId);
    }
    throw new HttpError(404, 'NOT_FOUND', '接口不存在');
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status, {code: error.code, message: error.message, ...(error.details ? {details: error.details} : {})}, requestId);
    console.error(error); return send(res, 500, {code: 'INTERNAL_ERROR', message: '服务暂时不可用'}, requestId);
  }
}
