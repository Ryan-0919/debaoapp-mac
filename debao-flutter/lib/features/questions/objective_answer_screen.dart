import '../../core/config/app_environment.dart';
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design_tokens.dart';
import '../../core/network/api_client.dart';
import '../../data/models.dart';
import '../../data/providers.dart';
import '../tools/study_tools_screens.dart';
import '../../shared/route_back_button.dart';
import '../learning/learning_inquiries_screen.dart';

/// RC objective answering flow. The default constructor deliberately keeps the
/// local prototype data; callers opt into the API with [remoteEnabled].
class ObjectiveAnswerScreen extends StatelessWidget {
  const ObjectiveAnswerScreen({
    super.key,
    required this.title,
    this.remoteEnabled = remoteDataDefault,
    this.subjectId,
    this.mode = 'chapter',
    this.questionType,
    this.paperId,
    this.questionIds = const [],
    this.limit,
    this.durationSeconds,
    this.sessionId,
    this.idempotencyKey,
    this.learningTaskId,
  });

  final String title;
  final bool remoteEnabled;
  final String? subjectId;
  final String mode;
  final String? questionType;
  final String? paperId;
  final List<String> questionIds;
  final int? limit;
  final int? durationSeconds;
  final String? sessionId;
  final String? idempotencyKey;
  final String? learningTaskId;

  @override
  Widget build(BuildContext context) => ProviderScope(
        child: _ObjectiveAnswerBody(
          title: title,
          remoteEnabled: remoteEnabled,
          subjectId: subjectId,
          mode: mode,
          questionType: questionType,
          paperId: paperId,
          questionIds: questionIds,
          limit: limit,
          durationSeconds: durationSeconds,
          sessionId: sessionId,
          idempotencyKey: idempotencyKey,
          learningTaskId: learningTaskId,
        ),
      );
}

class _ObjectiveAnswerBody extends ConsumerStatefulWidget {
  const _ObjectiveAnswerBody({
    required this.title,
    required this.remoteEnabled,
    required this.subjectId,
    required this.mode,
    required this.questionType,
    required this.paperId,
    required this.questionIds,
    required this.limit,
    required this.durationSeconds,
    required this.sessionId,
    required this.idempotencyKey,
    required this.learningTaskId,
  });

  final String title;
  final bool remoteEnabled;
  final String? subjectId;
  final String mode;
  final String? questionType;
  final String? paperId;
  final List<String> questionIds;
  final int? limit;
  final int? durationSeconds;
  final String? sessionId;
  final String? idempotencyKey;
  final String? learningTaskId;

  @override
  ConsumerState<_ObjectiveAnswerBody> createState() =>
      _ObjectiveAnswerScreenState();
}

