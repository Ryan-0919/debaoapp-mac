import '../../core/config/app_environment.dart';
import '../learning/learning_inquiries_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design_tokens.dart';
import '../../data/models.dart';
import '../../shared/debao_components.dart';
import '../../data/providers.dart';
import '../../shared/route_back_button.dart';
import '../questions/objective_answer_screen.dart';
import '../learning/learning_center_screens.dart';
import '../learning/learning_card_deck.dart';
import '../learning/learning_task_screen.dart';
import 'course_detail_screens.dart';

enum _QuickFilter { today, tomorrow, missed }

enum _SessionType { main, supplement, live, card, practice, review }

enum _SessionStatus { done, inProgress, notStarted, missed, liveSoon }

class _Session {
  const _Session({
    required this.id,
    required this.start,
    required this.end,
    required this.type,
    required this.label,
    required this.title,
    required this.status,
    this.lesson,
    this.teacher,
    this.duration = 0,
    this.progress,
    this.completedAt,
    this.tip,
    this.locked = false,
  });

  final String id;
  final String start;
  final String end;
  final _SessionType type;
  final String label;
  final String title;
  final _SessionStatus status;
  final String? lesson;
  final String? teacher;
  final int duration;
  final int? progress;
  final String? completedAt;
  final String? tip;
  final bool locked;
}

final _scheduleAnchor = DateTime.now();
final _today = _dateKey(_scheduleAnchor);
final _tomorrow = _dateKey(_scheduleAnchor.add(const Duration(days: 1)));

final _schedule = <String, List<_Session>>{
  _dateKey(_scheduleAnchor.subtract(const Duration(days: 2))): const [
    _Session(
        id: 's1',
        start: '09:00',
        end: '10:20',
        type: _SessionType.main,
        label: '录播',
        title: '民法精讲',
        lesson: '第16讲：物权的效力',
        teacher: '张明远',
        duration: 80,
        status: _SessionStatus.done,
        progress: 100,
        completedAt: '10:18'),
    _Session(
        id: 's2',
        start: '20:00',
        end: '20:30',
        type: _SessionType.practice,
        label: '练习',
        title: '物权法配套题组',
        duration: 30,
        status: _SessionStatus.done,
        completedAt: '20:25'),
  ],
  _dateKey(_scheduleAnchor.subtract(const Duration(days: 1))): const [
    _Session(
        id: 's3',
        start: '09:00',
        end: '10:30',
        type: _SessionType.main,
        label: '录播',
        title: '民法精讲',
        lesson: '第17讲：物权变动总论',
        teacher: '张明远',
        duration: 90,
        status: _SessionStatus.done,
        progress: 100,
        completedAt: '10:27'),
    _Session(
        id: 's4',
        start: '21:00',
        end: '21:30',
        type: _SessionType.review,
        label: '复习',
        title: '物权变动错题整理',
        duration: 30,
        status: _SessionStatus.missed,
        tip: '与本周课程配套'),
  ],
  _today: const [
    _Session(
        id: 's5',
        start: '09:00',
        end: '10:20',
        type: _SessionType.main,
        label: '录播',
        title: '民法精讲',
        lesson: '第18讲：物权变动的公示与公信原则',
        teacher: '张明远',
        duration: 80,
        status: _SessionStatus.inProgress,
        progress: 62),
    _Session(
        id: 's8-card',
        start: '10:30',
        end: '10:45',
        type: _SessionType.card,
        label: '卡片',
        title: '民法精讲 · 物权变动背诵卡片',
        lesson: '关联第18讲：物权变动的公示与公信原则',
        duration: 15,
        status: _SessionStatus.notStarted,
        tip: '完成听课打卡后解锁'),
    _Session(
        id: 's8',
        start: '11:00',
        end: '11:30',
        type: _SessionType.practice,
        label: '练习',
        title: '民法配套题组 · 第18讲',
        duration: 30,
        status: _SessionStatus.notStarted,
        tip: '完成关联卡片后解锁'),
  ],
  _tomorrow: const [
    _Session(
        id: 's9',
        start: '09:00',
        end: '10:30',
        type: _SessionType.main,
        label: '录播',
        title: '民法精讲',
        lesson: '第19讲：不动产登记',
        teacher: '张明远',
        duration: 90,
        status: _SessionStatus.notStarted),
    _Session(
        id: 's10',
        start: '15:00',
        end: '16:00',
        type: _SessionType.supplement,
        label: '专项',
        title: '善意取得专题精讲',
        duration: 60,
        status: _SessionStatus.notStarted,
        tip: '与本周民法课程配套'),
  ],
  _dateKey(_scheduleAnchor.add(const Duration(days: 2))): const [
    _Session(
        id: 's11',
        start: '09:30',
        end: '10:50',
        type: _SessionType.main,
        label: '录播',
        title: '民法精讲',
        lesson: '第20讲：动产交付',
        teacher: '张明远',
        duration: 80,
        status: _SessionStatus.notStarted),
  ],
  _dateKey(_scheduleAnchor.add(const Duration(days: 3))): const [],
  _dateKey(_scheduleAnchor.add(const Duration(days: 4))): const [
    _Session(
        id: 's12',
        start: '10:00',
        end: '10:30',
        type: _SessionType.review,
        label: '补课',
        title: '物权变动错题整理',
        duration: 30,
        status: _SessionStatus.notStarted,
        tip: '来自前日待补课'),
  ],
};

