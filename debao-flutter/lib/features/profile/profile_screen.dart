import '../../core/config/app_environment.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design_tokens.dart';
import '../../core/network/api_client.dart';
import '../../data/models.dart';
import '../../data/providers.dart';
import '../commerce/commerce_detail_screens.dart';
import '../commerce/mall_screen.dart';
import '../tools/study_tools_screens.dart';
import '../account/account_service_screens.dart';
import '../courses/courses_screen.dart';
import '../learning/learning_inquiries_screen.dart';
import '../../shared/route_back_button.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, this.remoteEnabled = remoteDataDefault});
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) {
    if (!remoteEnabled) return const _ProfileContent(remoteEnabled: false);
    const body = _RemoteProfileBody();
    // Reuse the application's root container so this page observes the
    // invalidation performed by the login flow. A fallback scope keeps the
    // screen usable when opened directly in an isolated preview/test.
    return _hasProviderScope(context) ? body : const ProviderScope(child: body);
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

class _RemoteProfileBody extends ConsumerWidget {
  const _RemoteProfileBody();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final courses = ref.watch(coursesProvider);
    final orders = ref.watch(ordersProvider);
    final report = ref.watch(learningReportProvider('week'));
    final mistakes = ref.watch(typedMistakesProvider);
    final states = [user, courses, orders, report, mistakes];
    if (states.any((state) => state.isLoading && !state.hasValue)) {
      return const _ProfileStatusScaffold(
          body: Center(
              child:
                  CircularProgressIndicator(key: ValueKey('profile-loading'))));
    }
    final failed = states.where((state) => state.hasError && !state.hasValue);
    if (failed.isNotEmpty) {
      final error = failed.first.error!;
      return _ProfileStatusScaffold(
          body: _ProfileErrorState(
        error: error,
        onRetry: () {
          ref.invalidate(currentUserProvider);
          ref.invalidate(coursesProvider);
          ref.invalidate(ordersProvider);
          ref.invalidate(learningReportProvider('week'));
          ref.invalidate(typedMistakesProvider);
        },
      ));
    }
    return _ProfileContent(
      remoteEnabled: true,
      user: user.valueOrNull,
      courses: courses.valueOrNull ?? const <Course>[],
      orders: orders.valueOrNull ?? const <Order>[],
      report: report.valueOrNull,
      mistakes: mistakes.valueOrNull ?? const <MistakeItem>[],
    );
  }
}

class _ProfileStatusScaffold extends StatelessWidget {
  const _ProfileStatusScaffold({required this.body});
  final Widget body;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: DebaoColors.page,
        body: SafeArea(child: body),
      );
}

class _ProfileErrorState extends StatelessWidget {
  const _ProfileErrorState({required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_outlined,
                color: DebaoColors.muted, size: 32),
            const SizedBox(height: 10),
            const Text('个人资料暂时无法加载',
                style: TextStyle(
                    color: DebaoColors.ink,
                    fontSize: 14,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Text('$error',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(color: DebaoColors.muted, fontSize: 11)),
            const SizedBox(height: 12),
            OutlinedButton.icon(
                key: const ValueKey('profile-retry'),
                onPressed: onRetry,
                icon: const Icon(Icons.refresh, size: 16),
                label: const Text('重试')),
          ]),
        ),
      );
}

