import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../core/config/app_environment.dart';
import '../../shared/route_back_button.dart';

/// Resolve uploaded assets against the configured API, including emulator hosts.
Uri learningAssetUri(String reference) {
  final uri = Uri.parse(AppEnvironment.current.apiBaseUrl).resolve(reference);
  if (!['http', 'https'].contains(uri.scheme)) {
    throw const FormatException('学习素材地址无效');
  }
  return uri;
}

class LearningHtmlReader extends StatefulWidget {
  const LearningHtmlReader(
      {super.key, required this.reference, this.isPdf = false});
  final String reference;
  final bool isPdf;
  @override
  State<LearningHtmlReader> createState() => _LearningHtmlReaderState();
}

class _LearningHtmlReaderState extends State<LearningHtmlReader> {
  WebViewController? controller;
  String? error;
  bool loaded = false;
  late final Uri uri;

  @override
  void initState() {
    super.initState();
    try {
      uri = learningAssetUri(widget.reference);
      if (!kIsWeb &&
          (defaultTargetPlatform == TargetPlatform.android ||
              defaultTargetPlatform == TargetPlatform.iOS)) {
        controller = WebViewController()
          ..setJavaScriptMode(JavaScriptMode.disabled)
          ..setNavigationDelegate(NavigationDelegate(
            onNavigationRequest: (request) =>
                Uri.tryParse(request.url)?.replace(fragment: '') ==
                        uri.replace(fragment: '')
                    ? NavigationDecision.navigate
                    : NavigationDecision.prevent,
            onPageFinished: (_) {
              if (mounted && error == null) setState(() => loaded = true);
            },
            onWebResourceError: (failure) {
              if (mounted && failure.isForMainFrame != false)
                setState(() {
                  error = '卡片加载失败，请重试';
                  loaded = false;
                });
            },
          ))
          ..loadRequest(uri);
      }
    } catch (_) {
      error = '无法打开卡片，请联系老师检查素材';
    }
  }

  Future<void> openInBrowser() async {
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication))
        throw StateError('无法打开');
      if (mounted) setState(() => loaded = true);
    } catch (_) {
      if (mounted) setState(() => error = '打开失败，请重试');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
            title: const Text('阅读学习卡片'), leading: const DebaoRouteBackButton()),
        body: Column(children: [
          Expanded(
              child: error != null
                  ? Center(
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Text(error!),
                      TextButton(
                          onPressed: () {
                            setState(() {
                              error = null;
                              loaded = false;
                            });
                            if (controller != null) {
                              controller!.reload();
                            } else {
                              openInBrowser();
                            }
                          },
                          child: const Text('重试'))
                    ]))
                  : controller != null
                      ? Stack(children: [
                          WebViewWidget(controller: controller!),
                          if (!loaded)
                            const Center(child: CircularProgressIndicator())
                        ])
                      : Center(
                          child: FilledButton(
                              onPressed: openInBrowser,
                              child: Text(
                                  widget.isPdf ? '打开 PDF 卡片' : '打开 HTML 卡片')))),
          SafeArea(
              top: false,
              child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton(
                    onPressed:
                        loaded ? () => Navigator.pop(context, true) : null,
                    child: Text(widget.isPdf ? '阅读完成，返回背诵任务' : '阅读完成，返回背诵任务'),
                  ))),
        ]),
      );
}
