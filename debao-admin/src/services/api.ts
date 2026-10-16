import type { paths } from "./openapi";

export type AdminApiPaths = paths;
export interface LearningInquiry {
  id: string; userId: string; reportId: string; questionId: string;
  studentName: string; question: {stem: string; options: string[]; answers: string[]; correctAnswers: string[]; analysis: string};
  reason: string; status: "pending" | "answered"; reply?: string;
  teacherName?: string; createdAt: string; repliedAt?: string;
}
export const getLearningInquiries = () =>
  request<LearningInquiry[]>("/v1/admin/learning-inquiries");
export const replyLearningInquiry = (id: string, reply: string, teacherName: string) =>
  request<LearningInquiry>(`/v1/admin/learning-inquiries/${encodeURIComponent(id)}/reply`,
    {method: "POST", body: JSON.stringify({reply, teacherName})});
export interface EarlyAccessRequest { id: string; userId: string; planId: string; requestedThrough: string; status: "pending" | "approved" | "rejected"; reason?: string; createdAt: string; plan?: {title?: string}; }
export const getEarlyAccessRequests = () => request<{items: EarlyAccessRequest[]; total: number}>('/v1/admin/learning/early-access');
export const reviewEarlyAccessRequest = (id: string, approved: boolean, reason = '') => request<EarlyAccessRequest>(`/v1/admin/learning/early-access/${encodeURIComponent(id)}/${approved ? 'approve' : 'reject'}`, {method: 'POST', body: JSON.stringify({reason})});

export interface AdminUser {
  id: string;
  name: string;
  role: string;
  permissions: string[];
}
export interface AdminMfaEnrollment {
  mfaRequired: true;
  enrollmentRequired: true;
  challengeToken: string;
  secret: string;
  otpAuthUri: string;
  expiresIn: number;
}

export interface DashboardMetrics {
  users: number;
  activeUsers: number;
  answeredToday: number;
  paidAmount: number;
  refundAmount: number;
  reports: number;
}
export interface AdminUserRecord extends AdminUser {
  phone: string;
  examYear: string;
  studyDays: number;
  sessionCount: number;
  courseCount: number;
}
export interface AdminUserDetail extends AdminUserRecord {
  sessions: Array<{ deviceId: string; expiresAt: string; revokedAt?: string }>;
  devices: Array<{
    id: string;
    userId: string;
    platform: string;
    name: string;
    lastSeenAt: string;
  }>;
  entitlements: Array<{
    userId: string;
    courseId: string;
    sourceOrderId?: string;
    expiresAt?: string;
  }>;
  orders: Array<Record<string, unknown>>;
  restriction?: {
    type: "login" | "community";
    reason: string;
    expiresAt?: string;
    createdAt: string;
  };
  courseProgress: Array<{
    userId: string;
    courseId: string;
    progress: number;
    updatedAt: string;
    courseTitle?: string;
    teacher?: string;
    type?: string;
    lessons?: number;
  }>;
  learningActivities: Array<{
    id: string;
    kind: string;
    courseId?: string;
    questionId?: string;
    taskId?: string;
    durationSeconds: number;
    quantity: number;
    occurredAt: string;
  }>;
  learningSummary: {
    courseCount: number;
    completedCourseCount: number;
    averageProgress: number;
    studyMinutes: number;
    courseMinutes: number;
    questionMinutes: number;
  };
  questionStats: {
    answeredCount: number;
    correctCount: number;
    correctRate: number;
    mistakeCount: number;
    favoriteCount: number;
    legalFavoriteCount: number;
  };
  questionSubmissions: Array<{
    id: string;
    questionId: string;
    answers: string[];
    correct: boolean;
    createdAt: string;
  }>;
  examStats: {
    objectiveSessionCount: number;
    objectiveSubmittedCount: number;
    objectiveReportCount: number;
    objectiveQuestionCount: number;
    objectiveCorrectCount: number;
    objectiveAverageScore: number;
    subjectiveSubmissionCount: number;
    subjectivePublishedCount: number;
    subjectiveAverageScore: number;
  };
  objectiveSessions: Array<Record<string, unknown>>;
  objectiveReports: Array<Record<string, unknown>>;
  subjectiveSubmissions: Array<Record<string, unknown>>;
  subjectiveReports: Array<Record<string, unknown>>;
  plans: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
}
export type ObjectiveQuestionType =
  "true_false" | "single" | "multiple" | "indeterminate";
export interface AdminQuestion {
  id: string;
  subjectId?: string;
  chapterId?: string;
  pointId?: string;
  stem: string;
  options: string[];
  answer: number;
  answerIndexes?: number[];
  analysis: string;
  questionType?: ObjectiveQuestionType;
  status?: "draft" | "review" | "published" | "disabled" | "archived" | string;
  version?: number;
  source?: string;
  updatedAt?: string;
}
export interface AdminSubjectiveQuestion {
  id: string;
  questionId: string;
  title: string;
  subjectId: string;
  chapterId?: string;
  pointId?: string;
  caseMaterial: string;
  totalScore: number;
  suggestedMinutes: number;
  status: string;
  version?: number;
  updatedAt?: string;
  publishedAt?: string;
}
export interface AdminSubject {
  id: string;
  name: string;
  questionCount?: number;
  objectiveQuestionCount?: number;
  subjectiveQuestionCount?: number;
  color?: string;
  status?: string;
  questionType?: "objective" | "subjective" | "both";
  chapters?: Array<{
    id: string;
    name: string;
    questionType?: string;
    points?: Array<{ id: string; name: string }>;
  }>;
}
export interface AdminPaper {
  id: string;
  name: string;
  year: string;
  volume: string;
  mode: string;
  durationMinutes: number;
  totalScore: number;
  questionIds: string[];
  questionKind: "objective" | "subjective";
  subjectId?: string;
  productId?: string;
  questionCount?: number;
  status?: string;
  version?: number;
  updatedAt?: string;
}
export interface AdminImportJob {
  id: string;
  filename: string;
  format: "xlsx" | "csv" | "json";
  questionKind: "objective" | "subjective";
  subjectId: string;
  chapterId: string;
  pointId: string;
  status: "preflight" | "completed";
  successCount: number;
  warningCount: number;
  errorCount: number;
  errors?: Array<{ row: number; message: string }>;
  createdAt: string;
  completedAt?: string;
}
export interface AdminLaw {
  id: string;
  title: string;
  article: string;
  content: string;
  documentCode?: string;
  sourceUrl?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  status?: string;
  version?: number;
  updatedAt?: string;
}
export interface AdminCourse {
  id: string;
  title: string;
  teacher: string;
  type: string;
  lessons: number;
  studentCount?: number;
  status?: string;
  productId?: string;
  isHot?: boolean;
  hotSortOrder?: number;
}
export interface AdminCourseLesson {
  id: string;
  sectionId: string;
  title: string;
  mediaKind: "video" | "audio" | "live" | "document";
  mediaReference?: string;
  handoutReference?: string;
  durationSeconds: number;
  trialEnabled: boolean;
  materialCategory?: string;
  materialKind?: "article" | "material";
  downloadable?: boolean;
  articleContent?: string;
  sortOrder: number;
  updatedAt: string;
}
export interface AdminCourseSection {
  id: string;
  courseId: string;
  title: string;
  sortOrder: number;
  updatedAt: string;
  lessons: AdminCourseLesson[];
}
export interface AdminProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  originalPrice: number;
  sold?: number;
  status?: string;
  benefits?: string[];
  updatedAt?: string;
}
export interface AdminProductSku {
  id: string;
  productId: string;
  name: string;
  price: number;
  stock: number;
  status: "active" | "disabled" | string;
  attributes: Record<string, string>;
  updatedAt?: string;
}
export interface AdminRefund {
  id: string;
  orderId?: string;
  amount?: number;
  reason?: string;
  reviewReason?: string;
  status?: string;
  createdAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  firstReviewedBy?: string;
  firstReviewedAt?: string;
  secondReviewedBy?: string;
  secondReviewedAt?: string;
  dualReviewRequired?: boolean;
  reviewStage?:
    "not_required" | "required" | "first_reviewed" | "ready" | string;
  readyForApproval?: boolean;
}
export interface AdminOrder {
  id: string;
  userId?: string;
  productId: string;
  productName: string;
  amount: number;
  status: string;
  createdAt: string;
}
export interface AdminOrderDetail extends AdminOrder {
  timeline: Array<{ event: string; at: string }>;
  payment: { provider: string; status: string };
  refunds: AdminRefund[];
}
export interface AdminCommunityReport {
  id: string;
  postId?: string;
  reason?: string;
  status?: string;
  createdAt?: string;
  resolution?: string;
}
export interface AdminCommunityPost {
  id: string;
  userId: string;
  userName: string;
  category: string;
  title: string;
  body: string;
  likes: number;
  status: string;
  createdAt: string;
  deletedAt?: string;
}
export interface AdminCommunityComment {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
  deletedAt?: string;
}
export interface AdminCommunityRule {
  id: string;
  name: string;
  action: string;
  keywords: string[];
  status: string;
  updatedAt: string;
}
export type AdminAnnouncementStatus =
  "draft" | "scheduled" | "published" | "expired" | "withdrawn";
export interface AdminAnnouncement {
  id: string;
  title: string;
  body: string;
  status: AdminAnnouncementStatus;
  persistedStatus?: Exclude<AdminAnnouncementStatus, "expired">;
  startsAt?: string;
  endsAt?: string;
  isPinned: boolean;
  audienceType: "all" | "exam_year";
  audienceValue?: string;
  deepLink?: string;
  audienceCount?: number;
  readCount?: number;
  closedCount?: number;
  readRate?: number;
  publishedAt?: string;
  withdrawnAt?: string;
  withdrawalReason?: string;
  updatedAt?: string;
  createdAt: string;
}
export type AdminAnnouncementInput = Pick<
  AdminAnnouncement,
  "title" | "body" | "isPinned" | "audienceType"