class _ObjectiveAnswerScreenState extends ConsumerState<_ObjectiveAnswerBody>
    with WidgetsBindingObserver {
  static const localQuestions = <_Question>[
    _Question(
      id: 'oq1',
      title:
          '甲公司（出卖人）与乙公司（买受人）签订买卖合同，约定甲以分期付款方式向乙出售一批货物，乙未按期付款超过合同金额五分之一后，甲主张解除合同。关于甲的主张，下列说法正确的是：',
      options: [
        '甲可以直接解除合同，无需通知乙',
        '甲须经催告乙在合理期限内付款，乙不履行时，甲可解除合同',
        '合同中无明确约定时，甲不能主张解除合同',
        '甲可以行使法定解除权，须以通知方式解除，通知到达乙时合同解除',
      ],
      correct: 3,
      subject: '民法',
      year: '2023',
      point: '分期付款买卖与法定解除权',
      lawBasis: '《中华人民共和国民法典》第634条',
      analysis:
          '根据《民法典》第634条，分期付款的买受人未支付到期价款的数额达到全部价款五分之一，经催告后在合理期限内仍未支付的，出卖人可以请求买受人支付全部价款或者解除合同。但本题需注意，法定解除权的行使须以通知方式，通知到达对方时合同解除。故D项正确。',
    ),
    _Question(
      id: 'oq2',
      title:
          '甲于2020年1月将一幅名画借给乙展览，约定展览结束后归还。乙展览结束后，将名画转卖给不知情的丙，丙支付合理对价并取得名画。甲于2023年6月发现后，向法院起诉要求丙返还名画。下列说法正确的是：',
      options: [
        '丙构成善意取得，甲无权要求丙返还名画',
        '名画属于遗失物，善意取得不适用，甲可要求丙返还',
        '甲的请求已超过诉讼时效，应被驳回',
        '丙构成善意取得，但甲可以就价款向乙主张不当得利返还',
      ],
      correct: 0,
      subject: '民法',
      year: '2023',
      point: '动产善意取得与遗失物区别',
      lawBasis: '《中华人民共和国民法典》第311条',
      analysis:
          '名画系甲委托乙保管（借用），乙占有系有权占有，非遗失物。乙将名画转卖给善意第三人丙，丙支付合理对价，满足善意取得的构成要件，丙依法取得名画所有权。甲不能要求丙返还，只能向乙主张损害赔偿。诉讼时效从甲知道或应当知道之日起算，2023年6月发现，尚未超过诉讼时效。故A项正确。',
    ),
    _Question(
      id: 'oq3',
      title: '关于诉讼时效的适用，下列说法错误的是：',
      options: [
        '当事人可以协议延长或缩短诉讼时效期间',
        '诉讼时效届满后，义务人的自愿履行不构成不当得利',
        '诉讼时效届满，权利人的实体权利并不消灭，只是丧失胜诉权',
        '权利人在诉讼时效期间内向义务人提出履行请求，诉讼时效中断',
      ],
      correct: 0,
      subject: '民法',
      year: '2022',
      point: '诉讼时效的性质与适用规则',
      lawBasis: '《中华人民共和国民法典》第197条',
      analysis:
          '根据《民法典》第197条，诉讼时效的期间、计算方法以及中止、中断的事由由法律规定，当事人约定无效。故A项说法错误，是本题应选的答案。B项正确（时效届满后自愿履行属于对抗时效抗辩的放弃，不构成不当得利）。C项正确（诉讼时效届满消灭的是胜诉权，而非实体权利）。D项正确（权利人提出请求构成时效中断事由）。',
    ),
    _Question(
      id: 'oq4',
      title: '甲（17岁，已参加工作）用自己工资购买了一台电脑，其父乙认为不必要，主张撤销该行为。下列说法正确的是：',
      options: [
        '甲系限制民事行为能力人，购买电脑需经乙同意或追认',
        '甲以自己的劳动收入为主要生活来源，视为完全民事行为能力人，该购买行为有效',
        '购买电脑属于与甲年龄、智力相适应的行为，乙无权撤销',
        '乙作为法定代理人，有权撤销甲的该购买行为',
      ],
      correct: 1,
      subject: '民法',
      year: '2022',
      point: '限制民事行为能力人与拟制完全民事行为能力',
      lawBasis: '《中华人民共和国民法典》第18条',
      analysis:
          '根据《民法典》第18条第2款，16周岁以上的未成年人，以自己的劳动收入为主要生活来源的，视为完全民事行为能力人。甲17岁，已参加工作并以工资为生活来源，应视为完全民事行为能力人，其购买电脑的行为完全有效，乙无权干涉或撤销。故B项正确。',
    ),
  ];

  /// Local and remote answers are stored as option indexes. A set preserves
  /// multi-select order independence while still rendering single-select
  /// questions with the same controls as the RC screen.
  final answersById = <String, Set<int>>{};
  int current = 0;
  int seconds = 15 * 60;
  Timer? timer;
  bool submitting = false;
  bool interrupted = false;
  String? submitError;
  final remoteAnswersById = <String, Set<int>>{};
  final remoteAnswerWrites = <String, Future<void>>{};
  String? hydratedSessionId;
  String? remoteSubmitKey;
  late final String remoteCreateKey =
      'flutter-objective-create-${DateTime.now().microsecondsSinceEpoch}';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || submitting) return;
      setState(() => seconds = seconds > 0 ? seconds - 1 : 0);
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused && mounted) {
      setState(() => interrupted = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.remoteEnabled) {
      return _buildScaffold(context, localQuestions);
    }

    final request = ObjectiveSessionRequest(
      mode: widget.mode,
      title: widget.title,
      subjectId: widget.subjectId,
      questionType: widget.questionType,
      paperId: widget.paperId,
      questionIds: widget.questionIds,
      limit: widget.limit,
      durationSeconds: widget.durationSeconds,
      sessionId: widget.sessionId,
      idempotencyKey: widget.idempotencyKey ?? remoteCreateKey,
    );
    final remote = ref.watch(objectiveSessionProvider(request));
    if (remote.isLoading && !remote.hasValue) {
      return _stateScaffold(
        title: widget.title,
        child: const _QuestionState(
          icon: Icons.cloud_download_outlined,
          title: '正在加载题目',
          message: '正在从题库服务读取题目，请稍候…',
          loading: true,
        ),
      );
    }
    if (remote.hasError && !remote.hasValue) {
      return _stateScaffold(
        title: widget.title,
        child: _QuestionState(
          icon: Icons.cloud_off_outlined,
          title: '题目加载失败',
          message: _errorMessage(remote.error),
          actionLabel: '重试',
          onAction: () => ref.invalidate(objectiveSessionProvider(request)),
        ),
      );
    }
    final session = remote.valueOrNull;
    if (session == null || session.questions.isEmpty) {
      return _stateScaffold(
        title: widget.title,
        child: const _QuestionState(
          icon: Icons.inbox_outlined,
          title: '暂无题目',
          message: '当前科目还没有可练习的题目。',
        ),
      );
    }
    _hydrateRemoteSession(session);
    if (session.status == 'submitted') {
      return ObjectiveReportScreen(
        answers: session.answers
            .map((answer) => int.tryParse(
                answer.answers.isEmpty ? '' : answer.answers.first))
            .toList(growable: false),
        remoteEnabled: true,
        sessionId: session.id,
        title: session.title,
      );
    }
    if (session.status != 'in_progress') {
      return _stateScaffold(
        title: session.title,
        child: _QuestionState(
          icon: Icons.timer_off_outlined,
          title: '答题时间已结束',
          message: '该答题会话已经过期，请返回题库重新组卷。',
          actionLabel: '返回题库',
          onAction: () => Navigator.maybePop(context),
        ),
      );
    }
    final remoteQuestions = session.questions
        .map(_Question.fromSession)
        .where((question) => question.options.isNotEmpty)
        .toList(growable: false);
    return _buildRemoteScaffold(context, session, remoteQuestions);
  }

  void _hydrateRemoteSession(ObjectiveSession session) {
    if (hydratedSessionId == session.id) return;
    hydratedSessionId = session.id;
    remoteAnswersById
      ..clear()
      ..addEntries(session.answers.map((answer) => MapEntry(
            answer.questionId,
            answer.answers.map(int.tryParse).whereType<int>().toSet(),
          )));
    answersById
      ..clear()
      ..addAll(remoteAnswersById);
    final expiresAt = DateTime.tryParse(session.expiresAt);
    final remaining = expiresAt == null
        ? session.durationSeconds
        : expiresAt.difference(DateTime.now()).inSeconds;
    seconds = math.max(0, remaining);
    remoteSubmitKey =
        'flutter-objective-submit-${session.id}-${session.startedAt}';
  }

  Widget _stateScaffold({required String title, required Widget child}) =>
      Scaffold(
        backgroundColor: const Color(0xFFF4F5F7),
        appBar: AppBar(
          leading: const DebaoRouteBackButton(),
          title: Text(title),
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white,
        ),
        body: child,
      );

  Widget _buildRemoteScaffold(BuildContext context, ObjectiveSession session,
      List<_Question> questions) {
    return _buildScaffold(context, questions, session: session);
  }

  Widget _buildScaffold(BuildContext context, List<_Question> questions,
      {ObjectiveSession? session}) {
    if (questions.isEmpty)
      return _stateScaffold(
          title: widget.title, child: const Center(child: Text('暂无可作答题目')));
    final safeCurrent = current.clamp(0, questions.length - 1).toInt();
    final question = questions[safeCurrent];
    final selected = answersById[question.id] ?? const <int>{};
    final title = widget.title;

    return Scaffold(
      backgroundColor: const Color(0xFFF4F5F7),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        centerTitle: true,
        leading: const DebaoRouteBackButton(),
        title: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(title,
              style:
                  const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
          Text('${safeCurrent + 1} / ${questions.length}',
              style: const TextStyle(fontSize: 11, color: DebaoColors.muted)),
        ]),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        actions: [
          IconButton(
            onPressed: () => _showAnswerCard(context, questions),
            tooltip: '答题卡',
            icon: const Icon(Icons.grid_view_outlined, size: 19),
          ),
        ],
      ),
      body: Column(children: [
        if (interrupted)
          MaterialBanner(
            content: Text(widget.remoteEnabled
                ? '已恢复未提交练习，答案已同步到云端'
                : '已恢复未提交练习，答案保存在本机'),
            leading: const Icon(Icons.restore),
            actions: [
              TextButton(
                onPressed: () => setState(() => interrupted = false),
                child: const Text('知道了'),
              ),
            ],
          ),
        if (submitError != null)
          MaterialBanner(
            content: Text(submitError!),
            leading: const Icon(Icons.error_outline),
            actions: [
              TextButton(
                onPressed: () => setState(() => submitError = null),
                child: const Text('关闭'),
              ),
            ],
          ),
        Container(
          height: 17,
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(bottom: BorderSide(color: Color(0xFFE5E7ED))),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
          child: LinearProgressIndicator(
            value: (safeCurrent + 1) / questions.length,
            minHeight: 3,
            backgroundColor: const Color(0xFFE5E7ED),
            valueColor: const AlwaysStoppedAnimation(Color(0xFF4C4BEA)),
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(8)),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Text(question.subject,
                            style: const TextStyle(
                                color: DebaoColors.muted, fontSize: 11)),
                        const SizedBox(width: 8),
                        Text('${question.year}年',
                            style: const TextStyle(
                                color: DebaoColors.muted, fontSize: 11)),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Container(
                            height: 21,
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                            alignment: Alignment.centerLeft,
                            decoration: BoxDecoration(
                              color: const Color(0xFFF4F5F7),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              question.point,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  color: DebaoColors.body, fontSize: 10),
                            ),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 11),
                      Text(question.title,
                          style: const TextStyle(
                              color: DebaoColors.ink,
                              fontSize: 14,
                              height: 1.78,
                              fontWeight: FontWeight.w400)),
                    ]),
              ),
              const SizedBox(height: 12),
              ...question.options.asMap().entries.map((entry) {
                final isSelected = selected.contains(entry.key);
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: InkWell(
                    onTap: () => _selectAnswer(question, entry.key, questions,
                        session: session),
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.all(15),
                      decoration: BoxDecoration(
                          color: isSelected
                              ? const Color(0xFFF0F0FF)
                              : Colors.white,
                          border: Border.all(
                              color: isSelected
                                  ? const Color(0xFF4C4BEA)
                                  : Colors.transparent,
                              width: 1.2),
                          borderRadius: BorderRadius.circular(8)),
                      child: Row(children: [
                        Container(
                          width: 28,
                          height: 28,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: isSelected
                                ? const Color(0xFF4C4BEA)
                                : const Color(0xFFF4F5F7),
                            border: Border.all(
                                color: isSelected
                                    ? const Color(0xFF4C4BEA)
                                    : const Color(0xFFD5D9E2)),
                          ),
                          child: Text(String.fromCharCode(65 + entry.key),
                              style: TextStyle(
                                  color: isSelected
                                      ? Colors.white
                                      : const Color(0xFF707684),
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600)),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                            child: Text(entry.value,
                                style: const TextStyle(
                                    color: Color(0xFF171925),
                                    fontSize: 14,
                                    height: 1.57))),
                      ]),
                    ),
                  ),
                );
              }),
            ],
          ),
        ),
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: SafeArea(
            top: false,
            child: Row(children: [
              SizedBox(
                width: 96,
                height: 44,
                child: OutlinedButton(
                  key: const ValueKey('objective-previous'),
                  onPressed: submitting || safeCurrent == 0
                      ? null
                      : () => setState(() => current = safeCurrent - 1),
                  style: OutlinedButton.styleFrom(
                    padding: EdgeInsets.zero,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: const [
                      Icon(Icons.chevron_left, size: 16),
                      SizedBox(width: 2),
                      Text('上一题'),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: SizedBox(
                  height: 44,
                  child: FilledButton(
                    key: const ValueKey('objective-next'),
                    onPressed: submitting
                        ? null
                        : safeCurrent < questions.length - 1
                            ? () => setState(() => current = safeCurrent + 1)
                            : (submitting
                                ? null
                                : () => _submit(context, questions)),
                    style: FilledButton.styleFrom(
                      padding: EdgeInsets.zero,
                      backgroundColor: const Color(0xFF4C4BEA),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8)),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                            safeCurrent < questions.length - 1
                                ? '下一题'
                                : (submitting ? '提交中…' : '交卷'),
                            style:
                                const TextStyle(fontWeight: FontWeight.w700)),
                        if (safeCurrent < questions.length - 1) ...const [
                          SizedBox(width: 2),
                          Icon(Icons.chevron_right, size: 16),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ]),
          ),
        ),
      ]),
    );
  }

  void _selectAnswer(_Question question, int index, List<_Question> questions,
      {ObjectiveSession? session}) {
    final next = {...(answersById[question.id] ?? const <int>{})};
    if (question.isMultiple) {
      if (!next.add(index)) next.remove(index);
    } else {
      next
        ..clear()
        ..add(index);
    }
    setState(() => answersById[question.id] = next);
    if (session != null) {
      _queueRemoteAnswer(session, question.id, next);
    }
  }

  void _queueRemoteAnswer(
      ObjectiveSession session, String questionId, Set<int> answers) {
    final repository = ref.read(questionRepositoryProvider);
    final previous = remoteAnswerWrites[questionId] ?? Future<void>.value();
    // A failed write must not poison all later edits for the same question;
    // the next tap starts a fresh attempt after the failed request completes.
    final next = previous.catchError((_) {}).then((_) async {
      await repository.saveSessionAnswer(
        sessionId: session.id,
        questionId: questionId,
        answers: (answers.toList()..sort()).map((value) => '$value').toList(),
      );
    });
    remoteAnswerWrites[questionId] = next;
    unawaited(next.catchError((error) {
      if (mounted) {
        setState(() => submitError = '答案保存失败：${_errorMessage(error)}');
      }
    }));
  }

  void _submit(BuildContext context, List<_Question> questions) {
    if (submitting) return;
    final unanswered = questions.length -
        questions
            .where((question) => answersById[question.id]?.isNotEmpty == true)
            .length;
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('确认提交'),
        content: Text(unanswered == 0
            ? '全部题目已作答，提交后将生成成绩报告。'
            : '还有 $unanswered 道题未作答，确定要提交吗？'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('继续作答')),
          FilledButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              if (widget.remoteEnabled) {
                unawaited(_submitRemote(context, questions));
              } else {
                setState(() => submitting = true);
                Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                      builder: (_) => ObjectiveReportScreen(
                          answers: questions
                              .map((question) =>
                                  _firstAnswer(answersById[question.id]))
                              .toList())),
                );
              }
            },
            child: const Text('确认提交'),
          ),
        ],
      ),
    );
  }

  Future<void> _submitRemote(
      BuildContext context, List<_Question> questions) async {
    final navigator = Navigator.of(context);
    setState(() {
      submitting = true;
      submitError = null;
    });
    try {
      final repository = ref.read(questionRepositoryProvider);
      if (remoteAnswerWrites.isNotEmpty) {
        await Future.wait(remoteAnswerWrites.values);
      }
      final request = ObjectiveSessionRequest(
        mode: widget.mode,
        title: widget.title,
        subjectId: widget.subjectId,
        paperId: widget.paperId,
        questionIds: widget.questionIds,
        limit: widget.limit,
        durationSeconds: widget.durationSeconds,
        sessionId: widget.sessionId,
        learningTaskId: widget.learningTaskId,
        idempotencyKey: widget.idempotencyKey ?? remoteCreateKey,
      );
      final session = await ref.read(objectiveSessionProvider(request).future);
      await repository.submitSession(
        sessionId: session.id,
        idempotencyKey: remoteSubmitKey ??
            'flutter-objective-submit-${session.id}-${session.startedAt}',
      );
      if (widget.learningTaskId != null && widget.learningTaskId!.isNotEmpty) {
        await ref
            .read(courseRepositoryProvider)
            .completeTask(widget.learningTaskId!);
      }
      if (!mounted) return;
      setState(() => submitting = false);
      navigator.pushReplacement(
        MaterialPageRoute(
          builder: (_) => ObjectiveReportScreen(
            answers: questions
                .map((q) => _firstAnswer(answersById[q.id]))
                .toList(growable: false),
            remoteEnabled: true,
            sessionId: session.id,
            title: widget.title,
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        submitting = false;
        submitError = '提交失败：${_errorMessage(error)}，请检查网络后重试。';
      });
    }
  }

  int? _firstAnswer(Set<int>? values) {
    if (values == null || values.isEmpty) return null;
    final sorted = values.toList()..sort();
    return sorted.first;
  }

  void _showAnswerCard(BuildContext context, List<_Question> questions) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('答题卡',
                    style:
                        TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                const SizedBox(height: 14),
                Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: List.generate(
                        questions.length,
                        (index) => InkWell(
                              onTap: () {
                                Navigator.pop(sheetContext);
                                setState(() => current = index);
                              },
                              child: Container(
                                  width: 38,
                                  height: 38,
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                      color: index == current
                                          ? DebaoColors.brand
                                          : answersById[questions[index].id]
                                                      ?.isNotEmpty ==
                                                  true
                                              ? DebaoColors.brandLight
                                              : DebaoColors.page,
                                      borderRadius: BorderRadius.circular(6)),
                                  child: Text('${index + 1}',
                                      style: TextStyle(
                                          color: index == current
                                              ? Colors.white
                                              : DebaoColors.body,
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600))),
                            ))),
                const SizedBox(height: 16),
                Text(
                    '已作答 ${questions.where((q) => answersById[q.id]?.isNotEmpty == true).length} / ${questions.length}',
                    style: const TextStyle(
                        color: DebaoColors.muted, fontSize: 12)),
                const SizedBox(height: 12),
                SizedBox(
                    width: double.infinity,
                    height: 44,
                    child: FilledButton(
                        onPressed: submitting
                            ? null
                            : () {
                                Navigator.pop(sheetContext);
                                _submit(context, questions);
                              },
                        style: FilledButton.styleFrom(
                            backgroundColor: DebaoColors.brand),
                        child: const Text('交卷'))),
              ]),
        ),
      ),
    );
  }
}