class _ProfileContent extends StatelessWidget {
  const _ProfileContent({
    required this.remoteEnabled,
    this.user,
    this.courses = const <Course>[],
    this.orders = const <Order>[],
    this.report,
    this.mistakes = const <MistakeItem>[],
  });
  final bool remoteEnabled;
  final UserProfile? user;
  final List<Course> courses;
  final List<Order> orders;
  final LearningReport? report;
  final List<MistakeItem> mistakes;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: DebaoColors.page,
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.only(bottom: 20),
            children: [
              _header(context),
              _continueLearning(context),
              _stats(),
              _weekly(context),
              _Group(
                  '学习与内容',
                  [
                    _ProfileItem(Icons.auto_awesome_outlined, '得恩私教学习中心',
                        Color(0xFFF0F0FF), Color(0xFF4C4BEA)),
                    _ProfileItem(Icons.description_outlined, '学习报告',
                        Color(0xFFEAF6EF), Color(0xFF3A7A46)),
                    _ProfileItem(Icons.menu_book_outlined, '做题记录',
                        Color(0xFFEDF5FF), Color(0xFF1A5FA8)),
                    _ProfileItem(Icons.error_outline, '错题本', Color(0xFFFFF1E8),
                        Color(0xFFD2691E)),
                  ],
                  remoteEnabled: remoteEnabled),
              _Group(
                  '课程与服务',
                  [
                    _ProfileItem(Icons.shopping_bag_outlined, '订单与已购',
                        Color(0xFFFFF0F5), Color(0xFFC0385A)),
                  ],
                  remoteEnabled: remoteEnabled),
              _Group(
                  '应用管理',
                  [
                    _ProfileItem(Icons.notifications_none, '重要通知',
                        Color(0xFFFFF5DD), Color(0xFFA87000)),
                    _ProfileItem(Icons.support_agent_outlined, '客服',
                        Color(0xFFEAF7F7), Color(0xFF1A8B8B)),
                    _ProfileItem(Icons.settings_outlined, '设置与隐私',
                        Color(0xFFF4F5F7), Color(0xFF707684)),
                  ],
                  remoteEnabled: remoteEnabled),
            ],
          ),
        ),
      );

  String get _displayName {
    if (!remoteEnabled) return '李明远';
    final name = user?.name.trim() ?? '';
    return name.isEmpty ? '未设置昵称' : name;
  }

  String get _avatarLabel {
    final name = _displayName;
    return name.isEmpty ? '?' : name.substring(0, 1);
  }

  String get _examSummary {
    if (!remoteEnabled) return '备考中 · 2024客观题';
    final year = user?.examYear?.trim() ?? '';
    return year.isEmpty ? '备考信息未设置' : '备考中 · ${year}客观题';
  }

  Course? get _continueCourse {
    if (!remoteEnabled || courses.isEmpty) return null;
    final sorted = [...courses]
      ..sort((a, b) => b.progress.compareTo(a.progress));
    return sorted.first;
  }

  double _progressFraction(double value) =>
      (value > 1 ? value / 100 : value).clamp(0, 1).toDouble();

  String _progressLabel(double value) =>
      '${(_progressFraction(value) * 100).round()}%';

  Color _accent(String? value) {
    if (value == null) return const Color(0xFF4C4BEA);
    final parsed = int.tryParse(value.replaceFirst('#', ''), radix: 16);
    return parsed == null
        ? const Color(0xFF4C4BEA)
        : Color(0xFF000000 | parsed);
  }

  Widget _header(BuildContext context) => Container(
        color: Colors.white,
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 16),
        child: Row(children: [
          Container(
            width: 52,
            height: 52,
            alignment: Alignment.center,
            decoration: BoxDecoration(
                color: _accent(user?.avatarColor), shape: BoxShape.circle),
            child: Text(_avatarLabel,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w700)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: Color(0xFF171925),
                      fontSize: 17,
                      fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text(_examSummary,
                  style:
                      const TextStyle(color: Color(0xFF707684), fontSize: 12)),
            ]),
          ),
          OutlinedButton(
            onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) =>
                        UserProfileScreen(remoteEnabled: remoteEnabled))),
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: Color(0xFFE5E7ED)),
              foregroundColor: const Color(0xFF4C4BEA),
              minimumSize: const Size(76, 32),
            ),
            child: const Text('编辑资料', style: TextStyle(fontSize: 12)),
          ),
        ]),
      );

  Widget _continueLearning(BuildContext context) {
    final course = _continueCourse;
    if (remoteEnabled && course == null) {
      return _card(
          child: const Row(children: [
        Icon(Icons.menu_book_outlined, color: Color(0xFF707684), size: 28),
        SizedBox(width: 10),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('暂无已开通课程',
              style: TextStyle(
                  color: Color(0xFF171925),
                  fontSize: 13,
                  fontWeight: FontWeight.w600)),
          SizedBox(height: 3),
          Text('购买课程后，学习进度会显示在这里。',
              style: TextStyle(color: Color(0xFF707684), fontSize: 11)),
        ]))
      ]));
    }
    final title = course?.title ?? '民法精讲课（2024版）';
    final progress = course?.progress ?? 42;
    final teacher = course?.teacher ?? '张明远';
    return _card(
      child: Row(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(5),
          child: Image.asset(
              course == null || course.type == 'video'
                  ? 'assets/images/course-civil-law.jpg'
                  : 'assets/images/course-subjective.jpg',
              width: 72,
              height: 48,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) =>
                  const ColoredBox(color: Color(0xFFE1E5F4))),
        ),
        const SizedBox(width: 10),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    color: Color(0xFF171925),
                    fontSize: 13,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 3),
            Text(
                remoteEnabled
                    ? '$teacher · ${_progressLabel(progress)}'
                    : '第18讲：物权变动的公示与公信原则',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Color(0xFF707684), fontSize: 11)),
            const SizedBox(height: 7),
            LinearProgressIndicator(
                value: _progressFraction(progress),
                minHeight: 4,
                backgroundColor: const Color(0xFFE5E7ED),
                valueColor: const AlwaysStoppedAnimation(Color(0xFF4C4BEA))),
          ]),
        ),
        const SizedBox(width: 10),
        FilledButton(
          onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(
                  builder: (_) => CoursesScreen(
                      remoteEnabled: remoteEnabled,
                      coursePage: true,
                      showBackButton: true))),
          style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFC9F456),
              foregroundColor: const Color(0xFF171925),
              minimumSize: const Size(56, 32),
              padding: EdgeInsets.zero),
          child: const Text('继续',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        ),
      ]),
    );
  }

  Widget _stats() {
    if (!remoteEnabled) {
      return _card(
          child: const Row(children: [
        Expanded(child: _Stat('2', '已开课程')),
        Expanded(child: _Stat('4.2h', '本周学习')),
        Expanded(child: _Stat('42%', '当前进度')),
      ]));
    }
    final minutes = report?.minutes ?? 0;
    final double average = courses.isEmpty
        ? 0
        : courses
                .map((item) => _progressFraction(item.progress))
                .reduce((a, b) => a + b) /
            courses.length;
    return _card(
        child: Row(children: [
      Expanded(child: _Stat('${courses.length}', '已开课程')),
      Expanded(child: _Stat(_hoursLabel(minutes), '本周学习')),
      Expanded(child: _Stat(_progressLabel(average), '当前进度')),
    ]));
  }

  String _hoursLabel(int minutes) {
    if (minutes < 60) return '${minutes}m';
    final hours = minutes / 60;
    return '${hours.toStringAsFixed(hours == hours.roundToDouble() ? 0 : 1)}h';
  }

  Widget _weekly(BuildContext context) {
    final focus = remoteEnabled
        ? (report?.subjects.isNotEmpty == true
            ? report!.subjects
                // The weekly focus is the weakest subject, not the one with
                // the most study time. Keep the recommendation aligned with
                // the report's accuracy metric.
                .reduce((a, b) => a.correctRate <= b.correctRate ? a : b)
                .subjectId
            : '暂无重点学科')
        : '民事诉讼法';
    final mistakeLabel =
        remoteEnabled ? '待复习错题：${mistakes.length} 道' : '待复习错题：28 道';
    return _card(
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('本周重点',
                style: TextStyle(
                    color: Color(0xFF171925),
                    fontSize: 13,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 7),
            Text('当前薄弱学科：$focus',
                style: const TextStyle(color: Color(0xFF707684), fontSize: 12)),
            const SizedBox(height: 3),
            Text(mistakeLabel,
                style: const TextStyle(color: Color(0xFF707684), fontSize: 12)),
          ]),
        ),
        InkWell(
            onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) =>
                        LearningReportScreen(remoteEnabled: remoteEnabled))),
            child: const Text('查看报告 ›',
                style: TextStyle(color: Color(0xFF4C4BEA), fontSize: 12))),
      ]),
    );
  }

  Widget _card({required Widget child}) => Container(
        margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(8)),
        child: child,
      );
}