String _dateKey(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

DateTime _parseDate(String key) {
  final values = key.split('-').map(int.parse).toList();
  return DateTime(values[0], values[1], values[2]);
}

List<DateTime> _weekFor(String selectedKey) {
  final selected = _parseDate(selectedKey);
  final mondayOffset = selected.weekday - DateTime.monday;
  final monday = selected.subtract(Duration(days: mondayOffset));
  return List.generate(7, (index) => monday.add(Duration(days: index)));
}

Color _sessionColor(_SessionType type) {
  switch (type) {
    case _SessionType.main:
      return DebaoColors.brand;
    case _SessionType.supplement:
      return const Color(0xFFA87000);
    case _SessionType.live:
      return const Color(0xFFC0385A);
    case _SessionType.card:
      return const Color(0xFF7B55C7);
    case _SessionType.practice:
      return const Color(0xFF1A8B8B);
    case _SessionType.review:
      return DebaoColors.muted;
  }
}

Color _statusColor(_SessionStatus status) {
  switch (status) {
    case _SessionStatus.done:
      return DebaoColors.success;
    case _SessionStatus.inProgress:
      return DebaoColors.brand;
    case _SessionStatus.notStarted:
      return DebaoColors.muted;
    case _SessionStatus.missed:
      return DebaoColors.error;
    case _SessionStatus.liveSoon:
      return const Color(0xFFC0385A);
  }
}

String _statusLabel(_SessionStatus status) {
  switch (status) {
    case _SessionStatus.done:
      return '已完成';
    case _SessionStatus.inProgress:
      return '学习中';
    case _SessionStatus.notStarted:
      return '未开始';
    case _SessionStatus.missed:
      return '待补课';
    case _SessionStatus.liveSoon:
      return '即将开始';
  }
}

class _CardStudyPage extends StatelessWidget {
  const _CardStudyPage({required this.session});
  final _Session session;
  @override
  Widget build(BuildContext context) => Scaffold(
        key: const ValueKey('courses-card-study-page'),
        appBar: AppBar(title: const Text('卡片学习')),
        body: LearningCardDeck(
          card: LearningCard(
              id: session.id,
              title: session.title,
              contentType: 'text',
              recallItems: const [
                (prompt: '物权变动应以一定方式向外界____。', answer: '展示'),
                (prompt: '登记或占有形成的权利外观，在一定条件下值得____。', answer: '信赖'),
              ],
              assets: const [
                (
                  type: 'text',
                  filename: '公示原则 · 演示卡片',
                  reference: '物权变动应以一定方式向外界展示。'
                ),
                (
                  type: 'text',
                  filename: '公信原则 · 演示卡片',
                  reference: '登记或占有形成的权利外观，在一定条件下值得信赖。'
                ),
              ]),
          onComplete: () => Navigator.of(context).pop(true),
        ),
      );
}

class CoursesScreen extends StatelessWidget {
  const CoursesScreen({
    super.key,
    this.remoteEnabled = remoteDataDefault,
    this.showBackButton = false,
    this.coursePage = false,
  });
  final bool remoteEnabled;
  final bool showBackButton;
  final bool coursePage;

  @override
  Widget build(BuildContext context) => ProviderScope(
        child: _CoursesScreenBody(
            remoteEnabled: remoteEnabled,
            showBackButton: showBackButton,
            coursePage: coursePage),
      );
}

class _CoursesScreenBody extends ConsumerStatefulWidget {
  const _CoursesScreenBody(
      {required this.remoteEnabled,
      required this.showBackButton,
      required this.coursePage});
  final bool remoteEnabled;
  final bool showBackButton;
  final bool coursePage;
  @override
  ConsumerState<_CoursesScreenBody> createState() => _CoursesScreenState();
}

class _CoursesScreenState extends ConsumerState<_CoursesScreenBody> {
  String selectedKey = _today;
  _QuickFilter? quickFilter;
  bool monthVisible = false;
  _Session? rescheduleSession;
  String? addCourse;
  final addedCourses = <String>{};
  final checkedInSessionIds = <String>{};
  final completedCardSessionIds = <String>{};
  bool diagnosticPromptShown = false;
  String taskFilter = '全部';
  String courseCategory = 'objective';
  String courseMedia = 'video';

  Widget _inquiryEntry() {
    final inquiries = widget.remoteEnabled
        ? ref.watch(learningInquiriesProvider).valueOrNull
        : null;
    final waiting =
        inquiries?.where((item) => item.status == 'pending').length ?? 0;
    final answered =
        inquiries?.where((item) => item.status == 'answered').length ?? 0;
    return ListTile(
      key: const ValueKey('learning-my-inquiries'),
      leading:
          const Icon(Icons.question_answer_outlined, color: DebaoColors.brand),
      title: const Text('我的答疑'),
      subtitle: Text(
          inquiries == null ? '查看错因提问和老师回复' : '$waiting 条待回复 · $answered 条已回复'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () async {
        ref.invalidate(learningInquiriesProvider);
        await Navigator.push(context,
            MaterialPageRoute(builder: (_) => const LearningInquiriesScreen()));
        ref.invalidate(learningInquiriesProvider);
      },
    );
  }

  @override
  void initState() {
    super.initState();
    if (widget.remoteEnabled) {
      WidgetsBinding.instance
          .addPostFrameCallback((_) => _maybePromptDiagnostic());
    }
  }

  @override
  void didUpdateWidget(covariant _CoursesScreenBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!oldWidget.remoteEnabled && widget.remoteEnabled) {
      WidgetsBinding.instance
          .addPostFrameCallback((_) => _maybePromptDiagnostic());
    }
  }

  Future<void> _maybePromptDiagnostic() async {
    if (!mounted || diagnosticPromptShown) return;
    diagnosticPromptShown = true;
    try {
      final state = await ref.read(learningDiagnosticProvider.future);
      if (!mounted || state.access != 'granted' || state.completed) return;
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          title: const Text('开始首次学习诊断'),
          content: const Text('首次进入学习中心需要先完成诊断，我们会根据结果制定专属学习计划。'),
          actions: [
            FilledButton(
              onPressed: () {
                Navigator.pop(dialogContext);
                Navigator.push<void>(
                  context,
                  MaterialPageRoute(
                    builder: (_) => LearningDiagnosticScreen(state: state),
                  ),
                );
              },
              child: const Text('进入诊断'),
            ),
          ],
        ),
      );
    } catch (_) {
      // The calendar remains usable when the diagnostic service is unavailable.
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: DebaoColors.page,
        appBar: widget.showBackButton || widget.coursePage
            ? AppBar(
                leading: const DebaoRouteBackButton(
                    fallbackLocation: '/?tab=profile'),
                title: Text(widget.coursePage ? '我的课程' : '学习日历'),
                backgroundColor: Colors.white,
                surfaceTintColor: Colors.white)
            : null,
        body: SafeArea(
          bottom: false,
          child: widget.coursePage
              ? _courseLibraryBody()
              : widget.remoteEnabled
                  ? _remoteCalendarBody()
                  : _calendarBody(),
        ),
      );

  Widget _remoteCalendarBody() {
    final remote = ref.watch(learningTasksProvider);
    if (remote.isLoading && !remote.hasValue) {
      return const Center(
          child: CircularProgressIndicator(key: ValueKey('courses-loading')));
    }
    if (remote.hasError && !remote.hasValue) {
      return _remoteError(remote.error.toString());
    }
    final tasks = remote.asData?.value ?? const <LearningTask>[];
    final sessionsByDate = _remoteSessionsByDate(tasks);
    final allSessions = sessionsByDate[selectedKey] ?? const <_Session>[];
    final sessions = allSessions
        .where((item) =>
            taskFilter == '全部' ||
            switch (taskFilter) {
              '课程' => item.type == _SessionType.main ||
                  item.type == _SessionType.supplement,
              '卡片' => item.type == _SessionType.card,
              '题目' => item.type == _SessionType.practice,
              _ => true,
            })
        .toList();
    if (tasks.isEmpty) {
      return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        _remoteCalendarHeader(),
        _inquiryEntry(),
        _taskFilters(),
        _groupEmpty('暂无学习日历数据'),
      ]);
    }
    return ListView(
        key: const ValueKey('courses-calendar-remote-scroll'),
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          _remoteCalendarHeader(),
          _inquiryEntry(),
          _taskFilters(),
          _remoteWeekStrip(sessionsByDate),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 13, 16, 8),
            child: Row(children: [
              const Expanded(
                  child: Text('今日学习任务',
                      style: TextStyle(
                          color: DebaoColors.ink,
                          fontSize: 15,
                          fontWeight: FontWeight.w800))),
              Text('${sessions.length} 项',
                  style:
                      const TextStyle(color: DebaoColors.muted, fontSize: 11)),
            ]),
          ),
          if (sessions.isEmpty)
            _groupEmpty('今天暂无学习任务')
          else
            ...sessions.map(_sessionCard),
        ]);
  }

  Widget _taskFilters() => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Wrap(spacing: 8, children: [
        for (final label in ['课程', '卡片', '题目', '全部'])
          ChoiceChip(
              label: Text(label),
              selected: taskFilter == label,
              onSelected: (_) => setState(() => taskFilter = label)),
        if (taskFilter == '题目')
          ActionChip(
            key: const ValueKey('question-tab-my-inquiries'),
            avatar: const Icon(Icons.question_answer_outlined, size: 16),
            label: const Text('我的答疑'),
            onPressed: () {
              ref.invalidate(learningInquiriesProvider);
              Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (_) => const LearningInquiriesScreen()));
            },
          ),
      ]));

  Widget _remoteWeekStrip(Map<String, List<_Session>> sessionsByDate) {
    final days = _weekFor(selectedKey);
    const monthNames = <String>[
      '一月',
      '二月',
      '三月',
      '四月',
      '五月',
      '六月',
      '七月',
      '八月',
      '九月',
      '十月',
      '十一月',
      '十二月',
    ];
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 7),
      child: Column(children: [
        Row(children: [
          Text(monthNames[days.first.month - 1],
              style: const TextStyle(
                  color: DebaoColors.ink,
                  fontSize: 14,
                  fontWeight: FontWeight.w700)),
          const Spacer(),
          IconButton(
            key: const ValueKey('courses-week-previous'),
            tooltip: '上一周',
            onPressed: () => setState(() {
              selectedKey = _dateKey(
                  _parseDate(selectedKey).subtract(const Duration(days: 7)));
              quickFilter = null;
            }),
            icon: const Icon(Icons.chevron_left,
                size: 18, color: DebaoColors.muted),
          ),
          IconButton(
            key: const ValueKey('courses-week-next'),
            tooltip: '下一周',
            onPressed: () => setState(() {
              selectedKey = _dateKey(
                  _parseDate(selectedKey).add(const Duration(days: 7)));
              quickFilter = null;
            }),
            icon: const Icon(Icons.chevron_right,
                size: 18, color: DebaoColors.muted),
          ),
        ]),
        Row(
          children: days.map((date) {
            final key = _dateKey(date);
            final selected = key == selectedKey;
            final entries = sessionsByDate[key] ?? const <_Session>[];
            final weekday =
                const ['一', '二', '三', '四', '五', '六', '日'][date.weekday - 1];
            return Expanded(
              child: InkWell(
                key: ValueKey('courses-day-$key'),
                onTap: () => setState(() {
                  selectedKey = key;
                  quickFilter = null;
                }),
                child: SizedBox(
                  height: 76,
                  child: Column(children: [
                    Text(weekday,
                        style: const TextStyle(
                            color: DebaoColors.muted, fontSize: 10)),
                    const SizedBox(height: 4),
                    Container(
                      width: 29,
                      height: 29,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                          color: selected
                              ? DebaoColors.brand
                              : key == _today
                                  ? DebaoColors.brandLight
                                  : Colors.transparent,
                          shape: BoxShape.circle),
                      child: Text('${date.day}',
                          style: TextStyle(
                              color: selected
                                  ? Colors.white
                                  : key == _today
                                      ? DebaoColors.brand
                                      : DebaoColors.ink,
                              fontSize: 13,
                              fontWeight: FontWeight.w600)),
                    ),
                    if (entries.isNotEmpty)
                      Container(
                          width: 5,
                          height: 5,
                          margin: const EdgeInsets.only(top: 3),
                          decoration: const BoxDecoration(
                              color: DebaoColors.brand,
                              shape: BoxShape.circle)),
                    if (key == _today)
                      const Text('今天',
                          style:
                              TextStyle(color: DebaoColors.brand, fontSize: 9)),
                  ]),
                ),
              ),
            );
          }).toList(),
        ),
      ]),
    );
  }

  Map<String, List<_Session>> _remoteSessionsByDate(List<LearningTask> tasks) {
    final grouped = <String, List<_Session>>{};
    for (final task in tasks) {
      if (task.contentType == 'live') continue;
      final type = switch (task.contentType) {
        'course' => _SessionType.main,
        'card' => _SessionType.card,
        'question' || 'subjective' || 'assessment' => _SessionType.practice,
        _ => _SessionType.supplement,
      };
      final status = switch (task.status) {
        'done' => _SessionStatus.done,
        'overdue' => _SessionStatus.missed,
        _ => _SessionStatus.notStarted,
      };
      final session = _Session(
        id: task.id,
        start: '当天',
        end: '',
        type: type,
        label: switch (type) {
          _SessionType.main => '课程',
          _SessionType.card => '卡片',
          _SessionType.practice => '题目',
          _ => '任务',
        },
        title: task.title,
        lesson: task.description,
        duration: task.minutes,
        status: status,
        completedAt: task.completedAt,
        locked: task.locked,
      );
      grouped.putIfAbsent(task.dueDate, () => []).add(session);
    }
    return grouped;
  }

  Widget _remoteCalendarHeader() => Container(
        color: Colors.white,
        padding: const EdgeInsets.fromLTRB(16, 15, 16, 14),
        child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('学习日历',
                  style: TextStyle(
                      color: DebaoColors.ink,
                      fontSize: 16,
                      fontWeight: FontWeight.w700)),
              SizedBox(height: 5),
              Text('日历安排由服务端学习计划提供。',
                  style: TextStyle(color: DebaoColors.muted, fontSize: 12)),
            ]),
      );

  Widget _remoteCalendarCourse(Course course) => Container(
        key: ValueKey('remote-calendar-course-${course.id}'),
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(8)),
        child: Row(children: [
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(course.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        color: DebaoColors.ink,
                        fontSize: 14,
                        fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text(course.teacher.isEmpty ? '讲师信息暂未提供' : course.teacher,
                    style: const TextStyle(
                        color: DebaoColors.muted, fontSize: 11)),
              ])),
          Text('${course.progress.clamp(0, 100).round()}%',
              style: const TextStyle(
                  color: DebaoColors.brand,
                  fontSize: 16,
                  fontWeight: FontWeight.w700)),
        ]),
      );

  Widget _calendarBody() {
    final allSessions = _schedule[selectedKey] ?? const <_Session>[];
    var sessions = allSessions;
    if (quickFilter == _QuickFilter.missed) {
      sessions = _schedule.values
          .expand((items) => items)
          .where((session) => session.status == _SessionStatus.missed)
          .toList();
    } else if (quickFilter == _QuickFilter.today) {
      sessions = _schedule[_today] ?? const <_Session>[];
    } else if (quickFilter == _QuickFilter.tomorrow) {
      sessions = _schedule[_tomorrow] ?? const <_Session>[];
    }
    sessions =
        sessions.where((session) => session.type != _SessionType.live).toList();

    return ListView(
      key: const ValueKey('courses-calendar-scroll'),
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        _localCalendarHeader(),
        _overview(),
        _weekStrip(),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 1),
          child: Row(
            children: [
              _filterPill('今天', _QuickFilter.today),
              const SizedBox(width: 8),
              _filterPill('明天', _QuickFilter.tomorrow),
              const SizedBox(width: 8),
              _filterPill('待补课 1', _QuickFilter.missed, danger: true),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 13, 16, 8),
          child: Row(
            children: [
              Expanded(
                  child: Text(
                      quickFilter == _QuickFilter.missed
                          ? '待补课程'
                          : selectedKey == _today
                              ? '今日学习'
                              : '${_parseDate(selectedKey).day}日课程',
                      style: const TextStyle(
                          color: DebaoColors.ink,
                          fontSize: 15,
                          fontWeight: FontWeight.w800))),
              Text('${sessions.length} 项  ·  预计 ${_durationHours(sessions)} 小时',
                  style:
                      const TextStyle(color: DebaoColors.muted, fontSize: 11)),
            ],
          ),
        ),
        if (quickFilter == null && selectedKey == _today) _resumeBanner(),
        if (sessions.isEmpty)
          _emptyState()
        else if (quickFilter == _QuickFilter.missed)
          ...sessions.map(_missedCard)
        else
          ...sessions.map((session) => _sessionCard(session)),
      ],
    );
  }

  Widget _localCalendarHeader() => Container(
        color: Colors.white,
        padding: const EdgeInsets.fromLTRB(16, 15, 16, 14),
        child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('学习日历',
                  style: TextStyle(
                      color: DebaoColors.ink,
                      fontSize: 16,
                      fontWeight: FontWeight.w700)),
              SizedBox(height: 5),
              Text('按学习计划查看每天的课程、卡片和练习。',
                  style: TextStyle(color: DebaoColors.muted, fontSize: 12)),
            ]),
      );

  Widget _overview() => Container(
        color: Colors.white,
        padding: const EdgeInsets.fromLTRB(16, 15, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('当前课程',
                          style: TextStyle(
                              color: DebaoColors.muted, fontSize: 11)),
                      SizedBox(height: 3),
                      Text('2026 法考主客一体系统班',
                          style: TextStyle(
                              color: DebaoColors.ink,
                              fontSize: 14,
                              fontWeight: FontWeight.w700)),
                      SizedBox(height: 3),
                      Text('第二阶段 · 系统精讲 · 民法第 18 讲 / 共 32 讲',
                          style: TextStyle(
                              color: DebaoColors.brand, fontSize: 11)),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: const [
                    Text('42%',
                        style: TextStyle(
                            color: DebaoColors.brand,
                            fontSize: 20,
                            fontWeight: FontWeight.w800)),
                    Text('整体进度',
                        style:
                            TextStyle(color: DebaoColors.muted, fontSize: 9)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 10),
            const ClipRRect(
              borderRadius: BorderRadius.all(Radius.circular(99)),
              child: LinearProgressIndicator(
                  value: .42,
                  minHeight: 5,
                  backgroundColor: DebaoColors.line,
                  valueColor: AlwaysStoppedAnimation<Color>(DebaoColors.brand)),
            ),
            const SizedBox(height: 12),
            const Wrap(
              spacing: 10,
              children: [
                Text('本周 7 / 12 节',
                    style: TextStyle(color: DebaoColors.body, fontSize: 11)),
                Text('·', style: TextStyle(color: DebaoColors.line)),
                Text('待补课 1 节',
                    style: TextStyle(
                        color: DebaoColors.error,
                        fontSize: 11,
                        fontWeight: FontWeight.w600)),
                Text('·', style: TextStyle(color: DebaoColors.line)),
              ],
            ),
          ],
        ),
      );

  Widget _weekStrip() {
    final days = _weekFor(selectedKey);
    const monthNames = <String>[
      '一月',
      '二月',
      '三月',
      '四月',
      '五月',
      '六月',
      '七月',
      '八月',
      '九月',
      '十月',
      '十一月',
      '十二月',
    ];
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 13, 16, 9),
      child: Column(
        children: [
          Row(
            children: [
              InkWell(
                key: const ValueKey('courses-open-month'),
                onTap: _openMonth,
                child: Row(
                  children: [
                    Text(monthNames[days.first.month - 1],
                        style: TextStyle(
                            color: DebaoColors.ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w700)),
                    Icon(Icons.chevron_right,
                        color: DebaoColors.muted, size: 15),
                  ],
                ),
              ),
              const Spacer(),
              IconButton(
                key: const ValueKey('courses-week-previous'),
                tooltip: '上一周',
                onPressed: () => setState(() {
                  selectedKey = _dateKey(_parseDate(selectedKey)
                      .subtract(const Duration(days: 7)));
                  quickFilter = null;
                }),
                icon: const Icon(Icons.chevron_left,
                    size: 18, color: DebaoColors.muted),
              ),
              IconButton(
                key: const ValueKey('courses-week-next'),
                tooltip: '下一周',
                onPressed: () => setState(() {
                  selectedKey = _dateKey(
                      _parseDate(selectedKey).add(const Duration(days: 7)));
                  quickFilter = null;
                }),
                icon: const Icon(Icons.chevron_right,
                    size: 18, color: DebaoColors.muted),
              ),
            ],
          ),
          Row(
            children: days.map((date) {
              final key = _dateKey(date);
              final selected = key == selectedKey;
              final entries = _schedule[key] ?? const <_Session>[];
              final weekday =
                  const ['一', '二', '三', '四', '五', '六', '日'][date.weekday - 1];
              final hasMissed = entries
                  .any((session) => session.status == _SessionStatus.missed);
              return Expanded(
                child: InkWell(
                  key: ValueKey('courses-day-${date.day}'),
                  onTap: () => setState(() {
                    selectedKey = key;
                    quickFilter = null;
                  }),
                  child: SizedBox(
                    height: 75,
                    child: Column(
                      children: [
                        Text(weekday,
                            style: const TextStyle(
                                color: DebaoColors.muted, fontSize: 10)),
                        const SizedBox(height: 5),
                        Container(
                          width: 29,
                          height: 29,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                              color: selected
                                  ? DebaoColors.brand
                                  : key == _today
                                      ? DebaoColors.brandLight
                                      : Colors.transparent,
                              border: key == _today && !selected
                                  ? Border.all(color: DebaoColors.brand)
                                  : null,
                              shape: BoxShape.circle),
                          child: Text('${date.day}',
                              style: TextStyle(
                                  color: selected
                                      ? Colors.white
                                      : key == _today
                                          ? DebaoColors.brand
                                          : DebaoColors.ink,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600)),
                        ),
                        const SizedBox(height: 4),
                        if (entries.isNotEmpty)
                          Container(
                              width: 5,
                              height: 5,
                              decoration: BoxDecoration(
                                  color: hasMissed
                                      ? DebaoColors.error
                                      : DebaoColors.brand,
                                  shape: BoxShape.circle)),
                        if (key == _today)
                          const Text('今天',
                              style: TextStyle(
                                  color: DebaoColors.brand, fontSize: 9)),
                      ],
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _filterPill(String label, _QuickFilter filter, {bool danger = false}) {
    final active = quickFilter == filter;
    final color = danger ? DebaoColors.error : DebaoColors.brand;
    return InkWell(
      key: ValueKey('courses-filter-${filter.name}'),
      onTap: () => setState(() => quickFilter = active ? null : filter),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        height: 28,
        padding: const EdgeInsets.symmetric(horizontal: 13),
        alignment: Alignment.center,
        decoration: BoxDecoration(
            color: active ? color : Colors.white,
            border: Border.all(color: active ? color : color.withOpacity(.3)),
            borderRadius: BorderRadius.circular(14)),
        child: Text(label,
            style: TextStyle(
                color: active ? Colors.white : color,
                fontSize: 12,
                fontWeight: FontWeight.w500)),
      ),
    );
  }

  Widget _resumeBanner() => Container(
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 9),
        decoration: BoxDecoration(
            color: DebaoColors.brandLight,
            border: Border.all(color: const Color(0xFFDAD9FF)),
            borderRadius: BorderRadius.circular(DebaoRadius.md)),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                      _isCheckedIn(_schedule[_today]!.first)
                          ? '今日课程已打卡'
                          : '待完成听课打卡',
                      style: TextStyle(
                          color: DebaoColors.brand,
                          fontSize: 10,
                          fontWeight: FontWeight.w600)),
                  SizedBox(height: 3),
                  Text('第18讲：物权变动的公示与公信原则',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          color: DebaoColors.ink,
                          fontSize: 12,
                          fontWeight: FontWeight.w700)),
                ],
              ),
            ),
            FilledButton(
              key: const ValueKey('courses-resume'),
              onPressed: _isCheckedIn(_schedule[_today]!.first)
                  ? null
                  : () => _confirmCheckIn(_schedule[_today]!.first),
              style: ButtonStyle(
                  backgroundColor:
                      const WidgetStatePropertyAll(DebaoColors.action),
                  foregroundColor:
                      const WidgetStatePropertyAll(DebaoColors.ink),
                  minimumSize: const WidgetStatePropertyAll(Size(74, 31)),
                  padding: const WidgetStatePropertyAll(EdgeInsets.zero),
                  shape: WidgetStatePropertyAll(RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(7)))),
              child: Text(
                  _isCheckedIn(_schedule[_today]!.first) ? '已完成' : '听课打卡',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      );

  Widget _sessionCard(_Session session) {
    final locked = session.locked || _isLocked(session);
    final completed = _isCompleted(session);
    final status = completed ? _SessionStatus.done : session.status;
    final color = locked ? DebaoColors.muted : _sessionColor(session.type);
    final statusColor = locked ? DebaoColors.muted : _statusColor(status);
    return Opacity(
      opacity: locked ? .48 : 1,
      child: Container(
        key: ValueKey('course-session-${session.id}'),
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        padding: const EdgeInsets.only(right: 12),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(DebaoRadius.md),
            border: Border(left: BorderSide(color: color, width: 3))),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
                width: 53,
                child: Padding(
                    padding: const EdgeInsets.only(top: 13),
                    child: Text(session.start,
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                            color: DebaoColors.muted, fontSize: 10)))),
            Container(
                width: 20,
                alignment: Alignment.topCenter,
                padding: const EdgeInsets.only(top: 13),
                child: Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                        color: status == _SessionStatus.notStarted
                            ? Colors.white
                            : statusColor,
                        shape: BoxShape.circle,
                        border: Border.all(color: statusColor, width: 2)))),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 12, 0, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 3),
                            decoration: BoxDecoration(
                                color: color.withOpacity(.12),
                                borderRadius: BorderRadius.circular(4)),
                            child: Text(session.label,
                                style: TextStyle(
                                    color: color,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700))),
                        const SizedBox(width: 7),
                        Text(locked ? '待解锁' : _statusLabel(status),
                            style: TextStyle(color: statusColor, fontSize: 10)),
                        const Spacer(),
                        Text(
                            session.end.isEmpty
                                ? session.start
                                : '${session.start}–${session.end}',
                            style: const TextStyle(
                                color: Color(0xFFC0C5D0), fontSize: 9)),
                      ],
                    ),
                    const SizedBox(height: 7),
                    Text(session.title,
                        style: const TextStyle(
                            color: DebaoColors.ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w700)),
                    if (session.lesson != null) ...[
                      const SizedBox(height: 3),
                      Text(session.lesson!,
                          style: const TextStyle(
                              color: DebaoColors.body, fontSize: 11)),
                    ],
                    const SizedBox(height: 5),
                    Text(
                        '${session.teacher ?? ''}${session.teacher == null ? '' : '  ·  '}${session.duration} 分钟${session.tip == null ? '' : '  ·  ${session.tip}'}',
                        style: const TextStyle(
                            color: DebaoColors.muted, fontSize: 10)),
                    if (session.progress != null &&
                        status == _SessionStatus.inProgress)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(99),
                                child: LinearProgressIndicator(
                                    value: session.progress! / 100,
                                    minHeight: 5,
                                    backgroundColor: DebaoColors.line,
                                    valueColor:
                                        const AlwaysStoppedAnimation<Color>(
                                            DebaoColors.brand)),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text('${session.progress}%',
                                style: const TextStyle(
                                    color: DebaoColors.brand, fontSize: 10)),
                          ],
                        ),
                      ),
                    if (session.completedAt != null || completed)
                      Padding(
                        padding: const EdgeInsets.only(top: 7),
                        child: Text('完成于 ${session.completedAt ?? '刚刚'}',
                            style: const TextStyle(
                                color: DebaoColors.success, fontSize: 10)),
                      ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: _sessionAction(session, color),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _missedCard(_Session session) => Container(
        key: ValueKey('courses-missed-${session.id}'),
        margin: const EdgeInsets.only(left: 16, right: 16, bottom: 10),
        padding: const EdgeInsets.all(13),
        decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.all(Radius.circular(DebaoRadius.md)),
            border:
                Border(left: BorderSide(color: DebaoColors.error, width: 4))),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                    decoration: const BoxDecoration(
                        color: Color(0xFFFFF4F1),
                        borderRadius: BorderRadius.all(Radius.circular(4))),
                    child: const Text('待补课',
                        style: TextStyle(
                            color: DebaoColors.error,
                            fontSize: 10,
                            fontWeight: FontWeight.w600))),
                const SizedBox(width: 8),
                const Text('原计划 8月26日',
                    style: TextStyle(color: DebaoColors.muted, fontSize: 10)),
              ],
            ),
            const SizedBox(height: 7),
            Text(session.title,
                style: const TextStyle(
                    color: DebaoColors.ink,
                    fontSize: 14,
                    fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Row(
              children: [
                Text('${session.duration} 分钟',
                    style: const TextStyle(
                        color: DebaoColors.muted, fontSize: 10)),
                const Spacer(),
                OutlinedButton(
                  key: const ValueKey('courses-reschedule'),
                  onPressed: () => _requestReschedule(session),
                  style: OutlinedButton.styleFrom(
                      minimumSize: const Size(74, 30),
                      padding: EdgeInsets.zero,
                      foregroundColor: DebaoColors.body,
                      side: const BorderSide(color: DebaoColors.line),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(7))),
                  child: const Text('调整日期', style: TextStyle(fontSize: 11)),
                ),
                const SizedBox(width: 7),
                OutlinedButton(
                  onPressed: () => _open(CourseDetailScreen(
                      courseId: 'c1', remoteEnabled: widget.remoteEnabled)),
                  style: OutlinedButton.styleFrom(
                      minimumSize: const Size(74, 30),
                      padding: EdgeInsets.zero,
                      foregroundColor: DebaoColors.error,
                      side:
                          BorderSide(color: DebaoColors.error.withOpacity(.3)),
                      backgroundColor: const Color(0xFFFFF4F1),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(7))),
                  child: const Text('立即补课', style: TextStyle(fontSize: 11)),
                ),
              ],
            ),
          ],
        ),
      );

  Widget _sessionAction(_Session session, Color color) {
    final locked = _isLocked(session);
    final checkedIn = _isCheckedIn(session);
    if (locked) {
      return OutlinedButton.icon(
        key: ValueKey('courses-action-${session.id}'),
        onPressed: null,
        style: OutlinedButton.styleFrom(
            foregroundColor: DebaoColors.muted,
            disabledForegroundColor: DebaoColors.muted,
            side: const BorderSide(color: DebaoColors.line),
            minimumSize: const Size(78, 30),
            padding: const EdgeInsets.symmetric(horizontal: 9),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(7))),
        icon: const Icon(Icons.lock_outline, size: 12),
        label: const Text('待解锁',
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
      );
    }
    if (session.type == _SessionType.main) {
      return OutlinedButton.icon(
        key: ValueKey('courses-action-${session.id}'),
        onPressed: checkedIn ? null : () => _confirmCheckIn(session),
        style: OutlinedButton.styleFrom(
            foregroundColor: color,
            disabledForegroundColor: DebaoColors.muted,
            side: BorderSide(color: color.withOpacity(.3)),
            minimumSize: const Size(78, 30),
            padding: const EdgeInsets.symmetric(horizontal: 9),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(7))),
        icon: Icon(checkedIn ? Icons.check_circle_outline : Icons.task_alt,
            size: 12),
        label: Text(checkedIn ? '已打卡' : '听课打卡',
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
      );
    }
    if (session.type == _SessionType.card) {
      final completed = _isCompleted(session);
      return OutlinedButton.icon(
        key: ValueKey('courses-action-${session.id}'),
        onPressed: completed ? null : () => _showCardSample(session),
        style: OutlinedButton.styleFrom(
            foregroundColor: color,
            disabledForegroundColor: DebaoColors.muted,
            side: BorderSide(color: color.withOpacity(.3)),
            minimumSize: const Size(78, 30),
            padding: const EdgeInsets.symmetric(horizontal: 9),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(7))),
        icon: Icon(
            completed ? Icons.check_circle_outline : Icons.style_outlined,
            size: 12),
        label: Text(completed ? '已完成' : '开始卡片',
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
      );
    }
    final label = switch (session.status) {
      _SessionStatus.inProgress => '继续学习',
      _SessionStatus.done => '再次学习',
      _SessionStatus.missed => '立即补课',
      _SessionStatus.liveSoon => '进入直播',
      _SessionStatus.notStarted => session.type == _SessionType.practice ||
              session.type == _SessionType.review
          ? '去完成'
          : '开始学习',
    };
    return OutlinedButton.icon(
      key: ValueKey('courses-action-${session.id}'),
      onPressed: () {
        if (session.status == _SessionStatus.missed) {
          setState(() => rescheduleSession = session);
        } else if (session.status == _SessionStatus.liveSoon) {
          _open(LiveCourseScreen(
              courseId: 'c3',
              title: session.title,
              remoteEnabled: widget.remoteEnabled));
        } else if (session.type == _SessionType.practice ||
            session.type == _SessionType.review) {
          _open(ObjectiveAnswerScreen(
              title: session.title,
              remoteEnabled: widget.remoteEnabled,
              mode: 'chapter',
              learningTaskId: widget.remoteEnabled ? session.id : null));
        } else if (session.type == _SessionType.card) {
          _showCardSample(session);
        } else {
          _open(CourseDetailScreen(
              courseId: 'c1', remoteEnabled: widget.remoteEnabled));
        }
      },
      style: OutlinedButton.styleFrom(
          foregroundColor: color,
          side: BorderSide(color: color.withOpacity(.3)),
          minimumSize: const Size(78, 30),
          padding: const EdgeInsets.symmetric(horizontal: 9),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(7))),
      icon: Icon(
          session.status == _SessionStatus.liveSoon
              ? Icons.podcasts_outlined
              : session.status == _SessionStatus.missed
                  ? Icons.calendar_month_outlined
                  : Icons.play_circle_outline,
          size: 12),
      label: Text(label,
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }

  bool _isCheckedIn(_Session session) =>
      checkedInSessionIds.contains(session.id) ||
      session.status == _SessionStatus.done;

  bool _isCompleted(_Session session) =>
      _isCheckedIn(session) || completedCardSessionIds.contains(session.id);

  bool _isLocked(_Session session) {
    if (session.locked) return true;
    if (session.type == _SessionType.main) return false;
    final sessions = _schedule[selectedKey] ?? const <_Session>[];
    final courseIndex =
        sessions.indexWhere((item) => item.type == _SessionType.main);
    if (courseIndex < 0) return false;
    final sessionIndex = sessions.indexOf(session);
    if (sessionIndex <= courseIndex) return false;
    if (!_isCheckedIn(sessions[courseIndex])) return true;
    final cardIndex =
        sessions.indexWhere((item) => item.type == _SessionType.card);
    if (cardIndex < 0 || sessionIndex <= cardIndex) return false;
    return !_isCompleted(sessions[cardIndex]);
  }

  Future<void> _checkIn(_Session session) async {
    if (widget.remoteEnabled) {
      try {
        await ref.read(courseRepositoryProvider).checkInTask(session.id);
        ref.invalidate(learningTasksProvider);
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('打卡失败：${_remoteErrorMessage(error)}')));
        }
        return;
      }
    } else {
      setState(() => checkedInSessionIds.add(session.id));
    }
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('听课打卡成功，卡片和后续练习已解锁')));
    }
  }

  Future<void> _confirmCheckIn(_Session session) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const ValueKey('courses-checkin-dialog'),
        title: const Text('确认听课打卡'),
        content: Text('请确认你已完成“${session.title}”的听课。\n\n打卡后将解锁本节课关联的卡片和后续练习。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('再想想'),
          ),
          FilledButton(
            key: const ValueKey('courses-checkin-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('确认打卡'),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      await _checkIn(session);
    }
  }

  Future<void> _showCardSample(_Session session) async {
    if (widget.remoteEnabled) {
      try {
        final tasks = await ref.read(courseRepositoryProvider).tasks();
        final task = tasks.firstWhere((item) => item.id == session.id);
        if (!mounted) return;
        await Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => LearningTaskScreen(task: task)));
        if (mounted) ref.invalidate(learningTasksProvider);
      } catch (_) {
        if (mounted)
          ScaffoldMessenger.of(context)
              .showSnackBar(const SnackBar(content: Text('卡片任务加载失败，请重试')));
      }
      return;
    }
    final completed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _CardStudyPage(session: session),
      ),
    );
    if (completed == true && mounted) {
      if (widget.remoteEnabled) {
        try {
          await ref.read(courseRepositoryProvider).completeTask(session.id);
          ref.invalidate(learningTasksProvider);
        } catch (error) {
          ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('卡片完成失败：${_remoteErrorMessage(error)}')));
          return;
        }
      } else {
        setState(() => completedCardSessionIds.add(session.id));
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('卡片已完成，后续题目已解锁')));
    }
  }

  Widget _emptyState() => Container(
        key: const ValueKey('courses-empty-state'),
        height: 190,
        margin: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(DebaoRadius.md)),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.event_available_outlined,
                color: DebaoColors.brand, size: 28),
            SizedBox(height: 10),
            Text('这一天没有安排',
                style: TextStyle(
                    color: DebaoColors.ink,
                    fontSize: 14,
                    fontWeight: FontWeight.w600)),
            SizedBox(height: 5),
            Text('学习计划会在这里显示后续安排',
                style: TextStyle(color: DebaoColors.muted, fontSize: 11)),
          ],
        ),
      );

  Widget _courseLibraryBody() {
    final state = widget.remoteEnabled
        ? ref.watch(coursesProvider)
        : const AsyncValue<List<Course>>.data([]);
    if (state.isLoading && !state.hasValue) {
      return const Center(
          child: CircularProgressIndicator(key: ValueKey('my-courses-loading')));
    }
    if (state.hasError && !state.hasValue) {
      return _remoteError(state.error.toString());
    }

    final courses = (state.valueOrNull ?? const <Course>[]).where((course) {
      final type = course.type.toLowerCase();
      return !type.contains('live') && !type.contains('直播');
    }).where((course) => _courseQuestionType(course) == courseCategory).where(
        (course) => _courseHasMedia(course, courseMedia)).toList(growable: false);
    final categoryLabel = courseCategory == 'subjective' ? '主观题' : '客观题';
    final mediaLabel = courseMedia == 'audio' ? '音频课程' : '视频课程';

    return ListView(
      key: const ValueKey('my-courses-scroll'),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
      children: [
        const Text('我的课程',
            style: TextStyle(
                color: DebaoColors.ink,
                fontSize: 18,
                fontWeight: FontWeight.w800)),
        const SizedBox(height: 5),
        const Text('按题型和课程形式查看已开通课程',
            style: TextStyle(color: DebaoColors.muted, fontSize: 12)),
        const SizedBox(height: 14),
        DebaoSegmented(
            labels: const ['主观题', '客观题'],
            selected: courseCategory == 'subjective' ? 0 : 1,
            onChanged: (index) => setState(() {
              courseCategory = index == 0 ? 'subjective' : 'objective';
            })),
        const SizedBox(height: 12),
        DebaoSegmented(
            labels: const ['音频课程', '视频课程'],
            selected: courseMedia == 'audio' ? 0 : 1,
            onChanged: (index) => setState(() {
              courseMedia = index == 0 ? 'audio' : 'video';
            })),
        const SizedBox(height: 18),
        Row(children: [
          Expanded(
              child: Text('$categoryLabel · $mediaLabel',
                  style: const TextStyle(
                      color: DebaoColors.ink,
                      fontSize: 15,
                      fontWeight: FontWeight.w700))),
          Text('${courses.length} 门',
              style: const TextStyle(color: DebaoColors.muted, fontSize: 11)),
        ]),
        const SizedBox(height: 8),
        if (courses.isEmpty)
          _groupEmpty('暂无符合条件的已开通课程')
        else
          _courseGroup(courses
              .map((course) => courseMedia == 'audio'
                  ? _remoteAudioCard(course)
                  : _remoteRecordedCard(course))
              .toList(growable: false)),
      ],
    );
  }

  String _courseQuestionType(Course course) {
    final value = course.questionType?.toLowerCase() ?? '';
    if (value.contains('subjective') || value.contains('主观')) {
      return 'subjective';
    }
    if (value.contains('objective') || value.contains('客观')) {
      return 'objective';
    }
    final title = course.title.toLowerCase();
    return title.contains('主观') ||
            title.contains('案例') ||
            title.contains('论述')
        ? 'subjective'
        : 'objective';
  }

  bool _courseHasMedia(Course course, String media) {
    final type = course.type.toLowerCase();
    if (media == 'audio') {
      return type.contains('audio') || type.contains('音频') || type == 'mixed';
    }
    return type.contains('video') || type.contains('视频') || type == 'mixed';
  }

  Widget _allCoursesBody() {
    final remote = widget.remoteEnabled
        ? ref.watch(coursesProvider)
        : const AsyncValue<List<Course>>.data([]);
    if (widget.remoteEnabled && remote.isLoading && !remote.hasValue) {
      return const Center(
          child: CircularProgressIndicator(key: ValueKey('courses-loading')));
    }
    if (widget.remoteEnabled && remote.hasError && !remote.hasValue) {
      return _remoteError(remote.error.toString());
    }

    final courses = remote.asData?.value ?? const <Course>[];
    final recorded = widget.remoteEnabled
        ? courses
            .map((course) => _RecordedCourse(
                  id: course.id,
                  name: course.title,
                  teacher: course.teacher,
                  progress: course.progress.round(),
                  completed: (course.progress / 100 * course.lessons).round(),
                  total: course.lessons,
                  last: '最近学习',
                ))
            .toList()
        : const <_RecordedCourse>[
            _RecordedCourse(
                id: 'c1',
                name: '民法精讲课（2024版）',
                teacher: '张明远',
                progress: 42,
                completed: 28,
                total: 68,
                last: '昨天 21:30'),
            _RecordedCourse(
                id: 'c2',
                name: '刑法体系课（2024版）',
                teacher: '李东明',
                progress: 18,
                completed: 13,
                total: 72,
                last: '3天前'),
          ];

    return ListView(
      key: const ValueKey('courses-all-scroll'),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
      children: widget.remoteEnabled
          ? _remoteAllChildren(courses, remote)
          : <Widget>[
              _sectionLabel('录播课'),
              if (recorded.isEmpty)
                _groupEmpty('暂无可用录播课程')
              else
                _courseGroup(recorded
                    .map((course) => _recordedCard(course))
                    .toList(growable: false)),
              _sectionLabel('专项训练'),
              _courseGroup([
                _trainingCard(
                    name: '请求权基础答题训练',
                    detail: '配合「民法精讲课」· 建议第18讲后开始',
                    added: addedCourses.contains('请求权基础答题训练')),
                _trainingCard(
                    name: '刑法重点罪名冲刺',
                    detail: '配合「刑法体系课」· 建议刑法分论阶段',
                    progress: 35,
                    added: true),
              ]),
              _sectionLabel('音频课程'),
              _courseGroup([
                _mediaCard(
                    kind: 'audio',
                    title: '民法音频精讲（通勤随听版）',
                    detail: '张明远主讲 · 共68讲 · 约52小时',
                    progress: 18,
                    action: '继续收听',
                    onTap: () => _open(AudioPlayerScreen(
                        courseId: 'c1', remoteEnabled: widget.remoteEnabled))),
                _mediaCard(
                    kind: 'audio',
                    title: '法考全科音频串讲班',
                    detail: '多位名师主讲 · 共220讲 · 约160小时',
                    action: '开始收听',
                    onTap: () => _open(AudioPlayerScreen(
                        courseId: 'c1', remoteEnabled: widget.remoteEnabled))),
              ]),
              _sectionLabel('已完成'),
              _groupEmpty('暂无已完成课程'),
            ],
    );
  }

  List<Widget> _remoteAllChildren(
      List<Course> courses, AsyncValue<List<Course>> remote) {
    final video = <Course>[];
    final training = <Course>[];
    final audio = <Course>[];
    final completed = <Course>[];
    for (final course in courses) {
      final kind = course.type.toLowerCase();
      if (kind.contains('live') || kind.contains('直播')) continue;
      if (course.progress >= 100) completed.add(course);
      if (kind.contains('audio') || kind.contains('音频')) {
        audio.add(course);
      } else if (kind.contains('practice') ||
          kind.contains('training') ||
          kind.contains('专项') ||
          kind.contains('练习')) {
        training.add(course);
      } else {
        video.add(course);
      }
    }
    return <Widget>[
      if (remote.hasError) _remoteBanner(remote.error.toString()),
      _sectionLabel('录播课'),
      if (video.isEmpty)
        _groupEmpty('暂无可用录播课程')
      else
        _courseGroup(video.map(_remoteRecordedCard).toList(growable: false)),
      _sectionLabel('专项训练'),
      if (training.isEmpty)
        _groupEmpty('暂无专项训练')
      else
        _courseGroup(training.map(_remoteTrainingCard).toList(growable: false)),
      _sectionLabel('音频课程'),
      if (audio.isEmpty)
        _groupEmpty('暂无音频课程')
      else
        _courseGroup(audio.map(_remoteAudioCard).toList(growable: false)),
      _sectionLabel('已完成'),
      if (completed.isEmpty)
        _groupEmpty('暂无已完成课程')
      else
        _courseGroup(
            completed.map(_remoteRecordedCard).toList(growable: false)),
    ];
  }

  _RecordedCourse _remoteCourse(Course course) => _RecordedCourse(
        id: course.id,
        name: course.title,
        teacher: course.teacher,
        progress: course.progress.clamp(0, 100).round(),
        completed:
            (course.progress.clamp(0, 100) / 100 * course.lessons).round(),
        total: course.lessons,
        last: '最近学习',
      );

  Widget _remoteRecordedCard(Course course) =>
      _recordedCard(_remoteCourse(course), remoteEnabled: true);

  Widget _remoteTrainingCard(Course course) => _trainingCard(
        courseId: course.id,
        remoteEnabled: true,
        name: course.title,
        detail: course.teacher.isEmpty ? '服务端课程' : course.teacher,
        progress: course.progress.clamp(0, 100).round(),
        added: false,
      );

  Widget _remoteAudioCard(Course course) => _mediaCard(
        kind: 'audio',
        title: course.title,
        detail: course.teacher.isEmpty ? '服务端音频课程' : course.teacher,
        progress: course.progress.clamp(0, 100).round(),
        action: '继续收听',
        onTap: () => _open(AudioPlayerScreen(
            courseId: course.id, remoteEnabled: widget.remoteEnabled)),
      );

  Widget _remoteError(String error) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_outlined,
                  color: DebaoColors.muted, size: 32),
              const SizedBox(height: 10),
              const Text('课程服务暂时不可用',
                  style: TextStyle(
                      color: DebaoColors.ink,
                      fontSize: 14,
                      fontWeight: FontWeight.w600)),
              const SizedBox(height: 5),
              Text(error,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style:
                      const TextStyle(color: DebaoColors.muted, fontSize: 11)),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                  key: const ValueKey('courses-retry'),
                  onPressed: () {
                    ref.invalidate(learningTasksProvider);
                    ref.invalidate(coursesProvider);
                  },
                  icon: const Icon(Icons.refresh, size: 15),
                  label: const Text('重试')),
            ],
          ),
        ),
      );

  String _remoteErrorMessage(Object error) {
    final value = error.toString();
    return value.replaceFirst(RegExp(r'^ApiError\([^)]*\):\s*'), '');
  }

  Widget _remoteBanner(String error) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        child: MaterialBanner(
          content: Text('课程数据加载失败：$error', maxLines: 2),
          leading: const Icon(Icons.cloud_off_outlined),
          actions: [
            TextButton(
                key: const ValueKey('courses-retry-banner'),
                onPressed: () => ref.invalidate(coursesProvider),
                child: const Text('重试')),
          ],
        ),
      );

  Widget _sectionLabel(String label) => Padding(
        padding: const EdgeInsets.only(bottom: 7, top: 3),
        child: Text(label,
            style: const TextStyle(color: DebaoColors.muted, fontSize: 11)),
      );

  Widget _courseGroup(List<Widget> children) => Container(
        margin: const EdgeInsets.only(bottom: 16),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(8)),
        clipBehavior: Clip.antiAlias,
        child: Column(children: children),
      );

  Widget _groupEmpty(String text) => Container(
        height: 54,
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.symmetric(horizontal: 15),
        alignment: Alignment.centerLeft,
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(8)),
        child: Text(text,
            style: const TextStyle(color: DebaoColors.muted, fontSize: 13)),
      );

  Widget _recordedCard(_RecordedCourse course,
          {bool remoteEnabled = remoteDataDefault}) =>
      Container(
        key: ValueKey('courses-recorded-${course.id}'),
        padding: const EdgeInsets.all(15),
        decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: DebaoColors.line))),
        child: Column(
          children: [
            InkWell(
              onTap: () => _open(CourseDetailScreen(
                  courseId: course.id, remoteEnabled: remoteEnabled)),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(5),
                    child: Image.asset(_courseImage(course.name),
                        width: 64, height: 44, fit: BoxFit.cover),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(course.name,
                            style: const TextStyle(
                                color: DebaoColors.ink,
                                fontSize: 14,
                                fontWeight: FontWeight.w700)),
                        Text(
                            course.last == '最近学习'
                                ? (course.teacher.isEmpty
                                    ? '讲师信息暂未提供'
                                    : '${course.teacher}主讲')
                                : '${course.teacher}主讲  ·  有效期至 2025年1月',
                            style: const TextStyle(
                                color: DebaoColors.muted, fontSize: 10)),
                        Row(
                          children: [
                            Expanded(
                                child: LinearProgressIndicator(
                                    value: course.progress / 100,
                                    minHeight: 5,
                                    backgroundColor: DebaoColors.line,
                                    valueColor:
                                        const AlwaysStoppedAnimation<Color>(
                                            DebaoColors.brand))),
                            const SizedBox(width: 8),
                            Text('${course.progress}%',
                                style: const TextStyle(
                                    color: DebaoColors.brand,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600)),
                          ],
                        ),
                        Text(
                            course.total > 0
                                ? '${course.completed}/${course.total} 课节  ·  上次学习 ${course.last}'
                                : '上次学习 ${course.last}',
                            style: const TextStyle(
                                color: DebaoColors.muted, fontSize: 10)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _open(CourseDetailScreen(
                        courseId: course.id, remoteEnabled: remoteEnabled)),
                    style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(32),
                        foregroundColor: DebaoColors.brand,
                        side: const BorderSide(color: DebaoColors.brandLight),
                        backgroundColor: DebaoColors.brandLight,
                        padding: EdgeInsets.zero,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(7))),
                    child: const Text('查看本周安排', style: TextStyle(fontSize: 11)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => _open(CourseDetailScreen(
                        courseId: course.id, remoteEnabled: remoteEnabled)),
                    style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(32),
                        backgroundColor: DebaoColors.action,
                        foregroundColor: DebaoColors.ink,
                        padding: EdgeInsets.zero,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(7))),
                    icon: const Icon(Icons.play_arrow, size: 13),
                    label: const Text('继续学习', style: TextStyle(fontSize: 11)),
                  ),
                ),
              ],
            ),
          ],
        ),
      );

  Widget _trainingCard({
    required String name,
    required String detail,
    int? progress,
    required bool added,
    String? courseId,
    bool remoteEnabled = remoteDataDefault,
  }) {
    final addKey = ValueKey('courses-training-add-$name');
    return Container(
      key: ValueKey('courses-training-$name'),
      padding: const EdgeInsets.all(15),
      decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: DebaoColors.line))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(name,
              style: const TextStyle(
                  color: DebaoColors.ink,
                  fontSize: 14,
                  fontWeight: FontWeight.w700)),
          Text(detail,
              style: const TextStyle(color: DebaoColors.muted, fontSize: 10)),
          if (progress != null)
            Padding(
              padding: const EdgeInsets.only(top: 7),
              child: Row(
                children: [
                  Expanded(
                      child: LinearProgressIndicator(
                          value: progress / 100,
                          minHeight: 5,
                          backgroundColor: DebaoColors.line,
                          valueColor: const AlwaysStoppedAnimation<Color>(
                              Color(0xFFA87000)))),
                  const SizedBox(width: 8),
                  Text('$progress%',
                      style: const TextStyle(
                          color: Color(0xFFA87000), fontSize: 10)),
                ],
              ),
            ),
          const SizedBox(height: 11),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: ValueKey('courses-training-open-$name'),
                  onPressed: () => _open(CourseDetailScreen(
                      courseId: courseId ?? 'c1',
                      remoteEnabled: remoteEnabled)),
                  style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(32),
                      foregroundColor: DebaoColors.body,
                      side: const BorderSide(color: DebaoColors.line),
                      padding: EdgeInsets.zero,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(7))),
                  child: const Text('查看课程', style: TextStyle(fontSize: 11)),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  key: addKey,
                  onPressed: added ? null : () => _requestAddCourse(name),
                  style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(32),
                      backgroundColor:
                          added ? DebaoColors.mint : DebaoColors.brandLight,
                      disabledBackgroundColor: DebaoColors.mint,
                      disabledForegroundColor: DebaoColors.success,
                      foregroundColor: DebaoColors.brand,
                      padding: EdgeInsets.zero,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(7))),
                  child: Text(added ? '✓ 已加入日历' : '+ 加入学习安排',
                      style: const TextStyle(fontSize: 11)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _mediaCard({
    required String kind,
    required String title,
    required String detail,
    required String action,
    required VoidCallback onTap,
    int? progress,
  }) {
    final live = kind == 'live';
    final color = live ? const Color(0xFFC0385A) : DebaoColors.brand;
    return Container(
      key: ValueKey('courses-media-$kind-$action'),
      padding: const EdgeInsets.all(15),
      decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: DebaoColors.line))),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                      color: color, borderRadius: BorderRadius.circular(10)),
                  child: Icon(live ? Icons.podcasts_outlined : Icons.menu_book,
                      color: Colors.white, size: 22)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            color: DebaoColors.ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w700)),
                    Text(detail,
                        style: const TextStyle(
                            color: DebaoColors.muted, fontSize: 10)),
                    if (progress != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 7),
                        child: Row(
                          children: [
                            Expanded(
                                child: LinearProgressIndicator(
                                    value: progress / 100,
                                    minHeight: 5,
                                    backgroundColor: DebaoColors.line,
                                    valueColor:
                                        const AlwaysStoppedAnimation<Color>(
                                            DebaoColors.brand))),
                            const SizedBox(width: 8),
                            Text('$progress%',
                                style: const TextStyle(
                                    color: DebaoColors.brand,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 11),
          SizedBox(
            width: double.infinity,
            height: 32,
            child: FilledButton.icon(
              onPressed: onTap,
              style: FilledButton.styleFrom(
                  backgroundColor: live ? DebaoColors.rose : DebaoColors.action,
                  foregroundColor: live ? color : DebaoColors.ink,
                  padding: EdgeInsets.zero,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(7))),
              icon: Icon(live ? Icons.podcasts_outlined : Icons.play_arrow,
                  size: 13),
              label: Text(action,
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
    );
  }

  String _courseImage(String title) {
    if (title.contains('刑法')) return 'assets/images/course-criminal-law.png';
    return 'assets/images/course-civil-law.jpg';
  }

  int _durationHours(List<_Session> sessions) =>
      ((sessions.fold<int>(0, (sum, item) => sum + item.duration)) / 60).ceil();

  void _open(Widget page) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => page));

  void _openMonth() {
    if (monthVisible) return;
    setState(() => monthVisible = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !monthVisible) return;
      setState(() => monthVisible = false);
      _showMonthSheet();
    });
  }

  void _requestReschedule(_Session session) {
    setState(() => rescheduleSession = session);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || rescheduleSession == null) return;
      final selected = rescheduleSession!;
      setState(() => rescheduleSession = null);
      _showRescheduleSheet(selected);
    });
  }

  void _requestAddCourse(String name) {
    setState(() => addCourse = name);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || addCourse == null) return;
      final selected = addCourse!;
      setState(() => addCourse = null);
      _showAddCalendarSheet(selected);
    });
  }

  Future<void> _showMonthSheet() async {
    var month = _parseDate(selectedKey).month;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) {
          final year = _parseDate(selectedKey).year;
          final first = DateTime(year, month, 1);
          final days = DateTime(year, month + 1, 0).day;
          final blank = first.weekday - DateTime.monday;
          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      IconButton(
                          onPressed: () => setSheetState(() => month--),
                          icon: const Icon(Icons.chevron_left)),
                      Text('$year年 ${month}月',
                          style: const TextStyle(
                              fontSize: 16, fontWeight: FontWeight.w700)),
                      IconButton(
                          onPressed: () => setSheetState(() => month++),
                          icon: const Icon(Icons.chevron_right)),
                    ],
                  ),
                  Row(
                    children: const ['一', '二', '三', '四', '五', '六', '日']
                        .map((day) => Expanded(
                            child: Center(
                                child: Text(day,
                                    style: TextStyle(
                                        color: DebaoColors.muted,
                                        fontSize: 11)))))
                        .toList(),
                  ),
                  const SizedBox(height: 7),
                  Wrap(
                    children: [
                      ...List.generate(
                          blank, (_) => const SizedBox(width: 44, height: 42)),
                      ...List.generate(days, (index) {
                        final day = index + 1;
                        final key = _dateKey(DateTime(year, month, day));
                        final selected = key == selectedKey;
                        final hasData = (_schedule[key] ?? []).isNotEmpty;
                        return InkWell(
                          key: ValueKey('courses-month-day-$day'),
                          onTap: () {
                            setState(() {
                              selectedKey = key;
                              quickFilter = null;
                            });
                            Navigator.pop(sheetContext);
                          },
                          child: SizedBox(
                            width: 44,
                            height: 42,
                            child: Column(
                              children: [
                                Container(
                                    width: 28,
                                    height: 28,
                                    alignment: Alignment.center,
                                    decoration: BoxDecoration(
                                        color: selected
                                            ? DebaoColors.brand
                                            : Colors.transparent,
                                        shape: BoxShape.circle),
                                    child: Text('$day',
                                        style: TextStyle(
                                            color: selected
                                                ? Colors.white
                                                : DebaoColors.ink,
                                            fontSize: 12,
                                            fontWeight: selected
                                                ? FontWeight.w700
                                                : FontWeight.w400))),
                                if (hasData)
                                  Container(
                                      width: 4,
                                      height: 4,
                                      decoration: const BoxDecoration(
                                          color: DebaoColors.brand,
                                          shape: BoxShape.circle)),
                              ],
                            ),
                          ),
                        );
                      }),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _showRescheduleSheet(_Session session) async {
    var selected = 1;
    final options = const [
      ('今天  8月27日', '今日安排已满'),
      ('明天  8月28日', ''),
      ('后天  8月29日', ''),
      ('本周末  8月30日', '暂无安排'),
      ('下周一  9月1日', ''),
    ];
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('调整补课日期',
                    style:
                        TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Text('调整「${session.title}」的学习日期',
                    style: const TextStyle(color: DebaoColors.body)),
                const SizedBox(height: 12),
                ...options.asMap().entries.map((entry) {
                  final active = entry.key == selected;
                  return InkWell(
                    onTap: () => setSheetState(() => selected = entry.key),
                    child: Container(
                      height: 44,
                      margin: const EdgeInsets.only(bottom: 7),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                          color: active
                              ? DebaoColors.brandLight
                              : DebaoColors.page,
                          border: Border.all(
                              color: active
                                  ? DebaoColors.brand
                                  : Colors.transparent),
                          borderRadius: BorderRadius.circular(8)),
                      child: Row(
                        children: [
                          Expanded(
                              child: Text(entry.value.$1,
                                  style: const TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600))),
                          Text(entry.value.$2,
                              style: const TextStyle(
                                  color: DebaoColors.muted, fontSize: 10)),
                          if (active)
                            const Padding(
                                padding: EdgeInsets.only(left: 8),
                                child: Icon(Icons.check,
                                    color: DebaoColors.brand, size: 15)),
                        ],
                      ),
                    ),
                  );
                }),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                        child: OutlinedButton(
                            onPressed: () => Navigator.pop(sheetContext),
                            child: const Text('取消'))),
                    const SizedBox(width: 9),
                    Expanded(
                        child: FilledButton(
                            key: const ValueKey('courses-sheet-confirm'),
                            onPressed: () => Navigator.pop(sheetContext),
                            style: FilledButton.styleFrom(
                                backgroundColor: DebaoColors.brand),
                            child: const Text('确认调整'))),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showAddCalendarSheet(String course) async {
    var day = 0;
    var time = '14:00';
    const days = ['今天 8/27', '明天 8/28', '8月29日', '8月30日 周日', '9月1日'];
    const times = ['09:00', '14:00', '19:00', '21:00'];
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('加入学习安排',
                    style:
                        TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Text('将「$course」加入学习日历',
                    style: const TextStyle(color: DebaoColors.body)),
                const SizedBox(height: 14),
                const Text('选择日期',
                    style: TextStyle(
                        color: DebaoColors.ink,
                        fontSize: 12,
                        fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children: days
                        .asMap()
                        .entries
                        .map((entry) => _choice(entry.value,
                            selected: day == entry.key,
                            onTap: () => setSheetState(() => day = entry.key)))
                        .toList()),
                const SizedBox(height: 14),
                const Text('开始时间',
                    style: TextStyle(
                        color: DebaoColors.ink,
                        fontSize: 12,
                        fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 7,
                  children: times
                      .map((item) => _choice(item,
                          selected: time == item,
                          onTap: () => setSheetState(() => time = item)))
                      .toList(),
                ),
                const SizedBox(height: 15),
                Row(
                  children: [
                    Expanded(
                        child: OutlinedButton(
                            onPressed: () => Navigator.pop(sheetContext),
                            child: const Text('取消'))),
                    const SizedBox(width: 9),
                    Expanded(
                        child: FilledButton(
                            key: const ValueKey('courses-sheet-confirm'),
                            onPressed: () {
                              setState(() => addedCourses.add(course));
                              Navigator.pop(sheetContext);
                            },
                            style: FilledButton.styleFrom(
                                backgroundColor: DebaoColors.brand),
                            child: const Text('加入日历'))),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _choice(String label,
          {required bool selected, required VoidCallback onTap}) =>
      InkWell(
        onTap: onTap,
        child: Container(
          height: 32,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          alignment: Alignment.center,
          decoration: BoxDecoration(
              color: selected ? DebaoColors.brand : Colors.white,
              border: Border.all(
                  color: selected ? DebaoColors.brand : DebaoColors.line),
              borderRadius: BorderRadius.circular(7)),
          child: Text(label,
              style: TextStyle(
                  color: selected ? Colors.white : DebaoColors.body,
                  fontSize: 11,
                  fontWeight: FontWeight.w500)),
        ),
      );
}

class _RecordedCourse {
  const _RecordedCourse({
    required this.id,
    required this.name,
    required this.teacher,
    required this.progress,
    required this.completed,
    required this.total,
    required this.last,
  });
  final String id;
  final String name;
  final String teacher;
  final int progress;
  final int completed;
  final int total;
  final String last;
}