class _Question {
  const _Question({
    required this.id,
    required this.title,
    required this.options,
    this.correct,
    this.analysis,
    this.subject = '民法',
    this.year = '2023',
    this.kind = '单选题',
    this.point = '在线练习',
    this.lawBasis = '',
  });

  final String id;
  final String title;
  final List<String> options;
  final int? correct;
  final String? analysis;
  final String subject;
  final String year;
  final String kind;
  final String point;
  final String lawBasis;

  bool get isMultiple => kind == '多选题' || kind == '不定项选择题';

  factory _Question.fromSession(ObjectiveSessionQuestion question) => _Question(
        id: question.id,
        title: question.stem,
        options: question.options,
        kind: question.questionTypeLabel,
        subject: question.subjectId ?? '当前科目',
        point: '在线练习',
      );
}

class _QuestionState extends StatelessWidget {
  const _QuestionState({
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
    this.loading = false,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool loading;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            if (loading)
              const SizedBox(
                  width: 28,
                  height: 28,
                  child: CircularProgressIndicator(strokeWidth: 2.5))
            else
              Icon(icon, color: const Color(0xFFC0C5D0), size: 40),
            const SizedBox(height: 14),
            Text(title,
                style:
                    const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: DebaoColors.muted, fontSize: 12)),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ]),
        ),
      );
}