> & {
  audienceValue?: string;
  startsAt?: string;
  endsAt?: string | null;
  deepLink?: string | null;
  status?: "draft" | "published";
};
export interface AdminAnnouncementStats {
  total: number;
  draft: number;
  scheduled: number;
  published: number;
  expired: number;
  withdrawn: number;
  reads: number;
  audience: number;
  readRate: number;
}
export interface AdminAIQuota {
  userId: string;
  name: string;
  dailyLimit: number;
  usedToday: number;
  monthlyLimit: number;
}
export interface AdminAIProvider {
  name: string;
  configured: boolean;
  status: string;
}
export interface AdminAnalytics {
  users: number;
  courses: number;
  questions: number;
  orders: number;
  forumPosts: number;
  generatedAt: string;
}
export interface AdminAIFlag {
  id: string;
  userId?: string;
  risk?: string;
  status?: string;
  createdAt?: string;
}
export interface AdminAIUsage {
  userId?: string;
  requests?: number;
  tokens?: number;
  cost?: number;
}
export interface AdminAuditLog {
  id?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  reason?: string;
  createdAt?: string;
}
export interface AdminSettings {
  examYear: string;
  examDate?: string;
  refundReviewThreshold: number;
  featureFlags: Record<string, boolean>;
}
export interface AdminHealth {
  api: string;
  database: string;
  redis: string;
  providers: Record<string, string>;
}

export type LearningDiagnosticDimension = string;
export type LearningDiagnosticQuestionType =
  "single" | "multiple" | "scale" | "text" | "number";
export interface AdminLearningDiagnosticDimension {
  code: string;
  label: string;
  description?: string;
  color?: string;
  sortOrder: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}
