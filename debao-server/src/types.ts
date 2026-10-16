export type OrderStatus = 'paid' | 'pending' | 'closed' | 'cancelled' | 'refund_requested' | 'refunded';

export interface Subject {
  id: string;
  name: string;
  questionCount: number;
  color: string;
  questionType?: 'objective' | 'subjective' | 'both';
  chapters?: Array<{id: string; name: string; questionType: 'objective' | 'subjective' | 'both'; points: Array<{id: string; name: string}>}>;
}

export interface Course {
  id: string;
  title: string;
  teacher: string;
  type: 'video' | 'audio' | 'live' | 'mixed';
  progress: number;
  lessons: number;
  accent: string;
  /** Optional commerce linkage supplied by content imports. */
  productId?: string;
  isHot?: boolean;
  hotSortOrder?: number;
  price?: number;
  originalPrice?: number;
  /** Personalized access state added by authenticated course endpoints. */
  hasAccess?: boolean;
  sourceOrderId?: string;
  expiresAt?: string;
  status?: 'draft' | 'scheduled' | 'published' | 'offline' | 'archived';
  updatedAt?: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  status: 'draft' | 'scheduled' | 'published' | 'withdrawn';
  startsAt?: string;
  endsAt?: string;
  isPinned: boolean;
  audienceType: 'all' | 'exam_year';
  audienceValue?: string;
  deepLink?: string;
  publishedAt?: string;
  withdrawnAt?: string;
  withdrawalReason?: string;
  updatedAt: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  originalPrice: number;
  sold: number;
  accent: string;
  benefits: string[];
  status?: 'draft' | 'on_sale' | 'off_sale' | 'archived';
  updatedAt?: string;
  /** Optional sellable variants and inventory managed by the server. */
  skus?: ProductSku[];
}

export interface ProductSku {
  id: string;
  productId: string;
  name: string;
  price: number;
  stock: number;
  status: 'active' | 'disabled';
  attributes: Record<string, string>;
  updatedAt: string;
}

export interface Coupon {
  code: string;
  type: 'amount' | 'percentage';
  value: number;
  minAmount: number;
  maxDiscount?: number;
  startsAt: string;
  endsAt: string;
  usageLimit?: number;
  usedCount: number;
  status: 'active' | 'disabled';
}

export interface Order {
  id: string;
  userId?: string;
  productName: string;
  amount: number;
  status: OrderStatus;
  createdAt: string;
  productId: string;
  clientRequestId?: string;
  skuId?: string;
  couponCode?: string;
  discountAmount?: number;
  expiresAt?: string;
  paidAt?: string;
  closedAt?: string;
  refundedAt?: string;
}