class _Stat extends StatelessWidget {
  const _Stat(this.value, this.label);
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Column(children: [
        Text(value,
            style: const TextStyle(
                color: Color(0xFF4C4BEA),
                fontSize: 19,
                fontWeight: FontWeight.w700)),
        const SizedBox(height: 5),
        Text(label,
            style: const TextStyle(color: Color(0xFF707684), fontSize: 11)),
      ]);
}

class _ProfileItem {
  const _ProfileItem(this.icon, this.label, this.background, this.color);
  final IconData icon;
  final String label;
  final Color background;
  final Color color;
}

class _Group extends StatelessWidget {
  const _Group(this.title, this.items, {required this.remoteEnabled});
  final String title;
  final List<_ProfileItem> items;
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 6),
            child: Text(title,
                style: const TextStyle(color: Color(0xFF707684), fontSize: 12)),
          ),
          Container(
            decoration: BoxDecoration(
                color: Colors.white, borderRadius: BorderRadius.circular(8)),
            child: Column(
              children: items.asMap().entries.map((entry) {
                final item = entry.value;
                return InkWell(
                  onTap: () {
                    final Widget? tool = switch (item.icon) {
                      Icons.event_note_outlined =>
                        LearningPlanScreen(remoteEnabled: remoteEnabled),
                      Icons.auto_awesome_outlined => PrivateCoachOverviewScreen(
                          remoteEnabled: remoteEnabled),
                      Icons.description_outlined =>
                        LearningReportScreen(remoteEnabled: remoteEnabled),
                      Icons.menu_book_outlined =>
                        QuestionRecordsScreen(remoteEnabled: remoteEnabled),
                      Icons.error_outline =>
                        MistakeBookScreen(remoteEnabled: remoteEnabled),
                      Icons.star_border =>
                        FavoritesScreen(remoteEnabled: remoteEnabled),
                      Icons.shopping_bag_outlined =>
                        OrderListScreen(remoteEnabled: remoteEnabled),
                      Icons.balance_outlined =>
                        LawSearchScreen(remoteEnabled: remoteEnabled),
                      Icons.edit_note_outlined =>
                        GradingServiceScreen(remoteEnabled: remoteEnabled),
                      Icons.notifications_none =>
                        NotificationsScreen(remoteEnabled: remoteEnabled),
                      Icons.support_agent_outlined => null,
                      Icons.settings_outlined =>
                        SettingsScreen(remoteEnabled: remoteEnabled),
                      Icons.play_circle_outline => CoursesScreen(
                          remoteEnabled: remoteEnabled,
                          coursePage: true,
                          showBackButton: true),
                      _ => null,
                    };
                    if (tool != null) {
                      Navigator.push(
                          context, MaterialPageRoute(builder: (_) => tool));
                      return;
                    }
                    if (item.label == '订单与已购') {
                      Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => OrderListScreen(
                                  remoteEnabled: remoteEnabled)));
                    }
                    if (item.label == '客服') {
                      showDialog<void>(
                          context: context,
                          builder: (_) => const AlertDialog(
                              title: Text('联系客服'),
                              content: Text('客服通道将根据后台配置显示。')));
                    }
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                        border: entry.key < items.length - 1
                            ? const Border(
                                bottom: BorderSide(color: Color(0xFFE5E7ED)))
                            : null),
                    child: Row(children: [
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                            color: item.background,
                            borderRadius: BorderRadius.circular(8)),
                        child: Icon(item.icon, color: item.color, size: 18),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                          child: Text(item.label,
                              style: const TextStyle(
                                  color: Color(0xFF171925), fontSize: 14))),
                      const Icon(Icons.chevron_right,
                          color: Color(0xFFC0C5D0), size: 19),
                    ]),
                  ),
                );
              }).toList(),
            ),
          ),
        ]),
      );
}