export interface AdminLearningDiagnosticForm {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  estimatedMinutes: number;
  submitLabel: string;
  successTitle: string;
  successDescription: string;
  status: "draft" | "published" | "disabled";
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}
export interface AdminLearningDiagnosticOption {
  id: string;
  label: string;
  score: number;
  sortOrder: number;
}
export interface AdminLearningDiagnosticQuestion {
  id: string;
  formId: string;
  stem: string;
  description?: string;
  section?: string;
  placeholder?: string;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
  type: LearningDiagnosticQuestionType;
  dimension: LearningDiagnosticDimension;
  required: boolean;
  sortOrder: number;
  status: "draft" | "published" | "disabled";
  version: number;
  options: AdminLearningDiagnosticOption[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}
export type AdminLearningDiagnosticInput = Pick<
  AdminLearningDiagnosticQuestion,
  "stem" | "type" | "dimension" | "required" | "sortOrder"
> & {
  formId?: string;
  description?: string;
  section?: string;
  placeholder?: string;
  validation?: AdminLearningDiagnosticQuestion["validation"];
  options: Array<
    Partial<Pick<AdminLearningDiagnosticOption, "id">> &
      Pick<AdminLearningDiagnosticOption, "label" | "score" | "sortOrder">
  >;
};
export interface AdminLearningDiagnosticStats {
  total: number;
  draft: number;
  published: number;
  disabled: number;
}
export interface AdminLearningDiagnosticResult {
  attemptId: string;
  user: {id: string; name: string; phone: string; examYear: string};
  scores: Record<string, number>;
  submittedAt: string;
  startedAt: string;
  answeredCount: number;
  questionCount: number;
  assignment?: {
    id: string;
    status: "assigned" | "pending";
    classType?: {id: string; code: string; name: string};
    stage?: {id: string; code: string; name: string};
    teacher?: {id: string; name: string; subject: string; specialty: string};
    assignedAt: string;
  };
  answers: Array<{questionId: string; optionIds: string[]; value?: string | number}>;
  questionSnapshot: AdminLearningDiagnosticQuestion[];
}
export type AdminLearningStageConditionOperator = "gte" | "lte" | "between";
export interface AdminLearningClassType {
  id: string;
  code: string;
  name: string;
  productId?: string;
  description?: string;
  endDate: string;
  sortOrder: number;
  status: "active" | "disabled";
  stageCount?: number;
  createdAt: string;
  updatedAt: string;
}
export interface AdminLearningStageCondition {
  dimension: string;
  operator: AdminLearningStageConditionOperator;
  value: number;
  upperValue?: number;
}
export interface AdminLearningStage {
  id: string;
  classTypeId?: string;
  code: string;
  name: string;
  description?: string;
  conditions: AdminLearningStageCondition[];
  teacherIds?: string[];
  sortOrder: number;
  status: "active" | "disabled";
  teacherCount?: number;
  createdAt: string;
  updatedAt: string;
}
export type AdminLearningPlanContentType = "course" | "question" | "subjective" | "assessment" | "card" | "task";
export type AdminLearningPlanMakeupPolicy = "spread" | "weekend";
export type AdminLearningCardUnlockRule = "after_course_checkin" | "after_previous_content" | "immediate";
export interface AdminLearningStagePlanConfig {
  stageId: string;
  totalMinutes: number;
  dailyMinutes: number;
  minDailyMinutes: number;
  maxDailyMinutes: number;
  weekdayMinMinutes: number;
  weekdayMaxMinutes: number;
  weekendMinMinutes: number;
  weekendMaxMinutes: number;
  holidayMinMinutes: number;
  holidayMaxMinutes: number;
  holidayDates: string[];
  studyDays: number[];
  durationDays: number;
  makeupPolicy: AdminLearningPlanMakeupPolicy;
  cardUnlockRule: AdminLearningCardUnlockRule;
  questionPushCount: number;
  questionSelectionStrategy: "profile";
  status: "draft" | "published";
  version: number;
  publishedAt?: string;
  updatedAt: string;
}
export interface AdminLearningStagePlanPreview {
  stage: AdminLearningStage;
  config: AdminLearningStagePlanConfig;
  startDate: string;
  endDate: string;
  totalMinutes: number;
  itemCount: number;
  taskCount: number;
  availableDays: number;
  maxDailyMinutes: number;
  minDailyMinutes: number;
  overDailyLimit: number;
  incomplete?: boolean;
  impact?: {userCount: number; planCount: number; pendingTaskCount: number; manuallyAdjustedCount: number};
  changes?: Array<{field: string; before: unknown; after: unknown}>;
  days: Array<{date: string; minutes: number; tasks: Array<{title: string; dueDate: string; minutes: number; contentType?: AdminLearningPlanContentType}>}>;
}
export interface AdminLearningPlan {
  id: string; userId: string; title: string; dailyMinutes: number; startDate: string; endDate: string;
  status: "active" | "completed" | "archived"; classTypeId?: string; stageId?: string; autoGenerated?: boolean;
  version?: number; changeReason?: string; generatedThrough?: string; contentCursor?: number; contentOffsetMinutes?: number; updatedAt?: string; pausedAt?: string; pausedUntil?: string; pauseReason?: string; taskCount?: number;
}
export interface AdminLearningTask { id: string; planId: string; title: string; dueDate: string; minutes: number; status: "todo" | "done" | "overdue"; completedAt?: string; subjectId?: string; contentType?: AdminLearningPlanContentType; contentId?: string; prerequisiteTaskId?: string; locked?: boolean; }
export interface AdminLearningPlanVersion { id: string; planId: string; version: number; reason: string; source: "auto" | "admin" | "publish" | "user"; snapshot: unknown; createdBy?: string; createdAt: string; }
export interface AdminLearningStagePlanItem {
  id: string;
  stageId: string;
  contentType: AdminLearningPlanContentType;
  contentId?: string;
  knowledgePointIds?: string[];
  title: string;
  description?: string;
  minutes?: number;
  weekDay?: number;
  questionCount?: number;
  sortOrder: number;
  required: boolean;
}
export interface AdminLearningStageWeeklyPreview {
  stage: AdminLearningStage;
  config: AdminLearningStagePlanConfig;
  startDate: string;
  generatedThrough: string;
  endDate: string;
  incomplete: boolean;
  days: Array<{date: string; items: AdminLearningStagePlanItem[]; tasks: AdminLearningTask[]}>;
}
export interface AdminLearningTeacher {
  id: string;
  stageId?: string;
  name: string;
  subject: string;
  specialty: string;
  sortOrder: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}
export type AdminLearningQuestionCategory = "objective" | "subjective";
export type AdminLearningQuestionType =
  | "true_false"
  | "single"
  | "indeterminate"
  | "multiple"
  | "short_answer"
  | "case_analysis";
export type AdminLearningQuestionStatus = "draft" | "published" | "disabled";
export type AdminLearningQuestionUsageScene =
  "diagnostic" | "daily_practice" | "stage_test" | "wrong_review";
export interface AdminLearningQuestionOption {
  key: string;
  label: string;
}
export interface AdminLearningSubQuestion {
  id?: string;
  prompt: string;
  referenceAnswer: string;
  analysis?: string;
  score: number;
}
export interface AdminLearningQuestion {
  id: string;
  category: AdminLearningQuestionCategory;
  questionType: AdminLearningQuestionType;
  subject: string;
  subjectId: string;
  columnName: string;
  chapterId: string;
  knowledgePoint: string;
  pointId: string;
  subKnowledgePoint?: string;
  subPointId?: string;
  difficulty: number;
  stem: string;
  options: AdminLearningQuestionOption[];
  correctAnswers: string[];
  analysis: string;
  explanationMediaType?: "audio" | "video";
  explanationMediaReference?: string;
  explanationMediaVisible?: boolean;
  caseMaterial?: string;
  subQuestions: AdminLearningSubQuestion[];
  estimatedMinutes: number;
  source?: string;
  sourceYear?: number;
  usageScenes: AdminLearningQuestionUsageScene[];
  status: AdminLearningQuestionStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}
export type AdminLearningQuestionInput = Omit<
  AdminLearningQuestion,
  "id" | "status" | "version" | "createdAt" | "updatedAt" | "publishedAt"
>;
export interface AdminLearningQuestionStats {
  total: number;
  objective: number;
  subjective: number;
  draft: number;
  published: number;
  disabled: number;
}
export interface AdminLearningCardAsset {
  id: string;
  type: "image" | "html" | "pdf";
  filename: string;
  reference: string;
  sizeBytes: number;
  sortOrder: number;
}
export interface AdminLearningCardRecallItem {
  id: string;
  prompt: string;
  answer: string;
  sortOrder: number;
}
export interface AdminLearningCard {
  id: string;
  title: string;
  description?: string;
  contentType: "image_gallery" | "html" | "pdf";
  assets: AdminLearningCardAsset[];
  recallItems: AdminLearningCardRecallItem[];
  knowledgePointIds: string[];
  sortOrder: number;
  status: "draft" | "published" | "disabled";
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}
export type AdminLearningCardInput = Pick<
  AdminLearningCard,
  | "title"
  | "description"
  | "contentType"
  | "assets"
  | "recallItems"
  | "knowledgePointIds"
  | "sortOrder"
>;
export interface AdminLearningQuestionTaxonomy {
  subjects: string[];
  columns: string[];
  knowledgePoints: string[];
  subKnowledgePoints: string[];
}
export type AdminLearningTaxonomyNodeType =
  "subject" | "chapter" | "point" | "subpoint";
export interface AdminLearningTaxonomyNode {
  id: string;
  category: AdminLearningQuestionCategory;
  type: AdminLearningTaxonomyNodeType;
  parentId?: string;
  code: string;
  name: string;
  sortOrder: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const csrf =
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("debao_admin_csrf")
      : null;
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(csrf && method !== "GET" ? { "x-csrf-token": csrf } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      payload?.error?.message ??
        payload?.message ??
        `请求失败（${response.status}）`,
    );
  return payload.data ?? payload;
}

export async function uploadAdminCourseMaterial(file: File) {
  const csrf = typeof window !== "undefined" ? window.sessionStorage.getItem("debao_admin_csrf") : null;
  const response = await fetch("/v1/admin/course-materials/upload", {
    method: "POST",
    credentials: "include",
    body: file,
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
      ...(csrf ? {"x-csrf-token": csrf} : {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? `上传失败（${response.status}）`);
  return (payload.data ?? payload) as {id: string; filename: string; sizeBytes: number; contentType: string; reference: string};
}

export function getCurrentAdmin() {
  return request<AdminUser>("/v1/admin/me");
}

export function getAdminNavigation() {
  return request<{
    items: Array<{ key: string; label: string; permission: string }>;
  }>("/v1/admin/navigation");
}

export function getAdminAdmins() {
  return request<{ items: Array<Record<string, unknown>>; total: number }>(
    "/v1/admin/admins",
  );
}

export function getAdminRoles() {
  return request<{ items: Array<Record<string, unknown>>; total: number }>(
    "/v1/admin/roles",
  );
}

export async function loginAdmin(username: string, password: string) {
  const result = await request<{
    admin?: AdminUser;
    csrfToken?: string;
    mfaRequired?: boolean;
    enrollmentRequired?: boolean;
    challengeToken?: string;
    secret?: string;
    otpAuthUri?: string;
    expiresIn?: number;
  }>("/v1/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (result.csrfToken)
    window.sessionStorage.setItem("debao_admin_csrf", result.csrfToken);
  return result;
}
export async function loginGradingAdmin(username: string, password: string) {
  const result = await request<{ admin?: AdminUser; csrfToken?: string }>(
    "/v1/grading-admin/auth/login",
    { method: "POST", body: JSON.stringify({ username, password }) },
  );
  if (result.csrfToken)
    window.sessionStorage.setItem("debao_admin_csrf", result.csrfToken);
  return result;
}
export async function loginLearningAdmin(username: string, password: string) {
  const result = await request<{ admin?: AdminUser; csrfToken?: string }>(
    "/v1/learning-admin/auth/login",
    { method: "POST", body: JSON.stringify({ username, password }) },
  );
  if (result.csrfToken)
    window.sessionStorage.setItem("debao_admin_csrf", result.csrfToken);
  return result;
}

export function getLearningDiagnosticQuestions(input?: {
  keyword?: string;
  status?: AdminLearningDiagnosticQuestion["status"];
}) {
  const query = new URLSearchParams();
  if (input?.keyword) query.set("keyword", input.keyword);
  if (input?.status) query.set("status", input.status);
  const suffix = query.toString();
  return request<{
    items: AdminLearningDiagnosticQuestion[];
    total: number;
    stats: AdminLearningDiagnosticStats;
  }>(`/v1/admin/learning-diagnostic/questions${suffix ? `?${suffix}` : ""}`);
}
export function getLearningDiagnosticResults(input?: {keyword?: string}) {
  const query = new URLSearchParams();
  if (input?.keyword) query.set("keyword", input.keyword);
  const suffix = query.toString();
  return request<{items: AdminLearningDiagnosticResult[]; total: number; stats: {total: number; assigned: number; pending: number}}>(
    `/v1/admin/learning-diagnostic/results${suffix ? `?${suffix}` : ""}`,
  );
}
export function updateLearningDiagnosticAssignment(attemptId: string, input: {stageId?: string; teacherId?: string}) {
  return request<NonNullable<AdminLearningDiagnosticResult["assignment"]>>(`/v1/admin/learning-diagnostic/results/${encodeURIComponent(attemptId)}/assignment`, {method: "PATCH", body: JSON.stringify({stageId: input.stageId ?? null, teacherId: input.teacherId ?? null})});
}
export function getLearningDiagnosticForm() {
  return request<{
    form: AdminLearningDiagnosticForm;
    publishedQuestionCount: number;
    totalQuestionCount: number;
  }>("/v1/admin/learning-diagnostic/form");
}
export function updateLearningDiagnosticForm(
  input: Partial<
    Pick<
      AdminLearningDiagnosticForm,
      | "title"
      | "subtitle"
      | "description"
      | "estimatedMinutes"
      | "submitLabel"
      | "successTitle"
      | "successDescription"
    >
  >,
) {
  return request<AdminLearningDiagnosticForm>(
    "/v1/admin/learning-diagnostic/form",
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function publishLearningDiagnosticForm() {
  return request<AdminLearningDiagnosticForm>(
    "/v1/admin/learning-diagnostic/form/publish",
    { method: "POST" },
  );
}
export function disableLearningDiagnosticForm(reason: string) {
  return request<AdminLearningDiagnosticForm>(
    "/v1/admin/learning-diagnostic/form/disable",
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function getLearningDiagnosticDimensions() {
  return request<{ items: AdminLearningDiagnosticDimension[]; total: number }>(
    "/v1/admin/learning-diagnostic/dimensions",
  );
}
export function createLearningDiagnosticDimension(
  input: Pick<
    AdminLearningDiagnosticDimension,
    "code" | "label" | "description" | "color" | "sortOrder"
  >,
) {
  return request<AdminLearningDiagnosticDimension>(
    "/v1/admin/learning-diagnostic/dimensions",
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function updateLearningDiagnosticDimension(
  code: string,
  input: Partial<
    Pick<
      AdminLearningDiagnosticDimension,
      "label" | "description" | "color" | "sortOrder" | "status"
    >
  >,
) {
  return request<AdminLearningDiagnosticDimension>(
    `/v1/admin/learning-diagnostic/dimensions/${encodeURIComponent(code)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function deleteLearningDiagnosticDimension(code: string) {
  return request<{ deleted: true; code: string }>(
    `/v1/admin/learning-diagnostic/dimensions/${encodeURIComponent(code)}`,
    { method: "DELETE" },
  );
}
export function createLearningDiagnosticQuestion(
  input: AdminLearningDiagnosticInput,
) {
  return request<AdminLearningDiagnosticQuestion>(
    "/v1/admin/learning-diagnostic/questions",
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function updateLearningDiagnosticQuestion(
  id: string,
  input: AdminLearningDiagnosticInput,
) {
  return request<AdminLearningDiagnosticQuestion>(
    `/v1/admin/learning-diagnostic/questions/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function publishLearningDiagnosticQuestion(id: string) {
  return request<AdminLearningDiagnosticQuestion>(
    `/v1/admin/learning-diagnostic/questions/${encodeURIComponent(id)}/publish`,
    { method: "POST" },
  );
}
export function disableLearningDiagnosticQuestion(id: string, reason: string) {
  return request<AdminLearningDiagnosticQuestion>(
    `/v1/admin/learning-diagnostic/questions/${encodeURIComponent(id)}/disable`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function deleteLearningDiagnosticQuestion(id: string) {
  return request<{ deleted: true; id: string }>(
    `/v1/admin/learning-diagnostic/questions/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
export function getLearningClassTypes() {
  return request<{ items: AdminLearningClassType[]; total: number }>(
    "/v1/admin/learning-coach/class-types",
  );
}
export function getLearningCoachProducts() {
  return request<{ items: AdminProduct[]; total: number }>(
    "/v1/admin/learning-coach/products",
  );
}
export function createLearningClassType(
  input: Pick<
    AdminLearningClassType,
    "code" | "name" | "productId" | "description" | "sortOrder"
  >,
) {
  return request<AdminLearningClassType>(
    "/v1/admin/learning-coach/class-types",
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function updateLearningClassType(
  id: string,
  input: Partial<
    Pick<
      AdminLearningClassType,
      "name" | "productId" | "description" | "sortOrder" | "status"
    >
  >,
) {
  return request<AdminLearningClassType>(
    `/v1/admin/learning-coach/class-types/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function deleteLearningClassType(id: string) {
  return request<{ deleted: true; id: string }>(
    `/v1/admin/learning-coach/class-types/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
export function getLearningStages(classTypeId?: string) {
  return request<{ items: AdminLearningStage[]; total: number }>(
    `/v1/admin/learning-coach/stages${classTypeId ? `?classTypeId=${encodeURIComponent(classTypeId)}` : ""}`,
  );
}
export function createLearningStage(
  input: Pick<
    AdminLearningStage,
    "classTypeId" | "code" | "name" | "description" | "conditions" | "sortOrder" | "teacherIds"
  >,
) {
  return request<AdminLearningStage>("/v1/admin/learning-coach/stages", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function updateLearningStage(
  id: string,
  input: Partial<
    Pick<
      AdminLearningStage,
      "name" | "description" | "conditions" | "sortOrder" | "status" | "teacherIds"
    >
  >,
) {
  return request<AdminLearningStage>(
    `/v1/admin/learning-coach/stages/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function deleteLearningStage(id: string) {
  return request<{ deleted: true; id: string }>(
    `/v1/admin/learning-coach/stages/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
export function getLearningStagePlan(stageId: string) {
  return request<{stage: AdminLearningStage; config: AdminLearningStagePlanConfig; items: AdminLearningStagePlanItem[]}>(`/v1/admin/learning-coach/stages/${encodeURIComponent(stageId)}/plan`);
}
export interface LearningAssessmentPaper { id: string; title: string; subjectId: string; questionIds: string[]; durationMinutes: number; status: 'draft' | 'published' | 'archived'; createdAt: string; updatedAt: string; }
export function getLearningAssessmentPapers() { return request<{items: LearningAssessmentPaper[]; total: number}>('/v1/admin/learning-assessment-papers'); }
export function createLearningAssessmentPaper(input: Pick<LearningAssessmentPaper, 'title' | 'subjectId' | 'questionIds' | 'durationMinutes'>) { return request<LearningAssessmentPaper>('/v1/admin/learning-assessment-papers', {method: 'POST', body: JSON.stringify(input)}); }
export function publishLearningAssessmentPaper(id: string) { return request<LearningAssessmentPaper>(`/v1/admin/learning-assessment-papers/${encodeURIComponent(id)}/publish`, {method: 'POST'}); }
export function updateLearningStagePlan(stageId: string, input: Pick<AdminLearningStagePlanConfig, "totalMinutes" | "dailyMinutes" | "minDailyMinutes" | "maxDailyMinutes" | "weekdayMinMinutes" | "weekdayMaxMinutes" | "weekendMinMinutes" | "weekendMaxMinutes" | "holidayMinMinutes" | "holidayMaxMinutes" | "holidayDates" | "studyDays" | "durationDays" | "makeupPolicy" | "cardUnlockRule" | "questionPushCount" | "questionSelectionStrategy">) {
  return request<AdminLearningStagePlanConfig>(`/v1/admin/learning-coach/stages/${encodeURIComponent(stageId)}/plan`, {method: "PATCH", body: JSON.stringify(input)});
}
export function previewLearningStagePlan(stageId: string, input?: Partial<Pick<AdminLearningStagePlanConfig, "totalMinutes" | "dailyMinutes" | "minDailyMinutes" | "maxDailyMinutes" | "weekdayMinMinutes" | "weekdayMaxMinutes" | "weekendMinMinutes" | "weekendMaxMinutes" | "holidayMinMinutes" | "holidayMaxMinutes" | "holidayDates" | "studyDays" | "durationDays" | "makeupPolicy">> & {startDate?: string}) {
  return request<AdminLearningStagePlanPreview>(`/v1/admin/learning-coach/stages/${encodeURIComponent(stageId)}/plan/preview`, {method: "POST", body: JSON.stringify(input ?? {})});
}
export function previewLearningStagePlanWeek(stageId: string, startDate?: string) {
  return request<AdminLearningStageWeeklyPreview>(`/v1/admin/learning-coach/stages/${encodeURIComponent(stageId)}/plan/weekly-preview`, {method: "POST", body: JSON.stringify(startDate ? {startDate} : {})});
}
export function publishLearningStagePlan(stageId: string, replanExisting = false) {
  return request<AdminLearningStagePlanConfig & {replanExisting?: boolean}>(`/v1/admin/learning-coach/stages/${encodeURIComponent(stageId)}/plan/publish`, {method: "POST", body: JSON.stringify({replanExisting})});
}
export function getAdminLearningPlan(id: string) {
  return request<{plan: AdminLearningPlan; tasks: AdminLearningTask[]; versions: AdminLearningPlanVersion[]}>(`/v1/admin/learning/plans/${encodeURIComponent(id)}`);
}
export function updateAdminLearningPlan(id: string, input: {title?: string; dailyMinutes?: number; startDate?: string; endDate?: string; reason: string}) {
  return request<AdminLearningPlan>(`/v1/admin/learning/plans/${encodeURIComponent(id)}`, {method: "PATCH", body: JSON.stringify(input)});
}
export function updateAdminLearningTask(planId: string, taskId: string, input: {title?: string; dueDate?: string; minutes?: number; reason: string}) {
  return request<AdminLearningTask>(`/v1/admin/learning/plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}`, {method: "PATCH", body: JSON.stringify(input)});
}
export function createLearningStagePlanItem(stageId: string, input: Omit<AdminLearningStagePlanItem, "id" | "stageId">) {
  return request<AdminLearningStagePlanItem>(`/v1/admin/learning-coach/stages/${encodeURIComponent(stageId)}/plan/items`, {method: "POST", body: JSON.stringify(input)});
}
export function updateLearningStagePlanItem(stageId: string, itemId: string, input: Partial<Omit<AdminLearningStagePlanItem, "id" | "stageId">>) {
  return request<AdminLearningStagePlanItem>(`/v1/admin/learning-coach/stages/${encodeURIComponent(stageId)}/plan/items/${encodeURIComponent(itemId)}`, {method: "PATCH", body: JSON.stringify(input)});
}
export function deleteLearningStagePlanItem(stageId: string, itemId: string) {
  return request<{deleted: true; id: string}>(`/v1/admin/learning-coach/stages/${encodeURIComponent(stageId)}/plan/items/${encodeURIComponent(itemId)}`, {method: "DELETE"});
}
export function getLearningStageTeachers(stageId: string) {
  return request<{
    stage: AdminLearningStage;
    items: AdminLearningTeacher[];
    total: number;
  }>(`/v1/admin/learning-coach/stages/${encodeURIComponent(stageId)}/teachers`);
}
export function getLearningTeachers(input?: {subject?: string; status?: AdminLearningTeacher["status"]}) {
  const query = new URLSearchParams();
  if (input?.subject) query.set("subject", input.subject);
  if (input?.status) query.set("status", input.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<{items: AdminLearningTeacher[]; total: number; subjects: string[]}>(`/v1/admin/learning-coach/teachers${suffix}`);
}
export function createLearningTeacher(input: Pick<AdminLearningTeacher, "name" | "subject" | "specialty" | "sortOrder">) {
  return request<AdminLearningTeacher>("/v1/admin/learning-coach/teachers", {method: "POST", body: JSON.stringify(input)});
}
export function createLearningStageTeacher(
  stageId: string,
  input: Pick<
    AdminLearningTeacher,
    "name" | "subject" | "specialty" | "sortOrder"
  >,
) {
  return request<AdminLearningTeacher>(
    `/v1/admin/learning-coach/stages/${encodeURIComponent(stageId)}/teachers`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function updateLearningTeacher(
  id: string,
  input: Partial<
    Pick<
      AdminLearningTeacher,
      "name" | "subject" | "specialty" | "sortOrder" | "status"
    >
  >,
) {
  return request<AdminLearningTeacher>(
    `/v1/admin/learning-coach/teachers/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function deleteLearningTeacher(id: string) {
  return request<{ deleted: true; id: string }>(
    `/v1/admin/learning-coach/teachers/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
export function getLearningQuestionBank(input?: {
  category?: AdminLearningQuestionCategory;
  questionType?: AdminLearningQuestionType;
  subject?: string;
  subjectId?: string;
  chapterId?: string;
  pointId?: string;
  subPointId?: string;
  status?: AdminLearningQuestionStatus;
  keyword?: string;
}) {
  const query = new URLSearchParams();
  if (input?.category) query.set("category", input.category);
  if (input?.questionType) query.set("questionType", input.questionType);
  if (input?.subject) query.set("subject", input.subject);
  if (input?.subjectId) query.set("subjectId", input.subjectId);
  if (input?.chapterId) query.set("chapterId", input.chapterId);
  if (input?.pointId) query.set("pointId", input.pointId);
  if (input?.subPointId) query.set("subPointId", input.subPointId);
  if (input?.status) query.set("status", input.status);
  if (input?.keyword) query.set("keyword", input.keyword);
  const suffix = query.toString();
  return request<{
    items: AdminLearningQuestion[];
    total: number;
    stats: AdminLearningQuestionStats;
    taxonomy: AdminLearningQuestionTaxonomy;
    taxonomyNodes: AdminLearningTaxonomyNode[];
  }>(`/v1/admin/learning-question-bank/questions${suffix ? `?${suffix}` : ""}`);
}
export function createLearningQuestion(input: AdminLearningQuestionInput) {
  return request<AdminLearningQuestion>(
    "/v1/admin/learning-question-bank/questions",
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function updateLearningQuestion(
  id: string,
  input: AdminLearningQuestionInput,
) {
  return request<AdminLearningQuestion>(
    `/v1/admin/learning-question-bank/questions/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function publishLearningQuestion(id: string) {
  return request<AdminLearningQuestion>(
    `/v1/admin/learning-question-bank/questions/${encodeURIComponent(id)}/publish`,
    { method: "POST" },
  );
}
export function disableLearningQuestion(id: string, reason: string) {
  return request<AdminLearningQuestion>(
    `/v1/admin/learning-question-bank/questions/${encodeURIComponent(id)}/disable`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function deleteLearningQuestion(id: string) {
  return request<{ deleted: true; id: string }>(
    `/v1/admin/learning-question-bank/questions/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
export function copyLearningQuestion(id: string) {
  return request<AdminLearningQuestion>(
    `/v1/admin/learning-question-bank/questions/${encodeURIComponent(id)}/copy`,
    { method: "POST" },
  );
}
export interface AdminLearningQuestionVersion {
  id: string;
  version: number;
  snapshot: AdminLearningQuestion;
  createdAt: string;
  current: boolean;
}
export function getLearningQuestionVersions(id: string) {
  return request<{ items: AdminLearningQuestionVersion[]; total: number }>(
    `/v1/admin/learning-question-bank/questions/${encodeURIComponent(id)}/versions`,
  );
}
export interface AdminLearningQuestionMediaUpload {
  id: string;
  type: "audio" | "video";
  filename: string;
  sizeBytes: number;
  contentType: string;
  reference: string;
}
export function uploadLearningQuestionMedia(
  file: File,
  onProgress?: (percent: number) => void,
) {
  return new Promise<AdminLearningQuestionMediaUpload>((resolve, reject) => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const inferredContentTypes: Record<string, string> = {
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
      wav: "audio/wav",
      ogg: "audio/ogg",
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
    };
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/v1/admin/learning-question-bank/media");
    xhr.withCredentials = true;
    xhr.setRequestHeader(
      "content-type",
      file.type ||
        inferredContentTypes[extension] ||
        "application/octet-stream",
    );
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    const csrf = window.sessionStorage.getItem("debao_admin_csrf");
    if (csrf) xhr.setRequestHeader("x-csrf-token", csrf);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("讲解文件上传失败，请检查网络后重试"));
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText) as {
          data?: AdminLearningQuestionMediaUpload;
          error?: { message?: string };
        };
        if (xhr.status >= 200 && xhr.status < 300 && result.data)
          resolve(result.data);
        else
          reject(
            new Error(
              result.error?.message || `讲解文件上传失败（${xhr.status}）`,
            ),
          );
      } catch {
        reject(new Error(`讲解文件上传失败（${xhr.status}）`));
      }
    };
    xhr.send(file);
  });
}
export function getLearningCards(filters?: {
  keyword?: string;
  status?: string;
  contentType?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.keyword) params.set("keyword", filters.keyword);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.contentType) params.set("contentType", filters.contentType);
  return request<{
    items: AdminLearningCard[];
    total: number;
    stats: {
      total: number;
      draft: number;
      published: number;
      disabled: number;
    };
  }>(`/v1/admin/learning-cards${params.size ? `?${params}` : ""}`);
}
export function createLearningCard(input: AdminLearningCardInput) {
  return request<AdminLearningCard>("/v1/admin/learning-cards", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function updateLearningCard(id: string, input: AdminLearningCardInput) {
  return request<AdminLearningCard>(
    `/v1/admin/learning-cards/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function publishLearningCard(id: string) {
  return request<AdminLearningCard>(
    `/v1/admin/learning-cards/${encodeURIComponent(id)}/publish`,
    { method: "POST", body: JSON.stringify({}) },
  );
}
export function disableLearningCard(id: string, reason: string) {
  return request<AdminLearningCard>(
    `/v1/admin/learning-cards/${encodeURIComponent(id)}/disable`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function deleteLearningCard(id: string) {
  return request<{ deleted: true; id: string }>(
    `/v1/admin/learning-cards/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
export function uploadLearningCardAsset(
  file: File,
  onProgress?: (percent: number) => void,
) {
  return new Promise<AdminLearningCardAsset>((resolve, reject) => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const inferred: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      html: "text/html",
      htm: "text/html",
      pdf: "application/pdf",
    };
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/v1/admin/learning-cards/assets");
    xhr.withCredentials = true;
    xhr.setRequestHeader(
      "content-type",
      file.type || inferred[extension] || "application/octet-stream",
    );
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    const csrf = window.sessionStorage.getItem("debao_admin_csrf");
    if (csrf) xhr.setRequestHeader("x-csrf-token", csrf);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("素材上传失败，请检查网络后重试"));
    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && payload.data)
          resolve({ ...payload.data, sortOrder: 0 });
        else
          reject(
            new Error(
              payload?.error?.message || `素材上传失败（${xhr.status}）`,
            ),
          );
      } catch {
        reject(new Error(`素材上传失败（${xhr.status}）`));
      }
    };
    xhr.send(file);
  });
}
export function importLearningQuestions(
  questions: AdminLearningQuestionInput[],
) {
  return request<{ items: AdminLearningQuestion[]; imported: number }>(
    "/v1/admin/learning-question-bank/questions/import",
    { method: "POST", body: JSON.stringify({ questions }) },
  );
}
export function bulkLearningQuestions(input: {
  action: "publish" | "disable" | "delete" | "move";
  ids: string[];
  reason?: string;
  target?: Pick<
    AdminLearningQuestionInput,
    "subjectId" | "chapterId" | "pointId" | "subPointId"
  >;
}) {
  return request<{ action: string; affected: number }>(
    "/v1/admin/learning-question-bank/questions/bulk",
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function getLearningQuestionTaxonomy(input: {
  category: AdminLearningQuestionCategory;
  type?: AdminLearningTaxonomyNodeType;
  parentId?: string;
}) {
  const query = new URLSearchParams({ category: input.category });
  if (input.type) query.set("type", input.type);
  if (input.parentId) query.set("parentId", input.parentId);
  return request<{ items: AdminLearningTaxonomyNode[]; total: number }>(
    `/v1/admin/learning-question-bank/taxonomy?${query.toString()}`,
  );
}
export function createLearningQuestionTaxonomy(
  input: Pick<
    AdminLearningTaxonomyNode,
    "category" | "type" | "code" | "name" | "sortOrder"
  > & { parentId?: string },
) {
  return request<AdminLearningTaxonomyNode>(
    "/v1/admin/learning-question-bank/taxonomy",
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function updateLearningQuestionTaxonomy(
  id: string,
  input: Partial<
    Pick<AdminLearningTaxonomyNode, "code" | "name" | "sortOrder" | "status">
  >,
) {
  return request<AdminLearningTaxonomyNode>(
    `/v1/admin/learning-question-bank/taxonomy/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function deleteLearningQuestionTaxonomy(id: string) {
  return request<{ deleted: true; id: string }>(
    `/v1/admin/learning-question-bank/taxonomy/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export function enrollCurrentAdminMfa() {
  return request<AdminMfaEnrollment>("/v1/admin/me/mfa/enroll", {
    method: "POST",
  });
}
export function resetAdminMfa(
  id: string,
  reason: string,
  confirmation: string,
) {
  return request<{ reset: boolean; nextLoginEnrollmentRequired: boolean }>(
    `/v1/admin/admins/${encodeURIComponent(id)}/mfa/reset`,
    { method: "POST", body: JSON.stringify({ reason, confirmation }) },
  );
}

export async function verifyAdminMfa(challengeToken: string, code: string) {
  const result = await request<{ admin: AdminUser; csrfToken: string }>(
    "/v1/admin/auth/mfa/verify",
    { method: "POST", body: JSON.stringify({ challengeToken, code }) },
  );
  window.sessionStorage.setItem("debao_admin_csrf", result.csrfToken);
  return result.admin;
}

export function logoutAdmin() {
  window.sessionStorage.removeItem("debao_admin_csrf");
  return request("/v1/admin/auth/logout", { method: "POST" });
}

export function getDashboardMetrics() {
  return request<DashboardMetrics>("/v1/admin/dashboard");
}

export function getAdminUsers(keyword?: string) {
  return request<{ items: AdminUserRecord[]; total: number }>(
    `/v1/admin/users${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""}`,
  );
}

export function createAdminUser(input: {
  name: string;
  phone: string;
  examYear: string;
}) {
  return request<AdminUserRecord>("/v1/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getAdminUser(id: string) {
  return request<AdminUserDetail>(`/v1/admin/users/${encodeURIComponent(id)}`);
}

export function deleteAdminUser(
  id: string,
  input: { reason: string; confirmation: "DELETE" },
) {
  return request<{
    deleted: true;
    userId: string;
    revokedSessions: number;
    retainedBusinessRecords: true;
    deletedAt: string;
  }>(`/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify(input),
  });
}

export function restrictAdminUser(
  id: string,
  input: { type: "login" | "community"; reason: string; expiresAt?: string },
) {
  return request(`/v1/admin/users/${encodeURIComponent(id)}/restrictions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function revokeAdminUserSessions(id: string) {
  return request<{ revoked: number }>(
    `/v1/admin/users/${encodeURIComponent(id)}/sessions/revoke`,
    { method: "POST" },
  );
}

export function adjustAdminUserEntitlement(
  id: string,
  input: {
    courseId: string;
    type: "grant" | "revoke";
    reason: string;
    expiresAt?: string;
  },
) {
  return request(
    `/v1/admin/users/${encodeURIComponent(id)}/entitlements/adjust`,
    {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );
}

export function getAdminSubjects() {
  return request<AdminSubject[]>("/v1/admin/content/subjects");
}
export function createAdminSubject(input: {name: string}) {
  return request<AdminSubject>("/v1/admin/content/subjects", {
    method: "POST", body: JSON.stringify(input),
  });
}
export function updateAdminSubject(
  id: string,
  input: { name?: string; questionType?: "objective" | "subjective" | "both" },
) {
  return request<AdminSubject>(
    `/v1/admin/content/subjects/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function deleteAdminSubject(id: string) {
  return request<{deleted: boolean; id: string}>(
    `/v1/admin/content/subjects/${encodeURIComponent(id)}`,
    {method: "DELETE"},
  );
}
export function createAdminChapter(
  subjectId: string,
  input: { name: string; questionType?: "objective" | "subjective" | "both" },
) {
  return request<AdminSubject>(
    `/v1/admin/content/subjects/${encodeURIComponent(subjectId)}/chapters`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function updateAdminChapter(
  subjectId: string,
  chapterId: string,
  input: { name?: string; questionType?: "objective" | "subjective" | "both" },
) {
  return request<AdminSubject>(
    `/v1/admin/content/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function deleteAdminChapter(subjectId: string, chapterId: string) {
  return request<{deleted: boolean; id: string}>(
    `/v1/admin/content/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}`,
    {method: "DELETE"},
  );
}
export function createAdminPoint(
  subjectId: string,
  chapterId: string,
  input: { name: string },
) {
  return request<AdminSubject>(
    `/v1/admin/content/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/points`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function updateAdminPoint(
  subjectId: string,
  chapterId: string,
  pointId: string,
  input: { name?: string },
) {
  return request<AdminSubject>(
    `/v1/admin/content/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/points/${encodeURIComponent(pointId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function deleteAdminPoint(subjectId: string, chapterId: string, pointId: string) {
  return request<{deleted: boolean; id: string}>(
    `/v1/admin/content/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/points/${encodeURIComponent(pointId)}`,
    {method: "DELETE"},
  );
}

export function getAdminQuestions(
  params: {
    keyword?: string;
    status?: string;
    subjectId?: string;
    chapterId?: string;
    pointId?: string;
    questionType?: ObjectiveQuestionType;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, String(value));
  });
  return request<{
    items: AdminQuestion[];
    total: number;
    page?: number;
    pageSize?: number;
  }>("/v1/admin/questions" + (query.size ? `?${query.toString()}` : ""));
}
export function getAdminSubjectiveQuestions(
  params: {
    keyword?: string;
    status?: string;
    subjectId?: string;
    chapterId?: string;
    pointId?: string;
  } = {},
) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(
    ([key, value]) => value && query.set(key, value),
  );
  return request<{ items: AdminSubjectiveQuestion[]; total: number }>(
    "/v1/admin/content/questions/subjective" +
      (query.size ? `?${query.toString()}` : ""),
  );
}

export function createAdminQuestion(
  input: Pick<
    AdminQuestion,
    | "stem"
    | "options"
    | "answer"
    | "answerIndexes"
    | "questionType"
    | "analysis"
    | "subjectId"
    | "chapterId"
    | "pointId"
  >,
) {
  return request<AdminQuestion>("/v1/admin/questions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function publishAdminQuestion(id: string) {
  return request<AdminQuestion>(
    `/v1/admin/questions/${encodeURIComponent(id)}/publish`,
    { method: "POST" },
  );
}

export function updateAdminQuestion(
  id: string,
  input: Pick<
    AdminQuestion,
    | "stem"
    | "options"
    | "answer"
    | "answerIndexes"
    | "questionType"
    | "analysis"
    | "chapterId"
    | "pointId"
  > & { subjectId?: string | null },
) {
  const { chapterId, pointId, ...content } = input;
  return request<AdminQuestion>(
    `/v1/admin/questions/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(content) },
  ).then(async (result) => {
    if (input.subjectId)
      return request<AdminQuestion>(
        `/v1/admin/questions/${encodeURIComponent(id)}/taxonomy`,
        {
          method: "PATCH",
          body: JSON.stringify({
            subjectId: input.subjectId,
            chapterId,
            pointId,
          }),
        },
      );
    return result;
  });
}

export function getAdminQuestionVersions(id: string) {
  return request<{ items: AdminQuestion[]; total: number }>(
    `/v1/admin/questions/${encodeURIComponent(id)}/versions`,
  );
}
export function getAdminPapers() {
  return request<{ items: AdminPaper[]; total: number }>(
    "/v1/admin/content/papers",
  );
}
export function createAdminPaper(
  input: Omit<
    AdminPaper,
    "id" | "questionCount" | "status" | "version" | "updatedAt"
  >,
) {
  return request<AdminPaper>("/v1/admin/content/papers", {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}
export function updateAdminPaper(id: string, input: Partial<AdminPaper>) {
  return request<AdminPaper>(
    `/v1/admin/content/papers/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function publishAdminPaper(id: string) {
  return request<AdminPaper>(
    `/v1/admin/content/papers/${encodeURIComponent(id)}/publish`,
    { method: "POST" },
  );
}
export function getAdminImports() {
  return request<{ items: AdminImportJob[]; total: number }>(
    "/v1/admin/content/imports",
  );
}
export function createAdminImport(input: {
  filename: string;
  format: "xlsx" | "json" | "csv";
  questionKind: "objective" | "subjective";
  records: Array<Record<string, unknown>>;
}) {
  return request<AdminImportJob>("/v1/admin/content/imports", {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}
export function confirmAdminImport(id: string) {
  return request<AdminImportJob>(
    `/v1/admin/content/imports/${encodeURIComponent(id)}/confirm`,
    { method: "POST" },
  );
}
export function getAdminLaws() {
  return request<{ items: AdminLaw[]; total: number }>(
    "/v1/admin/content/laws",
  );
}
export function createAdminLaw(
  input: Pick<AdminLaw, "title" | "article" | "content" | "effectiveFrom"> &
    Partial<Pick<AdminLaw, "documentCode" | "sourceUrl">>,
) {
  return request<AdminLaw>("/v1/admin/content/laws", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function publishAdminLaw(id: string) {
  return request<AdminLaw>(
    `/v1/admin/content/laws/${encodeURIComponent(id)}/publish`,
    { method: "POST" },
  );
}
export function disableAdminLaw(id: string, reason: string) {
  return request<AdminLaw>(
    `/v1/admin/content/laws/${encodeURIComponent(id)}/disable`,
    {
      method: "POST",
      body: JSON.stringify({ reason, confirmation: "DISABLE" }),
    },
  );
}

export function getAdminCourses() {
  return request<{ items: AdminCourse[]; total: number }>("/v1/admin/courses");
}
export function createAdminCourse(
  input: Pick<AdminCourse, "title" | "teacher" | "type" | "lessons"> & {productId?: string; isHot?: boolean; hotSortOrder?: number},
) {
  return request<AdminCourse>("/v1/admin/courses", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function updateAdminCourse(id: string, input: {isHot?: boolean; hotSortOrder?: number}) {
  return request<AdminCourse>(`/v1/admin/courses/${encodeURIComponent(id)}`, {method: "PATCH", body: JSON.stringify(input)});
}
export function publishAdminCourse(id: string) {
  return request<AdminCourse>(
    `/v1/admin/courses/${encodeURIComponent(id)}/publish`,
    { method: "POST" },
  );
}
export function getAdminCourseSections(courseId: string) {
  return request<{ items: AdminCourseSection[] }>(
    `/v1/admin/courses/${encodeURIComponent(courseId)}/sections`,
  );
}
export function createAdminCourseSection(
  courseId: string,
  input: { title: string; sortOrder?: number },
) {
  return request<AdminCourseSection>(
    `/v1/admin/courses/${encodeURIComponent(courseId)}/sections`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function createAdminCourseLesson(
  courseId: string,
  input: {
    sectionId: string;
    title: string;
    mediaKind: AdminCourseLesson["mediaKind"];
    mediaReference?: string;
    handoutReference?: string;
    durationSeconds?: number;
    trialEnabled?: boolean;
    materialCategory?: string;
    materialKind?: "article" | "material";
    downloadable?: boolean;
    articleContent?: string;
    sortOrder?: number;
  },
) {
  return request<AdminCourseLesson>(
    `/v1/admin/courses/${encodeURIComponent(courseId)}/lessons`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
export function updateAdminCourseLesson(
  courseId: string,
  lessonId: string,
  input: {
    title?: string;
    mediaReference?: string;
    handoutReference?: string;
    durationSeconds?: number;
    trialEnabled?: boolean;
  },
) {
  return request<AdminCourseLesson>(
    `/v1/admin/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export interface AdminLiveSession {
  id: string;
  courseId: string;
  lessonId?: string;
  title: string;
  teacher: string;
  startsAt: string;
  endsAt: string;
  provider?: "polyv" | "tencent";
  providerRoomId?: string;
  recordingVideoId?: string;
  playUrl?: string;
  recordingUrl?: string;
  status: string;
  notificationStatus: string;
}
export interface AdminGrading {
  id: string;
  userId: string;
  questionId?: string;
  fileUrl?: string;
  status: string;
  score?: number;
  feedback?: string;
  assignedAdminId?: string;
  claimedAt?: string;
}
export interface AdminGradingV2 {
  id: string;
  paperId?: string;
  paperTitle?: string;
  questionId: string;
  questionTitle?: string;
  rubricId: string;
  questionVersion: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  currentAssignmentId?: string;
  latestReportId?: string;
  assignment?: {
    id: string;
    status: string;
    graderId?: string;
    claimedAt?: string;
    dueAt?: string;
  };
  report?: AdminGradingReport;
}
export interface AdminGradingReport {
  id: string;
  submissionId: string;
  version: number;
  totalScore: number;
  maxScore: number;
  feedback: string;
  improvementAdvice: string;
  publishedAt: string;
}
export interface AdminGradingDetail {
  submission: AdminGradingV2 & {
    userId: string;
    answers: Array<{
      subQuestionId: string;
      text: string;
      attachments: string[];
    }>;
  };
  assignment?: {
    id: string;
    status: string;
    graderId?: string;
    claimedAt?: string;
    dueAt?: string;
  };
  rubric?: {
    id: string;
    title: string;
    subjectId: string;
    totalScore: number;
    gradingBasis: string;
    points: Array<{
      id: string;
      title: string;
      description: string;
      maxScore: number;
    }>;
  };
  aiRuns: Array<{
    id: string;
    provider: string;
    status: string;
    suggestedScore?: number;
    failureReason?: string;
    result?: unknown;
  }>;
  assignments: Array<Record<string, unknown>>;
  reviews: Array<{
    id: string;
    totalScore: number;
    feedback: string;
    improvementAdvice: string;
    pointResults: Array<Record<string, unknown>>;
    status: string;
  }>;
  reports: AdminGradingReport[];
  events: Array<{
    id: string;
    eventType: string;
    actorType: string;
    actorId?: string;
    createdAt: string;
  }>;
}
export interface AdminGradingStats {
  total: number;
  byStatus: Record<string, number>;
  completed: number;
  availableTasks: number;
  claimedTasks: number;
  hourlyCompleted?: Array<{ period: string; count: number }>;
  dailyCompleted?: Array<{ period: string; count: number }>;
  graderStats: Array<{
    graderId: string;
    displayName: string;
    completed: number;
  }>;
}
export interface AdminGraderAccount {
  id: string;
  username: string;
  displayName: string;
  subjectIds: string[];
  status?: "active" | "disabled";
}
export function getAdminLiveSessions() {
  return request<{ items: AdminLiveSession[]; total: number }>(
    "/v1/admin/courses/live-sessions",
  );
}
export function createAdminLiveSession(input: {
  courseId: string;
  lessonId: string;
  title: string;
  teacher: string;
  startsAt: string;
  endsAt: string;
  provider?: "polyv" | "tencent";
  providerRoomId?: string;
  recordingVideoId?: string;
}) {
  return request<AdminLiveSession>("/v1/admin/courses/live-sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function cancelAdminLiveSession(id: string, reason: string) {
  return request<AdminLiveSession>(
    `/v1/admin/courses/live-sessions/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function getAdminGrading() {
  return request<{
    items: AdminGradingV2[];
    legacyItems?: AdminGrading[];
    total: number;
  }>("/v1/admin/grading");
}
export function getAdminGradingDetail(id: string) {
  return request<AdminGradingDetail>(
    `/v1/admin/grading/${encodeURIComponent(id)}`,
  );
}
export function getAdminGradingStats() {
  return request<AdminGradingStats>("/v1/admin/grading/stats");
}
export function getAdminGraderAccounts() {
  return request<{ items: AdminGraderAccount[]; total: number }>(
    "/v1/admin/grader-accounts",
  );
}
export function createAdminGraderAccount(input: {
  username: string;
  displayName: string;
  password: string;
  subjectIds: string[];
}) {
  return request<AdminGraderAccount>("/v1/admin/grader-accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function updateAdminGraderAccount(
  id: string,
  input: Partial<{
    displayName: string;
    password: string;
    subjectIds: string[];
    status: "active" | "disabled";
  }>,
) {
  return request<AdminGraderAccount>(
    `/v1/admin/grader-accounts/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function assignAdminGrading(
  id: string,
  input: { graderId: string; dueAt: string; reason: string },
) {
  return request(`/v1/admin/grading/${encodeURIComponent(id)}/assign`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function reassignAdminGrading(
  id: string,
  input: { graderId: string; dueAt: string; reason: string },
) {
  return request(`/v1/admin/grading/${encodeURIComponent(id)}/reassign`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function recallAdminGrading(id: string, input: { reason: string }) {
  return request(`/v1/admin/grading/${encodeURIComponent(id)}/recall`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function queueAdminGradingManual(id: string) {
  return request(`/v1/admin/grading/${encodeURIComponent(id)}/queue-manual`, {
    method: "POST",
  });
}
export function publishAdminGrading(id: string) {
  return request<AdminGradingReport>(
    `/v1/admin/grading/${encodeURIComponent(id)}/publish`,
    { method: "POST" },
  );
}
export function selfReviewAdminGrading(
  id: string,
  input: {
    totalScore: number;
    feedback: string;
    improvementAdvice: string;
    pointResults?: unknown[];
    answerAnnotations?: unknown[];
    missedPointIds?: string[];
  },
) {
  return request(`/v1/admin/grading/${encodeURIComponent(id)}/self-review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function claimAdminGrading(id: string) {
  return request<AdminGrading>(
    `/v1/admin/grading/${encodeURIComponent(id)}/claim`,
    { method: "POST" },
  );
}
export function submitAdminGrading(
  id: string,
  score: number,
  feedback: string,
) {
  return request<AdminGrading>(
    `/v1/admin/grading/${encodeURIComponent(id)}/submit`,
    { method: "POST", body: JSON.stringify({ score, feedback }) },
  );
}
export function getAdminProducts() {
  return request<{ items: AdminProduct[]; total: number }>(
    "/v1/admin/products",
  );
}
export function createAdminProduct(
  input: Pick<
    AdminProduct,
    "name" | "category" | "price" | "originalPrice" | "benefits"
  >,
) {
  return request<AdminProduct>("/v1/admin/products", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function updateAdminProduct(
  id: string,
  input: Partial<AdminProduct> & { priceReason?: string; updatedAt?: string },
) {
  return request<AdminProduct>(`/v1/admin/products/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function getAdminProductSkus(productId?: string) {
  return request<{ items: AdminProductSku[]; total: number }>(
    `/v1/admin/products/skus${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`,
  );
}
export function updateAdminProductSku(
  productId: string,
  skuId: string,
  input: Partial<
    Pick<AdminProductSku, "name" | "price" | "stock" | "status" | "attributes">
  >,
) {
  return request<AdminProductSku>(
    `/v1/admin/products/${encodeURIComponent(productId)}/skus/${encodeURIComponent(skuId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function getAdminRefunds() {
  return request<{ items: AdminRefund[]; total: number }>("/v1/admin/refunds");
}
export function getAdminOrders() {
  return request<{ items: AdminOrder[]; total: number }>("/v1/admin/orders");
}
export function getAdminOrder(id: string) {
  return request<AdminOrderDetail>(
    `/v1/admin/orders/${encodeURIComponent(id)}`,
  );
}
export function approveAdminRefund(id: string) {
  return request<AdminRefund>(
    `/v1/admin/refunds/${encodeURIComponent(id)}/approve`,
    { method: "POST" },
  );
}
export function reviewAdminRefund(id: string, reason: string) {
  return request<AdminRefund>(
    `/v1/admin/refunds/${encodeURIComponent(id)}/review`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function rejectAdminRefund(id: string, reason: string) {
  return request<AdminRefund>(
    `/v1/admin/refunds/${encodeURIComponent(id)}/reject`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function getAdminCommunityReports() {
  return request<{ items: AdminCommunityReport[]; total: number }>(
    "/v1/admin/community/reports",
  );
}
export function resolveAdminCommunityReport(id: string, resolution: string) {
  return request<AdminCommunityReport>(
    `/v1/admin/community/reports/${encodeURIComponent(id)}/resolve`,
    { method: "POST", body: JSON.stringify({ resolution }) },
  );
}
export function getAdminCommunityPosts() {
  return request<{ items: AdminCommunityPost[]; total: number }>(
    "/v1/admin/community/posts",
  );
}
export function hideAdminCommunityPost(id: string, reason: string) {
  return request<{ id: string; status: string }>(
    `/v1/admin/community/posts/${encodeURIComponent(id)}/hide`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function getAdminCommunityComments() {
  return request<{ items: AdminCommunityComment[]; total: number }>(
    "/v1/admin/community/comments",
  );
}
export function hideAdminCommunityComment(id: string, reason: string) {
  return request<{ id: string; status: string }>(
    `/v1/admin/community/comments/${encodeURIComponent(id)}/hide`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function getAdminCommunityRules() {
  return request<{ items: AdminCommunityRule[]; total: number }>(
    "/v1/admin/community/rules",
  );
}
export function createAdminCommunityRule(
  input: Pick<AdminCommunityRule, "name" | "action" | "keywords">,
) {
  return request<AdminCommunityRule>("/v1/admin/community/rules", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function updateAdminCommunityRule(
  id: string,
  input: Partial<Pick<AdminCommunityRule, "name" | "action" | "keywords">>,
) {
  return request<AdminCommunityRule>(
    `/v1/admin/community/rules/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export interface AdminAnnouncementQuery {
  keyword?: string;
  status?: AdminAnnouncementStatus;
  audienceType?: "all" | "exam_year";
  isPinned?: boolean;
  page?: number;
  pageSize?: number;
  cursor?: number;
}
export function getAdminAnnouncements(query?: AdminAnnouncementQuery) {
  const params = new URLSearchParams();
  if (query?.keyword) params.set("keyword", query.keyword);
  if (query?.status) params.set("status", query.status);
  if (query?.audienceType) params.set("audienceType", query.audienceType);
  if (query?.isPinned !== undefined)
    params.set("isPinned", String(query.isPinned));
  if (query?.page !== undefined) params.set("page", String(query.page));
  if (query?.pageSize !== undefined)
    params.set("pageSize", String(query.pageSize));
  if (query?.cursor !== undefined) params.set("cursor", String(query.cursor));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{
    items: AdminAnnouncement[];
    total: number;
    page?: number;
    pageSize?: number;
    nextCursor?: string;
  }>(`/v1/admin/announcements${suffix}`);
}
export function getAdminAnnouncementStats() {
  return request<AdminAnnouncementStats>("/v1/admin/announcements/stats");
}
export function createAdminAnnouncement(input: AdminAnnouncementInput) {
  return request<AdminAnnouncement>("/v1/admin/announcements", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function updateAdminAnnouncement(
  id: string,
  input: Omit<AdminAnnouncementInput, "status">,
) {
  return request<AdminAnnouncement>(
    `/v1/admin/announcements/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
export function publishAdminAnnouncement(id: string, publishNow = false) {
  return request<AdminAnnouncement>(
    `/v1/admin/announcements/${encodeURIComponent(id)}/publish`,
    { method: "POST", body: JSON.stringify({ publishNow }) },
  );
}
export function withdrawAdminAnnouncement(id: string, reason: string) {
  return request<AdminAnnouncement>(
    `/v1/admin/announcements/${encodeURIComponent(id)}/withdraw`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function deleteAdminAnnouncement(id: string) {
  return request<{ deleted: boolean }>(
    `/v1/admin/announcements/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
export interface AdminBanner {
  id: string;
  title: string;
  imageUrl: string;
  target: string;
  startsAt: string;
  endsAt?: string;
  position?: string;
  sortOrder?: number;
  requiresLogin?: boolean;
}
export interface AdminTemplate {
  id: string;
  code: string;
  channel: string;
  titleTemplate: string;
  bodyTemplate: string;
  status: string;
}
export interface AdminPushJob {
  id: string;
  templateId: string;
  audience: Record<string, unknown>;
  status: string;
  createdAt: string;
}
export function getAdminBanners() {
  return request<{ items: AdminBanner[]; total: number }>("/v1/admin/banners");
}
export function createAdminBanner(input: Omit<AdminBanner, "id">) {
  return request<AdminBanner>("/v1/admin/banners", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function updateAdminBanner(
  id: string,
  input: Partial<Omit<AdminBanner, "id">>,
) {
  return request<AdminBanner>(`/v1/admin/banners/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function deleteAdminBanner(id: string) {
  return request<{ deleted: boolean }>(
    `/v1/admin/banners/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
export function getAdminTemplates() {
  return request<{ items: AdminTemplate[]; total: number }>(
    "/v1/admin/templates",
  );
}
export function createAdminTemplate(
  input: Omit<AdminTemplate, "id" | "status">,
) {
  return request<AdminTemplate>("/v1/admin/templates", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function getAdminPushJobs() {
  return request<{ items: AdminPushJob[]; total: number }>(
    "/v1/admin/push-jobs",
  );
}
export function createAdminPushJob(
  templateId: string,
  audience: Record<string, unknown>,
) {
  return request<AdminPushJob>("/v1/admin/push-jobs", {
    method: "POST",
    body: JSON.stringify({ templateId, audience }),
  });
}
export function cancelAdminPushJob(id: string) {
  return request<AdminPushJob>(
    `/v1/admin/push-jobs/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  );
}
export function getAdminAIQuotas() {
  return request<{ items: AdminAIQuota[]; total: number }>(
    "/v1/admin/ai/quotas",
  );
}
export function updateAdminAIQuota(
  userId: string,
  dailyLimit: number,
  monthlyLimit: number,
) {
  return request<AdminAIQuota>(
    `/v1/admin/ai/quotas/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: JSON.stringify({ dailyLimit, monthlyLimit }) },
  );
}
export function getAdminAIProviders() {
  return request<{ items: AdminAIProvider[] }>("/v1/admin/ai/providers");
}
export function getAdminAIFlags() {
  return request<{ items: AdminAIFlag[]; total: number }>("/v1/admin/ai/flags");
}
export function getAdminAIUsage() {
  return request<{ items: AdminAIUsage[]; total: number; generatedAt: string }>(
    "/v1/admin/ai/usage",
  );
}
export function getAdminAnalytics() {
  return request<AdminAnalytics>("/v1/admin/analytics/overview");
}
export function createAdminExport(
  resourceType: string,
  filters: Record<string, unknown> = {},
) {
  return request<{ id: string; status: string; note: string }>(
    "/v1/admin/exports",
    { method: "POST", body: JSON.stringify({ resourceType, filters }) },
  );
}
export function getAdminAuditLogs() {
  return request<{ items: AdminAuditLog[]; total: number }>(
    "/v1/admin/audit-logs",
  );
}
export function getAdminSettings() {
  return request<AdminSettings>("/v1/admin/settings");
}
export function updateAdminSettings(
  input: Pick<AdminSettings, "refundReviewThreshold" | "examDate"> & {featureFlags?: Record<string, boolean>},
) {
  return request<AdminSettings>("/v1/admin/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function getAdminHealth() {
  return request<AdminHealth>("/v1/admin/health");
}

export function getAdminCollection(path: string) {
  return request<{ items: Array<Record<string, unknown>>; total: number }>(
    path,
  );
}

export interface GraderProfile {
  id: string;
  username: string;
  displayName: string;
  subjectIds: string[];
}
export type GradingPointStatus = "hit" | "partial" | "missed";
export type GradingAnnotationType =
  "correct" | "score" | "error" | "highlight" | "comment";
export interface GradingAnswerAnnotation {
  id: string;
  subQuestionId: string;
  start: number;
  end: number;
  quote: string;
  type: GradingAnnotationType;
  comment?: string;
  scoreDelta?: number;
}
export interface GraderAssignment {
  id: string;
  submissionId: string;
  graderId?: string;
  status: string;
  createdAt: string;
  claimedAt?: string;
  dueAt?: string;
  submittedAt?: string;
  returnReason?: string;
  submission?: {
    id: string;
    questionId: string;
    rubricId: string;
    status: string;
    createdAt: string;
  };
  rubric?: { title: string; subjectId: string; totalScore: number };
  paper?: { id: string; title: string };
  ai?: { status: string; suggestedScore?: number };
  review?: { totalScore: number; status: string };
}
export interface GraderTaskDetail {
  assignment: GraderAssignment;
  submission: {
    id: string;
    questionId: string;
    status: string;
    answers: Array<{
      subQuestionId: string;
      text: string;
      attachments: string[];
    }>;
  };
  rubric?: {
    title: string;
    subjectId: string;
    caseMaterial: string;
    gradingBasis: string;
    totalScore: number;
    subQuestions: Array<{ id: string; prompt: string; maxScore: number }>;
    points: Array<{
      id: string;
      title: string;
      description: string;
      maxScore: number;
      legalReferences: string[];
    }>;
  };
  ai?: {
    status?: string;
    suggestedScore?: number;
    result?: {
      pointResults: Array<{
        pointId: string;
        suggestedScore: number;
        status: string;
        evidence: string;
      }>;
      feedback: string;
      needsHumanAttention: boolean;
    };
  };
  review?: {
    totalScore: number;
    pointResults: Array<{
      pointId: string;
      score: number;
      status: GradingPointStatus;
      comment?: string;
      evidence?: string;
    }>;
    answerAnnotations: GradingAnswerAnnotation[];
    missedPointIds: string[];
    feedback: string;
    improvementAdvice: string;
    aiOverrideReason?: string;
    status: string;
    createdAt: string;
  };
}
export interface GraderStats {
  graderId: string;
  todayCompleted: number;
  totalCompleted: number;
  inProgress: number;
  returned: number;
}

async function graderRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token =
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("debao_grader_token")
      : null;
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      payload?.error?.message ?? `请求失败（${response.status}）`,
    );
  return payload.data ?? payload;
}
export async function loginGrader(username: string, password: string) {
  const result = await graderRequest<{
    accessToken: string;
    grader: GraderProfile;
  }>("/v1/grader/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  window.sessionStorage.setItem("debao_grader_token", result.accessToken);
  return result.grader;
}
export async function logoutGrader() {
  try {
    await graderRequest("/v1/grader/auth/logout", { method: "POST" });
  } finally {
    window.sessionStorage.removeItem("debao_grader_token");
  }
}
export function getCurrentGrader() {
  return graderRequest<GraderProfile>("/v1/grader/me");
}
export function getGraderTasks(mine = false) {
  return graderRequest<{ items: GraderAssignment[]; total: number }>(
    `/v1/grader/tasks${mine ? "?mine=true" : ""}`,
  );
}
export function getGraderTask(id: string) {
  return graderRequest<GraderTaskDetail>(
    `/v1/grader/tasks/${encodeURIComponent(id)}`,
  );
}
export function claimGraderTask(id: string) {
  return graderRequest<GraderAssignment>(
    `/v1/grader/tasks/${encodeURIComponent(id)}/claim`,
    { method: "POST" },
  );
}
export function returnGraderTask(id: string, reason: string) {
  return graderRequest<GraderAssignment>(
    `/v1/grader/tasks/${encodeURIComponent(id)}/return`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
export function submitGraderReview(
  id: string,
  input: {
    totalScore: number;
    pointResults: Array<{
      pointId: string;
      score: number;
      status: GradingPointStatus;
      comment?: string;
      evidence?: string;
    }>;
    answerAnnotations: GradingAnswerAnnotation[];
    missedPointIds: string[];
    feedback: string;
    improvementAdvice: string;
    aiOverrideReason?: string;
  },
) {
  return graderRequest(`/v1/grader/tasks/${encodeURIComponent(id)}/review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function getGraderStats() {
  return graderRequest<GraderStats>("/v1/grader/stats");
}
