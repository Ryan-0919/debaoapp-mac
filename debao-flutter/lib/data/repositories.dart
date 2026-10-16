import '../core/network/api_client.dart';
import '../core/security/secure_token_store.dart';
import 'models.dart';

List<JsonMap> _items(dynamic value) {
  if (value is List) return value.whereType<JsonMap>().toList(growable: false);
  if (value is JsonMap && value['items'] is List) {
    return (value['items'] as List)
        .whereType<JsonMap>()
        .toList(growable: false);
  }
  return const [];
}

JsonMap _map(dynamic value) => value is JsonMap ? value : <String, dynamic>{};

bool _stringListsEqual(List<String> left, List<String> right) {
  if (left.length != right.length) return false;
  for (var index = 0; index < left.length; index += 1) {
    if (left[index] != right[index]) return false;
  }
  return true;
}

const _learningPlanStatuses = <String>{'active', 'completed', 'archived'};

ApiError _learningValidation(String message) =>
    ApiError('VALIDATION_ERROR', message);

String _requiredLearningId(String value, String label) {
  final id = value.trim();
  if (id.isEmpty) throw _learningValidation('$label ID 不能为空');
  return Uri.encodeComponent(id);
}

String _requiredPlanTitle(String value) {
  final title = value.trim();
  if (title.isEmpty || title.length > 160) {
    throw _learningValidation('计划标题不能为空且不能超过 160 个字符');
  }
  return title;
}

int _requiredPlanMinutes(int value) {
  if (value < 1 || value > 1440) {
    throw _learningValidation('每日学习时长必须是 1 到 1440 分钟的整数');
  }
  return value;
}

String _requiredPlanDate(String value, String field) {
  final date = value.trim();
  final match = RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date);
  final parsed = match ? DateTime.tryParse('${date}T00:00:00Z') : null;
  if (!match || parsed == null || _formatPlanDate(parsed.toUtc()) != date) {
    throw _learningValidation('$field 必须是有效的 YYYY-MM-DD 日期');
  }
  return date;
}