String _errorMessage(Object? error) {
  if (error is ApiError) return error.message;
  if (error is TimeoutException) return '请求超时';
  return '网络暂时不可用';
}

/// A server-derived result used by the remote report. Keeping this small makes
/// the report independently renderable in tests and after a submission.
class ObjectiveReportItem {
  const ObjectiveReportItem({
    required this.id,
    required this.title,
    required this.selectedAnswer,
    required this.correctAnswer,
    required this.correct,
    this.analysis,
    this.options = const [],
    this.submissionId,
    this.selectedAnswers = const [],
    this.correctAnswers = const [],
    this.explanationMediaType,
    this.explanationMediaReference,
  });

  final String id;
  final String title;
  final int? selectedAnswer;
  final int? correctAnswer;
  final bool correct;
  final String? analysis;
  final List<String> options;
  final String? submissionId;
  final List<int> selectedAnswers;
  final List<int> correctAnswers;
  final String? explanationMediaType, explanationMediaReference;

  List<int> get effectiveSelectedAnswers => selectedAnswers.isNotEmpty
      ? selectedAnswers
      : selectedAnswer == null
          ? const []
          : [selectedAnswer!];
  List<int> get effectiveCorrectAnswers => correctAnswers.isNotEmpty
      ? correctAnswers
      : correctAnswer == null
          ? const []
          : [correctAnswer!];
}

