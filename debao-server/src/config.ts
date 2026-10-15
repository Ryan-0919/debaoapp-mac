export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl?: string;
  redisUrl?: string;
  authSecret: string;
  paymentAdapter: string;
  smsAdapter: string;
  pushAdapter: string;
  gradingAdapter: string;
  aiAdapter: string;
  mediaAdapter: string;
  wechatAuthAdapter: string;
  carrierAuthAdapter: string;
  adminUsername: string;
  adminPassword: string;
  gradingAdminUsername: string;
  gradingAdminPassword: string;
  learningAdminUsername: string;
  learningAdminPassword: string;
  adminMfaSecret?: string;
  adminMfaRequired: boolean;
  refundReviewThreshold: number;
}

const adapterModes = new Set(['local', 'http', 'aliyun', 'unconfigured']);
function adapterMode(value: string | undefined, fallback: string) {
  const mode = value ?? fallback;
  if (!adapterModes.has(mode)) throw new Error(`Invalid adapter mode: ${mode}`);
  return mode;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  const nodeEnv = (env.NODE_ENV ?? 'development') as ServerConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test or production');
  const authSecret = env.DEBAO_AUTH_SECRET ?? (nodeEnv === 'production' ? '' : 'local-development-only-change-me');
  if (nodeEnv === 'production' && authSecret.length < 32) throw new Error('DEBAO_AUTH_SECRET must be at least 32 characters in production');
  if (nodeEnv === 'production' && !env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
  if (nodeEnv === 'production' && !env.REDIS_URL) throw new Error('REDIS_URL is required in production');
  const adminUsername = env.DEBAO_ADMIN_USERNAME ?? 'admin';
  const adminPassword = env.DEBAO_ADMIN_PASSWORD ?? (nodeEnv === 'production' ? '' : 'change-me-local');
  const gradingAdminUsername = env.DEBAO_GRADING_ADMIN_USERNAME ?? 'grading-admin';
  const gradingAdminPassword = env.DEBAO_GRADING_ADMIN_PASSWORD ?? (nodeEnv === 'production' ? '' : 'local-compose-grading-admin-2026');
  const learningAdminUsername = env.DEBAO_LEARNING_ADMIN_USERNAME ?? 'learning-admin';
  const learningAdminPassword = env.DEBAO_LEARNING_ADMIN_PASSWORD ?? (nodeEnv === 'production' ? '' : 'local-compose-learning-admin-2026');
  if (nodeEnv === 'production' && adminUsername.trim().length < 3) throw new Error('DEBAO_ADMIN_USERNAME must be at least 3 characters in production');
  if (nodeEnv === 'production' && adminPassword.length < 12) throw new Error('DEBAO_ADMIN_PASSWORD must be at least 12 characters in production');
  if (nodeEnv === 'production' && learningAdminPassword.length < 12) throw new Error('DEBAO_LEARNING_ADMIN_PASSWORD must be at least 12 characters in production');
  const adminMfaRequired = env.DEBAO_ADMIN_MFA_REQUIRED === undefined ? nodeEnv === 'production' : env.DEBAO_ADMIN_MFA_REQUIRED === 'true';
  const rawRefundReviewThreshold = env.DEBAO_REFUND_REVIEW_THRESHOLD;
  const refundReviewThreshold = rawRefundReviewThreshold === undefined ? 1000 : Number(rawRefundReviewThreshold.trim());
  if (rawRefundReviewThreshold !== undefined && (!rawRefundReviewThreshold.trim() || !Number.isFinite(refundReviewThreshold) || refundReviewThreshold < 0 || refundReviewThreshold > 1_000_000_000)) {
    throw new Error('DEBAO_REFUND_REVIEW_THRESHOLD must be a finite number between 0 and 1000000000');
  }
  return {
    nodeEnv,
    host: env.HOST ?? '0.0.0.0',
    port,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    authSecret,
    paymentAdapter: adapterMode(env.PAYMENT_ADAPTER, 'unconfigured'),
    smsAdapter: adapterMode(env.SMS_ADAPTER, 'unconfigured'),
    pushAdapter: adapterMode(env.PUSH_ADAPTER, 'unconfigured'),
    gradingAdapter: adapterMode(env.GRADING_ADAPTER, 'unconfigured'),
    aiAdapter: adapterMode(env.AI_ADAPTER, 'unconfigured'),
    mediaAdapter: adapterMode(env.MEDIA_ADAPTER, 'unconfigured'),
    wechatAuthAdapter: adapterMode(env.WECHAT_AUTH_ADAPTER, 'unconfigured'),
    carrierAuthAdapter: adapterMode(env.CARRIER_AUTH_ADAPTER, 'unconfigured'),
    adminUsername,
    adminPassword,
    gradingAdminUsername,
    gradingAdminPassword,
    learningAdminUsername,
    learningAdminPassword,
    adminMfaSecret: env.DEBAO_ADMIN_MFA_SECRET,
    adminMfaRequired,
    refundReviewThreshold,
  };
}