class PrivateCoachOverviewScreen extends ConsumerStatefulWidget {
  const PrivateCoachOverviewScreen({super.key, this.remoteEnabled = true});
  final bool remoteEnabled;
  @override
  ConsumerState<PrivateCoachOverviewScreen> createState() =>
      _PrivateCoachOverviewState();
}

class _PrivateCoachOverviewState
    extends ConsumerState<PrivateCoachOverviewScreen> {
  String? selectedSubjectId;
  String examMode = 'objective';

  @override
  Widget build(BuildContext context) {
    if (!widget.remoteEnabled) return const _PrivateCoachEmpty();
    final plans = ref.watch(learningPlansProvider);
    final tasks = ref.watch(learningTasksProvider);
    final report = ref.watch(learningReportProvider('month'));
    final records = ref.watch(learningQuestionRecordsProvider);
    final inquiries = ref.watch(learningInquiriesProvider);
    final orders = ref.watch(ordersProvider);
    final grading = ref.watch(gradingSubmissionsProvider);
    final loading = [plans, tasks, report, records, inquiries, orders];
    if (loading.any((state) => state.isLoading && !state.hasValue)) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final failed = loading.where((state) => state.hasError && !state.hasValue);
    if (failed.isNotEmpty) {
      final failedItems = <String, AsyncValue<dynamic>>{
        '学习计划': plans,
        '今日任务': tasks,
        '学习报告': report,
        '做题记录': records,
        '我的答疑': inquiries,
        '订单': orders,
      };
      final details = failedItems.entries
          .where((entry) => entry.value.hasError && !entry.value.hasValue)
          .map((entry) =>
              '${entry.key}：${_privateCoachError(entry.value.error!)}')
          .join('\n');
      return Scaffold(
        appBar: AppBar(title: const Text('得恩私教学习中心')),
        body: Center(
            child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_outlined,
                color: DebaoColors.muted, size: 34),
            const SizedBox(height: 12),
            const Text('学习中心暂时无法加载',
                style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Text(details,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: DebaoColors.muted, fontSize: 12, height: 1.5)),
            const SizedBox(height: 16),
            TextButton.icon(
              onPressed: () {
                ref.invalidate(learningPlansProvider);
                ref.invalidate(learningTasksProvider);
                ref.invalidate(learningReportProvider('month'));
                ref.invalidate(learningQuestionRecordsProvider);
                ref.invalidate(learningInquiriesProvider);
                ref.invalidate(ordersProvider);
              },
              icon: const Icon(Icons.refresh),
              label: const Text('重试'),
            ),
          ]),
        )),
      );
    }
    final planItems = plans.valueOrNull ?? const <LearningPlan>[];
    final paid = (orders.valueOrNull ?? const <Order>[]).any(
        (item) => ['paid', 'completed', 'fulfilled'].contains(item.status));
    if (!paid && planItems.isEmpty) {
      return const _PrivateCoachEmpty(remoteEnabled: true);
    }
    final taskItems = tasks.valueOrNull ?? const <LearningTask>[];
    final examTasks =
        taskItems.where((item) => item.contentType == 'assessment').toList();
    final cardTasks =
        taskItems.where((item) => item.contentType == 'card').toList();
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final completedPlans = planItems
        .where((item) =>
            item.status == 'completed' ||
            (item.endDate.isNotEmpty && item.endDate.compareTo(today) < 0))
        .length;
    final doneTasks = taskItems.where((item) => item.status == 'done').length;
    final courses = ref.watch(coursesProvider).valueOrNull ?? const <Course>[];
    final subjects =
        ref.watch(subjectsProvider).valueOrNull ?? const <Subject>[];
    final monthReport = report.valueOrNull;
    final visibleSubjects = monthReport?.subjects ??
        const <({String subjectId, int minutes, int correctRate})>[];
    final selected = selectedSubjectId == null
        ? visibleSubjects
        : visibleSubjects
            .where((item) => item.subjectId == selectedSubjectId)
            .toList();
    final subjectiveSubmissions =
        grading.valueOrNull ?? const <GradingSubmission>[];
    final gradedSubjective = subjectiveSubmissions.where((item) {
      final score = item.score;
      final maxScore = item.maxScore;
      return score != null && maxScore != null && maxScore > 0;
    }).toList(growable: false);
    final subjectiveRate = gradedSubjective.isEmpty
        ? null
        : (gradedSubjective
                    .map((item) => (item.score! / item.maxScore!) * 100)
                    .reduce((left, right) => left + right) /
                gradedSubjective.length)
            .round()
            .clamp(0, 100)
            .toInt();
    final activeRate =
        examMode == 'objective' ? monthReport?.correctRate : subjectiveRate;
    final activeMinutes = examMode == 'objective' ? monthReport?.minutes : null;
    final activeAnswered = examMode == 'objective'
        ? monthReport?.answered
        : gradedSubjective.length;
    final activeSubjects = examMode == 'objective'
        ? selected
        : const <({String subjectId, int minutes, int correctRate})>[];
    return Scaffold(
      backgroundColor: DebaoColors.page,
      appBar:
          AppBar(title: const Text('得恩私教学习中心'), backgroundColor: Colors.white),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        _examModeTabs(),
        const SizedBox(height: 10),
        Card(
            child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(children: [
                  const Icon(Icons.workspace_premium_outlined,
                      color: Color(0xFF4C4BEA), size: 30),
                  const SizedBox(width: 10),
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        const Text('付费学习中心数据',
                            style: TextStyle(
                                fontSize: 16, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 4),
                        Text(
                            '${planItems.length} 个学习计划 · 已完成 $doneTasks 项任务 · ${examMode == 'objective' ? '客观题' : '主观题'}',
                            style: const TextStyle(
                                color: DebaoColors.muted, fontSize: 12))
                      ]))
                ]))),
        _scoreCard(
            rate: activeRate,
            answered: activeAnswered,
            report: monthReport,
            hasSubjectiveData: gradedSubjective.isNotEmpty),
        _subjectFilter(
            subjects: subjects,
            visibleSubjects: visibleSubjects,
            enabled: examMode == 'objective'),
        _learningDataCard(
            report: monthReport,
            rate: activeRate,
            minutes: activeMinutes,
            answered: activeAnswered,
            subjects: activeSubjects,
            subjectLabel: (id) => subjects
                .firstWhere((subject) => subject.id == id,
                    orElse: () => Subject(id: id, name: id))
                .name),
        _privateSection(
            context,
            '学习进度',
            Icons.timeline_outlined,
            '${report.valueOrNull?.minutes ?? 0} 分钟学习时长 · $completedPlans 个历史完成计划',
            () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => LearningPlanScreen(remoteEnabled: true)))),
        _privateSection(
            context,
            '听课完成进度',
            Icons.play_circle_outline,
            '已开通课程 ${courses.length} 门',
            () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => CoursesScreen(
                        remoteEnabled: true,
                        coursePage: true,
                        showBackButton: true)))),
        _privateSection(
            context,
            '我的考试',
            Icons.assignment_outlined,
            examTasks.isEmpty
                ? '暂无已安排的单科测试'
                : '${examTasks.where((item) => item.status == 'done').length}/${examTasks.length} 场已完成',
            () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => LearningPlanScreen(remoteEnabled: true)))),
        _privateSection(
            context,
            '背诵卡片',
            Icons.style_outlined,
            cardTasks.isEmpty
                ? '暂无背诵卡片任务'
                : '${cardTasks.where((item) => item.status == 'done').length}/${cardTasks.length} 张已完成',
            () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => LearningPlanScreen(remoteEnabled: true)))),
        _privateSection(
            context,
            '做题数据',
            Icons.bar_chart_outlined,
            '${records.valueOrNull?.length ?? 0} 条做题记录',
            () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) =>
                        QuestionRecordsScreen(remoteEnabled: true)))),
        _privateSection(
            context,
            '答疑记录',
            Icons.question_answer_outlined,
            '${inquiries.valueOrNull?.where((item) => item.status == 'answered').length ?? 0} 条已回复',
            () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const LearningInquiriesScreen()))),
      ]),
    );
  }

  Widget _examModeTabs() => Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
            color: const Color(0xFFEFF0F5),
            borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          _modeTab('objective', '客观题'),
          _modeTab('subjective', '主观题'),
        ]),
      );

  Widget _modeTab(String mode, String label) {
    final selected = examMode == mode;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(9),
        onTap: () => setState(() {
          examMode = mode;
          selectedSubjectId = null;
        }),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 11),
          decoration: BoxDecoration(
              color: selected ? Colors.white : Colors.transparent,
              borderRadius: BorderRadius.circular(9),
              boxShadow: selected
                  ? const [
                      BoxShadow(
                          color: Color(0x14000000),
                          blurRadius: 5,
                          offset: Offset(0, 2))
                    ]
                  : null),
          child: Text(label,
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: selected ? const Color(0xFF4C4BEA) : DebaoColors.body,
                  fontSize: 16,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500)),
        ),
      ),
    );
  }

  Widget _scoreCard({
    required int? rate,
    required int? answered,
    required LearningReport? report,
    required bool hasSubjectiveData,
  }) {
    final hasData = rate != null && (answered ?? 0) > 0;
    final score = hasData && examMode == 'objective'
        ? (rate * 1.8).round().clamp(0, 180)
        : null;
    return Card(
      margin: const EdgeInsets.only(top: 10),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 15, 16, 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(examMode == 'objective' ? '预估分' : '主观题得分率',
                style: const TextStyle(
                    color: DebaoColors.ink,
                    fontSize: 17,
                    fontWeight: FontWeight.w700)),
            const Spacer(),
            TextButton(
                onPressed: examMode == 'objective'
                    ? () => Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) =>
                                LearningReportScreen(remoteEnabled: true)))
                    : null,
                child: const Text('变化趋势 ›')),
          ]),
          const SizedBox(height: 2),
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(score == null ? (hasData ? '$rate%' : '--') : '$score',
                style: const TextStyle(
                    color: Color(0xFF18244C),
                    fontSize: 42,
                    height: 1,
                    fontWeight: FontWeight.w700)),
            const SizedBox(width: 8),
            if (hasData)
              Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                      examMode == 'objective'
                          ? '当前正确率 $rate%'
                          : '共 $answered 份已批改',
                      style: const TextStyle(
                          color: Color(0xFF4C4BEA), fontSize: 12))),
          ]),
          const SizedBox(height: 8),
          Text(
              hasData
                  ? '数据来自${report?.period == 'month' ? '本月' : '当前'}真实学习记录'
                  : examMode == 'subjective' && !hasSubjectiveData
                      ? '完成主观题并收到批改后，这里会显示数据'
                      : '完成课程或练习后，这里会生成预估分',
              style: const TextStyle(color: DebaoColors.muted, fontSize: 12)),
        ]),
      ),
    );
  }

  Widget _subjectFilter({
    required List<Subject> subjects,
    required List<({String subjectId, int minutes, int correctRate})>
        visibleSubjects,
    required bool enabled,
  }) {
    final items = <({String? id, String label})>[
      (id: null, label: '全部'),
      ...visibleSubjects.map((item) => (
            id: item.subjectId,
            label: subjects
                .firstWhere((subject) => subject.id == item.subjectId,
                    orElse: () =>
                        Subject(id: item.subjectId, name: item.subjectId))
                .name
          )),
    ];
    return Card(
      margin: const EdgeInsets.only(top: 10),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Row(
              children: items
                  .map((item) => Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(item.label),
                          selected: enabled && selectedSubjectId == item.id,
                          onSelected: !enabled
                              ? null
                              : (_) =>
                                  setState(() => selectedSubjectId = item.id),
                          selectedColor: const Color(0xFFE9E9FF),
                          labelStyle: TextStyle(
                              color: enabled && selectedSubjectId == item.id
                                  ? const Color(0xFF4C4BEA)
                                  : DebaoColors.body,
                              fontWeight:
                                  enabled && selectedSubjectId == item.id
                                      ? FontWeight.w700
                                      : FontWeight.w400),
                          side: BorderSide.none,
                        ),
                      ))
                  .toList()),
        ),
      ),
    );
  }

  Widget _learningDataCard({
    required LearningReport? report,
    required int? rate,
    required int? minutes,
    required int? answered,
    required List<({String subjectId, int minutes, int correctRate})> subjects,
    required String Function(String) subjectLabel,
  }) {
    final hasData =
        (rate ?? 0) > 0 || (minutes ?? 0) > 0 || (answered ?? 0) > 0;
    return Card(
      margin: const EdgeInsets.only(top: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Text('学习数据',
                style: TextStyle(
                    color: DebaoColors.ink,
                    fontSize: 17,
                    fontWeight: FontWeight.w700)),
            const SizedBox(width: 6),
            const Icon(Icons.help_outline, size: 16, color: DebaoColors.muted),
            const Spacer(),
            Text(examMode == 'objective' ? '客观题' : '主观题',
                style: const TextStyle(color: DebaoColors.muted, fontSize: 12)),
          ]),
          const SizedBox(height: 5),
          Text(
              report == null
                  ? '统计范围：暂无数据'
                  : '统计范围：${report.period == 'month' ? '本月' : report.period}',
              style: const TextStyle(color: DebaoColors.muted, fontSize: 12)),
          const SizedBox(height: 12),
          _dataLegend(),
          const SizedBox(height: 14),
          if (!hasData)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 22),
              child: Center(
                  child: Text('完成学习后，这里会显示你的真实数据',
                      style: TextStyle(color: DebaoColors.muted))),
            )
          else ...[
            _metricBar('听课时长', _hoursLabel(minutes ?? 0), '${minutes ?? 0} 分钟',
                ((minutes ?? 0) / 600).clamp(0, 1)),
            _metricBar('做题丰富度', '${answered ?? 0} 题', '${answered ?? 0} 题',
                ((answered ?? 0) / 500).clamp(0, 1)),
            _metricBar('得分率', '${rate ?? 0}%', '${rate ?? 0}%',
                ((rate ?? 0) / 100).clamp(0, 1)),
            _metricBar('做题量', '${answered ?? 0} 题', '${answered ?? 0} 题',
                ((answered ?? 0) / 500).clamp(0, 1)),
          ],
          if (subjects.isNotEmpty) ...[
            const SizedBox(height: 14),
            const Text('各科学习表现',
                style: TextStyle(
                    color: DebaoColors.ink,
                    fontSize: 14,
                    fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            SizedBox(
                height: 165,
                child: _LearningDataChart(
                    subjects: subjects, labelFor: subjectLabel)),
          ],
        ]),
      ),
    );
  }

  Widget _dataLegend() => Row(children: [
        const Text('学习数据水平',
            style: TextStyle(color: DebaoColors.body, fontSize: 12)),
        const SizedBox(width: 10),
        ...[
          (const Color(0xFFFF6B54), '<60'),
          (const Color(0xFFFFC15A), '60-70'),
          (const Color(0xFF6ED7C2), '70-80'),
          (const Color(0xFF6788ED), '≥80'),
        ].map((item) => Padding(
              padding: const EdgeInsets.only(right: 7),
              child: Row(children: [
                Container(
                    width: 17,
                    height: 7,
                    decoration: BoxDecoration(
                        color: item.$1,
                        borderRadius: BorderRadius.circular(4))),
                const SizedBox(width: 3),
                Text(item.$2,
                    style:
                        const TextStyle(color: DebaoColors.muted, fontSize: 9)),
              ]),
            )),
      ]);

  String _hoursLabel(int minutes) {
    if (minutes < 60) return '${minutes}m';
    final hours = minutes / 60;
    return '${hours.toStringAsFixed(hours == hours.roundToDouble() ? 0 : 1)}h';
  }

  Widget _metricBar(String title, String value, String detail, double ratio) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
            SizedBox(
                width: 74,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: const TextStyle(
                              color: DebaoColors.body,
                              fontSize: 12,
                              fontWeight: FontWeight.w600)),
                      const SizedBox(height: 2),
                      Text(value,
                          style: const TextStyle(
                              color: Color(0xFF4C4BEA),
                              fontSize: 13,
                              fontWeight: FontWeight.w700)),
                    ])),
            const SizedBox(width: 8),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                  SizedBox(
                      height: 9,
                      child: LayoutBuilder(builder: (context, constraints) {
                        final marker = constraints.maxWidth * ratio.clamp(0, 1);
                        return Stack(children: [
                          DecoratedBox(
                              decoration: BoxDecoration(
                                  color: const Color(0xFFF1F2F5),
                                  borderRadius: BorderRadius.circular(5)),
                              child: const SizedBox.expand()),
                          FractionallySizedBox(
                              widthFactor: ratio.clamp(0, 1),
                              child: DecoratedBox(
                                  decoration: BoxDecoration(
                                      gradient: const LinearGradient(colors: [
                                        Color(0xFFFF6B54),
                                        Color(0xFFFFC15A),
                                        Color(0xFF6ED7C2),
                                        Color(0xFF6788ED),
                                      ]),
                                      borderRadius: BorderRadius.circular(5)))),
                          Positioned(
                              left: (marker - 1.5)
                                  .clamp(0, constraints.maxWidth - 3),
                              top: -2,
                              child: const Icon(Icons.arrow_drop_up,
                                  size: 12, color: DebaoColors.ink)),
                        ]);
                      })),
                  const SizedBox(height: 3),
                  Text(detail,
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                          color: DebaoColors.muted, fontSize: 10)),
                ])),
          ]));

  Widget _privateSection(BuildContext context, String title, IconData icon,
          String summary, VoidCallback onTap) =>
      Card(
          margin: const EdgeInsets.only(top: 10),
          child: ListTile(
              leading: Icon(icon, color: const Color(0xFF4C4BEA)),
              title: Text(title,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(summary),
              trailing: const Icon(Icons.chevron_right),
              onTap: onTap));
}