export interface OrderEvent {
  id: string;
  orderId: string;
  type: 'created' | 'paid' | 'cancelled' | 'expired' | 'refund_requested' | 'refunded' | 'refund_rejected';
  actor: 'user' | 'system' | 'admin' | 'provider';
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface LearningActivity {
  id: string;
  userId: string;
  kind: 'question' | 'course' | 'task' | 'reading';
  subjectId?: string;
  questionId?: string;
  courseId?: string;
  taskId?: string;
  durationSeconds: number;
  quantity: number;
  idempotencyKey?: string;
  occurredAt: string;
}

export type LearningDiagnosticDimensionCode = 'foundation' | 'time' | 'discipline' | 'comprehension' | 'memory' | 'practice';
/** Dimension codes are configurable by the learning team; built-ins are only the seeded defaults. */
export type LearningDiagnosticDimension = string;
export type LearningDiagnosticQuestionStatus = 'draft' | 'published' | 'disabled';
export type LearningDiagnosticQuestionType = 'single' | 'multiple' | 'scale' | 'text' | 'number';

export interface LearningDiagnosticDimensionDefinition {
  code: string;
  label: string;
  description?: string;
  color?: string;
  sortOrder: number;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface LearningDiagnosticForm {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  estimatedMinutes: number;
  submitLabel: string;
  successTitle: string;
  successDescription: string;
  status: 'draft' | 'published' | 'disabled';
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface LearningDiagnosticOption {
  id: string;
  label: string;
  score: number;
  sortOrder: number;
}

export interface LearningDiagnosticQuestion {
  id: string;
  formId: string;
  stem: string;
  description?: string;
  section?: string;
  placeholder?: string;
  validation?: {min?: number; max?: number; minLength?: number; maxLength?: number};
  type: LearningDiagnosticQuestionType;
  dimension: LearningDiagnosticDimension;
  required: boolean;
  sortOrder: number;
  status: LearningDiagnosticQuestionStatus;
  version: number;
  options: LearningDiagnosticOption[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface LearningDiagnosticAttempt {
  id: string;
  userId: string;
  answers: Array<{questionId: string; optionIds: string[]; value?: string | number}>;
  questionSnapshot: LearningDiagnosticQuestion[];
  scores: Record<LearningDiagnosticDimension, number>;
  status: 'submitted';
  startedAt: string;
  submittedAt: string;
}

export type LearningQuestionCategory = 'objective' | 'subjective';
export type LearningQuestionType = 'true_false' | 'single' | 'indeterminate' | 'multiple' | 'short_answer' | 'case_analysis';
export type LearningQuestionStatus = 'draft' | 'published' | 'disabled';
export type LearningQuestionUsageScene = 'diagnostic' | 'daily_practice' | 'stage_test' | 'wrong_review';

export interface LearningQuestionOption {
  key: string;
  label: string;
}

export interface LearningQuestionSubQuestion {
  id: string;
  prompt: string;
  referenceAnswer: string;
  analysis?: string;
  score: number;
}

/** Independent question bank used by the learning-plan recommendation engine. */
export interface LearningQuestionBankQuestion {
  id: string;
  category: LearningQuestionCategory;
  questionType: LearningQuestionType;
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
  options: LearningQuestionOption[];
  correctAnswers: string[];
  analysis: string;
  explanationMediaType?: 'audio' | 'video';
  explanationMediaReference?: string;
  explanationMediaVisible?: boolean;
  caseMaterial?: string;
  subQuestions: LearningQuestionSubQuestion[];
  estimatedMinutes: number;
  source?: string;
  sourceYear?: number;
  usageScenes: LearningQuestionUsageScene[];
  status: LearningQuestionStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedSnapshot?: Pick<LearningStagePlanConfig, 'dailyMinutes' | 'studyDays' | 'durationDays' | 'makeupPolicy'>;
}

export type LearningCardContentType = 'image_gallery' | 'html' | 'pdf';
export type LearningCardStatus = 'draft' | 'published' | 'disabled';
export interface LearningCardAsset {
  id: string;
  type: 'image' | 'html' | 'pdf';
  filename: string;
  reference: string;
  sizeBytes: number;
  sortOrder: number;
}
export interface LearningCardRecallItem {
  id: string;
  prompt: string;
  answer: string;
  sortOrder: number;
}
export interface LearningCard {
  id: string;
  title: string;
  description?: string;
  contentType: LearningCardContentType;
  assets: LearningCardAsset[];
  recallItems: LearningCardRecallItem[];
  sortOrder: number;
  status: LearningCardStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export type LearningQuestionTaxonomyNodeType = 'subject' | 'chapter' | 'point' | 'subpoint';
export interface LearningQuestionTaxonomyNode {
  id: string;
  category: LearningQuestionCategory;
  type: LearningQuestionTaxonomyNodeType;
  parentId?: string;
  code: string;
  name: string;
  sortOrder: number;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export type LearningStageStatus = 'active' | 'disabled';
export type LearningStageConditionOperator = 'gte' | 'lte' | 'between';

export interface LearningClassType {
  id: string;
  code: string;
  name: string;
  productId?: string;
  description?: string;
  endDate: string;
  sortOrder: number;
  status: LearningStageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LearningStageCondition {
  dimension: LearningDiagnosticDimension;
  operator: LearningStageConditionOperator;
  value: number;
  upperValue?: number;
}

export interface LearningStage {
  id: string;
  classTypeId?: string;
  code: string;
  name: string;
  description?: string;
  conditions: LearningStageCondition[];
  sortOrder: number;
  status: LearningStageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LearningTeacher {
  id: string;
  stageId: string;
  name: string;
  subject: string;
  specialty: string;
  sortOrder: number;
  status: LearningStageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LearningTeacherAssignment {
  id: string;
  userId: string;
  attemptId: string;
  classTypeId?: string;
  stageId?: string;
  teacherId?: string;
  scores: Record<LearningDiagnosticDimension, number>;
  status: 'assigned' | 'pending';
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export type LearningPlanContentType = 'course' | 'question' | 'subjective' | 'assessment' | 'card' | 'task';
export type LearningPlanMakeupPolicy = 'spread' | 'weekend';
export type LearningCardUnlockRule = 'after_course_checkin' | 'after_previous_content' | 'immediate';
export type LearningQuestionSelectionStrategy = 'profile';
export interface LearningStagePlanConfig {
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
  makeupPolicy: LearningPlanMakeupPolicy;
  cardUnlockRule: LearningCardUnlockRule;
  questionPushCount: number;
  questionSelectionStrategy: LearningQuestionSelectionStrategy;
  status: 'draft' | 'published';
  version: number;
  publishedAt?: string;
  publishedSnapshot?: {totalMinutes: number; dailyMinutes: number; minDailyMinutes: number; maxDailyMinutes: number; weekdayMinMinutes: number; weekdayMaxMinutes: number; weekendMinMinutes: number; weekendMaxMinutes: number; holidayMinMinutes: number; holidayMaxMinutes: number; holidayDates: string[]; studyDays: number[]; durationDays: number; makeupPolicy: LearningPlanMakeupPolicy; cardUnlockRule: LearningCardUnlockRule; questionPushCount: number; questionSelectionStrategy: LearningQuestionSelectionStrategy};
  updatedAt: string;
}
export interface LearningStagePlanItem {
  id: string;
  stageId: string;
  contentType: LearningPlanContentType;
  contentId?: string;
  /** Objective point/subpoint IDs covered by an external course. */
  knowledgePointIds?: string[];
  title: string;
  description?: string;
  /** Optional legacy estimate. New stage content is scheduled by the stage rules, not per-item duration. */
  minutes?: number;
  weekDay?: number;
  /** Optional override for a question slot; falls back to the stage rule. */
  questionCount?: number;
  sortOrder: number;
  required: boolean;
}
export interface LearningSubjectiveSubmission {
  id: string;
  userId: string;
  taskId: string;
  questionId: string;
  answers: Array<{subQuestionId: string; text: string}>;
  submittedAt: string;
}

export interface AttachmentUpload {
  id: string;
  userId: string;
  filename: string;
  contentType: 'image/jpeg' | 'image/png' | 'application/pdf';
  sizeBytes: number;
  sha256?: string;
  status: 'pending' | 'completed' | 'rejected' | 'expired';
  uploadToken: string;
  expiresAt: string;
  completedAt?: string;
  createdAt: string;
}

/** A user-owned AI conversation. Provider credentials never leave the server. */
export interface AISession {
  id: string;
  userId: string;
  title: string;
  clientRequestId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface AIMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  clientRequestId?: string;
  createdAt: string;
}

/** Provider usage telemetry recorded for every AI request.  Token/cost fields
 * are optional because unconfigured/local providers may not expose billing
 * metadata; in that case the event still records the request outcome. */
export interface AIUsageEvent {
  id: string;
  userId?: string;
  sessionId?: string;
  messageId?: string;
  provider: string;
  model?: string;
  feature: string;
  status: 'completed' | 'failed' | 'blocked_quota';
  inputTokens?: number;
  outputTokens?: number;
  costMinor?: number;
  errorCode?: string;
  createdAt: string;
}

/** A safety/risk signal emitted by an AI provider or server policy. */
export interface AIRiskFlag {
  id: string;
  userId?: string;
  sessionId?: string;
  messageId?: string;
  risk: string;
  reason: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface AIQuota {
  userId: string;
  dailyLimit: number;
  monthlyLimit: number;
  updatedAt: string;
  updatedBy?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  phone: string;
  examYear: string;
  studyDays: number;
  avatarColor?: string;
  avatarUrl?: string;
}

export type SmsPurpose = 'login' | 'bind_phone' | 'change_phone_old' | 'change_phone_new' | 'delete_account' | 'link_identity' | 'unlink_identity';

export interface VerificationChallenge {
  phone: string;
  purpose: SmsPurpose;
  providerMessageId: string;
  requestIp?: string;
  deviceId?: string;
  requestedAt: string;
  expiresAt: string;
  attempts: number;
  codeHash?: string;
  consumedAt?: string;
}

export interface AccountDeletionRequest {
  userId: string;
  requestedAt: string;
  executeAfter: string;
  cancelledAt?: string;
  completedAt?: string;
}

export interface UserIdentity {
  userId: string;
  provider: 'wechat';
  providerUserId: string;
  unionId?: string;
  nickname?: string;
  createdAt: string;
}

export interface PhoneBindingTicket {
  provider: 'wechat';
  providerUserId: string;
  unionId?: string;
  nickname?: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface Question {
  id: string;
  /** Stable subject key used by both app and admin filtering. */
  subjectId?: string;
  stem: string;
  options: string[];
  answer: number;
  /** Optional answer set for multiple-choice questions. For single-choice rows this is omitted. */
  answerIndexes?: number[];
  questionType?: 'true_false' | 'single' | 'multiple' | 'indeterminate';
  chapterId?: string;
  pointId?: string;
  analysis: string;
  explanationMediaType?: 'audio' | 'video';
  explanationMediaReference?: string;
  status?: 'draft' | 'review' | 'published' | 'disabled' | 'archived';
  version?: number;
  source?: string;
  updatedAt?: string;
}

export type ObjectiveSessionStatus = 'in_progress' | 'submitted' | 'expired';
export interface ObjectiveSessionAnswer {
  questionId: string;
  answers: string[];
  updatedAt: string;
}
export interface ObjectiveQuestionSnapshot {
  id: string;
  subjectId?: string;
  stem: string;
  options: string[];
  answer: number;
  answerIndexes?: number[];
  questionType?: 'true_false' | 'single' | 'multiple' | 'indeterminate';
  analysis: string;
  explanationMediaType?: 'audio' | 'video';
  explanationMediaReference?: string;
  version: number;
  source?: string;
}
export interface ObjectiveSession {
  id: string;
  userId: string;
  mode: 'chapter' | 'year' | 'random' | 'exam';
  title: string;
  subjectId?: string;
  paperId?: string;
  /** Links a session to a private-coach curriculum task. */
  learningTaskId?: string;
  questionIds: string[];
  questions: ObjectiveQuestionSnapshot[];
  answers: ObjectiveSessionAnswer[];
  durationSeconds: number;
  startedAt: string;
  expiresAt: string;
  status: ObjectiveSessionStatus;
  /** Idempotency key used when creating the session. */
  createIdempotencyKey?: string;
  /** Idempotency key used when submitting the session. */
  submissionIdempotencyKey?: string;
  /** Legacy alias retained when reading pre-023 rows. */
  idempotencyKey?: string;
  reportId?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface ObjectiveReportResult {
  questionId: string;
  subjectId?: string;
  stem: string;
  options: string[];
  questionType?: 'true_false' | 'single' | 'multiple' | 'indeterminate';
  version: number;
  answers: string[];
  correctAnswers: string[];
  correct: boolean;
  analysis: string;
  explanationMediaType?: 'audio' | 'video';
  explanationMediaReference?: string;
}
export interface ObjectiveReport {
  id: string;
  sessionId: string;
  userId: string;
  mode: ObjectiveSession['mode'];
  title: string;
  total: number;
  answered: number;
  correct: number;
  score: number;
  maxScore: number;
  results: ObjectiveReportResult[];
  subjectStats: Array<{subjectId: string; total: number; correct: number; correctRate: number}>;
  submittedAt: string;
}

/** Immutable metadata captured when a standalone answer is submitted. */
export type QuestionSubmissionSnapshot = ObjectiveQuestionSnapshot;

export type GradingSubmissionStatus =
  | 'submitted'
  | 'ai_queued'
  | 'ai_processing'
  | 'ai_completed'
  | 'ai_failed'
  | 'manual_queued'
  | 'manual_claimed'
  | 'manual_submitted'
  | 'supervisor_review'
  | 'manual_returned'
  | 'manual_expired'
  | 'published'
  | 'appealed'
  | 'cancelled';

export interface GradingRubricPoint {
  id: string;
  title: string;
  description: string;
  maxScore: number;
  sortOrder: number;
  keywords: string[];
  legalReferences: string[];
}

export interface GradingRubric {
  id: string;
  questionId: string;
  questionVersion: number;
  title: string;
  subjectId: string;
  chapterId?: string;
  pointId?: string;
  caseMaterial: string;
  subQuestions: Array<{id: string; prompt: string; maxScore: number}>;
  gradingBasis: string;
  totalScore: number;
  suggestedMinutes: number;
  allowedAnswerTypes: Array<'text' | 'image' | 'pdf'>;
  points: GradingRubricPoint[];
  status: 'draft' | 'review' | 'published' | 'disabled' | 'archived';
  versionReason?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface GradingPaper {
  id: string;
  title: string;
  subjectId: string;
  year?: string;
  totalScore: number;
  questionIds: string[];
  status: 'draft' | 'published' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface GradingSubmission {
  id: string;
  userId: string;
  paperId?: string;
  questionId: string;
  rubricId: string;
  questionVersion: number;
  idempotencyKey: string;
  answerHash: string;
  answers: Array<{subQuestionId: string; text: string; attachments: string[]}>;
  status: GradingSubmissionStatus;
  aiFailureReason?: string;
  currentAssignmentId?: string;
  latestReportId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GradingAIRun {
  id: string;
  submissionId: string;
  provider: string;
  model?: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  suggestedScore?: number;
  result?: {pointResults: Array<{pointId: string; suggestedScore: number; status: 'hit' | 'partial' | 'miss'; evidence: string}>; feedback: string; needsHumanAttention: boolean};
  failureReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  costMinor?: number;
  createdAt: string;
  completedAt?: string;
}

export interface GradingAssignment {
  id: string;
  submissionId: string;
  graderId?: string;
  status: 'available' | 'claimed' | 'submitted' | 'returned' | 'expired' | 'cancelled';
  claimedAt?: string;
  dueAt?: string;
  submittedAt?: string;
  returnReason?: string;
  createdAt: string;
}

export type GradingPointStatus = 'hit' | 'partial' | 'missed';
export type GradingAnnotationType = 'correct' | 'score' | 'error' | 'highlight' | 'comment';

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

export interface GradingReview {
  id: string;
  submissionId: string;
  assignmentId: string;
  graderId?: string;
  reviewerType?: 'grader' | 'admin';
  reviewerAdminId?: string;
  totalScore: number;
  pointResults: Array<{pointId: string; score: number; status: GradingPointStatus; comment?: string; evidence?: string}>;
  answerAnnotations: GradingAnswerAnnotation[];
  missedPointIds: string[];
  feedback: string;
  improvementAdvice: string;
  aiOverrideReason?: string;
  status: 'submitted' | 'approved' | 'rejected';
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface GradingReport {
  id: string;
  submissionId: string;
  reviewId: string;
  version: number;
  totalScore: number;
  maxScore: number;
  answers: Array<{subQuestionId: string; text: string; attachments: string[]}>;
  pointResults: Array<{pointId: string; title: string; score: number; maxScore: number; status: GradingPointStatus; comment?: string; evidence?: string}>;
  answerAnnotations: GradingAnswerAnnotation[];
  missedPointIds: string[];
  feedback: string;
  improvementAdvice: string;
  publishedBy: string;
  publishedAt: string;
}

export interface GraderAccount {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  subjectIds: string[];
  createdAt: string;
}

export interface GradingEvent {
  id: string;
  submissionId: string;
  eventType: string;
  actorType: 'user' | 'grader' | 'admin' | 'system';
  actorId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type ForumCategory = '经验分享' | '答疑求助' | '知识整理' | '技巧方法';

export interface ForumPost {
  id: string;
  userId: string;
  userName: string;
  category: ForumCategory;
  title: string;
  body: string;
  likes: number;
  status: 'published';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ForumComment {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
  deletedAt?: string;
}

export interface LegalDocument {
  id: string;
  title: string;
  article: string;
  content: string;
  documentCode?: string;
  sourceUrl?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  status?: 'draft' | 'published' | 'disabled';
  version?: number;
  updatedAt?: string;
  subjectId?: string;
}

export interface LegalFavorite {
  id: string;
  userId: string;
  legalDocumentId: string;
  documentVersion: number;
  article: string;
  title: string;
  content: string;
  subjectId?: string;
  effectiveFrom?: string;
  createdAt: string;
}

export interface AppLegalDocument {
  key: 'terms' | 'privacy' | 'sdk-list' | 'account-deletion';
  title: string;
  version: number;
  updatedAt: string;
  status: 'draft' | 'published' | 'disabled';
  sections: Array<{title: string; body: string}>;
}

export interface UserSettings {
  userId: string;
  learningReminders: boolean;
  courseUpdates: boolean;
  orderNotifications: boolean;
  updatedAt: string;
}

export interface Store {
  learningInquiries: Array<{
    id: string; userId: string; reportId: string; questionId: string;
    question: ObjectiveReportResult; reason: string; status: 'pending' | 'answered';
    reply?: string; teacherName?: string; repliedBy?: string;
    createdAt: string; repliedAt?: string; clientRequestId: string;
  }>;
  profiles: Map<string, UserProfile>;
  subjects: Subject[];
  courses: Course[];
  courseSections: Array<{id: string; courseId: string; title: string; sortOrder: number; updatedAt: string}>;
  courseLessons: Array<{id: string; sectionId: string; title: string; mediaKind: 'video' | 'audio' | 'live' | 'document'; mediaReference?: string; handoutReference?: string; durationSeconds: number; trialEnabled: boolean; sortOrder: number; materialCategory?: string; materialKind?: 'article' | 'material'; downloadable?: boolean; articleContent?: string; updatedAt: string}>;
  liveSessions: Array<{id: string; courseId: string; lessonId?: string; title: string; teacher: string; startsAt: string; endsAt: string; provider?: 'polyv' | 'tencent'; providerRoomId?: string; recordingVideoId?: string; playUrl?: string; recordingUrl?: string; status: 'scheduled' | 'live' | 'completed' | 'cancelled'; notificationStatus: 'not_required' | 'sent' | 'unavailable' | 'failed'; updatedAt: string}>;
  products: Product[];
  productSkus: ProductSku[];
  coupons: Coupon[];
  orders: Order[];
  orderEvents: OrderEvent[];
  questions: Question[];
  objectiveSessions: ObjectiveSession[];
  objectiveReports: ObjectiveReport[];
  papers: Array<{id: string; name: string; year: string; volume: string; mode: string; durationMinutes: number; totalScore: number; questionIds: string[]; productId?: string; status: 'draft' | 'published' | 'archived'; version: number; updatedAt: string}>;
  /** In-memory fallback for answer drafts. The key is userId:questionId. */
  drafts: Map<string, {userId: string; questionId: string; answers: string[]; updatedAt: string}>;
  sessions: Map<string, {userId: string; refreshToken: string; deviceId: string; expiresAt: string; revokedAt?: string}>;
  identities: UserIdentity[];
  bindingTickets: Map<string, PhoneBindingTicket>;
  verificationChallenges: VerificationChallenge[];
  deletionRequests: Map<string, AccountDeletionRequest>;
  devices: Array<{id: string; userId: string; platform: 'android' | 'ios' | 'harmony'; name: string; pushToken?: string; lastSeenAt: string}>;
  submissions: Array<{id: string; userId: string; questionId: string; answers: string[]; correct: boolean; createdAt: string; questionSnapshot?: QuestionSubmissionSnapshot; idempotencyKey?: string}>;
  learningPlans: Array<{id: string; userId: string; title: string; dailyMinutes: number; startDate: string; endDate: string; status: 'active' | 'completed' | 'archived'; classTypeId?: string; stageId?: string; autoGenerated?: boolean; version?: number; changeReason?: string; generatedThrough?: string; contentCursor?: number; contentOffsetMinutes?: number; earlyUnlockedThrough?: string; updatedAt?: string; pausedAt?: string; pausedUntil?: string; pauseReason?: string}>;
  learningEarlyAccessRequests: Array<{id: string; userId: string; planId: string; requestedThrough: string; status: 'pending' | 'approved' | 'rejected'; reason?: string; reviewedBy?: string; reviewedAt?: string; createdAt: string}>;
  learningTasks: Array<{cardRecall?: {version: number; items: Array<{id: string; prompt: string; answer: string; rating: string}>}; id: string; planId: string; title: string; description?: string; dueDate: string; minutes: number; status: 'todo' | 'done' | 'overdue'; completedAt?: string; subjectId?: string; contentType?: LearningPlanContentType; contentId?: string; locked?: boolean}>;
  learningSubjectiveSubmissions: LearningSubjectiveSubmission[];
  learningPlanVersions: Array<{id: string; planId: string; version: number; reason: string; source: 'auto' | 'admin' | 'publish' | 'user'; snapshot: {plan: Store['learningPlans'][number]; tasks: Store['learningTasks'];}; createdBy?: string; createdAt: string}>;
  favorites: Array<{id: string; userId: string; questionId: string; createdAt: string}>;
  legalFavorites: LegalFavorite[];
  mistakes: Array<{id: string; userId: string; questionId: string; wrongCount: number; lastAnswer: string; resolved: boolean}>;
  entitlements: Array<{userId: string; courseId: string; sourceOrderId: string; expiresAt?: string}>;
  courseProgress: Array<{userId: string; courseId: string; progress: number; updatedAt: string}>;
  learningActivities: LearningActivity[];
  learningActivityKeys: Set<string>;
  learningDiagnosticQuestions: LearningDiagnosticQuestion[];
  learningDiagnosticDimensions: LearningDiagnosticDimensionDefinition[];
  learningDiagnosticForms: LearningDiagnosticForm[];
  learningDiagnosticAttempts: LearningDiagnosticAttempt[];
  learningQuestionBankQuestions: LearningQuestionBankQuestion[];
  learningQuestionTaxonomyNodes: LearningQuestionTaxonomyNode[];
  learningCards: LearningCard[];
  learningClassTypes: LearningClassType[];
  learningStages: LearningStage[];
  learningTeachers: LearningTeacher[];
  learningTeacherAssignments: LearningTeacherAssignment[];
  learningStagePlanConfigs: LearningStagePlanConfig[];
  learningStagePlanItems: LearningStagePlanItem[];
  learningAssessmentPapers: Array<{id: string; title: string; subjectId: string; questionIds: string[]; durationMinutes: number; status: 'draft' | 'published' | 'archived'; createdAt: string; updatedAt: string}>;
  notificationReceipts: Set<string>;
  grading: Array<{id: string; userId: string; questionId?: string; fileUrl?: string; status: 'queued' | 'processing' | 'completed' | 'rejected'; score?: number; feedback?: string; assignedAdminId?: string; claimedAt?: string; version?: number; createdAt: string}>;
  gradingRubrics: GradingRubric[];
  gradingPapers: GradingPaper[];
  gradingSubmissions: GradingSubmission[];
  gradingAiRuns: GradingAIRun[];
  gradingAssignments: GradingAssignment[];
  gradingReviews: GradingReview[];
  gradingReports: GradingReport[];
  graderAccounts: GraderAccount[];
  graderSessions: Map<string, {graderId: string; expiresAt: string; revokedAt?: string}>;
  gradingEvents: GradingEvent[];
  gradingCredits: Map<string, number>;
  gradingCreditLedger: Array<{id: string; userId: string; submissionId: string; delta: number; balanceAfter: number; createdAt: string}>;
  announcements: Announcement[];
  banners: Array<{id: string; title: string; imageUrl: string; target: string; startsAt: string; endsAt?: string; position?: string; sortOrder?: number; requiresLogin?: boolean}>;
  legalDocuments: LegalDocument[];
  appLegalDocuments: AppLegalDocument[];
  userSettings: Map<string, UserSettings>;
  forumPosts: ForumPost[];
  forumComments: ForumComment[];
  forumLikes: Set<string>;
  forumFavorites: Set<string>;
  userRestrictions: Map<string, {type: 'login' | 'community'; reason: string; expiresAt?: string; createdAt: string}>;
  entitlementAdjustments: Array<{id: string; userId: string; courseId?: string; type: 'grant' | 'revoke'; reason: string; sourceReference?: string; expiresAt?: string; createdAt: string}>;
  refunds: Array<{
    id: string;
    orderId: string;
    userId?: string;
    reason: string;
    amount: number;
    status: 'requested' | 'reviewing' | 'completed' | 'rejected';
    createdAt: string;
    reviewReason?: string;
    reviewedAt?: string;
    reviewedBy?: string;
    firstReviewedAt?: string;
    firstReviewedBy?: string;
    secondReviewedAt?: string;
    secondReviewedBy?: string;
  }>;
  communityReports: Array<{id: string; postId?: string; commentId?: string; reporterUserId?: string; reason: string; status: 'pending' | 'processing' | 'resolved' | 'rejected'; resolution?: string; createdAt: string; resolvedAt?: string}>;
  attachmentUploads: AttachmentUpload[];
  aiSessions: AISession[];
  aiMessages: AIMessage[];
  aiSessionRequestKeys: Map<string, string>;
  aiMessageRequestKeys: Map<string, string>;
  aiQuotas: Map<string, AIQuota>;
  aiUsage: AIUsageEvent[];
  aiRiskFlags: AIRiskFlag[];
  communityModerationActions: Array<{
    id: string;
    targetType: 'post' | 'comment' | 'user';
    targetId: string;
    action: 'none' | 'hide' | 'delete' | 'warn' | 'restrict' | 'ban';
    reason: string;
    durationSeconds?: number;
    createdBy?: string;
    createdAt: string;
  }>;
  notificationClosures: Set<string>;
}
