import {createHash, randomUUID} from 'node:crypto';
import type {SmsPurpose} from './types.js';
import {randomInt} from 'node:crypto';
import * as Dysmsapi from '@alicloud/dysmsapi20170525';
import {$OpenApiUtil} from '@alicloud/openapi-core';

interface HttpProviderOptions {
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
}

async function postJson<T>(provider: string, options: HttpProviderOptions, path: string, payload: unknown): Promise<T> {
  if (!options.endpoint) throw new Error(`${provider} provider endpoint is not configured`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    const response = await fetch(`${options.endpoint.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {'content-type': 'application/json', accept: 'application/json', ...(options.apiKey ? {authorization: `Bearer ${options.apiKey}`} : {})},
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`${provider} provider returned HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

export interface PaymentAdapter {
  readonly name: string;
  pay(orderId: string, amount: number): Promise<{status: 'paid' | 'pending'; transactionId: string}>;
}

export interface SmsAdapter {
  readonly name: string;
  sendCode(phone: string, purpose: SmsPurpose, code?: string): Promise<{accepted: boolean; providerMessageId: string}>;
  verifyCode(phone: string, code: string, purpose: SmsPurpose, expectedCodeHash?: string): Promise<{valid: boolean}>;
}

export interface PushAdapter {
  readonly name: string;
  send(deviceToken: string, title: string, body: string): Promise<{accepted: boolean; providerMessageId: string}>;
}

export interface GradingAdapter {
  readonly name: string;
  enqueue(submissionId: string): Promise<{status: 'queued' | 'processing'}>;
}

export interface AIAdapter {
  readonly name: string;
  /**
   * Provider responses may include usage/billing metadata.  Local and
   * unconfigured adapters intentionally omit it rather than fabricating
   * production token or cost numbers.
   */
  reply(prompt: string): Promise<{
    reply: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    costMinor?: number;
    risk?: {risk: string; reason: string};
  }>;
}

export interface MediaAdapter {
  readonly name: string;
  prepare(courseId: string, kind: string): Promise<{available: boolean; reason?: string; url?: string; expiresAt?: string}>;
}

export interface WechatAuthAdapter {
  readonly name: string;
  exchangeCode(code: string): Promise<{providerUserId: string; unionId?: string; nickname?: string}>;
}

export interface CarrierAuthAdapter {
  readonly name: string;
  verifyToken(providerToken: string): Promise<{phone: string; carrier?: string}>;
}

export class LocalPaymentAdapter implements PaymentAdapter {
  readonly name = 'local';
  async pay(orderId: string, _amount: number) { return {status: 'paid' as const, transactionId: `LOCAL-${orderId}-${Date.now()}`}; }
}
export class UnconfiguredPaymentAdapter implements PaymentAdapter {
  readonly name = 'unconfigured';
  async pay(_orderId: string, _amount: number) { return {status: 'pending' as const, transactionId: `PENDING-${Date.now()}`}; }
}
export class HttpPaymentAdapter implements PaymentAdapter {
  readonly name = 'http';
  constructor(private readonly options: HttpProviderOptions) {}
  pay(orderId: string, amount: number) { return postJson<{status: 'paid' | 'pending'; transactionId: string}>('payment', this.options, '/payments', {orderId, amount}); }
}

export class LocalSmsAdapter implements SmsAdapter {
  readonly name = 'local';
  async sendCode(_phone: string, _purpose: SmsPurpose, _code?: string) { return {accepted: true, providerMessageId: `LOCAL-SMS-${randomUUID()}`}; }
  async verifyCode(_phone: string, code: string, _purpose: SmsPurpose, _expectedCodeHash?: string) { return {valid: code === '123456'}; }
}
export class UnconfiguredSmsAdapter implements SmsAdapter {
  readonly name = 'unconfigured';
  async sendCode(_phone: string, _purpose: SmsPurpose, _code?: string) { return {accepted: false, providerMessageId: 'SMS-NOT-CONFIGURED'}; }
  async verifyCode(_phone: string, _code: string, _purpose: SmsPurpose, _expectedCodeHash?: string) { return {valid: false}; }
}
export class HttpSmsAdapter implements SmsAdapter {
  readonly name = 'http';
  constructor(private readonly options: HttpProviderOptions) {}
  sendCode(phone: string, purpose: SmsPurpose, code?: string) { return postJson<{accepted: boolean; providerMessageId: string}>('sms', this.options, '/sms/send-code', {phone, purpose, code}); }
  verifyCode(phone: string, code: string, purpose: SmsPurpose, _expectedCodeHash?: string) { return postJson<{valid: boolean}>('sms', this.options, '/sms/verify-code', {phone, code, purpose}); }
}

interface AliyunSmsOptions {
  accessKeyId?: string;
  accessKeySecret?: string;
  signName?: string;
  templateCode?: string;
  timeoutMs?: number;
}

type AliyunSdkClient = {sendSms(request: unknown): Promise<{body?: {code?: string; message?: string; bizId?: string; requestId?: string}}>};

export class AliyunSmsAdapter implements SmsAdapter {
  readonly name = 'aliyun';
  private readonly client: AliyunSdkClient;
  private readonly options: AliyunSmsOptions;
  private readonly codes = new Map<string, {code: string; expiresAt: number}>();

  constructor(options: AliyunSmsOptions) {
    if (!options.accessKeyId || !options.accessKeySecret || !options.signName || !options.templateCode) {
      throw new Error('Aliyun SMS credentials, sign name and template code are required');
    }
    this.options = options;
    const packageModule = Dysmsapi.default as unknown as {default: new (config: $OpenApiUtil.Config) => AliyunSdkClient};
    const ClientCtor = packageModule.default;
    this.client = new ClientCtor(new $OpenApiUtil.Config({
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      endpoint: 'dysmsapi.aliyuncs.com',
      connectTimeout: options.timeoutMs ?? 8_000,
      readTimeout: options.timeoutMs ?? 8_000,
    }));
  }

  async sendCode(phone: string, purpose: SmsPurpose, providedCode?: string) {
    const code = providedCode ?? String(randomInt(100000, 1000000));
    const response = await this.client.sendSms(new Dysmsapi.SendSmsRequest({
      phoneNumbers: phone,
      signName: this.options.signName,
      templateCode: this.options.templateCode,
      templateParam: JSON.stringify({code}),
      outId: `debao-${purpose}-${Date.now()}`,
    }));
    const body = response.body;
    if (body?.code !== 'OK') {
      throw new Error(`Aliyun SMS ${body?.code ?? 'UNKNOWN'}: ${body?.message ?? 'send failed'}`);
    }
    this.codes.set(this.key(phone, purpose), {code, expiresAt: Date.now() + 300_000});
    return {accepted: true, providerMessageId: body.bizId ?? body.requestId ?? `ALIYUN-SMS-${randomUUID()}`};
  }

  async verifyCode(phone: string, code: string, purpose: SmsPurpose, expectedCodeHash?: string) {
    if (expectedCodeHash) {
      const actual = createHash('sha256').update(`${phone}:${purpose}:${code}`).digest('hex');
      return {valid: actual === expectedCodeHash};
    }
    const key = this.key(phone, purpose);
    const current = this.codes.get(key);
    if (!current || current.expiresAt <= Date.now()) {
      this.codes.delete(key);
      return {valid: false};
    }
    const valid = current.code === code;
    if (valid) this.codes.delete(key);
    return {valid};
  }

  private key(phone: string, purpose: SmsPurpose) { return `${purpose}:${phone}`; }
}

export class LocalPushAdapter implements PushAdapter {
  readonly name = 'local';
  async send(_deviceToken: string, _title: string, _body: string) { return {accepted: false, providerMessageId: 'LOCAL-PUSH-NOT-CONFIGURED'}; }
}
export class UnconfiguredPushAdapter implements PushAdapter {
  readonly name = 'unconfigured';
  async send(_deviceToken: string, _title: string, _body: string) { return {accepted: false, providerMessageId: 'PUSH-NOT-CONFIGURED'}; }
}
export class HttpPushAdapter implements PushAdapter {
  readonly name = 'http';
  constructor(private readonly options: HttpProviderOptions) {}
  send(deviceToken: string, title: string, body: string) { return postJson<{accepted: boolean; providerMessageId: string}>('push', this.options, '/push/send', {deviceToken, title, body}); }
}

export class LocalGradingAdapter implements GradingAdapter {
  readonly name = 'local';
  async enqueue(_submissionId: string) { return {status: 'queued' as const}; }
}
export class UnconfiguredGradingAdapter implements GradingAdapter {
  readonly name = 'unconfigured';
  async enqueue(_submissionId: string): Promise<{status: 'queued' | 'processing'}> {
    throw new Error('GRADING_PROVIDER_NOT_CONFIGURED');
  }
}
export class HttpGradingAdapter implements GradingAdapter {
  readonly name = 'http';
  constructor(private readonly options: HttpProviderOptions) {}
  enqueue(submissionId: string) { return postJson<{status: 'queued' | 'processing'}>('grading', this.options, '/grading/enqueue', {submissionId}); }
}

export class LocalAIAdapter implements AIAdapter {
  readonly name = 'local';
  async reply(prompt: string) { return {reply: `本地 AI 适配器回答：“${prompt}”。正式环境需配置 AI provider key、内容审核和配额策略。`, model: 'local'}; }
}
export class UnconfiguredAIAdapter implements AIAdapter {
  readonly name = 'unconfigured';
  async reply(_prompt: string): Promise<{reply: string}> { throw new Error('AI provider is not configured'); }
}
export class HttpAIAdapter implements AIAdapter {
  readonly name = 'http';
  constructor(private readonly options: HttpProviderOptions) {}
  reply(prompt: string) {
    return postJson<{
      reply: string;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      costMinor?: number;
      risk?: {risk: string; reason: string};
    }>('ai', this.options, '/ai/reply', {prompt});
  }
}

export class UnconfiguredMediaAdapter implements MediaAdapter {
  readonly name = 'unconfigured';
  async prepare(_courseId: string, kind: string) { return {available: false, reason: `${kind} 媒体适配器尚未配置对象存储/CDN 与播放授权`}; }
}
export class HttpMediaAdapter implements MediaAdapter {
  readonly name = 'http';
  constructor(private readonly options: HttpProviderOptions) {}
  prepare(courseId: string, kind: string) { return postJson<{available: boolean; reason?: string; url?: string; expiresAt?: string}>('media', this.options, '/media/prepare', {courseId, kind}); }
}

export class LocalWechatAuthAdapter implements WechatAuthAdapter {
  readonly name = 'local';
  async exchangeCode(code: string) {
    if (!code.startsWith('local-wechat-')) throw new Error('local WeChat code is invalid');
    return {providerUserId: 'wx-local-demo', unionId: 'wx-union-local-demo', nickname: '微信用户'};
  }
}
export class UnconfiguredWechatAuthAdapter implements WechatAuthAdapter {
  readonly name = 'unconfigured';
  async exchangeCode(_code: string): Promise<{providerUserId: string}> { throw new Error('WeChat auth provider is not configured'); }
}
export class HttpWechatAuthAdapter implements WechatAuthAdapter {
  readonly name = 'http';
  constructor(private readonly options: HttpProviderOptions) {}
  exchangeCode(code: string) { return postJson<{providerUserId: string; unionId?: string; nickname?: string}>('wechat-auth', this.options, '/auth/wechat/exchange', {code}); }
}

export class LocalCarrierAuthAdapter implements CarrierAuthAdapter {
  readonly name = 'local';
  async verifyToken(providerToken: string) {
    const match = providerToken.match(/^local-one-click:(1\d{10})$/);
    if (!match) throw new Error('local one-click token is invalid');
    return {phone: match[1], carrier: 'local'};
  }
}
export class UnconfiguredCarrierAuthAdapter implements CarrierAuthAdapter {
  readonly name = 'unconfigured';
  async verifyToken(_providerToken: string): Promise<{phone: string}> { throw new Error('carrier auth provider is not configured'); }
}
export class HttpCarrierAuthAdapter implements CarrierAuthAdapter {
  readonly name = 'http';
  constructor(private readonly options: HttpProviderOptions) {}
  verifyToken(providerToken: string) { return postJson<{phone: string; carrier?: string}>('carrier-auth', this.options, '/auth/carrier/verify', {providerToken}); }
}

type ProviderEnv = NodeJS.ProcessEnv;
function options(prefix: string, env: ProviderEnv): HttpProviderOptions {
  return {endpoint: env[`${prefix}_PROVIDER_URL`], apiKey: env[`${prefix}_PROVIDER_KEY`], timeoutMs: Number(env.PROVIDER_TIMEOUT_MS ?? 8_000)};
}

function aliyunSmsOptions(env: ProviderEnv): AliyunSmsOptions {
  return {
    accessKeyId: env.SMS_PROVIDER_ACCESS_KEY_ID,
    accessKeySecret: env.SMS_PROVIDER_ACCESS_KEY_SECRET,
    signName: env.SMS_SIGN_NAME,
    templateCode: env.SMS_TEMPLATE_CODE,
    timeoutMs: Number(env.PROVIDER_TIMEOUT_MS ?? 8_000),
  };
}

export function createPaymentAdapter(env: ProviderEnv = process.env): PaymentAdapter {
  const mode = env.PAYMENT_ADAPTER ?? (env.DEBAO_TEST_FIXTURES === 'true' ? 'local' : 'unconfigured');
  return mode === 'local' && env.DEBAO_TEST_FIXTURES === 'true' ? new LocalPaymentAdapter() : mode === 'http' ? new HttpPaymentAdapter(options('PAYMENT', env)) : new UnconfiguredPaymentAdapter();
}
export function createSmsAdapter(env: ProviderEnv = process.env): SmsAdapter {
  const mode = env.SMS_ADAPTER ?? (env.DEBAO_TEST_FIXTURES === 'true' ? 'local' : 'unconfigured');
  return mode === 'local' && env.DEBAO_TEST_FIXTURES === 'true' ? new LocalSmsAdapter() : mode === 'http' ? new HttpSmsAdapter(options('SMS', env)) : mode === 'aliyun' ? new AliyunSmsAdapter(aliyunSmsOptions(env)) : new UnconfiguredSmsAdapter();
}
export function createPushAdapter(env: ProviderEnv = process.env): PushAdapter {
  const mode = env.PUSH_ADAPTER ?? 'unconfigured';
  return mode === 'local' && env.DEBAO_TEST_FIXTURES === 'true' ? new LocalPushAdapter() : mode === 'http' ? new HttpPushAdapter(options('PUSH', env)) : new UnconfiguredPushAdapter();
}
export function createGradingAdapter(env: ProviderEnv = process.env): GradingAdapter {
  const mode = env.GRADING_ADAPTER ?? (env.DEBAO_TEST_FIXTURES === 'true' ? 'local' : 'unconfigured');
  return mode === 'local' && env.DEBAO_TEST_FIXTURES === 'true' ? new LocalGradingAdapter() : mode === 'http' ? new HttpGradingAdapter(options('GRADING', env)) : new UnconfiguredGradingAdapter();
}
export function createAIAdapter(env: ProviderEnv = process.env): AIAdapter {
  const mode = env.AI_ADAPTER ?? (env.DEBAO_TEST_FIXTURES === 'true' ? 'local' : 'unconfigured');
  return mode === 'local' && env.DEBAO_TEST_FIXTURES === 'true' ? new LocalAIAdapter() : mode === 'http' ? new HttpAIAdapter(options('AI', env)) : new UnconfiguredAIAdapter();
}
export function createMediaAdapter(env: ProviderEnv = process.env): MediaAdapter {
  return (env.MEDIA_ADAPTER ?? 'unconfigured') === 'http' ? new HttpMediaAdapter(options('MEDIA', env)) : new UnconfiguredMediaAdapter();
}
export function createWechatAuthAdapter(env: ProviderEnv = process.env): WechatAuthAdapter {
  const mode = env.WECHAT_AUTH_ADAPTER ?? (env.DEBAO_TEST_FIXTURES === 'true' ? 'local' : 'unconfigured');
  return mode === 'local' && env.DEBAO_TEST_FIXTURES === 'true' ? new LocalWechatAuthAdapter() : mode === 'http' ? new HttpWechatAuthAdapter(options('WECHAT_AUTH', env)) : new UnconfiguredWechatAuthAdapter();
}
export function createCarrierAuthAdapter(env: ProviderEnv = process.env): CarrierAuthAdapter {
  const mode = env.CARRIER_AUTH_ADAPTER ?? (env.DEBAO_TEST_FIXTURES === 'true' ? 'local' : 'unconfigured');
  return mode === 'local' && env.DEBAO_TEST_FIXTURES === 'true' ? new LocalCarrierAuthAdapter() : mode === 'http' ? new HttpCarrierAuthAdapter(options('CARRIER_AUTH', env)) : new UnconfiguredCarrierAuthAdapter();
}