class LegacyObjectiveReportScreen extends StatelessWidget {
  const LegacyObjectiveReportScreen({super.key, required this.answers});

  final List<int?> answers;

  @override
  Widget build(BuildContext context) => ObjectiveReportScreen(answers: answers);
}

class ObjectiveReportScreen extends StatelessWidget {
  const ObjectiveReportScreen({
    super.key,
    required this.answers,
    this.remoteEnabled = remoteDataDefault,
    this.results,
    this.title = '答题报告',
    this.sessionId,
    this.report,
    this.demoFixture = false,
  });

  final List<int?> answers;
  final bool remoteEnabled;
  final List<ObjectiveReportItem>? results;
  final String title;
  final String? sessionId;
  final ObjectiveReport? report;

  /// Keeps the standalone preview aligned with the RC's fixed report sample.
  /// Real submissions leave this false and calculate from their answers.
  final bool demoFixture;

  @override
  Widget build(BuildContext context) {
    if (report != null) {
      return _ObjectiveReportView.fromReport(report!);
    }
    if (remoteEnabled && sessionId != null && sessionId!.isNotEmpty) {
      return ProviderScope(
        child: _ObjectiveSessionReportLoader(
          sessionId: sessionId!,
          answers: answers,
          title: title,
        ),
      );
    }
    if (remoteEnabled && (results == null || results!.isEmpty)) {
      return Scaffold(
        backgroundColor: Color(0xFFF4F5F7),
        appBar: AppBar(
          leading: const DebaoRouteBackButton(),
          title: Text('答题报告'),
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white,
        ),
        body: _QuestionState(
          icon: Icons.link_off_outlined,
          title: '答题会话编号缺失',
          message: '请从做题记录或答题完成页重新打开报告。',
        ),
      );
    }
    final items = results ?? _localReportItems(answers, demo: demoFixture);
    return _ObjectiveReportView(
      title: title,
      items: items,
      remote: remoteEnabled,
      serverScore: demoFixture ? 75 : null,
      serverMaxScore: demoFixture ? 100 : null,
      serverCorrect: demoFixture ? 3 : null,
      serverAnswered: demoFixture ? 4 : null,
      serverSubjectStats: demoFixture
          ? const [
              (subjectId: '民法', total: 3, correct: 2, correctRate: 67),
              (subjectId: '刑法', total: 1, correct: 1, correctRate: 100),
            ]
          : const [],
    );
  }

