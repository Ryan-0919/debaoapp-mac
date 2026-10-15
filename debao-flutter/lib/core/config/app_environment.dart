import 'package:flutter/foundation.dart';

// Only widget tests explicitly built with this flag may use legacy fixtures.
const remoteDataDefault =
    !bool.fromEnvironment('DEBAO_TEST_FIXTURES', defaultValue: false);

enum AppEnvironment {
  development('开发', 'http://127.0.0.1:4000'),
  staging('预发布', 'https://staging-api.example.invalid'),
  production('生产', 'https://debao-api.denlaw.cn');

  const AppEnvironment(this.label, this._defaultApiBaseUrl);

  final String label;
  final String _defaultApiBaseUrl;

  /// Allows CI, physical devices, and local emulators to select the API
  /// host without changing source files. Example:
  /// `flutter run --dart-define=DEBAO_API_BASE_URL=http://10.0.2.2:4000`.
  static const _apiBaseUrlOverride =
      String.fromEnvironment('DEBAO_API_BASE_URL');

  String get apiBaseUrl {
    if (_apiBaseUrlOverride.isNotEmpty) return _apiBaseUrlOverride;

    // Android's emulator exposes the host machine through 10.0.2.2. Keep
    // Web and desktop on loopback, where the local API is actually bound.
    if (this == AppEnvironment.development &&
        !kIsWeb &&
        defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:4000';
    }
    return _defaultApiBaseUrl;
  }

  // The shipped client must use the deployed API by default. Local or staging
  // environments remain available through DEBAO_API_BASE_URL at build time.
  static AppEnvironment get current => AppEnvironment.production;

  bool get allowsMocks => false;
}
