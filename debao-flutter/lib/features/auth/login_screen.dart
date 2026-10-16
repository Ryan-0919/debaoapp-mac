import '../../core/config/app_environment.dart';
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_client.dart';
import '../../data/providers.dart';

const _brand = Color(0xFF4C4BEA);
const _page = Color(0xFFF4F5F7);
const _muted = Color(0xFF707684);

class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key, this.remoteEnabled = remoteDataDefault});

  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) {
    final body = _LoginBody(remoteEnabled: remoteEnabled);
    // The production router already lives below the app's root ProviderScope.
    // Reusing that container is required so a successful login invalidates the
    // same current-user provider that the shell/profile page reads. Keep a
    // local scope only when this screen is rendered standalone by a preview or
    // widget test.
    return _hasProviderScope(context) ? body : ProviderScope(child: body);
  }

  bool _hasProviderScope(BuildContext context) {
    try {
      ProviderScope.containerOf(context, listen: false);
      return true;
    } catch (_) {
      return false;
    }
  }
}

class _LoginBody extends ConsumerStatefulWidget {
  const _LoginBody({required this.remoteEnabled});

  final bool remoteEnabled;

  @override
  ConsumerState<_LoginBody> createState() => _LoginBodyState();
}

class _LoginBodyState extends ConsumerState<_LoginBody> {
  bool sms = false;
  bool agreed = false;
  bool busy = false;
  bool sendingCode = false;
  bool loadingProviders = false;
  bool smsAvailable = true;
  bool wechatAvailable = false;
  bool providersFailed = false;
  int countdown = 0;
  String? error;
  Timer? _countdownTimer;
  final phone = TextEditingController();
  final code = TextEditingController();

  String get _deviceId => 'flutter-${defaultTargetPlatform.name}';

  @override
  void initState() {
    super.initState();
    if (widget.remoteEnabled) {
      unawaited(_loadProviders());
    }
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    phone.dispose();
    code.dispose();
    super.dispose();
  }