  List<ObjectiveReportItem> _localReportItems(List<int?> values,
      {bool demo = false}) {
    final selectedValues = demo ? _localDemoAnswers : values;
    return List.generate(_ObjectiveAnswerScreenState.localQuestions.length,
        (index) {
      final question = _ObjectiveAnswerScreenState.localQuestions[index];
      final selected =
          selectedValues.length > index ? selectedValues[index] : null;
      return ObjectiveReportItem(
        id: question.id,
        title: question.title,
        selectedAnswer: selected,
        correctAnswer: question.correct,
        correct: selected != null && selected == question.correct,
        analysis: question.analysis,
        options: question.options,
      );
    });
  }
}

// Matches the RC ObjectiveReportScreen fallback sample (D, B, A, A).
const _localDemoAnswers = <int?>[3, 1, 0, 0];

class _ObjectiveSessionReportLoader extends ConsumerWidget {
  const _ObjectiveSessionReportLoader({
    required this.sessionId,
    required this.answers,
    required this.title,
  });

  final String sessionId;
  final List<int?> answers;
  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final report = ref.watch(objectiveReportProvider(sessionId));
    if (report.isLoading && !report.hasValue) {
      return const Scaffold(
        backgroundColor: Color(0xFFF4F5F7),
        body: _QuestionState(
          icon: Icons.cloud_download_outlined,
          title: '正在加载成绩',
          message: '正在读取服务端判分结果，请稍候…',
          loading: true,
        ),
      );
    }
    if (report.hasError && !report.hasValue) {
      return Scaffold(
        backgroundColor: const Color(0xFFF4F5F7),
        appBar: AppBar(
          leading: const DebaoRouteBackButton(),
          title: Text(title),
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white,
        ),
        body: _QuestionState(
          icon: Icons.cloud_off_outlined,
          title: '成绩加载失败',
          message: _errorMessage(report.error),
          actionLabel: '重试',
          onAction: () => ref.invalidate(objectiveReportProvider(sessionId)),
        ),
      );
    }
    final value = report.valueOrNull;
    if (value == null || value.results.isEmpty) {
      return const Scaffold(
        backgroundColor: Color(0xFFF4F5F7),
        body: _QuestionState(
          icon: Icons.inbox_outlined,
          title: '暂无成绩报告',
          message: '服务端还没有生成该答题会话的报告。',
        ),
      );
    }
    return _ObjectiveReportView.fromReport(value);
  }
}

class _ObjectiveReportView extends StatelessWidget {
  const _ObjectiveReportView(
      {required this.title,
      required this.items,
      required this.remote,
      this.serverScore,
      this.serverMaxScore,
      this.serverCorrect,
      this.serverAnswered,
      this.reportId,
      this.serverSubjectStats = const []});

  factory _ObjectiveReportView.fromReport(ObjectiveReport report) {
    final items = report.results
        .map((result) => ObjectiveReportItem(
              id: result.questionId,
              title: result.stem,
              selectedAnswer: _parseFirstIndex(result.answers),
              correctAnswer: _parseFirstIndex(result.correctAnswers),
              selectedAnswers: _parseIndexes(result.answers),
              correctAnswers: _parseIndexes(result.correctAnswers),
              correct: result.correct,
              analysis: result.analysis,
              options: result.options,
              explanationMediaReference: result.explanationMediaReference,
              explanationMediaType: result.explanationMediaType,
            ))
        .toList(growable: false);
    return _ObjectiveReportView(
      title: report.title,
      items: items,
      remote: true,
      reportId: report.id,
      serverCorrect: report.correct,
      serverScore: report.score,
      serverMaxScore: report.maxScore,
      serverAnswered: report.answered,
      serverSubjectStats: report.subjectStats,
    );
  }

  final String title;
  final List<ObjectiveReportItem> items;
  final bool remote;
  final String? reportId;
  final int? serverScore;
  final int? serverMaxScore;
  final int? serverCorrect;
  final int? serverAnswered;
  final List<({String subjectId, int total, int correct, int correctRate})>
      serverSubjectStats;