String _privateCoachError(Object error) {
  if (error is ApiError) {
    if (error.statusCode == 401 || error.code == 'UNAUTHORIZED') {
      return '请先登录';
    }
    return '${error.code}${error.statusCode == null ? '' : ' (${error.statusCode})'}：${error.message}';
  }
  return error.toString();
}

class _PrivateCoachEmpty extends StatelessWidget {
  const _PrivateCoachEmpty({this.remoteEnabled = false});
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: DebaoColors.page,
        appBar: AppBar(
          leading:
              const DebaoRouteBackButton(fallbackLocation: '/?tab=profile'),
          title: const Text('得恩私教学习中心'),
          backgroundColor: DebaoColors.page,
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.lock_outline,
                  size: 42, color: Color(0xFF7C83A1)),
              const SizedBox(height: 16),
              const Text('暂未开通学习中心权限',
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: DebaoColors.ink)),
              const SizedBox(height: 8),
              const Text('登录并购买学习中心服务后，这里会显示你的学习数据',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: DebaoColors.muted, fontSize: 13)),
              if (remoteEnabled) ...[
                const SizedBox(height: 20),
                OutlinedButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => const MallScreen(
                            remoteEnabled: true, showBackButton: true)),
                  ),
                  child: const Text('查看课程并开通'),
                ),
              ],
            ]),
          ),
        ),
      );
}

class _LearningDataChart extends StatelessWidget {
  const _LearningDataChart({required this.subjects, required this.labelFor});
  final List<({String subjectId, int minutes, int correctRate})> subjects;
  final String Function(String) labelFor;
  @override
  Widget build(BuildContext context) {
    if (subjects.isEmpty)
      return const Center(
          child: Text('暂无科目学习数据', style: TextStyle(color: DebaoColors.muted)));
    final maxMinutes = subjects
        .map((item) => item.minutes)
        .fold<int>(1, (max, value) => value > max ? value : max);
    return Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: subjects.take(8).map((item) {
          final height = 30 + 110 * item.minutes / maxMinutes;
          return Expanded(
              child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Text('${item.correctRate}%',
                            style: const TextStyle(
                                fontSize: 10, color: DebaoColors.body)),
                        const SizedBox(height: 4),
                        Container(
                            height: height,
                            decoration: BoxDecoration(
                                color: const Color(0xFF4C4BEA),
                                borderRadius: BorderRadius.circular(6))),
                        const SizedBox(height: 5),
                        Text(labelFor(item.subjectId),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 10, color: DebaoColors.muted))
                      ])));
        }).toList());
  }
}