String _formatPlanDate(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

Map<String, dynamic> _learningPlanPayload({
  required String title,
  required int dailyMinutes,
  String? startDate,
  String? endDate,
}) {
  final normalizedTitle = _requiredPlanTitle(title);
  final minutes = _requiredPlanMinutes(dailyMinutes);
  final start = startDate == null ? null : _requiredPlanDate(startDate, '开始日期');
  final end = endDate == null ? null : _requiredPlanDate(endDate, '结束日期');
  if (start != null && end != null && end.compareTo(start) < 0) {
    throw _learningValidation('计划结束日期不能早于开始日期');
  }
  return <String, dynamic>{
    'title': normalizedTitle,
    'dailyMinutes': minutes,
    if (start != null) 'startDate': start,
    if (end != null) 'endDate': end,
  };
}

Map<String, dynamic> _learningPlanUpdatePayload({
  String? title,
  int? dailyMinutes,
  String? startDate,
  String? endDate,
  String? status,
}) {
  if (title == null &&
      dailyMinutes == null &&
      startDate == null &&
      endDate == null &&
      status == null) {
    throw _learningValidation('至少提供一项计划修改内容');
  }
  final start = startDate == null ? null : _requiredPlanDate(startDate, '开始日期');
  final end = endDate == null ? null : _requiredPlanDate(endDate, '结束日期');
  if (start != null && end != null && end.compareTo(start) < 0) {
    throw _learningValidation('计划结束日期不能早于开始日期');
  }
  if (status != null && !_learningPlanStatuses.contains(status)) {
    throw _learningValidation('计划状态不正确');
  }
  return <String, dynamic>{
    if (title != null) 'title': _requiredPlanTitle(title),
    if (dailyMinutes != null)
      'dailyMinutes': _requiredPlanMinutes(dailyMinutes),
    if (start != null) 'startDate': start,
    if (end != null) 'endDate': end,
    if (status != null) 'status': status,
  };
}

JsonMap _learningResponseMap(dynamic value, String entity) {
  final map = value is JsonMap && value['data'] is JsonMap
      ? value['data'] as JsonMap
      : value is JsonMap
          ? value
          : null;
  if (map == null || map.isEmpty) {
    throw ApiError('INVALID_RESPONSE', '$entity 响应格式无效');
  }
  return map;
}

LearningPlan _learningPlanFromResponse(dynamic value) {
  final plan = LearningPlan.fromJson(_learningResponseMap(value, '学习计划'));
  if (plan.id.isEmpty ||
      plan.title.isEmpty ||
      plan.dailyMinutes < 1 ||
      !_learningPlanStatuses.contains(plan.status)) {
    throw const ApiError('INVALID_RESPONSE', '学习计划响应字段无效');
  }
  return plan;
}

LearningTask _learningTaskFromResponse(dynamic value) {
  final task = LearningTask.fromJson(_learningResponseMap(value, '学习任务'));
  if (task.id.isEmpty || task.title.isEmpty || task.minutes < 0) {
    throw const ApiError('INVALID_RESPONSE', '学习任务响应字段无效');
  }
  return task;
}

class UserRepository {
  const UserRepository(this.client);
  final ApiTransport client;
  Future<UserProfile> me() async =>
      UserProfile.fromJson(await client.getData('/v1/me') as JsonMap);
  Future<UserProfile> update(JsonMap data) async => UserProfile.fromJson(
      await client.patchData('/v1/me', data: data) as JsonMap);
}

/// Account security operations kept behind a typed repository so screens do
/// not need to know endpoint paths or response envelope details.
class AccountSecurityRepository {
  const AccountSecurityRepository(this.client);
  final ApiTransport client;

  Future<List<AccountIdentity>> identities() async =>
      _items(await client.getData('/v1/me/identities'))
          .map(AccountIdentity.fromJson)
          .toList(growable: false);

  Future<AuthCodeResult> sendPhoneCode({
    required String stage,
    String? phone,
  }) async {
    final payload = <String, dynamic>{
      'stage': stage,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
    };
    return AuthCodeResult.fromJson(
        _map(await client.postData('/v1/account/phone/code', data: payload)));
  }

  Future<UserProfile> changePhone({
    required String newPhone,
    required String oldCode,
    required String newCode,
  }) async =>
      UserProfile.fromJson(_map(await client.postData(
        '/v1/account/phone/change',
        data: {
          'newPhone': newPhone,
          'oldCode': oldCode,
          'newCode': newCode,
        },
      )));

  Future<AuthCodeResult> sendIdentityCode({required bool link}) async =>
      AuthCodeResult.fromJson(_map(await client.postData(
        link ? '/v1/account/identity/link-code' : '/v1/account/identity/code',
      )));

  Future<AccountIdentity> bindWechat({
    required String authorizationCode,
    required String smsCode,
  }) async =>
      AccountIdentity.fromJson(_map(await client.postData(
        '/v1/me/identities/wechat',
        data: {'code': authorizationCode, 'smsCode': smsCode},
      )));

  Future<bool> unlinkWechat(String code) async =>
      (_map(await client.deleteData('/v1/me/identities/wechat', data: {
        'code': code,
      }))['removed']) ==
      true;

  Future<AccountDeletionStatus> deletionStatus() async =>
      AccountDeletionStatus.fromJson(
          _map(await client.getData('/v1/account/deletion')));

  Future<AuthCodeResult> sendDeletionCode() async => AuthCodeResult.fromJson(
      _map(await client.postData('/v1/account/deletion/code')));

  Future<AccountDeletionStatus> requestDeletion(String code) async =>
      AccountDeletionStatus.fromJson(_map(await client.postData(
        '/v1/account/deletion',
        data: {'code': code},
      )));

  Future<AccountDeletionStatus> cancelDeletion() async =>
      AccountDeletionStatus.fromJson(_map(await client.postData(
        '/v1/account/deletion/cancel',
      )));

  Future<List<UserDevice>> devices() async =>
      _items(await client.getData('/v1/devices'))
          .map(UserDevice.fromJson)
          .toList(growable: false);

  Future<DeviceRemovalResult> removeDevice(String id) async =>
      DeviceRemovalResult.fromJson(_map(
          await client.deleteData('/v1/devices/${Uri.encodeComponent(id)}')));
}

class AuthRepository {
  const AuthRepository(this.client, this.tokenStore);

  final ApiTransport client;
  final TokenStore tokenStore;

  Future<AuthProviderAvailability> providers() async =>
      AuthProviderAvailability.fromJson(
          _map(await client.getData('/v1/auth/providers')));

  Future<AuthCodeResult> sendCode(
    String phone, {
    String purpose = 'login',
    String? deviceId,
  }) async {
    final response = await client.postData('/v1/auth/send-code', data: {
      'phone': phone,
      'purpose': purpose,
      if (deviceId != null && deviceId.isNotEmpty) 'deviceId': deviceId,
    });
    return AuthCodeResult.fromJson(_map(response));
  }

  Future<AuthSession> login(
    String phone,
    String code, {
    String? deviceId,
  }) async {
    final session = AuthSession.fromJson(_map(await client.postData(
      '/v1/auth/login',
      data: {
        'phone': phone,
        'code': code,
        if (deviceId != null && deviceId.isNotEmpty) 'deviceId': deviceId,
      },
    )));
    await _persistSession(session);
    return session;
  }

  Future<AuthSession> bindWechatPhone({
    required String bindingToken,
    required String phone,
    required String code,
    String? deviceId,
  }) async {
    final session = AuthSession.fromJson(_map(await client.postData(
      '/v1/auth/wechat/bind-phone',
      data: {
        'bindingToken': bindingToken,
        'phone': phone,
        'code': code,
        if (deviceId != null && deviceId.isNotEmpty) 'deviceId': deviceId,
      },
    )));
    await _persistSession(session);
    return session;
  }

  Future<void> logout() async {
    try {
      await client.postData('/v1/auth/logout');
    } finally {
      await tokenStore.clear();
    }
  }

  Future<void> _persistSession(AuthSession session) async {
    if (session.accessToken.isEmpty || session.refreshToken.isEmpty) {
      throw const ApiError('INVALID_AUTH_RESPONSE', '登录服务返回的会话信息不完整');
    }
    await tokenStore.writeTokens(
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    );
  }
}

class HomeRepository {
  const HomeRepository(this.client);
  final ApiTransport client;
  Future<HomeData> home() async =>
      HomeData.fromJson(await client.getData('/v1/home') as JsonMap);
  Future<List<JsonMap>> materials() async =>
      _items(await client.getData('/v1/materials'));
}

class AiRepository {
  const AiRepository(this.client);
  final ApiTransport client;

  Future<String> reply(String prompt) async {
    final response = await client.postData('/v1/ai/reply', data: {
      'prompt': prompt,
    });
    final payload = _map(response);
    final value = '${payload['reply'] ?? ''}'.trim();
    if (value.isEmpty) {
      throw const ApiError('EMPTY_RESPONSE', 'AI 服务未返回回答');
    }
    return value;
  }
}

class QuestionRepository {
  Future<List<LearningInquiry>> inquiries() async =>
      _items(await client.getData('/v1/learning/inquiries'))
          .map(LearningInquiry.fromJson)
          .toList(growable: false);
  Future<LearningInquiry> submitInquiry({
    required String reportId,
    required String questionId,
    required String reason,
    required String clientRequestId,
  }) async =>
      LearningInquiry.fromJson(
          _map(await client.postData('/v1/learning/inquiries', data: {
        'reportId': reportId,
        'questionId': questionId,
        'reason': reason,
        'clientRequestId': clientRequestId,
      })));
  Future<List<JsonMap>> papers() async =>
      _items(await client.getData('/v1/question-papers'));
  const QuestionRepository(this.client);
  final ApiTransport client;
  Future<List<Subject>> subjects() async =>
      _items(await client.getData('/v1/question-subjects'))
          .map(Subject.fromJson)
          .toList(growable: false);
  Future<List<Question>> questions(
          {String? subjectId, int page = 1, int pageSize = 20}) async =>
      _items(await client.getData('/v1/questions', query: {
        'subjectId': subjectId,
        'page': page,
        'pageSize': pageSize
      }))
          .map(Question.fromJson)
          .toList(growable: false);
  Future<Question> question(String id) async =>
      Question.fromJson(_map(await client.getData('/v1/questions/$id')));
  Future<QuestionRecordPage> recordPage({
    int page = 1,
    int pageSize = 20,
    String? subjectId,
    String? mode,
  }) async {
    final value = await client.getData('/v1/question-records', query: {
      'page': page,
      'pageSize': pageSize,
      if (subjectId != null && subjectId.isNotEmpty) 'subjectId': subjectId,
      if (mode != null && mode.isNotEmpty) 'mode': mode,
    });
    return QuestionRecordPage.fromJson(value);
  }

  Future<List<JsonMap>> records({
    int page = 1,
    int pageSize = 50,
    String? subjectId,
    String? mode,
  }) async =>
      (await recordPage(
        page: page,
        pageSize: pageSize,
        subjectId: subjectId,
        mode: mode,
      ))
          .items
          .map((item) => <String, dynamic>{
                'id': item.id,
                'questionId': item.questionId,
                'answers': item.answers,
                'correct': item.correct,
                'createdAt': item.createdAt,
                if (item.analysis != null) 'analysis': item.analysis,
                if (item.subjectId != null) 'subjectId': item.subjectId,
                if (item.mode != null) 'mode': item.mode,
                if (item.title != null) 'title': item.title,
                if (item.total != null) 'total': item.total,
                if (item.correctCount != null)
                  'correctCount': item.correctCount,
              })
          .toList(growable: false);
  Future<List<QuestionRecord>> typedRecords() async =>
      (await recordPage(pageSize: 50)).items;
  Future<List<QuestionRecord>> learningRecords() async =>
      _items(await client.getData('/v1/learning/question-records'))
          .map(QuestionRecord.fromJson)
          .where((item) => item.id.isNotEmpty)
          .toList(growable: false);
  Future<JsonMap> recordReport(String submissionId) async => _map(
      await client.getData('/v1/question-submissions/$submissionId/report'));
  Future<JsonMap> submit(String questionId, List<String> answers) async =>
      await client.postData('/v1/question-submissions',
          data: {'questionId': questionId, 'answers': answers}) as JsonMap;

  Future<ObjectiveSession> createObjectiveSession({
    required String mode,
    required String title,
    String? questionType,
    String? subjectId,
    String? paperId,
    List<String>? questionIds,
    int? limit,
    int? durationSeconds,
    required String idempotencyKey,
    String? learningTaskId,
  }) async {
    final payload = <String, dynamic>{
      'mode': mode,
      'title': title,
      if (questionType != null && questionType.isNotEmpty)
        'questionType': questionType,
      if (subjectId != null && subjectId.isNotEmpty) 'subjectId': subjectId,
      if (paperId != null && paperId.isNotEmpty) 'paperId': paperId,
      if (questionIds != null && questionIds.isNotEmpty)
        'questionIds': questionIds,
      if (limit != null) 'limit': limit,
      if (durationSeconds != null) 'durationSeconds': durationSeconds,
      if (learningTaskId != null && learningTaskId.isNotEmpty)
        'learningTaskId': learningTaskId,
    };
    final response = client is HeaderAwareApiTransport
        ? await (client as HeaderAwareApiTransport).postDataWithHeaders(
            '/v1/question-sessions',
            data: payload,
            headers: {'Idempotency-Key': idempotencyKey},
          )
        : await client.postData('/v1/question-sessions', data: {
            ...payload,
            'idempotencyKey': idempotencyKey,
          });
    return ObjectiveSession.fromJson(_map(response));
  }

  /// Opens a resumable session for [request]. Existing in-progress sessions
  /// are preferred when their quiz identity matches; otherwise a new server
  /// session is created with an idempotency key.
  Future<ObjectiveSession> openObjectiveSession(
      ObjectiveSessionRequest request) async {
    if (request.sessionId != null && request.sessionId!.isNotEmpty) {
      return objectiveSession(request.sessionId!);
    }
    final existing = await objectiveSessions(status: 'in_progress');
    ObjectiveSession? match;
    for (final session in existing) {
      if (_objectiveSessionMatchesRequest(session, request)) {
        match = session;
        break;
      }
    }
    if (match != null) return objectiveSession(match.id);
    return createObjectiveSession(
      mode: request.mode,
      title: request.title,
      questionType: request.questionType,
      subjectId: request.subjectId,
      paperId: request.paperId,
      questionIds: request.questionIds,
      limit: request.limit,
      durationSeconds: request.durationSeconds,
      learningTaskId: request.learningTaskId,
      idempotencyKey: request.effectiveIdempotencyKey,
    );
  }

  bool _objectiveSessionMatchesRequest(
      ObjectiveSession session, ObjectiveSessionRequest request) {
    if (session.mode != request.mode ||
        session.title != request.title ||
        session.subjectId != request.subjectId ||
        session.paperId != request.paperId ||
        session.learningTaskId != request.learningTaskId) {
      return false;
    }
    if (request.questionType != null &&
        session.questions
            .any((item) => item.questionType != request.questionType)) {
      return false;
    }

    if (request.durationSeconds != null &&
        session.durationSeconds != request.durationSeconds) {
      return false;
    }

    if (request.questionIds.isNotEmpty) {
      final uniqueIds = request.questionIds.toSet().toList(growable: false);
      final defaultLimit = request.mode == 'exam' ? 100 : 20;
      final expectedIds =
          uniqueIds.take(request.limit ?? defaultLimit).toList(growable: false);
      if (!_stringListsEqual(session.questionIds, expectedIds)) return false;
    } else if (request.limit != null &&
        session.questionIds.length != request.limit) {
      return false;
    }

    return true;
  }

  // Short aliases keep the repository ergonomic for feature/domain callers.
  Future<ObjectiveSession> createSession({
    required String mode,
    required String title,
    String? subjectId,
    String? paperId,
    List<String>? questionIds,
    int? limit,
    int? durationSeconds,
    String? learningTaskId,
    required String idempotencyKey,
  }) =>
      createObjectiveSession(
        mode: mode,
        title: title,
        subjectId: subjectId,
        paperId: paperId,
        questionIds: questionIds,
        limit: limit,
        durationSeconds: durationSeconds,
        learningTaskId: learningTaskId,
        idempotencyKey: idempotencyKey,
      );

  Future<ObjectiveSession> getSession(String sessionId) =>
      objectiveSession(sessionId);

  Future<List<ObjectiveSession>> objectiveSessions({
    String? status,
  }) async =>
      _items(await client.getData('/v1/question-sessions', query: {
        if (status != null && status.isNotEmpty) 'status': status,
      }))
          .map(ObjectiveSession.fromJson)
          .toList(growable: false);

  Future<ObjectiveSession> objectiveSession(String sessionId) async =>
      ObjectiveSession.fromJson(
          _map(await client.getData('/v1/question-sessions/$sessionId')));

  Future<JsonMap> saveObjectiveAnswer({
    required String sessionId,
    required String questionId,
    required List<String> answers,
  }) async {
    final payload = <String, dynamic>{
      'questionId': questionId,
      'answers': answers,
    };
    final response = client is PutAwareApiTransport
        ? await (client as PutAwareApiTransport)
            .putData('/v1/question-sessions/$sessionId/answers', data: payload)
        : await client.patchData('/v1/question-sessions/$sessionId/answers',
            data: payload);
    return _map(response);
  }

  Future<JsonMap> saveSessionAnswer({
    required String sessionId,
    required String questionId,
    required List<String> answers,
  }) =>
      saveObjectiveAnswer(
        sessionId: sessionId,
        questionId: questionId,
        answers: answers,
      );

  Future<ObjectiveReport> submitObjectiveSession({
    required String sessionId,
    required String idempotencyKey,
  }) async {
    final path = '/v1/question-sessions/$sessionId/submit';
    final response = client is HeaderAwareApiTransport
        ? await (client as HeaderAwareApiTransport).postDataWithHeaders(
            path,
            headers: {'Idempotency-Key': idempotencyKey},
          )
        : await client.postData(path, data: {
            'idempotencyKey': idempotencyKey,
          });
    return ObjectiveReport.fromJson(_map(response));
  }

  Future<ObjectiveReport> submitSession({
    required String sessionId,
    required String idempotencyKey,
  }) =>
      submitObjectiveSession(
        sessionId: sessionId,
        idempotencyKey: idempotencyKey,
      );

  Future<ObjectiveReport> objectiveReport(String sessionId) async =>
      ObjectiveReport.fromJson(_map(
          await client.getData('/v1/question-sessions/$sessionId/report')));

  Future<ObjectiveReport> getReport(String sessionId) =>
      objectiveReport(sessionId);

  Future<JsonMap> saveDraft(String questionId, List<String> answers) async {
    if (client is! PutAwareApiTransport) {
      throw const ApiError('UNSUPPORTED', '当前网络传输层不支持云端草稿保存，请稍后重试');
    }
    return _map(await (client as PutAwareApiTransport).putData(
        '/v1/question-drafts/$questionId',
        data: {'questionId': questionId, 'answers': answers}));
  }

  Future<List<JsonMap>> favorites() async =>
      _items(await client.getData('/v1/favorites'));
  Future<List<FavoriteItem>> typedFavorites() async =>
      (await favorites()).map(FavoriteItem.fromJson).toList(growable: false);
  Future<FavoriteItem> addFavorite(String questionId) async =>
      FavoriteItem.fromJson(_map(await client
          .postData('/v1/favorites', data: {'questionId': questionId})));
  Future<void> removeFavorite(String id) async {
    await client.deleteData('/v1/favorites/$id');
  }

  Future<List<LegalFavorite>> legalFavorites() async =>
      _items(await client.getData('/v1/legal-favorites'))
          .map(LegalFavorite.fromJson)
          .toList(growable: false);

  Future<LegalFavorite> addLegalFavorite(String documentId) async =>
      LegalFavorite.fromJson(_map(await client.postData(
        '/v1/legal-favorites',
        data: {'documentId': documentId},
      )));

  Future<void> removeLegalFavorite(String id) async {
    await client.deleteData('/v1/legal-favorites/$id');
  }

  Future<List<JsonMap>> mistakes() async =>
      _items(await client.getData('/v1/mistakes'));
  Future<List<MistakeItem>> typedMistakes() async =>
      (await mistakes()).map(MistakeItem.fromJson).toList(growable: false);
  Future<void> resolveMistake(String id) async {
    await client.deleteData('/v1/mistakes/$id');
  }
}

class CourseRepository {
  const CourseRepository(this.client);
  final ApiTransport client;
  Future<List<Course>> courses() async =>
      _items(await client.getData('/v1/courses'))
          .map(Course.fromJson)
          .toList(growable: false);
  Future<Course?> detail(String id) async {
    final value = await client.getData('/v1/courses/$id');
    if (value is! JsonMap || value.isEmpty) return null;
    return Course.fromJson(value);
  }

  Future<CourseEntitlement> entitlement(String id) async =>
      CourseEntitlement.fromJson(
          await client.getData('/v1/courses/$id/entitlement') as JsonMap);
  Future<List<LiveSession>> liveSessions(String courseId) async =>
      _items(await client.getData(
        '/v1/courses/${Uri.encodeComponent(courseId)}/live-sessions',
      ))
          .map(LiveSession.fromJson)
          .toList(growable: false);

  Future<LiveJoinResult> joinLiveSession(
    String sessionId, {
    String mode = 'live',
  }) async =>
      LiveJoinResult.fromJson(_map(await client.postData(
        '/v1/live-sessions/${Uri.encodeComponent(sessionId)}/join',
        data: {'mode': mode},
      )));

  Future<MediaAvailability> prepareMedia(String courseId, String kind) async =>
      MediaAvailability.fromJson(await client.postData('/v1/media/prepare',
          data: {'courseId': courseId, 'kind': kind}) as JsonMap);
  Future<JsonMap> updateProgress(String id, double progress) async =>
      await client.postData('/v1/courses/$id/progress',
          data: {'progress': progress}) as JsonMap;
  Future<List<LearningPlan>> plans() async =>
      _items(await client.getData('/v1/learning/plans'))
          .map(LearningPlan.fromJson)
          .toList(growable: false);
  Future<LearningPlan> createPlan(
          {required String title,
          int dailyMinutes = 60,
          String? startDate,
          String? endDate}) async =>
      _learningPlanFromResponse(await client.postData('/v1/learning/plans',
          data: _learningPlanPayload(
            title: title,
            dailyMinutes: dailyMinutes,
            startDate: startDate,
            endDate: endDate,
          )));
  Future<LearningPlan> updatePlan(String id,
          {String? title,
          int? dailyMinutes,
          String? startDate,
          String? endDate,
          String? status}) async =>
      _learningPlanFromResponse(await client.patchData(
          '/v1/learning/plans/${_requiredLearningId(id, '计划')}',
          data: _learningPlanUpdatePayload(
            title: title,
            dailyMinutes: dailyMinutes,
            startDate: startDate,
            endDate: endDate,
            status: status,
          )));
  Future<void> deletePlan(String id) async {
    await client
        .deleteData('/v1/learning/plans/${_requiredLearningId(id, '计划')}');
  }

  Future<List<LearningTask>> tasks() async =>
      _items(await client.getData('/v1/learning/tasks'))
          .map(LearningTask.fromJson)
          .toList(growable: false);
  Future<List<EarlyAccessRequest>> earlyAccessRequests() async =>
      _items(await client.getData('/v1/learning/early-access'))
          .map((item) => EarlyAccessRequest.fromJson(
              (item['request'] as JsonMap?) ?? <String, dynamic>{}))
          .where((item) => item.id.isNotEmpty)
          .toList(growable: false);
  Future<EarlyAccessRequest> requestEarlyAccess(String planId,
          {String? reason}) async =>
      EarlyAccessRequest.fromJson(await client.postData(
          '/v1/learning/plans/${Uri.encodeComponent(planId)}/early-access',
          data: {'reason': reason ?? ''}) as JsonMap);
  Future<LearningDiagnosticState> diagnostic() async =>
      LearningDiagnosticState.fromJson(
          await client.getData('/v1/learning/diagnostic') as JsonMap);
  Future<LearningDiagnosticResult> submitDiagnostic({
    required String startedAt,
    required List<JsonMap> answers,
  }) async =>
      LearningDiagnosticResult.fromJson(await client.postData(
        '/v1/learning/diagnostic/submit',
        data: {'startedAt': startedAt, 'answers': answers},
      ) as JsonMap);
  Future<LearningCard?> card(String id) async {
    final value =
        await client.getData('/v1/learning/cards/${Uri.encodeComponent(id)}');
    return value is JsonMap && value.isNotEmpty
        ? LearningCard.fromJson(value)
        : null;
  }

  Future<LearningSubjectiveQuestion?> subjectiveQuestion(String id) async {
    final value = await client.getData(
        '/v1/learning/questions/subjective/${Uri.encodeComponent(id)}');
    return value is JsonMap && value.isNotEmpty
        ? LearningSubjectiveQuestion.fromJson(value)
        : null;
  }

  Future<LearningTask> checkInTask(String id) async =>
      _learningTaskFromResponse(await client.postData(
          '/v1/learning/tasks/${_requiredLearningId(id, '任务')}/check-in'));
  Future<LearningTask> submitSubjectiveTask(
          String id, List<JsonMap> answers) async =>
      _learningTaskFromResponse(await client.postData(
          '/v1/learning/tasks/${_requiredLearningId(id, '任务')}/subjective-submit',
          data: {'answers': answers}));
  Future<LearningTask> completeTask(String id,
      {int? cardVersion, Map<int, String>? recallRatings}) async {
    final task = _learningTaskFromResponse(await client.postData(
        '/v1/learning/tasks/${_requiredLearningId(id, '任务')}/complete',
        data: cardVersion == null
            ? null
            : {
                'cardVersion': cardVersion,
                'recallRatings': [
                  for (final rating
                      in (recallRatings ?? <int, String>{}).entries)
                    {'index': rating.key, 'rating': rating.value}
                ]
              }));
    if (task.status != 'done') {
      throw const ApiError('INVALID_RESPONSE', '任务完成状态无效');
    }
    return task;
  }

  Future<LearningReport> report({String period = 'week'}) async =>
      LearningReport.fromJson(
          await client.getData('/v1/learning/report', query: {'period': period})
              as JsonMap);
}

class CommerceRepository {
  const CommerceRepository(this.client);
  final ApiTransport client;
  Future<List<Product>> products() async =>
      _items(await client.getData('/v1/products'))
          .map(Product.fromJson)
          .toList(growable: false);
  Future<Product> product(String id) async =>
      Product.fromJson(await client.getData('/v1/products/$id') as JsonMap);
  Future<List<Order>> orders() async =>
      _items(await client.getData('/v1/orders'))
          .map(Order.fromJson)
          .toList(growable: false);
  Future<Order> order(String id) async =>
      Order.fromJson(await client.getData('/v1/orders/$id') as JsonMap);
  Future<JsonMap> createOrder(String productId,
          {required String clientRequestId}) async =>
      await client.postData('/v1/orders', data: {
        'productId': productId,
        'clientRequestId': clientRequestId
      }) as JsonMap;
}

class CommunityRepository {
  const CommunityRepository(this.client);
  final ApiTransport client;

  // The list-returning provider predates cursor pagination.  Remembering the
  // cursor from the most recent page keeps that API source-compatible while
  // allowing the detail screen to request subsequent pages.
  static final Map<String, String?> _commentCursors = <String, String?>{};
  static final Map<String, String?> _postCursors = <String, String?>{};

  String? nextCommentCursor(String postId) => _commentCursors[postId];
  String? nextPostCursor({String? category, String scope = 'all'}) =>
      _postCursors['${scope}:${category ?? ''}'];
  Future<List<NotificationItem>> notifications() async => _items(await client
          .getData('/v1/notifications')
          .timeout(const Duration(seconds: 2)))
      .map(NotificationItem.fromJson)
      .toList(growable: false);
  Future<void> markNotificationRead(String id) async {
    await client.postData('/v1/notifications/$id/read');
  }

  /// Fetch one cursor page of forum posts.  Older call sites use [posts],
  /// which intentionally remains a list-returning convenience wrapper.
  Future<ForumPage<ForumPost>> postPage({
    String? category,
    String scope = 'all',
    String? cursor,
    int limit = 20,
  }) async {
    final response = await client.getData('/v1/forum/posts', query: {
      if (category != null && category.trim().isNotEmpty) 'category': category,
      'scope': scope,
      if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      'limit': limit,
    });
    final items =
        _items(response).map(ForumPost.fromJson).toList(growable: false);
    final next = response is JsonMap && response['nextCursor'] != null
        ? '${response['nextCursor']}'
        : null;
    _postCursors['${scope}:${category ?? ''}'] = next;
    return ForumPage(items: items, nextCursor: next);
  }

  Future<List<ForumPost>> posts(
          {String? category, String scope = 'all'}) async =>
      (await postPage(category: category, scope: scope)).items;
  Future<ForumPost> createPost(
          {required String title,
          required String body,
          required String category}) async =>
      ForumPost.fromJson(await client.postData('/v1/forum/posts',
              data: {'title': title, 'body': body, 'category': category})
          as JsonMap);

  Future<ForumPost> postDetail(String id) async => ForumPost.fromJson(
      await client.getData('/v1/forum/posts/${Uri.encodeComponent(id)}')
          as JsonMap);

  Future<ForumPage<ForumComment>> commentPage(
    String postId, {
    String? cursor,
    int limit = 20,
  }) async {
    final response = await client.getData(
      '/v1/forum/posts/${Uri.encodeComponent(postId)}/comments',
      query: {
        'limit': limit,
        if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      },
    );
    final items =
        _items(response).map(ForumComment.fromJson).toList(growable: false);
    final next = response is JsonMap && response['nextCursor'] != null
        ? '${response['nextCursor']}'
        : null;
    _commentCursors[postId] = next;
    return ForumPage(items: items, nextCursor: next);
  }

  Future<List<ForumComment>> comments(String postId) async =>
      (await commentPage(postId)).items;

  Future<void> deletePost(String postId) async {
    await client.deleteData('/v1/forum/posts/${Uri.encodeComponent(postId)}');
  }

  /// Submit a user report for a published post.  The server keeps the report
  /// in a pending moderation queue (and de-duplicates an identical pending
  /// report from the same user), so the mobile client only needs to surface a
  /// success/error state and must not pretend that moderation has completed.
  Future<JsonMap> reportPost(String postId, String reason) async =>
      _map(await client.postData(
          '/v1/forum/posts/${Uri.encodeComponent(postId)}/report',
          data: {'reason': reason.trim()}));

  Future<void> deleteComment(String commentId) async {
    await client
        .deleteData('/v1/forum/comments/${Uri.encodeComponent(commentId)}');
  }

  Future<ForumPost> toggleLike(String postId) async =>
      ForumPost.fromJson(await client.postData(
          '/v1/forum/posts/${Uri.encodeComponent(postId)}/like') as JsonMap);

  Future<ForumPost> toggleFavorite(String postId) async =>
      ForumPost.fromJson(await client.postData(
              '/v1/forum/posts/${Uri.encodeComponent(postId)}/favorite')
          as JsonMap);

  Future<ForumComment> createComment(String postId, String body) async =>
      ForumComment.fromJson(await client.postData(
          '/v1/forum/posts/${Uri.encodeComponent(postId)}/comments',
          data: {'body': body}) as JsonMap);
}

class LegalRepository {
  const LegalRepository(this.client);
  final ApiTransport client;

  Future<AppLegalDocument> document(String key) async {
    const supported = <String>{
      'terms',
      'privacy',
      'sdk-list',
      'account-deletion'
    };
    if (!supported.contains(key)) {
      throw const ApiError('LEGAL_DOCUMENT_NOT_FOUND', '应用文档不存在');
    }
    final encodedKey = Uri.encodeComponent(key);
    final payload =
        _map(await client.getData('/v1/legal-documents/$encodedKey'));
    final document = AppLegalDocument.fromJson(payload);
    if (document.key != key ||
        document.title.trim().isEmpty ||
        document.sections.isEmpty) {
      throw const ApiError('INVALID_LEGAL_DOCUMENT', '应用文档内容不完整');
    }
    return document;
  }

  Future<List<LegalDocument>> search(String query, {String? subjectId}) async =>
      _items(await client.getData('/v1/law/search', query: {
        'q': query,
        if (subjectId != null && subjectId.isNotEmpty) 'subjectId': subjectId,
      }))
          .map(LegalDocument.fromJson)
          .toList(growable: false);
  Future<List<JsonMap>> announcements() async =>
      _items(await client.getData('/v1/announcements'));
}

class SettingsRepository {
  const SettingsRepository(this.client);
  final ApiTransport client;

  Future<UserSettings> settings() async =>
      UserSettings.fromJson(_map(await client.getData('/v1/me/settings')));

  Future<UserSettings> update({
    bool? learningReminders,
    bool? courseUpdates,
    bool? orderNotifications,
  }) async {
    final data = <String, dynamic>{
      if (learningReminders != null) 'learningReminders': learningReminders,
      if (courseUpdates != null) 'courseUpdates': courseUpdates,
      if (orderNotifications != null) 'orderNotifications': orderNotifications,
    };
    if (data.isEmpty) {
      throw const ApiError('VALIDATION_ERROR', '至少提供一项设置');
    }
    return UserSettings.fromJson(
        _map(await client.patchData('/v1/me/settings', data: data)));
  }
}

class GradingRepository {
  const GradingRepository(this.client);
  final ApiTransport client;
  Future<List<GradingQuestion>> questions({String? subjectId}) async =>
      _items(await client.getData('/v1/grading/questions', query: {
        if (subjectId != null) 'subjectId': subjectId,
      }))
          .map(GradingQuestion.fromJson)
          .toList(growable: false);
  Future<List<JsonMap>> papers({String? subjectId}) async =>
      _items(await client.getData('/v1/grading/papers', query: {
        if (subjectId != null) 'subjectId': subjectId,
      }));
  Future<List<GradingPaper>> typedPapers({String? subjectId}) async =>
      (await papers(subjectId: subjectId))
          .map(GradingPaper.fromJson)
          .toList(growable: false);
  Future<GradingPaper> paper(String id) async => GradingPaper.fromJson(
      _map(await client.getData('/v1/grading/papers/$id')));
  Future<GradingQuestion> question(String id) async => GradingQuestion.fromJson(
      _map(await client.getData('/v1/grading/questions/$id')));
  Future<List<GradingSubmission>> submissions() async =>
      _items(await client.getData('/v1/grading/submissions/v2'))
          .map(GradingSubmission.fromJson)
          .toList(growable: false);
  Future<GradingSubmission> submission(String id) async =>
      GradingSubmission.fromJson(
          _map(await client.getData('/v1/grading/submissions/$id')));
  Future<GradingReport> report(String submissionId) async =>
      GradingReport.fromJson(_map(await client
          .getData('/v1/grading/submissions/$submissionId/report')));
  Future<GradingSubmission> submit({
    required String questionId,
    required List<JsonMap> answers,
    required String idempotencyKey,
    String? paperId,
  }) async {
    final payload = <String, dynamic>{
      'questionId': questionId,
      'answers': answers,
      if (paperId != null) 'paperId': paperId,
    };
    final response = client is HeaderAwareApiTransport
        ? await (client as HeaderAwareApiTransport).postDataWithHeaders(
            '/v1/grading/submissions',
            data: payload,
            headers: {'Idempotency-Key': idempotencyKey},
          )
        : await client.postData('/v1/grading/submissions', data: {
            ...payload,
            // Legacy transports cannot set headers; retaining the key in the
            // body keeps deterministic fake/replay tests useful.
            'idempotencyKey': idempotencyKey,
          });
    return GradingSubmission.fromJson(_map(response));
  }

  Future<JsonMap> retry(String id) async =>
      _map(await client.postData('/v1/grading/submissions/$id/retry'));
}