  @override
  Widget build(BuildContext context) {
    final total = items.length;
    final correct = serverCorrect ?? items.where((item) => item.correct).length;
    final answered = serverAnswered ?? total;
    final score =
        serverScore ?? (total == 0 ? 0 : ((correct / total) * 100).round());
    final maxScore = serverMaxScore ?? 100;
    return Scaffold(
      backgroundColor: const Color(0xFFF4F5F7),
      appBar: AppBar(
          leading: const DebaoRouteBackButton(),
          title: Text(title),
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white),
      body: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(8)),
              child: Column(children: [
                Container(
                    width: 86,
                    height: 86,
                    decoration: BoxDecoration(
                        color: const Color(0xFFF0F0FF),
                        shape: BoxShape.circle,
                        border: Border.all(
                            color: const Color(0xFF4C4BEA), width: 4)),
                    child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text('$score',
                              style: const TextStyle(
                                  fontSize: 25,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF4C4BEA))),
                          Text(maxScore == 100 ? '分' : '/$maxScore',
                              style: TextStyle(
                                  fontSize: 10, color: Color(0xFF4C4BEA)))
                        ])),
                const SizedBox(height: 10),
                const Text('本次得分',
                    style: TextStyle(fontSize: 14, color: Color(0xFF5F6574))),
                const SizedBox(height: 14),
                const Divider(height: 1, color: Color(0xFFE5E7ED)),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                      child: _ReportMetric(
                          '$correct', '答对', const Color(0xFF5DA765))),
                  Container(
                      width: 1, height: 30, color: const Color(0xFFE5E7ED)),
                  Expanded(
                      child: _ReportMetric(
                          '${(answered - correct).clamp(0, answered)}',
                          '答错',
                          const Color(0xFFFF7252))),
                  Container(
                      width: 1, height: 30, color: const Color(0xFFE5E7ED)),
                  Expanded(
                      child: _ReportMetric(
                          '$answered', '总题数', const Color(0xFF171925)))
                ])
              ]),
            ),
            const SizedBox(height: 12),
            Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(8)),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('科目分析',
                          style: TextStyle(
                              fontSize: 14, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 12),
                      if (serverSubjectStats.isNotEmpty)
                        ...serverSubjectStats.map((stat) => _SubjectProgress(
                              name: stat.subjectId,
                              value: stat.total == 0
                                  ? 0
                                  : stat.correct / stat.total,
                              count: '${stat.correct}/${stat.total}',
                            ))
                      else
                        _SubjectProgress(
                            name: items.isNotEmpty && items.first.id.isNotEmpty
                                ? '当前科目'
                                : '暂无科目',
                            value: total == 0 ? 0 : correct / total,
                            count: '$correct/$total'),
                    ])),
            const SizedBox(height: 14),
            const Text('逐题解析',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            ...items.asMap().entries.map((entry) => _ReviewCard(
                  index: entry.key,
                  isRight: entry.value.correct,
                  title: entry.value.title,
                  selectedAnswer: entry.value.selectedAnswer,
                  correctAnswer: entry.value.correctAnswer,
                  selectedAnswers: entry.value.effectiveSelectedAnswers,
                  correctAnswers: entry.value.effectiveCorrectAnswers,
                  options: entry.value.options,
                  analysis: entry.value.analysis,
                  remote: remote,
                  reportId: reportId,
                  item: entry.value,
                )),
          ]),
      bottomNavigationBar: SafeArea(
          top: false,
          child: Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              decoration: const BoxDecoration(
                  color: Colors.white,
                  border: Border(top: BorderSide(color: Color(0xFFE5E7ED)))),
              child: Row(children: [
                Expanded(
                    child: OutlinedButton(
                        onPressed: () =>
                            Navigator.of(context).push(MaterialPageRoute(
                                builder: (_) => MistakeBookScreen(
                                      remoteEnabled: remote,
                                    ))),
                        style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(44),
                            side: const BorderSide(color: Color(0xFFE5E7ED)),
                            foregroundColor: const Color(0xFF5F6574)),
                        child: const Text('加入错题本'))),
                const SizedBox(width: 8),
                Expanded(
                    child: FilledButton(
                        onPressed: () => Navigator.popUntil(
                            context, (route) => route.isFirst),
                        style: FilledButton.styleFrom(
                            minimumSize: const Size.fromHeight(44),
                            backgroundColor: const Color(0xFF4C4BEA)),
                        child: const Text('返回题库')))
              ]))),
    );
  }
}

List<int> _parseIndexes(List<String> values) =>
    values.map(int.tryParse).whereType<int>().toSet().toList()..sort();

int? _parseFirstIndex(List<String> values) {
  final indexes = _parseIndexes(values);
  return indexes.isEmpty ? null : indexes.first;
}