  Future<void> _loadProviders() async {
    if (loadingProviders || !widget.remoteEnabled) return;
    setState(() => loadingProviders = true);
    try {
      final availability = await ref.read(authRepositoryProvider).providers();
      if (!mounted) return;
      setState(() {
        smsAvailable = availability.sms;
        wechatAvailable = availability.wechat;
        providersFailed = false;
        loadingProviders = false;
      });
    } catch (value) {
      if (!mounted) return;
      // A failed capability check must not turn into a fake enabled button.
      setState(() {
        smsAvailable = false;
        wechatAvailable = false;
        providersFailed = true;
        loadingProviders = false;
        error = _errorMessage(value);
      });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: _page,
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 72, 24, 24),
            children: [
              Container(
                width: 64,
                height: 64,
                alignment: Alignment.center,
                decoration:
                    const BoxDecoration(color: _brand, shape: BoxShape.circle),
                child: const Icon(Icons.balance, color: Colors.white, size: 31),
              ),
              const SizedBox(height: 18),
              const Text('登录得宝',
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Text(
                sms ? '输入手机号和验证码，登录后学习记录会自动同步。' : '登录后同步课程、题库记录和学习进度。',
                style: const TextStyle(color: _muted),
              ),
              const SizedBox(height: 32),
              if (widget.remoteEnabled && loadingProviders)
                const LinearProgressIndicator(key: ValueKey('auth-loading')),
              if (sms) _smsForm(context) else _methodOptions(context),
              const SizedBox(height: 20),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: agreed,
                onChanged: busy
                    ? null
                    : (value) => setState(() {
                          agreed = value ?? false;
                          error = null;
                        }),
                title: const Text('我已阅读并同意用户协议和隐私政策',
                    style: TextStyle(fontSize: 12)),
              ),
              if (error != null) ...[
                const SizedBox(height: 8),
                Container(
                  key: const ValueKey('auth-error'),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF1EE),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(error!,
                      style: const TextStyle(
                          color: Color(0xFFB13B25), fontSize: 12)),
                ),
                if (providersFailed)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      key: const ValueKey('auth-providers-retry'),
                      onPressed: loadingProviders ? null : _loadProviders,
                      child: const Text('重试登录方式'),
                    ),
                  ),
              ],
              const SizedBox(height: 20),
              Text(
                widget.remoteEnabled
                    ? '登录服务由服务端供应商提供，未配置的微信/短信 SDK 会显示不可用状态。'
                    : '当前为本地预览模式，真实登录请使用发布环境配置。',
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: Color(0xFF9DA2AE), fontSize: 11, height: 1.5),
              ),
            ],
          ),
        ),
      );

  Widget _methodOptions(BuildContext context) => Column(
        children: [
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: !agreed ||
                      busy ||
                      loadingProviders ||
                      (widget.remoteEnabled && !wechatAvailable)
                  ? null
                  : _wechat,
              icon: const Icon(Icons.chat_bubble_outline),
              label: Text(loadingProviders ? '正在检查登录方式…' : '微信登录'),
            ),
          ),
          if (widget.remoteEnabled && !wechatAvailable)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text('当前安装包未配置微信登录，请使用手机号验证码登录。',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: _muted, fontSize: 11)),
            ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed:
                  agreed && !busy && (!widget.remoteEnabled || smsAvailable)
                      ? _openSms
                      : null,
              icon: const Icon(Icons.phone_outlined),
              label: const Text('手机号登录'),
            ),
          ),
        ],
      );

  Widget _smsForm(BuildContext context) => Column(
        children: [
          TextField(
            controller: phone,
            keyboardType: TextInputType.phone,
            maxLength: 11,
            enabled: !busy,
            onChanged: (_) => setState(() => error = null),
            decoration: const InputDecoration(
                labelText: '手机号', hintText: '请输入 11 位手机号', counterText: ''),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: code,
            keyboardType: TextInputType.number,
            maxLength: 6,
            enabled: !busy,
            onChanged: (_) => setState(() => error = null),
            decoration: InputDecoration(
              labelText: '验证码',
              hintText: '请输入 6 位验证码',
              counterText: '',
              suffixIcon: TextButton(
                key: const ValueKey('auth-send-code'),
                onPressed: busy ||
                        sendingCode ||
                        countdown > 0 ||
                        (widget.remoteEnabled && !smsAvailable)
                    ? null
                    : _sendCode,
                child: Text(countdown > 0 ? '${countdown}s' : '获取验证码'),
              ),
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: busy ? null : _submit,
              child: Text(busy ? '登录中…' : '手机号登录'),
            ),
          ),
          TextButton(
              onPressed: busy ? null : _backToOptions,
              child: const Text('返回其他登录方式')),
        ],
      );

  void _openSms() {
    if (!agreed) {
      setState(() => error = '请先阅读并同意用户协议和隐私政策。');
      return;
    }
    setState(() {
      sms = true;
      error = null;
    });
  }

  void _backToOptions() {
    setState(() {
      sms = false;
      error = null;
    });
  }

  Future<void> _wechat() async {
    if (!agreed) {
      setState(() => error = '请先阅读并同意用户协议和隐私政策。');
      return;
    }
    // The native WeChat SDK is intentionally not emulated by Flutter.
    if (widget.remoteEnabled) {
      setState(() => error = '当前安装包未配置微信授权 SDK，请使用手机号验证码登录。');
      return;
    }
    _finish('微信登录服务尚未配置，请改用手机号登录。');
  }

  Future<void> _sendCode() async {
    if (!_validPhone(phone.text)) {
      setState(() => error = '请输入正确的 11 位手机号。');
      return;
    }
    if (!agreed) {
      setState(() => error = '请先阅读并同意用户协议和隐私政策。');
      return;
    }
    if (!widget.remoteEnabled) {
      setState(() {
        error = '本地预览模式不发送真实验证码，请使用 123456。';
        code.text = '123456';
      });
      return;
    }
    setState(() {
      sendingCode = true;
      error = null;
    });
    try {
      final result = await ref.read(authRepositoryProvider).sendCode(
            phone.text,
            deviceId: _deviceId,
          );
      if (!mounted) return;
      if (!result.accepted) {
        setState(() => error = '验证码服务暂不可用，请稍后重试。');
        return;
      }
      _startCountdown(result.expiresIn > 0 ? 60 : 0);
      setState(() => error = '验证码已发送，请查收短信。');
    } catch (value) {
      if (mounted) setState(() => error = _errorMessage(value));
    } finally {
      if (mounted) setState(() => sendingCode = false);
    }
  }

  Future<void> _submit() async {
    if (!_validPhone(phone.text) || !RegExp(r'^\d{6}$').hasMatch(code.text)) {
      setState(() => error = '请输入正确的手机号和 6 位验证码。');
      return;
    }
    if (!agreed) {
      setState(() => error = '请先阅读并同意用户协议和隐私政策。');
      return;
    }
    if (!widget.remoteEnabled) {
      _finish('登录成功（本地预览）');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await ref.read(authRepositoryProvider).login(
            phone.text,
            code.text,
            deviceId: _deviceId,
          );
      ref.invalidate(currentUserProvider);
      ref.invalidate(coursesProvider);
      ref.invalidate(ordersProvider);
      ref.invalidate(homeDataProvider);
      ref.invalidate(learningTasksProvider);
      if (!mounted) return;
      setState(() => busy = false);
      final router = GoRouter.maybeOf(context);
      if (router != null) {
        router.go('/');
      } else {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('登录成功')));
      }
    } catch (value) {
      if (mounted) {
        setState(() {
          busy = false;
          error = _errorMessage(value);
        });
      }
    }
  }

  void _startCountdown(int seconds) {
    _countdownTimer?.cancel();
    if (seconds <= 0) return;
    setState(() => countdown = seconds);
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (countdown <= 1) {
        timer.cancel();
        setState(() => countdown = 0);
      } else {
        setState(() => countdown -= 1);
      }
    });
  }

  void _finish(String message) {
    setState(() => busy = true);
    Future<void>.delayed(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      setState(() => busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    });
  }

  bool _validPhone(String value) => RegExp(r'^1\d{10}$').hasMatch(value);

  String _errorMessage(Object value) {
    if (value is ApiError) return value.message;
    return '登录服务暂不可用，请检查网络后重试。';
  }
}