class _ReportMetric extends StatelessWidget {
  const _ReportMetric(this.value, this.label, this.color);
  final String value;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Column(children: [
        Text(value,
            style: TextStyle(
                color: color, fontSize: 20, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(label,
            style: const TextStyle(color: Color(0xFF707684), fontSize: 12))
      ]);
}

class _SubjectProgress extends StatelessWidget {
  const _SubjectProgress(
      {required this.name, required this.value, required this.count});
  final String name;
  final String count;
  final double value;

  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(children: [
        Row(children: [
          Text(name,
              style: const TextStyle(color: Color(0xFF5F6574), fontSize: 13)),
          const Spacer(),
          Text(count,
              style: const TextStyle(color: Color(0xFF707684), fontSize: 12))
        ]),
        const SizedBox(height: 6),
        LinearProgressIndicator(
            value: value.clamp(0, 1).toDouble(),
            minHeight: 5,
            borderRadius: const BorderRadius.all(Radius.circular(3)),
            backgroundColor: const Color(0xFFE5E7ED),
            valueColor: AlwaysStoppedAnimation(value >= .7
                ? const Color(0xFF5DA765)
                : const Color(0xFFFF7252)))
      ]));
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({
    required this.index,
    required this.isRight,
    this.title,
    this.selectedAnswer,
    this.correctAnswer,
    this.selectedAnswers = const [],
    this.correctAnswers = const [],
    this.options = const [],
    this.analysis,
    this.remote = false,
    this.reportId,
    this.item,
  });

  final int index;
  final bool isRight;
  final String? title;
  final int? selectedAnswer;
  final int? correctAnswer;
  final List<int> selectedAnswers;
  final List<int> correctAnswers;
  final List<String> options;
  final String? analysis;
  final bool remote;
  final String? reportId;
  final ObjectiveReportItem? item;

  @override
  Widget build(BuildContext context) {
    final selectedValues = selectedAnswers.isNotEmpty
        ? selectedAnswers
        : selectedAnswer == null
            ? const <int>[]
            : [selectedAnswer!];
    final correctValues = correctAnswers.isNotEmpty
        ? correctAnswers
        : correctAnswer == null
            ? const <int>[]
            : [correctAnswer!];
    String labels(List<int> values, String empty) => values.isEmpty
        ? empty
        : values.map((value) => String.fromCharCode(65 + value)).join('、');
    final selectedLabel = labels(selectedValues, '未作答');
    final correctLabel = labels(correctValues, '服务端判定');
    final explanation =
        analysis?.trim().isNotEmpty == true ? analysis! : '暂未发布本题解析';
    return InkWell(
        key: ValueKey('review-question-$index'),
        onTap: item == null
            ? null
            : () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => _QuestionReviewDetail(
                        item: item!, reportId: reportId))),
        child: Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
                color: Colors.white, borderRadius: BorderRadius.circular(8)),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Icon(isRight ? Icons.check_circle : Icons.cancel,
                    color: isRight
                        ? const Color(0xFF5DA765)
                        : const Color(0xFFFF7252),
                    size: 17),
                const SizedBox(width: 8),
                Expanded(
                    child: Text(title ?? '关于合同效力与当事人权利的下列说法正确的是…',
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: Color(0xFF171925),
                            fontSize: 13,
                            height: 1.45))),
                const Icon(Icons.chevron_right, size: 20),
              ]),
              const SizedBox(height: 8),
              Padding(
                  padding: const EdgeInsets.only(left: 25),
                  child: Row(children: [
                    const Text('你的答案: ',
                        style:
                            TextStyle(color: Color(0xFF5F6574), fontSize: 12)),
                    Text(selectedLabel,
                        style: TextStyle(
                            color: isRight
                                ? const Color(0xFF5DA765)
                                : const Color(0xFFFF7252),
                            fontSize: 12,
                            fontWeight: FontWeight.w600)),
                    const SizedBox(width: 16),
                    const Text('正确答案: ',
                        style:
                            TextStyle(color: Color(0xFF5F6574), fontSize: 12)),
                    Text(correctLabel,
                        style: const TextStyle(
                            color: Color(0xFF5DA765),
                            fontSize: 12,
                            fontWeight: FontWeight.w600))
                  ])),
              const SizedBox(height: 8),
              Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                      color: const Color(0xFFF4F5F7),
                      borderRadius: BorderRadius.circular(4)),
                  child: Text(remote ? '解析：$explanation' : '解析：$explanation',
                      style: const TextStyle(
                          color: Color(0xFF707684),
                          fontSize: 12,
                          height: 1.5))),
              const SizedBox(height: 8),
              const Text('点击查看完整解析、微课并提交错因',
                  style: TextStyle(color: DebaoColors.brand, fontSize: 12)),
            ])));
  }
}

class _QuestionReviewDetail extends StatelessWidget {
  const _QuestionReviewDetail({required this.item, this.reportId});
  final ObjectiveReportItem item;
  final String? reportId;
  String labels(List<int> values) => values.isEmpty
      ? '未作答'
      : values.map((i) => String.fromCharCode(65 + i)).join('、');
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
            title: const Text('题目解析'), leading: const DebaoRouteBackButton()),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          SelectableText(item.title,
              style: const TextStyle(fontSize: 18, height: 1.6)),
          const SizedBox(height: 16),
          for (final option in item.options.asMap().entries)
            Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                    '${String.fromCharCode(65 + option.key)}. ${option.value}',
                    style: const TextStyle(height: 1.5))),
          Text('你的答案：${labels(item.effectiveSelectedAnswers)}'),
          Text('正确答案：${labels(item.effectiveCorrectAnswers)}'),
          const Divider(height: 32),
          const Text('解析',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 10),
          SelectableText(
              item.analysis?.trim().isNotEmpty == true
                  ? item.analysis!
                  : '暂未发布本题解析',
              style: const TextStyle(height: 1.7)),
          QuestionMicroLesson(
              reference: item.explanationMediaReference,
              type: item.explanationMediaType),
          const Divider(height: 32),
          if (reportId != null)
            SubmitLearningInquiry(reportId: reportId!, questionId: item.id),
        ]),
      );
}
