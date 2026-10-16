import '../../core/config/app_environment.dart';
// Legacy RC helper widgets remain available for alternate tool states; some
// are intentionally not referenced by the default route yet.
// ignore_for_file: unused_element, unused_element_parameter

import 'dart:async';

import 'package:flutter/material.dart';
import '../learning/learning_task_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../data/models.dart';
import '../../data/providers.dart';
import '../questions/objective_answer_screen.dart';
import '../community/forum_screens.dart';
import '../../shared/route_back_button.dart';

const _brand = Color(0xFF4C4BEA);
const _page = Color(0xFFF4F5F7);
const _ink = Color(0xFF171925);
const _body = Color(0xFF5F6574);
const _muted = Color(0xFF707684);
const _line = Color(0xFFE5E7ED);
const _errorColor = Color(0xFFFF7252);

Widget _screen(String title, Widget body) => Scaffold(
      backgroundColor: _page,
      appBar: AppBar(
          leading: const DebaoRouteBackButton(),
          title: Text(title),
          centerTitle: true,
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white),
      body: body,
    );

String _errorMessage(Object error, {String fallback = '加载失败，请稍后重试'}) {
  if (error is ApiError) {
    return switch (error.code) {
      'OFFLINE' => '当前处于离线状态，请检查网络后重试。',
      'TIMEOUT' => '请求超时，请稍后重试。',
      'UNAUTHORIZED' => '登录状态已失效，请重新登录。',
      _ => error.message.isEmpty ? fallback : error.message,
    };
  }
  return error.toString().replaceFirst('Exception: ', '').isEmpty
      ? fallback
      : error.toString().replaceFirst('Exception: ', '');
}

class _ToolLoadingState extends StatelessWidget {
  const _ToolLoadingState({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => Center(
      child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const CircularProgressIndicator(color: _brand),
            const SizedBox(height: 12),
            Text(label, style: const TextStyle(color: _muted, fontSize: 12)),
          ])));
}

class _ToolErrorState extends StatelessWidget {
  const _ToolErrorState({required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final offline = error is ApiError &&
        ((error as ApiError).code == 'OFFLINE' ||
            (error as ApiError).code == 'TIMEOUT');
    return Center(
        child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(offline ? Icons.cloud_off_outlined : Icons.error_outline,
                  color: offline ? _muted : const Color(0xFFD2691E), size: 28),
              const SizedBox(height: 10),
              Text(_errorMessage(error),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: _body, fontSize: 12)),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh, size: 16),
                  label: const Text('重试')),
            ])));
  }
}

class _ToolEmptyState extends StatelessWidget {
  const _ToolEmptyState(
      {required this.icon,
      required this.title,
      required this.message,
      this.action});
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
      child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, color: _muted, size: 30),
            const SizedBox(height: 10),
            Text(title,
                style: const TextStyle(
                    color: _ink, fontSize: 14, fontWeight: FontWeight.w600)),
            const SizedBox(height: 5),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: _muted, fontSize: 12)),
            if (action != null) ...[
              const SizedBox(height: 14),
              action!,
            ],
          ])));
}

class LearningPlanScreen extends StatelessWidget {
  const LearningPlanScreen({
    super.key,
    this.remoteEnabled = remoteDataDefault,
    this.allowManualPlanManagement = false,
  });
  final bool remoteEnabled;

  /// Private-coach plans are published and changed by the teaching backend.
  /// Keep this false for the learner-facing screen so it cannot create or
  /// mutate a plan that should mirror the daily check-in curriculum.
  final bool allowManualPlanManagement;

  @override
  Widget build(BuildContext context) => ProviderScope(
        child: _LearningPlanBody(
            remoteEnabled: remoteEnabled,
            allowManualPlanManagement: allowManualPlanManagement),
      );
}

class _LearningPlanBody extends ConsumerStatefulWidget {
  const _LearningPlanBody(
      {required this.remoteEnabled, required this.allowManualPlanManagement});
  final bool remoteEnabled;
  final bool allowManualPlanManagement;

  @override
  ConsumerState<_LearningPlanBody> createState() => _LearningPlanScreenState();
}

class _LearningPlanScreenState extends ConsumerState<_LearningPlanBody> {
  // Keep the local preview data in the same two sections as the RC screen.
  static const fixtureSections = <({
    String week,
    List<({String title, String detail, String time})> tasks
  })>[
    (
      week: '本周计划（8月26日–9月1日）',
      tasks: [
        (title: '完成民法·物权法章节练习', detail: '目标30题 · 已完成12题', time: '45分钟'),
        (title: '观看刑法第8讲', detail: '犯罪的未完成形态 · 约55分钟', time: '55分钟'),
        (title: '复习错题（民法）', detail: '28道待复习', time: '30分钟'),
        (title: '完成行政法章节测验', detail: '行政许可 · 15题', time: '20分钟'),
      ],
    ),
    (
      week: '下周预计',
      tasks: [
        (title: '民事诉讼法专项练习', detail: '强化薄弱科目', time: '60分钟'),
        (title: '2022年真题卷二精练', detail: '历年真题模拟', time: '90分钟'),
      ],
    ),
  ];
  final completed = <int>{1};
  bool _mutatingPlan = false;
  bool _requestingEarlyAccess = false;
  final _completingTaskIds = <String>{};
  final _completedRemoteTaskIds = <String>{};
  final _planOverrides = <String, LearningPlan>{};
  final _removedPlanIds = <String>{};
  String? _selectedPlanId;

  @override
  Widget build(BuildContext context) {
    if (widget.remoteEnabled) {
      final plans = ref.watch(learningPlansProvider);
      final tasksRemote = ref.watch(learningTasksProvider);
      if (plans.isLoading &&
          !plans.hasValue &&
          tasksRemote.isLoading &&
          !tasksRemote.hasValue) {
        return _screen('学习计划', const _ToolLoadingState(label: '正在加载学习计划…'));
      }
      if ((plans.hasError && !plans.hasValue) ||
          (tasksRemote.hasError && !tasksRemote.hasValue)) {
        final error = plans.hasError ? plans.error! : tasksRemote.error!;
        return _screen(
            '学习计划',
            _ToolErrorState(
                error: error,
                onRetry: () {
                  ref.invalidate(learningPlansProvider);
                  ref.invalidate(learningTasksProvider);
                }));
      }
      final planItems =
          _effectivePlans(plans.valueOrNull ?? const <LearningPlan>[]);
      final taskItems = (tasksRemote.valueOrNull ?? const <LearningTask>[])
          .where((task) => !_removedPlanIds.contains(task.planId))
          .toList(growable: false);
      if (planItems.isEmpty && taskItems.isEmpty) {
        return _screen(
            '学习计划',
            _ToolEmptyState(
                action: widget.allowManualPlanManagement
                    ? KeyedSubtree(
                        key: const ValueKey('learning-plan-add'),
                        child: OutlinedButton.icon(
                          key: const ValueKey('learning-plan-empty-add'),
                          onPressed:
                              _mutatingPlan ? null : () => _openPlanEditor(),
                          icon: const Icon(Icons.add, size: 16),
                          label: const Text('创建计划'),
                        ),
                      )
                    : null,
                icon: Icons.event_note_outlined,
                title: '暂无学习计划',
                message: widget.allowManualPlanManagement
                    ? '创建一个计划后，今天的任务会显示在这里。'
                    : '后台发布学习计划后，这里会同步显示每日课程和打卡任务。'));
      }
      return _remotePlanBody(planItems, taskItems);
    }
    return _localPlanBody();
  }

  Widget _localPlanBody() {
    final allTasks =
        fixtureSections.expand((section) => section.tasks).toList();
    final doneCount =
        completed.where((index) => index < allTasks.length).length;
    final progress = allTasks.isEmpty ? 0.0 : doneCount / allTasks.length;
    return _screen(
        '学习计划',
        ListView(padding: const EdgeInsets.only(bottom: 24), children: [
          Container(
              margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(8)),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('本周完成进度',
                              style: TextStyle(
                                  color: _ink,
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600)),
                          Text('$doneCount / ${allTasks.length}',
                              key: const ValueKey(
                                  'learning-plan-progress-value'),
                              style: TextStyle(
                                  color: _brand,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500))
                        ]),
                    const SizedBox(height: 8),
                    LinearProgressIndicator(
                        key: const ValueKey('learning-plan-progress-track'),
                        value: progress,
                        minHeight: 8,
                        backgroundColor: _line,
                        valueColor: AlwaysStoppedAnimation(_brand)),
                    const SizedBox(height: 6),
                    Text('预计本周学习时长 3.5 小时，已完成 0.9 小时',
                        style: TextStyle(color: _muted, fontSize: 11)),
                  ])),
          ..._localSections(),
        ]));
  }

  List<Widget> _localSections() {
    var offset = 0;
    final sections = <Widget>[];
    for (final section in fixtureSections) {
      final start = offset;
      sections.add(_planSection(
        week: section.week,
        tasks: section.tasks
            .asMap()
            .entries
            .map((entry) => _TaskTile(
                  title: entry.value.title,
                  detail: entry.value.detail,
                  duration: entry.value.time,
                  done: completed.contains(start + entry.key),
                  onTap: () => setState(() {
                    final index = start + entry.key;
                    if (completed.contains(index)) {
                      completed.remove(index);
                    } else {
                      completed.add(index);
                    }
                  }),
                ))
            .toList(growable: false),
      ));
      offset += section.tasks.length;
    }
    return sections;
  }

  Widget _planSection({required String week, required List<Widget> tasks}) =>
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(week,
              key: ValueKey('learning-plan-section-$week'),
              style: const TextStyle(color: _muted, fontSize: 12)),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: ColoredBox(
              color: Colors.white,
              child: Column(children: [
                for (var index = 0; index < tasks.length; index++)
                  if (index == tasks.length - 1)
                    tasks[index]
                  else
                    Column(children: [
                      tasks[index],
                      const Divider(height: 1, color: _line),
                    ]),
              ]),
            ),
          ),
        ]),
      );

  Widget _remotePlanBody(
      List<LearningPlan> plans, List<LearningTask> remoteTasks) {
    // RN renders the active plan and its own tasks. If no plan exists, keep
    // orphaned tasks visible under a neutral section rather than dropping
    // server data silently.
    final plan = _displayedPlan(plans);
    final planTasks = plan == null
        ? remoteTasks
        : remoteTasks.where((task) => task.planId == plan.id).toList();
    final planTitle = plan?.title ?? '学习任务';
    final done = planTasks.where(_isTaskDone).length;
    final doneMinutes = planTasks
        .where(_isTaskDone)
        .fold<int>(0, (sum, task) => sum + task.minutes);
    final progress = planTasks.isEmpty ? 0.0 : done / planTasks.length;
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final todayTasks =
        planTasks.where((task) => task.dueDate == today).toList();
    final todayDone = todayTasks.isNotEmpty && todayTasks.every(_isTaskDone);
    final earlyRequests = ref.watch(earlyAccessProvider).valueOrNull ??
        const <EarlyAccessRequest>[];
    final pendingRequests = earlyRequests
        .where((item) => item.planId == plan?.id && item.status == 'pending');
    final earlyRequest = pendingRequests.isEmpty ? null : pendingRequests.first;
    return _screen(
        '学习计划',
        ListView(padding: const EdgeInsets.only(bottom: 24), children: [
          Container(
              margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(8)),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      const Expanded(
                          child: Text('本周完成进度',
                              style: TextStyle(
                                  color: _ink,
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600))),
                      Text('$done / ${planTasks.length}',
                          style: const TextStyle(
                              color: _brand,
                              fontSize: 13,
                              fontWeight: FontWeight.w500)),
                      const SizedBox(width: 4),
                      if (widget.allowManualPlanManagement)
                        IconButton(
                          key: const ValueKey('learning-plan-add'),
                          tooltip: '创建计划',
                          onPressed:
                              _mutatingPlan ? null : () => _openPlanEditor(),
                          icon: const Icon(Icons.add, color: _brand, size: 20),
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints.tightFor(
                              width: 32, height: 32),
                        ),
                      if (widget.allowManualPlanManagement && plan != null)
                        PopupMenuButton<String>(
                          key: const ValueKey('learning-plan-actions'),
                          tooltip: 'plan-actions',
                          onSelected: (action) =>
                              _handlePlanAction(action, plan: plan),
                          padding: EdgeInsets.zero,
                          itemBuilder: (context) => [
                            const PopupMenuItem(
                                value: 'edit', child: Text('编辑计划')),
                            if (_planStatus(plan) != 'completed')
                              const PopupMenuItem(
                                  value: 'complete', child: Text('标记为已完成')),
                            if (_planStatus(plan) != 'archived')
                              const PopupMenuItem(
                                  value: 'archive', child: Text('归档计划')),
                            const PopupMenuItem(
                                value: 'delete', child: Text('删除计划')),
                          ],
                          icon: const Icon(Icons.more_horiz,
                              color: _muted, size: 20),
                        )
                    ]),
                    if (plan != null && plans.length > 1) ...[
                      const SizedBox(height: 8),
                      _planSelector(plans, plan),
                    ],
                    const SizedBox(height: 10),
                    LinearProgressIndicator(
                        value: progress,
                        minHeight: 8,
                        backgroundColor: _line,
                        valueColor: const AlwaysStoppedAnimation(_brand)),
                    const SizedBox(height: 8),
                    Text('已完成学习时长 ${(doneMinutes / 60).toStringAsFixed(1)} 小时',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: _muted, fontSize: 11)),
                    if (plan != null && todayDone) ...[
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          key: const ValueKey('learning-plan-early-access'),
                          onPressed:
                              _requestingEarlyAccess || earlyRequest != null
                                  ? null
                                  : () => _requestEarlyAccess(plan),
                          icon: _requestingEarlyAccess
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.rocket_launch_outlined),
                          label:
                              Text(earlyRequest != null ? '提前学习申请审核中' : '提前学习'),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                          earlyRequest != null
                              ? '后台同意后可学习后续内容'
                              : '今日任务已完成，可申请学习后续内容',
                          style: const TextStyle(color: _muted, fontSize: 11)),
                    ],
                  ])),
          if (planTasks.isEmpty)
            _ToolEmptyState(
                action: widget.allowManualPlanManagement
                    ? OutlinedButton.icon(
                        key: const ValueKey('learning-plan-no-task-add'),
                        onPressed:
                            _mutatingPlan ? null : () => _openPlanEditor(),
                        icon: const Icon(Icons.add, size: 16),
                        label: const Text('创建计划'),
                      )
                    : null,
                icon: Icons.checklist_outlined,
                title: '暂无待办任务',
                message: widget.allowManualPlanManagement
                    ? '计划生成任务后会显示在这里。'
                    : '后台发布每日课程后，这里会同步显示任务。')
          else
            _planSection(
                week: plan == null
                    ? planTitle
                    : '${plan.title}（${plan.startDate}–${plan.endDate}）',
                tasks: planTasks
                    .map((task) => _TaskTile(
                          title: task.title,
                          detail:
                              '${_isTaskDone(task) ? '已完成' : task.locked ? '待解锁' : '待完成'} · 截止 ${task.dueDate}',
                          duration: '${task.minutes}分钟',
                          done: _isTaskDone(task),
                          busy: _completingTaskIds.contains(task.id),
                          onTap: _isTaskDone(task) ||
                                  task.locked ||
                                  _completingTaskIds.contains(task.id)
                              ? null
                              : task.contentType != null
                                  ? () async {
                                      await Navigator.push<void>(
                                          context,
                                          MaterialPageRoute(
                                              builder: (_) =>
                                                  LearningTaskScreen(
                                                      task: task)));
                                      if (mounted) {
                                        ref.invalidate(learningTasksProvider);
                                      }
                                    }
                                  : () => _completeRemoteTask(task.id),
                        ))
                    .toList(growable: false)),
        ]));
  }

  Future<void> _requestEarlyAccess(LearningPlan plan) async {
    setState(() => _requestingEarlyAccess = true);
    try {
      await ref.read(courseRepositoryProvider).requestEarlyAccess(plan.id);
      ref.invalidate(earlyAccessProvider);
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('申请已提交，请等待后台审核')));
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_errorMessage(error))));
    } finally {
      if (mounted) setState(() => _requestingEarlyAccess = false);
    }
  }

  List<LearningPlan> _effectivePlans(List<LearningPlan> source) {
    final byId = <String, LearningPlan>{};
    for (final plan in source) {
      if (plan.id.isEmpty || _removedPlanIds.contains(plan.id)) continue;
      byId[plan.id] = _planOverrides[plan.id] ?? plan;
    }
    for (final entry in _planOverrides.entries) {
      if (!_removedPlanIds.contains(entry.key) &&
          !byId.containsKey(entry.key)) {
        byId[entry.key] = entry.value;
      }
    }
    return byId.values.toList(growable: false);
  }

  String _planStatus(LearningPlan plan) =>
      _planOverrides[plan.id]?.status ?? plan.status;

  String _planStatusLabel(LearningPlan plan) => switch (_planStatus(plan)) {
        'completed' => '已完成',
        'archived' => '已归档',
        _ => '进行中',
      };

  LearningPlan? _displayedPlan(List<LearningPlan> plans) {
    if (plans.isEmpty) return null;
    final selectedId = _selectedPlanId;
    if (selectedId != null) {
      for (final plan in plans) {
        if (plan.id == selectedId) return plan;
      }
    }
    for (final plan in plans) {
      if (_planStatus(plan) == 'active') return plan;
    }
    return plans.first;
  }

  Widget _planSelector(List<LearningPlan> plans, LearningPlan selected) =>
      DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          key: const ValueKey('learning-plan-selector'),
          value: selected.id,
          isExpanded: true,
          icon: const Icon(Icons.expand_more, color: _muted, size: 18),
          style: const TextStyle(color: _ink, fontSize: 12),
          onChanged: _mutatingPlan
              ? null
              : (value) {
                  if (value == null || value == selected.id) return;
                  setState(() => _selectedPlanId = value);
                },
          items: plans
              .map((plan) => DropdownMenuItem<String>(
                    value: plan.id,
                    child: Text(
                      '${plan.title} · ${_planStatusLabel(plan)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ))
              .toList(growable: false),
        ),
      );

  bool _isTaskDone(LearningTask task) =>
      task.status == 'done' || _completedRemoteTaskIds.contains(task.id);

  Future<void> _handlePlanAction(String action, {LearningPlan? plan}) async {
    final plans = _effectivePlans(
        ref.read(learningPlansProvider).valueOrNull ?? const []);
    final selected = plan ?? _displayedPlan(plans);
    if (selected == null) return;
    final target = plans.firstWhere((item) => item.id == selected.id,
        orElse: () => selected);
    switch (action) {
      case 'edit':
        await _openPlanEditor(plan: target);
      case 'complete':
        await _setPlanStatus(target, 'completed');
      case 'archive':
        await _setPlanStatus(target, 'archived');
      case 'delete':
        await _confirmDeletePlan(target);
    }
  }

  Future<void> _setPlanStatus(LearningPlan plan, String status) async {
    if (_mutatingPlan) return;
    setState(() => _mutatingPlan = true);
    try {
      final updated = await ref
          .read(courseRepositoryProvider)
          .updatePlan(plan.id, status: status);
      if (!mounted) return;
      setState(() {
        _planOverrides[plan.id] = updated;
        _selectedPlanId = updated.id;
      });
      _invalidatePlans();
    } catch (error) {
      _showPlanError(error);
    } finally {
      if (mounted) setState(() => _mutatingPlan = false);
    }
  }

  Future<void> _openPlanEditor({LearningPlan? plan}) async {
    if (_mutatingPlan) return;
    final draft = await showDialog<_PlanDraft>(
      context: context,
      builder: (dialogContext) => _PlanEditorDialog(plan: plan),
    );
    if (draft == null || !mounted) return;
    setState(() => _mutatingPlan = true);
    try {
      final repository = ref.read(courseRepositoryProvider);
      if (plan == null) {
        final created = await repository.createPlan(
          title: draft.title,
          dailyMinutes: draft.dailyMinutes,
          startDate: draft.startDate,
          endDate: draft.endDate,
        );
        if (!mounted) return;
        setState(() {
          _planOverrides[created.id] = created;
          _selectedPlanId = created.id;
        });
      } else {
        final updated = await repository.updatePlan(
          plan.id,
          title: draft.title,
          dailyMinutes: draft.dailyMinutes,
          startDate: draft.startDate,
          endDate: draft.endDate,
        );
        if (!mounted) return;
        setState(() {
          _planOverrides[plan.id] = updated;
          _selectedPlanId = updated.id;
        });
      }
      _invalidatePlans();
    } catch (error) {
      _showPlanError(error);
    } finally {
      if (mounted) setState(() => _mutatingPlan = false);
    }
  }

  Future<void> _confirmDeletePlan(LearningPlan plan) async {
    if (_mutatingPlan) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('确认删除学习计划？'),
        content: Text('删除“${plan.title}”及其任务？'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('取消')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('删除')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _mutatingPlan = true);
    try {
      await ref.read(courseRepositoryProvider).deletePlan(plan.id);
      if (!mounted) return;
      setState(() {
        _removedPlanIds.add(plan.id);
        _planOverrides.remove(plan.id);
        if (_selectedPlanId == plan.id) _selectedPlanId = null;
      });
      _invalidatePlans();
    } catch (error) {
      _showPlanError(error);
    } finally {
      if (mounted) setState(() => _mutatingPlan = false);
    }
  }

  void _invalidatePlans() {
    ref.invalidate(learningPlansProvider);
    ref.invalidate(learningTasksProvider);
  }

  void _showPlanError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(_errorMessage(error))));
  }

  Future<void> _completeRemoteTask(String id) async {
    if (id.isEmpty || _completingTaskIds.contains(id)) return;
    setState(() => _completingTaskIds.add(id));
    try {
      final completedTask =
          await ref.read(courseRepositoryProvider).completeTask(id);
      if (completedTask.status != 'done') {
        throw const ApiError('INVALID_RESPONSE', '任务完成状态无效，请稍后重试');
      }
      if (!mounted) return;
      setState(() {
        _completingTaskIds.remove(id);
        _completedRemoteTaskIds.add(id);
      });
      ref.invalidate(learningTasksProvider);
      ref.invalidate(learningPlansProvider);
    } catch (error) {
      if (!mounted) return;
      setState(() => _completingTaskIds.remove(id));
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(_errorMessage(error, fallback: '任务完成失败，请重试'))));
    }
  }
}

class _PlanDraft {
  const _PlanDraft({
    required this.title,
    required this.dailyMinutes,
    required this.startDate,
    required this.endDate,
  });

  final String title;
  final int dailyMinutes;
  final String startDate;
  final String endDate;
}

class _PlanEditorDialog extends StatefulWidget {
  const _PlanEditorDialog({this.plan});
  final LearningPlan? plan;

  @override
  State<_PlanEditorDialog> createState() => _PlanEditorDialogState();
}

class _PlanEditorDialogState extends State<_PlanEditorDialog> {
  late final TextEditingController _titleController;
  late final TextEditingController _minutesController;
  late final TextEditingController _startController;
  late final TextEditingController _endController;
  String? _error;

  @override
  void initState() {
    super.initState();
    final plan = widget.plan;
    _titleController = TextEditingController(text: plan?.title ?? '');
    _minutesController =
        TextEditingController(text: '${plan?.dailyMinutes ?? 60}');
    final today = _formatPlanDate(DateTime.now());
    _startController = TextEditingController(
        text: plan?.startDate.isNotEmpty == true ? plan!.startDate : today);
    _endController = TextEditingController(
        text: plan?.endDate.isNotEmpty == true ? plan!.endDate : today);
  }

  @override
  void dispose() {
    _titleController.dispose();
    _minutesController.dispose();
    _startController.dispose();
    _endController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.plan == null ? '创建学习计划' : '编辑学习计划'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
              key: const ValueKey('learning-plan-title-input'),
              controller: _titleController,
              autofocus: widget.plan == null,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: '计划名称'),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('learning-plan-minutes-input'),
              controller: _minutesController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '每日学习时长（分钟）'),
            ),
            const SizedBox(height: 12),
            _dateField('开始日期', _startController),
            const SizedBox(height: 12),
            _dateField('结束日期', _endController),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Align(
                  alignment: Alignment.centerLeft,
                  child: Text(_error!,
                      style: const TextStyle(
                          color: Color(0xFFD2691E), fontSize: 12))),
            ],
          ]),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context), child: const Text('取消')),
          FilledButton(
              key: const ValueKey('learning-plan-save'),
              onPressed: _save,
              child: const Text('保存')),
        ],
      );

  Widget _dateField(String label, TextEditingController controller) =>
      TextField(
        controller: controller,
        readOnly: true,
        onTap: () => _pickDate(controller),
        decoration: InputDecoration(
            labelText: label,
            suffixIcon: const Icon(Icons.calendar_today_outlined, size: 18)),
      );

  Future<void> _pickDate(TextEditingController controller) async {
    final initial = DateTime.tryParse(controller.text) ?? DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (date != null) controller.text = _formatPlanDate(date);
  }

  void _save() {
    final title = _titleController.text.trim();
    final minutes = int.tryParse(_minutesController.text.trim());
    final start = _startController.text.trim();
    final end = _endController.text.trim();
    final startDate = DateTime.tryParse(start);
    final endDate = DateTime.tryParse(end);
    if (title.isEmpty) {
      setState(() => _error = '请输入计划名称');
      return;
    }
    if (minutes == null || minutes < 1 || minutes > 1440) {
      setState(() => _error = '每日时长需在 1 到 1440 分钟之间');
      return;
    }
    if (startDate == null || endDate == null) {
      setState(() => _error = '请选择有效的起止日期');
      return;
    }
    if (endDate.isBefore(startDate)) {
      setState(() => _error = '结束日期不能早于开始日期');
      return;
    }
    Navigator.pop(
        context,
        _PlanDraft(
            title: title,
            dailyMinutes: minutes,
            startDate: _formatPlanDate(startDate),
            endDate: _formatPlanDate(endDate)));
  }
}

String _formatPlanDate(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

class _TaskTile extends StatelessWidget {
  const _TaskTile(
      {required this.title,
      required this.detail,
      required this.duration,
      required this.done,
      this.busy = false,
      this.onTap});
  final String title, detail, duration;
  final bool done;
  final bool busy;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 70,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(
                width: 18,
                height: 18,
                child: busy
                    ? CircularProgressIndicator(
                        key: ValueKey('learning-plan-task-busy-$title'),
                        strokeWidth: 2,
                        color: _brand,
                      )
                    : Icon(
                        done
                            ? Icons.check_circle_outline
                            : Icons.circle_outlined,
                        key: ValueKey('learning-plan-task-status-$title'),
                        color: done
                            ? const Color(0xFF3A7A46)
                            : const Color(0xFFC0C5D0),
                        size: 18),
              ),
              const SizedBox(width: 12),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text(title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            color: done ? _muted : _ink,
                            fontSize: 14,
                            height: 20 / 14,
                            fontWeight: FontWeight.w500,
                            decoration:
                                done ? TextDecoration.lineThrough : null)),
                    Text(detail,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: _muted, fontSize: 12, height: 17 / 12)),
                  ])),
              const SizedBox(width: 8),
              Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.access_time_outlined,
                    color: Color(0xFFC0C5D0), size: 11),
                const SizedBox(width: 2),
                Text(duration,
                    style: const TextStyle(color: _muted, fontSize: 11)),
              ]),
            ]),
          ),
        ),
      );
}

class LegacyLearningReportScreen extends StatelessWidget {
  const LegacyLearningReportScreen({super.key});
  @override
  Widget build(BuildContext context) => _screen(
      '学习报告',
      ListView(padding: const EdgeInsets.all(16), children: [
        Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
                color: Colors.white, borderRadius: BorderRadius.circular(8)),
            child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('本周学习概览',
                      style: TextStyle(
                          color: _ink,
                          fontSize: 15,
                          fontWeight: FontWeight.w700)),
                  SizedBox(height: 16),
                  Row(children: [
                    Expanded(child: _Metric('4.2h', '学习时长')),
                    Expanded(child: _Metric('86', '完成题数')),
                    Expanded(child: _Metric('78%', '正确率'))
                  ]),
                  SizedBox(height: 18),
                  LinearProgressIndicator(
                      value: .7,
                      minHeight: 7,
                      borderRadius: BorderRadius.all(Radius.circular(4)),
                      backgroundColor: _line,
                      valueColor: AlwaysStoppedAnimation(_brand)),
                  SizedBox(height: 7),
                  Text('较上周提升 18%',
                      style: TextStyle(color: Color(0xFF3A7A46), fontSize: 12))
                ])),
        const SizedBox(height: 14),
        const Text('科目表现',
            style: TextStyle(
                color: _ink, fontSize: 15, fontWeight: FontWeight.w700)),
        const SizedBox(height: 9),
        ...const [
          ('民法', .86, Color(0xFF4C4BEA)),
          ('刑法', .74, Color(0xFFD2691E)),
          ('民诉法', .58, Color(0xFF1A8B8B)),
          ('行政法', .69, Color(0xFF1A5FA8))
        ].map((item) => _SubjectMetric(item.$1, item.$2, item.$3)),
        const SizedBox(height: 8),
        Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
                color: const Color(0xFFFFF5DD),
                borderRadius: BorderRadius.circular(8)),
            child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.lightbulb_outline,
                      color: Color(0xFFA87000), size: 19),
                  SizedBox(width: 8),
                  Expanded(
                      child: Text('建议下周优先复习民事诉讼法，并完成 28 道错题订正。',
                          style: TextStyle(
                              color: _body, fontSize: 12, height: 1.5)))
                ])),
      ]));
}

class _Metric extends StatelessWidget {
  const _Metric(this.value, this.label);
  final String value, label;
  @override
  Widget build(BuildContext context) => Column(children: [
        Text(value,
            style: const TextStyle(
                color: _brand, fontSize: 20, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: _muted, fontSize: 11))
      ]);
}

class _SubjectMetric extends StatelessWidget {
  const _SubjectMetric(this.name, this.progress, this.color);
  final String name;
  final double progress;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
      margin: const EdgeInsets.only(bottom: 9),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(8)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(name, style: const TextStyle(color: _body, fontSize: 13)),
          const Spacer(),
          Text('${(progress * 100).round()}%',
              style: TextStyle(
                  color: color, fontSize: 13, fontWeight: FontWeight.w700))
        ]),
        const SizedBox(height: 7),
        LinearProgressIndicator(
            value: progress,
            minHeight: 5,
            borderRadius: const BorderRadius.all(Radius.circular(3)),
            backgroundColor: _line,
            valueColor: AlwaysStoppedAnimation(color))
      ]));
}

class QuestionRecordsScreen extends StatelessWidget {
  const QuestionRecordsScreen(
      {super.key, this.remoteEnabled = remoteDataDefault});
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) =>
      ProviderScope(child: _QuestionRecordsBody(remoteEnabled: remoteEnabled));
}

class _QuestionRecordsLegacyBody extends ConsumerWidget {
  const _QuestionRecordsLegacyBody({required this.remoteEnabled});
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!remoteEnabled) {
      return _screen('做题记录', _localRecordsBody(context));
    }

    final state = ref.watch(typedQuestionRecordsProvider);
    if (state.isLoading) {
      return _screen('做题记录', const _ToolLoadingState(label: '正在加载做题记录…'));
    }
    if (state.hasError) {
      return _screen(
          '做题记录',
          _ToolErrorState(
              error: state.error!,
              onRetry: () => ref.invalidate(typedQuestionRecordsProvider)));
    }
    final records = state.value
            ?.map(_RecordItem.fromModel)
            .where((item) => item.id.isNotEmpty)
            .toList(growable: false) ??
        const <_RecordItem>[];
    if (records.isEmpty) {
      return _screen(
          '做题记录',
          const _ToolEmptyState(
              icon: Icons.assignment_outlined,
              title: '暂无做题记录',
              message: '完成一次练习后，记录会显示在这里。'));
    }
    return _screen('做题记录', _recordsBody(context, records));
  }

  Widget _localRecordsBody(BuildContext context) => ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          Container(
              height: 76,
              margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(8)),
              child: const Row(children: [
                Expanded(child: _RecordSummaryMetric('2,847', '累计做题')),
                SizedBox(
                    height: 44, child: VerticalDivider(width: 1, color: _line)),
                Expanded(child: _RecordSummaryMetric('68%', '正确率')),
              ])),
          Container(
              margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(8)),
              child: Column(children: [
                _RcRecordRow(
                    mode: '章节练习',
                    date: '今天',
                    time: '21:05',
                    title: '民法·物权法',
                    count: 20,
                    correct: 15,
                    onTap: () => _openLocalReport(context, const [0, 1, 0, 2])),
                _RcRecordRow(
                    mode: '历年真题',
                    date: '昨天',
                    time: '20:30',
                    title: '2023年卷一',
                    count: 50,
                    correct: 36,
                    onTap: () => _openLocalReport(context, const [1, 1, 2, 0])),
                _RcRecordRow(
                    mode: '章节练习',
                    date: '8月24日',
                    time: '19:15',
                    title: '刑法·总论',
                    count: 15,
                    correct: 12,
                    onTap: () => _openLocalReport(context, const [2, 0, 1, 1])),
                _RcRecordRow(
                    mode: '章节练习',
                    date: '8月23日',
                    time: '21:40',
                    title: '民法·合同法',
                    count: 25,
                    correct: 17,
                    showDivider: false,
                    onTap: () => _openLocalReport(context, const [0, 2, 1, 1])),
              ])),
        ],
      );

  void _openLocalReport(BuildContext context, List<int?> answers) {
    Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ObjectiveReportScreen(
              answers: answers,
              title: '答题报告',
              demoFixture: true,
            )));
  }

  Widget _recordsBody(BuildContext context, List<_RecordItem> records) {
    final answered = records.fold<int>(0, (sum, item) => sum + item.count);
    final correct = records.fold<int>(0, (sum, item) => sum + item.correct);
    final rate = answered == 0 ? 0 : ((correct / answered) * 100).round();
    return ListView(padding: const EdgeInsets.all(16), children: [
      _SummaryRowData(answered: answered, correctRate: rate),
      const SizedBox(height: 14),
      const Text('最近练习',
          style: TextStyle(
              color: _ink, fontSize: 15, fontWeight: FontWeight.w700)),
      const SizedBox(height: 9),
      ...records.map((item) => _RemoteRecord(
            item,
            onOpen: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => QuestionRecordDetailScreen(
                      recordId: item.submissionId ?? item.id,
                      questionId: item.questionId,
                      title: item.title,
                      remoteEnabled: true,
                    ))),
          )),
    ]);
  }
}

class _QuestionRecordsBody extends ConsumerStatefulWidget {
  const _QuestionRecordsBody({required this.remoteEnabled});

  final bool remoteEnabled;

  @override
  ConsumerState<_QuestionRecordsBody> createState() => _QuestionRecordsState();
}

class _QuestionRecordsState extends ConsumerState<_QuestionRecordsBody> {
  static const _pageSize = 20;

  String? _subjectId;
  String? _mode;
  int _page = 1;
  int _total = 0;
  int _answered = 0;
  int _correct = 0;
  int _requestVersion = 0;
  bool _loading = true;
  bool _loadingMore = false;
  bool _loaded = false;
  Object? _error;
  Object? _loadMoreError;
  List<QuestionRecord> _records = const [];

  QuestionRecordQuery get _query => QuestionRecordQuery(
        page: 1,
        pageSize: _pageSize,
        subjectId: _subjectId,
        mode: _mode,
      );

  @override
  void initState() {
    super.initState();
    if (widget.remoteEnabled) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
    } else {
      _loading = false;
      _loaded = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.remoteEnabled) {
      return const _QuestionRecordsLegacyBody(remoteEnabled: false);
    }

    final subjects =
        ref.watch(subjectsProvider).valueOrNull ?? const <Subject>[];
    if (_loading && !_loaded) {
      return _screen(
          '\u505a\u9898\u8bb0\u5f55',
          const _ToolLoadingState(
              label: '\u6b63\u5728\u52a0\u8f7d\u505a\u9898\u8bb0\u5f55\u2026'));
    }
    if (_error != null && _records.isEmpty) {
      return _screen('\u505a\u9898\u8bb0\u5f55',
          _ToolErrorState(error: _error!, onRetry: _reload));
    }
    final items = _records
        .map(_RecordItem.fromModel)
        .where((item) => item.id.isNotEmpty)
        .toList(growable: false);
    return _screen(
        '\u505a\u9898\u8bb0\u5f55', _recordsBody(context, subjects, items));
  }

  Future<void> _reload() async {
    if (!mounted) return;
    final requestVersion = ++_requestVersion;
    final query = _query;
    setState(() {
      _loading = true;
      _loaded = false;
      _error = null;
      _loadMoreError = null;
      _page = 1;
      _total = 0;
      _answered = 0;
      _correct = 0;
      _records = const [];
    });
    try {
      ref.invalidate(questionRecordPageProvider(query));
      final page = await ref.read(questionRecordPageProvider(query).future);
      if (!mounted || requestVersion != _requestVersion) return;
      setState(() {
        _records = page.items;
        _page = page.page;
        _total = page.total;
        _answered = page.answered;
        _correct = page.correct;
        _loading = false;
        _loaded = true;
      });
    } catch (error) {
      if (!mounted || requestVersion != _requestVersion) return;
      setState(() {
        _loading = false;
        _loaded = true;
        _error = error;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore) return;
    final requestVersion = _requestVersion;
    final nextPage = _page + 1;
    setState(() {
      _loadingMore = true;
      _loadMoreError = null;
    });
    try {
      final page = await ref.read(questionRepositoryProvider).recordPage(
            page: nextPage,
            pageSize: _pageSize,
            subjectId: _subjectId,
            mode: _mode,
          );
      if (!mounted || requestVersion != _requestVersion) return;
      setState(() {
        _records = [..._records, ...page.items];
        _page = page.page;
        _total = page.total;
        _answered = page.answered;
        _correct = page.correct;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted || requestVersion != _requestVersion) return;
      setState(() {
        _loadingMore = false;
        _loadMoreError = error;
      });
    }
  }

  bool get _hasMore => _records.length < _total;

  void _changeFilter({String? subjectId, String? mode}) {
    if (_subjectId == subjectId && _mode == mode) return;
    setState(() {
      _subjectId = subjectId;
      _mode = mode;
    });
    _reload();
  }

  Widget _recordsBody(
      BuildContext context, List<Subject> subjects, List<_RecordItem> items) {
    final rate = _answered == 0 ? 0 : ((_correct / _answered) * 100).round();
    return ListView(padding: const EdgeInsets.all(16), children: [
      _recordFilters(subjects),
      const SizedBox(height: 12),
      _SummaryRowData(answered: _answered, correctRate: rate),
      const SizedBox(height: 14),
      const Text('\u6700\u8fd1\u7ec3\u4e60',
          style: TextStyle(
              color: _ink, fontSize: 15, fontWeight: FontWeight.w700)),
      const SizedBox(height: 9),
      if (items.isEmpty)
        const _ToolEmptyState(
            icon: Icons.assignment_outlined,
            title: '\u6682\u65e0\u505a\u9898\u8bb0\u5f55',
            message:
                '\u5b8c\u6210\u4e00\u6b21\u7ec3\u4e60\u540e\uff0c\u8bb0\u5f55\u4f1a\u663e\u793a\u5728\u8fd9\u91cc\u3002')
      else ...[
        ...items.map((item) => _RemoteRecord(
              item,
              onOpen: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => QuestionRecordDetailScreen(
                        recordId: item.submissionId ?? item.id,
                        questionId: item.questionId,
                        title: item.title,
                        remoteEnabled: true,
                      ))),
            )),
        if (_loadMoreError != null)
          Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 8),
            child: _InlineRetry(
                message: '\u66f4\u591a\u8bb0\u5f55\u52a0\u8f7d\u5931\u8d25',
                onRetry: _loadMore),
          )
        else if (_hasMore)
          Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 8),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _loadingMore ? null : _loadMore,
                icon: _loadingMore
                    ? const SizedBox(
                        width: 15,
                        height: 15,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.expand_more),
                label: Text(_loadingMore
                    ? '\u6b63\u5728\u52a0\u8f7d\u2026'
                    : '\u52a0\u8f7d\u66f4\u591a'),
              ),
            ),
          )
        else
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Center(
                child: Text('\u5df2\u52a0\u8f7d\u5168\u90e8\u8bb0\u5f55',
                    style: TextStyle(color: _muted, fontSize: 11))),
          ),
      ],
    ]);
  }

  Widget _recordFilters(List<Subject> subjects) {
    final selectedSubject = subjects
        .where((subject) => subject.id == _subjectId)
        .map((subject) => subject.name)
        .toList(growable: false);
    final subjectLabel =
        selectedSubject.isEmpty ? '全部科目' : selectedSubject.first;
    final modeLabel = switch (_mode) {
      'objective' => '客观题',
      'subjective' => '主观题',
      _ => '全部模式',
    };
    final active = _subjectId != null || _mode != null;

    Widget dropdown({
      required Key key,
      required String label,
      required String value,
      required List<DropdownMenuItem<String>> items,
      required ValueChanged<String?> onChanged,
    }) =>
        DropdownButtonFormField<String>(
          key: key,
          initialValue: value,
          isExpanded: true,
          menuMaxHeight: 360,
          itemHeight: 48,
          icon: const Icon(Icons.keyboard_arrow_down_rounded),
          decoration: InputDecoration(
            labelText: label,
            filled: true,
            fillColor: Colors.white,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: _line)),
            enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: _line)),
            focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: _brand, width: 1.5)),
          ),
          items: items,
          onChanged: onChanged,
        );

    final subjectItems = <DropdownMenuItem<String>>[
      const DropdownMenuItem<String>(
          value: '', child: Text('全部科目', overflow: TextOverflow.ellipsis)),
      ...subjects.map((subject) => DropdownMenuItem<String>(
            value: subject.id,
            child: Text(subject.name, overflow: TextOverflow.ellipsis),
          )),
    ];
    final modeItems = const <DropdownMenuItem<String>>[
      DropdownMenuItem<String>(
          value: '', child: Text('全部模式', overflow: TextOverflow.ellipsis)),
      DropdownMenuItem<String>(value: 'objective', child: Text('客观题')),
      DropdownMenuItem<String>(value: 'subjective', child: Text('主观题')),
    ];

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      LayoutBuilder(builder: (context, constraints) {
        final narrow = constraints.maxWidth < 420;
        final subject = dropdown(
          key: const ValueKey('question-record-subject-filter'),
          label: '科目 · $subjectLabel',
          value: _subjectId ?? '',
          items: subjectItems,
          onChanged: (value) => _changeFilter(
              subjectId: value == null || value.isEmpty ? null : value,
              mode: _mode),
        );
        final mode = dropdown(
          key: const ValueKey('question-record-mode-filter'),
          label: '模式 · $modeLabel',
          value: _mode ?? '',
          items: modeItems,
          onChanged: (value) => _changeFilter(
              subjectId: _subjectId,
              mode: value == null || value.isEmpty ? null : value),
        );
        if (narrow) {
          return Column(children: [subject, const SizedBox(height: 10), mode]);
        }
        return Row(children: [
          Expanded(child: subject),
          const SizedBox(width: 10),
          Expanded(child: mode),
        ]);
      }),
      if (active) ...[
        const SizedBox(height: 8),
        Row(children: [
          const Icon(Icons.filter_alt_outlined, size: 14, color: _brand),
          const SizedBox(width: 4),
          Expanded(
              child: Text('当前筛选：$subjectLabel · $modeLabel',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: _body, fontSize: 12))),
          TextButton(
              key: const ValueKey('question-record-clear-filters'),
              onPressed: () => _changeFilter(),
              child: const Text('清除筛选')),
        ]),
      ],
    ]);
  }
}

class _InlineRetry extends StatelessWidget {
  const _InlineRetry({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(message, style: const TextStyle(color: _muted, fontSize: 11)),
          const SizedBox(width: 8),
          TextButton(onPressed: onRetry, child: const Text('\u91cd\u8bd5')),
        ],
      );
}

class _RecordItem {
  const _RecordItem({
    required this.id,
    required this.questionId,
    required this.date,
    required this.time,
    required this.mode,
    required this.title,
    required this.count,
    required this.correct,
    this.submissionId,
  });

  final String id;
  final String questionId;
  final String date;
  final String time;
  final String mode;
  final String title;
  final int count;
  final int correct;
  final String? submissionId;

  factory _RecordItem.fromModel(QuestionRecord record) => _RecordItem(
        id: record.id,
        questionId: record.questionId,
        date: _formatDate(record.createdAt),
        time: _formatTime(record.createdAt),
        mode: record.mode == 'subjective' ||
                record.questionId.startsWith('subjective-')
            ? '主观题'
            : '客观题',
        title: record.title?.trim().isNotEmpty == true
            ? record.title!
            : '题目 ${record.questionId}',
        count: record.total ?? 1,
        correct: record.correctCount ?? (record.correct ? 1 : 0),
        submissionId: record.id,
      );
}

String _formatDate(String value) {
  final parsed = DateTime.tryParse(value)?.toLocal();
  return parsed == null ? value : '${parsed.month}月${parsed.day}日';
}

String _formatTime(String value) {
  final parsed = DateTime.tryParse(value)?.toLocal();
  return parsed == null
      ? ''
      : '${parsed.hour.toString().padLeft(2, '0')}:${parsed.minute.toString().padLeft(2, '0')}';
}

class _SummaryRowData extends StatelessWidget {
  const _SummaryRowData({required this.answered, required this.correctRate});
  final int answered;
  final int correctRate;

  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(8)),
      child: Row(children: [
        Expanded(child: _Metric('$answered', '累计题数')),
        Expanded(child: _Metric('$correctRate%', '平均正确率')),
        const Expanded(child: _Metric('—', '累计用时')),
      ]));
}

class _RemoteRecord extends StatelessWidget {
  const _RemoteRecord(this.item, {required this.onOpen});
  final _RecordItem item;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final rate =
        item.count == 0 ? 0 : ((item.correct / item.count) * 100).round();
    return Container(
        margin: const EdgeInsets.only(bottom: 9),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(8)),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onOpen,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(children: [
                Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                        color: const Color(0xFFF0F0FF),
                        borderRadius: BorderRadius.circular(8)),
                    child: const Icon(Icons.assignment_outlined,
                        color: _brand, size: 19)),
                const SizedBox(width: 10),
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Row(children: [
                        Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                                color: _page,
                                borderRadius: BorderRadius.circular(4)),
                            child: Text(item.mode,
                                style: const TextStyle(
                                    color: _muted, fontSize: 10))),
                        const SizedBox(width: 6),
                        Text('${item.date} ${item.time}',
                            style:
                                const TextStyle(color: _muted, fontSize: 10)),
                      ]),
                      const SizedBox(height: 4),
                      Text(item.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: _ink,
                              fontSize: 13,
                              fontWeight: FontWeight.w600)),
                      const SizedBox(height: 3),
                      Text('${item.count}题 · 正确${item.correct}题 · 正确率 $rate%',
                          style: TextStyle(
                              color:
                                  rate >= 70 ? const Color(0xFF3A7A46) : _muted,
                              fontSize: 11)),
                    ])),
                const SizedBox(width: 8),
                const Icon(Icons.chevron_right, color: _muted, size: 18),
              ]),
            ),
          ),
        ));
  }
}

/// Loads the server-side report for one objective submission. The list page
/// only contains a compact activity row; this screen resolves the original
/// question before handing the result to the shared RC report renderer.
class QuestionRecordDetailScreen extends StatelessWidget {
  const QuestionRecordDetailScreen({
    super.key,
    required this.recordId,
    required this.questionId,
    required this.title,
    this.remoteEnabled = true,
  });

  final String recordId;
  final String questionId;
  final String title;
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) => ProviderScope(
        child: _QuestionRecordDetailBody(
          recordId: recordId,
          questionId: questionId,
          title: title,
          remoteEnabled: remoteEnabled,
        ),
      );
}

class _QuestionRecordDetailBody extends ConsumerWidget {
  const _QuestionRecordDetailBody({
    required this.recordId,
    required this.questionId,
    required this.title,
    required this.remoteEnabled,
  });

  final String recordId;
  final String questionId;
  final String title;
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!remoteEnabled) {
      return ObjectiveReportScreen(
        answers: const <int?>[0, 1, 0, 2],
        title: title.isEmpty ? '答题报告' : title,
        demoFixture: true,
      );
    }
    if (recordId.trim().isEmpty) {
      return _screen(
          '做题记录详情',
          const _ToolEmptyState(
              icon: Icons.link_off_outlined,
              title: '记录编号缺失',
              message: '请从做题记录列表重新打开该记录。'));
    }
    final reportState = ref.watch(questionRecordReportProvider(recordId));
    final questionState = ref.watch(questionProvider(questionId));
    if (reportState.isLoading && !reportState.hasValue) {
      return _screen('做题记录详情', const _ToolLoadingState(label: '正在加载答题详情…'));
    }
    if (reportState.hasError && !reportState.hasValue) {
      return _screen(
          '做题记录详情',
          _ToolErrorState(
              error: reportState.error!,
              onRetry: () =>
                  ref.invalidate(questionRecordReportProvider(recordId))));
    }
    final report = reportState.valueOrNull;
    if (report == null || report.isEmpty) {
      return _screen(
          '做题记录详情',
          const _ToolEmptyState(
              icon: Icons.assignment_outlined,
              title: '暂无答题详情',
              message: '该记录的答题报告暂时不可用。'));
    }

    // A record remains useful when the question was later archived or
    // revised. The report endpoint stores an immutable snapshot, so prefer
    // those fields and only fall back to the current question for legacy
    // records that predate the snapshot contract.
    final question = questionState.valueOrNull;
    final selectedAnswers = _parseRecordIndexes(report['answers']);
    final snapshotOptions = _parseRecordStrings(report['options']);
    final snapshotCorrectAnswers =
        _parseRecordIndexes(report['correctAnswers']);
    final correctAnswers = snapshotCorrectAnswers.isNotEmpty
        ? snapshotCorrectAnswers
        : question == null
            ? const <int>[]
            : question.answerIndexes.isNotEmpty
                ? question.answerIndexes
                : question.answer == null
                    ? const <int>[]
                    : [question.answer!];
    final snapshotStem = '${report['stem'] ?? ''}'.trim();
    final snapshotAnalysis = '${report['analysis'] ?? ''}'.trim();
    final reportTitle =
        snapshotStem.isNotEmpty ? snapshotStem : question?.stem ?? title;
    final reportOptions = snapshotOptions.isNotEmpty
        ? snapshotOptions
        : question?.options ?? const <String>[];
    final reportItem = ObjectiveReportItem(
      id: '${report['questionId'] ?? questionId}',
      title: reportTitle,
      selectedAnswer: selectedAnswers.isEmpty ? null : selectedAnswers.first,
      correctAnswer: correctAnswers.isEmpty ? null : correctAnswers.first,
      selectedAnswers: selectedAnswers,
      correctAnswers: correctAnswers,
      correct: report['correct'] == true,
      analysis:
          snapshotAnalysis.isNotEmpty ? snapshotAnalysis : question?.analysis,
      options: reportOptions,
      submissionId: recordId,
    );
    return ObjectiveReportScreen(
      answers: selectedAnswers.isEmpty
          ? const <int?>[null]
          : [selectedAnswers.first],
      results: [reportItem],
      remoteEnabled: true,
      title: title.isEmpty ? '答题报告' : title,
    );
  }
}

List<int> _parseRecordIndexes(dynamic value) {
  if (value is! List) return const <int>[];
  return value
      .map((item) {
        final parsed = int.tryParse('$item');
        if (parsed != null) return parsed;
        if (item is String && item.length == 1) {
          final code = item.toUpperCase().codeUnitAt(0);
          if (code >= 65 && code <= 90) return code - 65;
        }
        return null;
      })
      .whereType<int>()
      .toList(growable: false);
}

List<String> _parseRecordStrings(dynamic value) {
  if (value is! List) return const <String>[];
  return value
      .map((item) => '$item'.trim())
      .where((item) => item.isNotEmpty)
      .toList(growable: false);
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow();
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(8)),
      child: const Row(children: [
        Expanded(child: _Metric('128', '累计题数')),
        Expanded(child: _Metric('78%', '平均正确率')),
        Expanded(child: _Metric('12.5h', '累计用时'))
      ]));
}

class _RecordSummaryMetric extends StatelessWidget {
  const _RecordSummaryMetric(this.value, this.label);

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(value,
              style: const TextStyle(
                  color: _brand,
                  fontSize: 20,
                  height: 25 / 20,
                  fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(label,
              style: const TextStyle(
                  color: _muted, fontSize: 11, height: 15 / 11)),
        ],
      );
}

class _RcRecordRow extends StatelessWidget {
  const _RcRecordRow({
    required this.mode,
    required this.date,
    required this.time,
    required this.title,
    required this.count,
    required this.correct,
    required this.onTap,
    this.showDivider = true,
  });

  final String mode;
  final String date;
  final String time;
  final String title;
  final int count;
  final int correct;
  final VoidCallback onTap;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final rate = count == 0 ? 0 : ((correct / count) * 100).round();
    final rateColor = rate >= 70 ? const Color(0xFF5DA765) : _errorColor;
    return Material(
        color: Colors.transparent,
        child: InkWell(
            key: ValueKey('local-record-$title'),
            onTap: onTap,
            child: Container(
                constraints: const BoxConstraints(minHeight: 94),
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                decoration: BoxDecoration(
                    border: showDivider
                        ? const Border(
                            bottom: BorderSide(color: _line, width: 1))
                        : null),
                child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                            Row(children: [
                              Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                      color: _page,
                                      borderRadius: BorderRadius.circular(4)),
                                  child: Text(mode,
                                      style: const TextStyle(
                                          color: _muted,
                                          fontSize: 11,
                                          height: 15 / 11))),
                              const SizedBox(width: 6),
                              Text('$date $time',
                                  style: const TextStyle(
                                      color: _muted,
                                      fontSize: 11,
                                      height: 15 / 11)),
                            ]),
                            const SizedBox(height: 4),
                            Text(title,
                                style: const TextStyle(
                                    color: _ink,
                                    fontSize: 14,
                                    height: 19 / 14,
                                    fontWeight: FontWeight.w600)),
                            const SizedBox(height: 2),
                            Text.rich(TextSpan(children: [
                              TextSpan(
                                  text: '$count题 · 正确$correct题 · 正确率',
                                  style: const TextStyle(
                                      color: _muted,
                                      fontSize: 12,
                                      height: 17 / 12)),
                              TextSpan(
                                  text: '$rate%',
                                  style: TextStyle(
                                      color: rateColor,
                                      fontSize: 12,
                                      height: 17 / 12,
                                      fontWeight: FontWeight.w500)),
                            ])),
                          ])),
                      const SizedBox(width: 12),
                      const Icon(Icons.chevron_right,
                          color: Color(0xFFC0C5D0), size: 16),
                    ]))));
  }
}

class _Record extends StatelessWidget {
  const _Record(this.title, this.meta, this.time, {this.onTap});
  final String title, meta, time;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final content = Container(
        margin: const EdgeInsets.only(bottom: 9),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(8)),
        child: Row(children: [
          Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                  color: const Color(0xFFF0F0FF),
                  borderRadius: BorderRadius.circular(8)),
              child: const Icon(Icons.assignment_outlined,
                  color: _brand, size: 19)),
          const SizedBox(width: 10),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(title,
                    style: const TextStyle(
                        color: _ink,
                        fontSize: 13,
                        fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text(meta, style: const TextStyle(color: _muted, fontSize: 11))
              ])),
          Text(time, style: const TextStyle(color: _muted, fontSize: 11)),
          if (onTap != null) ...[
            const SizedBox(width: 6),
            const Icon(Icons.chevron_right, color: _muted, size: 18),
          ],
        ]));
    if (onTap == null) return content;
    return Material(
        color: Colors.transparent,
        child: InkWell(
            key: ValueKey('local-record-$title'),
            onTap: onTap,
            borderRadius: BorderRadius.circular(8),
            child: content));
  }
}

class MistakeBookScreen extends StatelessWidget {
  const MistakeBookScreen({super.key, this.remoteEnabled = remoteDataDefault});
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) => ProviderScope(
        child: _MistakeBookBody(remoteEnabled: remoteEnabled),
      );
}

class _MistakeBookBody extends ConsumerStatefulWidget {
  const _MistakeBookBody({required this.remoteEnabled});
  final bool remoteEnabled;

  @override
  ConsumerState<_MistakeBookBody> createState() => _MistakeBookScreenState();
}

class _MistakeBookScreenState extends ConsumerState<_MistakeBookBody> {
  String filter = '全部';
  static const localMistakes = <({
    String id,
    String subject,
    String year,
    String stem,
    String userAnswer,
    String answer,
    int wrongCount,
  })>[
    (
      id: 'oq1',
      subject: '民法',
      year: '2023',
      stem:
          '甲公司（出卖人）与乙公司（买受人）签订买卖合同，约定甲以分期付款方式向乙出售一批货物，乙未按期付款超过合同金额五分之一后，甲主张解除合同。关于甲的主张，下列说法正确的是：',
      userAnswer: 'B',
      answer: 'D',
      wrongCount: 2,
    ),
    (
      id: 'oq2',
      subject: '民法',
      year: '2023',
      stem:
          '甲于2020年1月将一幅名画借给乙展览，约定展览结束后归还。乙展览结束后，将名画转卖给不知情的丙，丙支付合理对价并取得名画。甲于2023年6月发现后，向法院起诉要求丙返还名画。下列说法正确的是：',
      userAnswer: 'C',
      answer: 'A',
      wrongCount: 1,
    ),
    (
      id: 'oq3',
      subject: '民法',
      year: '2022',
      stem: '关于诉讼时效的适用，下列说法错误的是：',
      userAnswer: 'B',
      answer: 'A',
      wrongCount: 3,
    ),
  ];
  @override
  Widget build(BuildContext context) {
    if (widget.remoteEnabled) {
      final remote = ref.watch(typedMistakesProvider);
      if (remote.isLoading && !remote.hasValue) {
        return _screen('错题本', const _ToolLoadingState(label: '正在加载错题…'));
      }
      if (remote.hasError && !remote.hasValue) {
        return _screen(
            '错题本',
            _ToolErrorState(
                error: remote.error!,
                onRetry: () => ref.invalidate(typedMistakesProvider)));
      }
      final remoteItems = remote.valueOrNull ?? const <MistakeItem>[];
      if (remoteItems.isEmpty) {
        return _screen(
            '错题本',
            const _ToolEmptyState(
                icon: Icons.error_outline,
                title: '暂无错题',
                message: '完成练习后，错题会自动收录在这里。'));
      }
      return _remoteMistakeBody(remoteItems);
    }
    return _localMistakeBody();
  }

  Widget _localMistakeBody() {
    final subjects = ['全部', '民法', '刑法', '行政法', '民事诉讼法', '刑事诉讼法'];
    final visible = filter == '全部'
        ? localMistakes
        : localMistakes.where((item) => item.subject == filter).toList();
    return _screen(
        '错题本',
        Column(children: [
          Container(
              height: 43,
              color: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
              child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: subjects.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, index) {
                    final value = subjects[index];
                    return ChoiceChip(
                        label: Text(value),
                        selected: filter == value,
                        selectedColor: _brand,
                        labelStyle: TextStyle(
                            color: filter == value ? Colors.white : _body,
                            fontSize: 12),
                        showCheckmark: false,
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        visualDensity:
                            const VisualDensity(horizontal: -2, vertical: -2),
                        onSelected: (_) => setState(() => filter = value));
                  })),
          Expanded(
              child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  children: [
                SizedBox(
                    height: 39,
                    child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('共 ${visible.length} 道错题待复习',
                              style:
                                  const TextStyle(color: _muted, fontSize: 12)),
                          Row(mainAxisSize: MainAxisSize.min, children: [
                            const Icon(Icons.refresh, size: 14, color: _brand),
                            const SizedBox(width: 3),
                            const Text('一键重做',
                                style: TextStyle(color: _brand, fontSize: 12)),
                          ])
                        ])),
                if (visible.isEmpty)
                  const _ToolEmptyState(
                      icon: Icons.filter_alt_off_outlined,
                      title: '暂无符合条件的错题',
                      message: '请调整科目筛选后重试。')
                else
                  ...visible.map((item) => _LocalMistakeCard(
                        item: item,
                        onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: (_) => const ObjectiveAnswerScreen(
                                    title: '错题复习'))),
                      )),
              ])),
        ]));
  }

  Widget _remoteMistakeBody(List<MistakeItem> remoteItems) {
    final visible = filter == '全部'
        ? remoteItems
        : remoteItems
            .where((item) => _subjectForQuestion(item.question) == filter)
            .toList();
    final subjects = ['全部', '民法', '刑法', '诉讼法'];
    return _screen(
        '错题本',
        ListView(padding: const EdgeInsets.all(16), children: [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text('共 ${visible.length} 道错题待复习',
                style: const TextStyle(color: _muted, fontSize: 12)),
            TextButton.icon(
                onPressed: visible.isEmpty
                    ? null
                    : () => Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) => ObjectiveAnswerScreen(
                                  title: '错题重做',
                                  remoteEnabled: true,
                                  mode: 'random',
                                  subjectId: visible.first.question?.subjectId,
                                  questionIds: visible
                                      .map((item) => item.questionId)
                                      .where((id) => id.isNotEmpty)
                                      .toList(growable: false),
                                  limit: visible.length,
                                ))),
                icon: const Icon(Icons.refresh, size: 14),
                label: const Text('一键重做'),
                style: TextButton.styleFrom(
                    foregroundColor: _brand, padding: EdgeInsets.zero))
          ]),
          const SizedBox(height: 4),
          SizedBox(
              height: 38,
              child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: subjects.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, index) {
                    final value = subjects[index];
                    return ChoiceChip(
                        label: Text(value),
                        selected: filter == value,
                        selectedColor: _brand,
                        labelStyle: TextStyle(
                            color: filter == value ? Colors.white : _body),
                        showCheckmark: false,
                        onSelected: (_) => setState(() => filter = value));
                  })),
          const SizedBox(height: 12),
          if (visible.isEmpty)
            const _ToolEmptyState(
                icon: Icons.filter_alt_off_outlined,
                title: '暂无符合条件的错题',
                message: '请调整科目筛选后重试。')
          else
            ...visible.map((item) => _RemovableItem(
                icon: Icons.error_outline,
                color: const Color(0xFFD2691E),
                text: item.question?.stem ?? item.questionId,
                onRemove: () => _resolveRemoteMistake(item))),
        ]));
  }

  String _subjectForQuestion(Question? question) {
    final stem = question?.stem ?? '';
    if (stem.contains('刑') || stem.contains('犯罪')) return '刑法';
    if (stem.contains('诉讼') || stem.contains('时效')) return '诉讼法';
    return '民法';
  }

  Future<void> _resolveRemoteMistake(MistakeItem item) async {
    try {
      await ref.read(questionRepositoryProvider).resolveMistake(item.id);
      ref.invalidate(typedMistakesProvider);
      ref.invalidate(mistakesProvider);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(_errorMessage(error))));
    }
  }
}

class FavoritesScreen extends StatelessWidget {
  const FavoritesScreen({super.key, this.remoteEnabled = remoteDataDefault});
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) =>
      ProviderScope(child: _FavoritesBody(remoteEnabled: remoteEnabled));
}

class _FavoritesBody extends ConsumerStatefulWidget {
  const _FavoritesBody({required this.remoteEnabled});
  final bool remoteEnabled;

  @override
  ConsumerState<_FavoritesBody> createState() => _FavoritesState();
}

class _FavoritesState extends ConsumerState<_FavoritesBody> {
  static const localItems = <({
    String id,
    String subject,
    String? year,
    String title,
  })>[
    (
      id: 'favorite-1',
      subject: '民法',
      year: '2023',
      title: '关于善意取得制度适用的判断（第2题）',
    ),
    (
      id: 'favorite-2',
      subject: '民法典',
      year: null,
      title: '善意取得——《民法典》第311条',
    ),
    (
      id: 'favorite-3',
      subject: '民法',
      year: '2022',
      title: '关于诉讼时效适用规则的判断（第3题）',
    ),
    (
      id: 'favorite-4',
      subject: '刑法',
      year: '2023',
      title: '犯罪未完成形态的认定（第5题）',
    ),
  ];
  final removed = <String>{};
  final removing = <String>{};

  @override
  Widget build(BuildContext context) {
    if (!widget.remoteEnabled) {
      final visible = localItems
          .where((item) => !removed.contains(item.id))
          .toList(growable: false);
      return _screen(
          '收藏夹',
          ListView(padding: EdgeInsets.zero, children: [
            Padding(
                padding: const EdgeInsets.fromLTRB(16, 11, 16, 10),
                child: Text('共 ${visible.length} 条收藏',
                    style: const TextStyle(color: _muted, fontSize: 12))),
            if (visible.isEmpty)
              const _ToolEmptyState(
                  icon: Icons.star_border,
                  title: '暂无收藏',
                  message: '在题目或法条详情中点击收藏即可稍后查看。')
            else
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 16),
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(8)),
                child: Column(
                  children: [
                    for (var index = 0; index < visible.length; index++)
                      _LocalFavoriteCard(
                        item: visible[index],
                        showDivider: index < visible.length - 1,
                        onOpen: () => _openLocalFavorite(context),
                        onRemove: () =>
                            setState(() => removed.add(visible[index].id)),
                      ),
                  ],
                ),
              ),
          ]));
    }

    final questionState = ref.watch(typedFavoritesProvider);
    final legalState = ref.watch(legalFavoritesProvider);
    if (questionState.isLoading || legalState.isLoading) {
      return _screen('收藏夹', const _ToolLoadingState(label: '正在加载收藏…'));
    }
    final error = questionState.error ?? legalState.error;
    if (error != null) {
      return _screen(
          '收藏夹',
          _ToolErrorState(
              error: error,
              onRetry: () {
                ref.invalidate(typedFavoritesProvider);
                ref.invalidate(legalFavoritesProvider);
              }));
    }
    final items = questionState.value
            ?.map(_FavoriteItem.fromModel)
            .where((item) => item.id.isNotEmpty && !removed.contains(item.id))
            .toList(growable: false) ??
        const <_FavoriteItem>[];
    final legalItems = legalState.value
            ?.where((item) => item.id.isNotEmpty && !removed.contains(item.id))
            .toList(growable: false) ??
        const <LegalFavorite>[];
    if (items.isEmpty && legalItems.isEmpty) {
      return _screen(
          '收藏夹',
          const _ToolEmptyState(
              icon: Icons.star_border,
              title: '暂无收藏',
              message: '在题目或法条详情中点击收藏即可稍后查看。'));
    }
    return _screen(
        '收藏夹',
        ListView(padding: const EdgeInsets.all(16), children: [
          Text('${items.length + legalItems.length} 条收藏',
              style: const TextStyle(color: _muted, fontSize: 12)),
          const SizedBox(height: 10),
          if (items.isNotEmpty) ...[
            const Text('题目收藏',
                style: TextStyle(
                    color: _ink, fontSize: 14, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
          ],
          ...items.map((item) => _RemoteFavoriteItem(
                item: item,
                removing: removing.contains(item.id),
                onOpen: () => _showFavorite(context, item),
                onRemove: () => _remove(item),
              )),
          if (items.isNotEmpty && legalItems.isNotEmpty)
            const SizedBox(height: 10),
          if (legalItems.isNotEmpty) ...[
            const Text('法条收藏',
                style: TextStyle(
                    color: _ink, fontSize: 14, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            ...legalItems.map((item) => _RemoteLegalFavoriteItem(
                  item: item,
                  removing: removing.contains(item.id),
                  onOpen: () => _showLegalFavorite(context, item),
                  onRemove: () => _removeLegal(item),
                )),
          ],
        ]));
  }

  Future<void> _remove(_FavoriteItem item) async {
    if (removing.contains(item.id)) return;
    setState(() => removing.add(item.id));
    try {
      await ref.read(questionRepositoryProvider).removeFavorite(item.id);
      ref.invalidate(typedFavoritesProvider);
      if (mounted) setState(() => removed.add(item.id));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(_errorMessage(error, fallback: '移除收藏失败'))));
      }
    } finally {
      if (mounted) setState(() => removing.remove(item.id));
    }
  }

  Future<void> _removeLegal(LegalFavorite item) async {
    if (removing.contains(item.id)) return;
    setState(() => removing.add(item.id));
    try {
      await ref.read(questionRepositoryProvider).removeLegalFavorite(item.id);
      ref.invalidate(legalFavoritesProvider);
      if (mounted) setState(() => removed.add(item.id));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(_errorMessage(error, fallback: '移除法条收藏失败'))));
      }
    } finally {
      if (mounted) setState(() => removing.remove(item.id));
    }
  }

  Future<void> _showLegalFavorite(
      BuildContext context, LegalFavorite item) async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(spacing: 6, runSpacing: 6, children: [
                  _Tag(_subjectLabel(item.subjectId)),
                  if (item.version != null) _Tag('版本 ${item.version}'),
                  if (item.effectiveFrom?.isNotEmpty == true)
                    _Tag('生效 ${item.effectiveFrom}'),
                ]),
                const SizedBox(height: 10),
                Text('${item.article}  ${item.title}',
                    style: const TextStyle(
                        color: _ink,
                        fontSize: 17,
                        fontWeight: FontWeight.w700)),
                const SizedBox(height: 14),
                Text(item.content,
                    style: const TextStyle(
                        color: _body, fontSize: 14, height: 1.8)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showFavorite(BuildContext context, _FavoriteItem item) async {
    if (item.questionId.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('该收藏题目已下架，暂时无法继续练习')));
      return;
    }
    final navigator = Navigator.of(context);
    final practice = await showModalBottomSheet<bool>(
        context: context,
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(
              child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                  child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.title,
                            style: const TextStyle(
                                color: _ink,
                                fontSize: 16,
                                fontWeight: FontWeight.w700)),
                        const SizedBox(height: 8),
                        Text(item.content,
                            style: const TextStyle(
                                color: _body, fontSize: 13, height: 1.6)),
                        const SizedBox(height: 14),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                              onPressed: () {
                                Navigator.of(sheetContext).pop(true);
                              },
                              icon: const Icon(Icons.menu_book_outlined),
                              label: const Text('继续练习')),
                        ),
                      ])),
            ));
    if (!mounted || practice != true) return;
    await navigator.push(MaterialPageRoute(
        builder: (_) => ObjectiveAnswerScreen(
              title: '收藏题目',
              remoteEnabled: true,
              mode: 'chapter',
              subjectId: item.subjectId,
              questionIds: [item.questionId],
              limit: 1,
              durationSeconds: 15 * 60,
            )));
  }

  Future<void> _openLocalFavorite(BuildContext context) async {
    // The RC favorites screen routes every fixture row to the same chapter
    // practice entry, including the law-themed row.
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ObjectiveAnswerScreen(
              title: '收藏题目',
              mode: 'chapter',
            )));
  }
}

class _FavoriteItem {
  const _FavoriteItem(
      {required this.id,
      required this.questionId,
      required this.subject,
      required this.title,
      required this.content,
      this.year,
      this.subjectId});
  final String id;
  final String questionId;
  final String subject;
  final String title;
  final String content;
  final String? year;
  final String? subjectId;

  factory _FavoriteItem.fromModel(FavoriteItem item) => _FavoriteItem(
        id: item.id,
        questionId: item.questionId,
        subject: _subjectLabel(item.question?.subjectId),
        title: item.question?.stem ?? '收藏题目',
        content: item.question?.analysis ?? '已收藏的题目，可从这里继续复习。',
        year: _questionYear(item.question),
        subjectId: item.question?.subjectId,
      );
}

String? _questionYear(Question? question) {
  final source = question?.source;
  if (source == null) return null;
  final match = RegExp(r'20\d{2}').firstMatch(source);
  return match?.group(0);
}

String _subjectLabel(String? subjectId) => switch (subjectId) {
      'civil' => '民法',
      'criminal' => '刑法',
      'civil-proc' => '诉讼法',
      'crim-proc' => '刑诉法',
      'admin' => '行政法',
      'commercial' => '商法',
      'economic' => '经济法',
      'theory' => '理论法',
      _ => '题库',
    };

class _RemoteFavoriteItem extends StatelessWidget {
  const _RemoteFavoriteItem(
      {required this.item,
      required this.removing,
      required this.onOpen,
      required this.onRemove});
  final _FavoriteItem item;
  final bool removing;
  final VoidCallback onOpen;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) => InkWell(
      onTap: removing ? null : onOpen,
      borderRadius: BorderRadius.circular(8),
      child: Container(
          margin: const EdgeInsets.only(bottom: 9),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
              color: Colors.white, borderRadius: BorderRadius.circular(8)),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.star, color: Color(0xFFA87000), size: 19),
            const SizedBox(width: 10),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Wrap(spacing: 6, children: [
                    _Tag(item.subject),
                    if (item.year != null && item.year!.isNotEmpty)
                      _Tag('${item.year}年'),
                  ]),
                  const SizedBox(height: 5),
                  Text(item.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: _ink, fontSize: 13)),
                ])),
            removing
                ? const SizedBox(
                    width: 19,
                    height: 19,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : IconButton(
                    tooltip: '移除收藏',
                    onPressed: onRemove,
                    icon: const Icon(Icons.delete_outline,
                        color: _muted, size: 19)),
          ])));
}

class _RemoteLegalFavoriteItem extends StatelessWidget {
  const _RemoteLegalFavoriteItem({
    required this.item,
    required this.removing,
    required this.onOpen,
    required this.onRemove,
  });

  final LegalFavorite item;
  final bool removing;
  final VoidCallback onOpen;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: removing ? null : onOpen,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          margin: const EdgeInsets.only(bottom: 9),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
              color: Colors.white, borderRadius: BorderRadius.circular(8)),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.menu_book_outlined,
                color: Color(0xFF1A8B8B), size: 19),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(spacing: 6, runSpacing: 4, children: [
                      _Tag(_subjectLabel(item.subjectId)),
                      if (item.version != null) _Tag('版本 ${item.version}'),
                      if (item.effectiveFrom?.isNotEmpty == true)
                        _Tag('生效 ${item.effectiveFrom}'),
                    ]),
                    const SizedBox(height: 5),
                    Text('${item.article}  ${item.title}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: _ink, fontSize: 13)),
                  ]),
            ),
            removing
                ? const SizedBox(
                    width: 19,
                    height: 19,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : IconButton(
                    tooltip: '移除收藏',
                    onPressed: onRemove,
                    icon: const Icon(Icons.delete_outline,
                        color: _muted, size: 19)),
          ]),
        ),
      );
}

class _Tag extends StatelessWidget {
  const _Tag(this.label);
  final String label;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration:
          BoxDecoration(color: _page, borderRadius: BorderRadius.circular(3)),
      child: Text(label, style: const TextStyle(color: _body, fontSize: 10)));
}

class _RemovableItem extends StatelessWidget {
  const _RemovableItem(
      {required this.icon,
      required this.color,
      required this.text,
      this.onTap,
      required this.onRemove});
  final IconData icon;
  final Color color;
  final String text;
  final VoidCallback? onTap;
  final VoidCallback onRemove;
  @override
  Widget build(BuildContext context) {
    final content = Container(
        margin: const EdgeInsets.only(bottom: 9),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(8)),
        child: Row(children: [
          Icon(icon, color: color, size: 19),
          const SizedBox(width: 10),
          Expanded(
              child: Text(text,
                  style: const TextStyle(color: _ink, fontSize: 13))),
          if (onTap != null)
            const Padding(
                padding: EdgeInsets.only(right: 4),
                child: Icon(Icons.chevron_right, color: _muted, size: 18)),
          IconButton(
              tooltip: '移除',
              onPressed: onRemove,
              icon: const Icon(Icons.delete_outline, color: _muted, size: 19))
        ]));
    if (onTap == null) return content;
    return Material(
        color: Colors.transparent,
        child: InkWell(
            key: ValueKey('local-favorite-$text'),
            onTap: onTap,
            borderRadius: BorderRadius.circular(8),
            child: content));
  }
}

class _LocalMistakeCard extends StatelessWidget {
  const _LocalMistakeCard({required this.item, required this.onTap});

  final ({
    String id,
    String subject,
    String year,
    String stem,
    String userAnswer,
    String answer,
    int wrongCount,
  }) item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label:
            '${item.subject} ${item.year}年，答错${item.wrongCount}次，${item.stem}',
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            key: ValueKey('mistake-question-${item.id}'),
            onTap: onTap,
            borderRadius: BorderRadius.circular(8),
            child: Container(
              constraints: const BoxConstraints(minHeight: 119),
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(8)),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      _mistakeTag(item.subject),
                      const SizedBox(width: 8),
                      _mistakeTag('${item.year}年'),
                      const Spacer(),
                      const Icon(Icons.circle,
                          color: Color(0xFFFF7252), size: 7),
                      const SizedBox(width: 3),
                      Text('答错${item.wrongCount}次',
                          style: const TextStyle(
                              color: Color(0xFFFF7252), fontSize: 11)),
                    ]),
                    const SizedBox(height: 7),
                    Text(item.stem,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: _ink, fontSize: 13, height: 1.5)),
                    const SizedBox(height: 6),
                    Row(children: [
                      Text('我的答案：',
                          style: const TextStyle(color: _muted, fontSize: 12)),
                      Text(item.userAnswer,
                          style: const TextStyle(
                              color: Color(0xFFFF7252),
                              fontSize: 12,
                              fontWeight: FontWeight.w500)),
                      const SizedBox(width: 12),
                      const Text('正确答案：',
                          style: TextStyle(color: _muted, fontSize: 12)),
                      Text(item.answer,
                          style: const TextStyle(
                              color: Color(0xFF5DA765),
                              fontSize: 12,
                              fontWeight: FontWeight.w500)),
                      const Spacer(),
                      const Icon(Icons.chevron_right,
                          color: Color(0xFFC0C5D0), size: 16),
                    ]),
                  ]),
            ),
          ),
        ),
      );

  Widget _mistakeTag(String text) => Container(
        height: 21,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        alignment: Alignment.center,
        decoration:
            BoxDecoration(color: _page, borderRadius: BorderRadius.circular(3)),
        child: Text(text, style: const TextStyle(color: _body, fontSize: 10)),
      );
}

class _LocalFavoriteCard extends StatelessWidget {
  const _LocalFavoriteCard({
    required this.item,
    required this.showDivider,
    required this.onOpen,
    required this.onRemove,
  });

  final ({
    String id,
    String subject,
    String? year,
    String title,
  }) item;
  final bool showDivider;
  final VoidCallback onOpen;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.transparent,
        child: InkWell(
          key: ValueKey('local-favorite-${item.title}'),
          onTap: onOpen,
          child: Container(
            key: ValueKey(item.id),
            constraints: const BoxConstraints(minHeight: 70),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
            decoration: BoxDecoration(
                border: showDivider
                    ? const Border(bottom: BorderSide(color: _line, width: 1))
                    : null),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              IconButton(
                  key: ValueKey('remove-favorite-${item.id}'),
                  tooltip: '取消收藏',
                  onPressed: onRemove,
                  padding: EdgeInsets.zero,
                  constraints:
                      const BoxConstraints.tightFor(width: 24, height: 28),
                  icon: const Icon(Icons.star,
                      color: Color(0xFFA87000), size: 18)),
              const SizedBox(width: 12),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Wrap(spacing: 6, runSpacing: 4, children: [
                      _favoriteTag(item.subject),
                      if (item.year != null) _favoriteTag('${item.year}年'),
                    ]),
                    const SizedBox(height: 5),
                    Text(item.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: _ink, fontSize: 13, height: 1.45)),
                  ])),
              const SizedBox(width: 8),
              const Padding(
                  padding: EdgeInsets.only(top: 3),
                  child: Icon(Icons.chevron_right,
                      color: Color(0xFFC0C5D0), size: 16)),
            ]),
          ),
        ),
      );

  Widget _favoriteTag(String text) => Container(
        height: 21,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration:
            BoxDecoration(color: _page, borderRadius: BorderRadius.circular(3)),
        child: Text(text, style: const TextStyle(color: _body, fontSize: 10)),
      );
}

class LegacyLawSearchScreen extends StatefulWidget {
  const LegacyLawSearchScreen({super.key});
  @override
  State<LegacyLawSearchScreen> createState() => _LegacyLawSearchScreenState();
}

class _LegacyLawSearchScreenState extends State<LegacyLawSearchScreen> {
  final controller = TextEditingController();
  String query = '';
  static const laws = [
    ('民法典第三百一十一条', '善意取得', '无处分权人将不动产或者动产转让给受让人的，符合善意取得条件的，受让人取得所有权。'),
    ('民法典第五百六十三条', '合同解除', '当事人一方迟延履行主要债务，经催告后在合理期限内仍未履行的，可以解除合同。'),
    ('刑法第二十五条', '共同犯罪', '共同犯罪是指二人以上共同故意犯罪。')
  ];
  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final results = laws
        .where((law) =>
            query.isEmpty ||
            law.$1.contains(query) ||
            law.$2.contains(query) ||
            law.$3.contains(query))
        .toList();
    return _screen(
        '法条检索',
        ListView(padding: const EdgeInsets.all(16), children: [
          TextField(
              controller: controller,
              onChanged: (value) => setState(() => query = value),
              decoration: InputDecoration(
                  hintText: '输入法条名称或关键词',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: query.isEmpty
                      ? null
                      : IconButton(
                          onPressed: () {
                            controller.clear();
                            setState(() => query = '');
                          },
                          icon: const Icon(Icons.clear)),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide.none))),
          const SizedBox(height: 18),
          Text(query.isEmpty ? '热门法条' : '检索结果 ${results.length} 条',
              style: const TextStyle(
                  color: _ink, fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 9),
          ...results.map((law) => _LawCard(law)),
          if (results.isEmpty)
            const Padding(
                padding: EdgeInsets.only(top: 36),
                child: Center(
                    child: Text('未找到相关法条',
                        style: TextStyle(color: _muted, fontSize: 13)))),
        ]));
  }
}

class _LawCard extends StatelessWidget {
  const _LawCard(this.law);
  final (String, String, String) law;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(8)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(law.$1,
              style: const TextStyle(
                  color: _brand, fontSize: 14, fontWeight: FontWeight.w700)),
          const SizedBox(height: 5),
          Text(law.$2,
              style: const TextStyle(
                  color: _ink, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 7),
          Text(law.$3,
              style: const TextStyle(color: _body, fontSize: 12, height: 1.55)),
        ]),
      );
}

class LawSearchScreen extends StatelessWidget {
  const LawSearchScreen({
    super.key,
    this.remoteEnabled = remoteDataDefault,
    this.source,
    this.subject,
  });

  final bool remoteEnabled;

  /// Optional navigation context used by the subjective-answer flow.  The
  /// RC surface exposes a visible "返回作答" affordance and keeps the
  /// selected subject while the user searches laws.
  final String? source;
  final String? subject;

  @override
  Widget build(BuildContext context) => remoteEnabled
      ? ProviderScope(
          child: _RemoteLawSearchBody(source: source, subject: subject))
      : _LocalLawSearchScreen(source: source, subject: subject);
}

class _UnusedRemoteLawSearchBody extends ConsumerStatefulWidget {
  const _UnusedRemoteLawSearchBody();

  @override
  ConsumerState<_UnusedRemoteLawSearchBody> createState() =>
      _UnusedRemoteLawSearchState();
}

class _UnusedRemoteLawSearchState
    extends ConsumerState<_UnusedRemoteLawSearchBody> {
  int tab = 0;
  String query = '';
  final controller = TextEditingController();

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: _page,
        appBar: AppBar(
            leading: const DebaoRouteBackButton(),
            title: const Text('法条 · 论坛'),
            backgroundColor: Colors.white,
            surfaceTintColor: Colors.white),
        body: Column(children: [
          _lawTabs(),
          Expanded(
              child: tab == 0
                  ? _remoteLawTab()
                  : tab == 1
                      ? _localForumTab()
                      : _localNoticeTab()),
        ]),
      );

  Widget _lawTabs() => Container(
        color: Colors.white,
        height: 42,
        child: Row(
            children: ['法条检索', '学习论坛', '官方公告']
                .asMap()
                .entries
                .map((entry) => Expanded(
                      child: InkWell(
                        onTap: () => setState(() => tab = entry.key),
                        child: Column(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              Text(entry.value,
                                  style: TextStyle(
                                      fontSize: 13,
                                      color: tab == entry.key ? _brand : _muted,
                                      fontWeight: tab == entry.key
                                          ? FontWeight.w600
                                          : FontWeight.w400)),
                              const SizedBox(height: 7),
                              Container(
                                  width: 34,
                                  height: 2,
                                  color: tab == entry.key
                                      ? _brand
                                      : Colors.transparent),
                            ]),
                      ),
                    ))
                .toList()),
      );

  Widget _remoteLawTab() {
    final term = query.trim();
    final state = ref.watch(legalSearchProvider(term));
    final results = state.valueOrNull ?? const <LegalDocument>[];
    return ListView(padding: const EdgeInsets.all(16), children: [
      TextField(
          controller: controller,
          onChanged: (value) => setState(() => query = value),
          decoration: InputDecoration(
              hintText: '输入法条名称或关键词',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: term.isEmpty
                  ? null
                  : IconButton(
                      onPressed: () {
                        controller.clear();
                        setState(() => query = '');
                      },
                      icon: const Icon(Icons.clear)),
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none))),
      const SizedBox(height: 16),
      if (state.isLoading && !state.hasValue)
        const Padding(
            padding: EdgeInsets.only(top: 34),
            child: Center(child: CircularProgressIndicator(strokeWidth: 2.2)))
      else if (state.hasError && !state.hasValue)
        _ToolErrorState(
            error: state.error!,
            onRetry: () => ref.invalidate(legalSearchProvider(term)))
      else if (results.isEmpty)
        _ToolEmptyState(
            icon: Icons.menu_book_outlined,
            title: term.isEmpty ? '暂无热门法条' : '未找到相关法条',
            message: term.isEmpty ? '输入关键词开始检索。' : '换个关键词再试试。')
      else ...[
        Text(term.isEmpty ? '热门法条' : '检索结果 ${results.length} 条',
            style: const TextStyle(
                fontSize: 15, fontWeight: FontWeight.w700, color: _ink)),
        const SizedBox(height: 8),
        ...results.map((law) => _UnusedRemoteLawCard(law)),
      ],
    ]);
  }

  Widget _localForumTab() =>
      ListView(padding: const EdgeInsets.all(16), children: const [
        _ForumCard('备考经验分享：三年法考路上的时间管理', '已坚持 3 年，整理了完整复习节奏与错题方法。', '342'),
        _ForumCard('善意取得中“合理价格”如何认定？', '有没有具体法条依据和案例参考？', '28'),
        _ForumCard('共同犯罪 8 大考点汇总', '近五年真题解析与易错点。', '186'),
      ]);

  Widget _localNoticeTab() =>
      ListView(padding: const EdgeInsets.all(16), children: const [
        _NoticeCard(
            '2024 年法律职业资格考试客观题考试时间公告', '根据司法部统一部署，考试时间定于 9 月 14 日、15 日举行。'),
        _NoticeCard('得宝法考 2024 客观题冲刺班正式上线', '包含直播课程、历年真题精讲与考前模拟押题。'),
        _NoticeCard('关于法律职业资格考试报名条件调整的说明', '请以官方最新规定为准。'),
      ]);
}

class _UnusedRemoteLawCard extends StatelessWidget {
  const _UnusedRemoteLawCard(this.law);
  final LegalDocument law;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: () => showModalBottomSheet<void>(
            context: context,
            showDragHandle: true,
            builder: (_) => SafeArea(
                  child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                      child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(law.title,
                                style: const TextStyle(
                                    color: _ink,
                                    fontSize: 17,
                                    fontWeight: FontWeight.w700)),
                            const SizedBox(height: 5),
                            Text(law.article,
                                style: const TextStyle(
                                    color: _brand, fontSize: 13)),
                            const SizedBox(height: 10),
                            Text(law.content,
                                style: const TextStyle(
                                    color: _body, fontSize: 13, height: 1.6)),
                          ])),
                )),
        borderRadius: BorderRadius.circular(8),
        child: Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
                color: Colors.white, borderRadius: BorderRadius.circular(8)),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(law.article,
                  style: const TextStyle(
                      color: _brand,
                      fontSize: 13,
                      fontWeight: FontWeight.w700)),
              const SizedBox(height: 5),
              Text(law.title,
                  style: const TextStyle(
                      color: _ink, fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 7),
              Text(law.content,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: _body, fontSize: 12, height: 1.55)),
            ])),
      );
}

class _LocalLawSearchScreen extends StatefulWidget {
  const _LocalLawSearchScreen({this.source, this.subject});

  final String? source;
  final String? subject;

  @override
  State<_LocalLawSearchScreen> createState() => _LocalLawSearchState();
}

class _LocalLawArticle {
  const _LocalLawArticle({
    required this.subject,
    required this.law,
    required this.article,
    required this.title,
    required this.content,
    required this.fullText,
    required this.chapter,
  });

  final String subject;
  final String law;
  final String article;
  final String title;
  final String content;
  final String fullText;
  final String chapter;
}

const _localLawArticles = <_LocalLawArticle>[
  _LocalLawArticle(
      subject: '民法',
      law: '中华人民共和国民法典',
      article: '第311条',
      title: '善意取得',
      content:
          '无处分权人将不动产或者动产转让给受让人的，所有权人有权追回；除法律另有规定外，符合下列情形的，受让人取得该不动产或者动产所有权。',
      fullText:
          '无处分权人将不动产或者动产转让给受让人的，所有权人有权追回；除法律另有规定外，符合下列情形的，受让人取得该不动产或者动产的所有权：\n（一）受让人受让该不动产或者动产时是善意的；\n（二）以合理的价格转让；\n（三）转让的不动产或者动产依照法律规定应当登记的已经登记，不需要登记的已经交付给受让人。\n受让人依据前款规定取得不动产或者动产的所有权的，原所有权人有权向无处分权人请求损害赔偿。\n当事人善意取得其他物权的，参照适用前两款规定。',
      chapter: '第二编 物权 · 第一分编 通则 · 第三章 物权的保护'),
  _LocalLawArticle(
      subject: '民法',
      law: '中华人民共和国民法典',
      article: '第188条',
      title: '诉讼时效期间',
      content: '向人民法院请求保护民事权利的诉讼时效期间为三年。法律另有规定的，依照其规定。',
      fullText:
          '向人民法院请求保护民事权利的诉讼时效期间为三年。法律另有规定的，依照其规定。\n诉讼时效期间自权利人知道或者应当知道权利受到损害以及义务人之日起计算。',
      chapter: '第一编 总则 · 第九章 诉讼时效'),
  _LocalLawArticle(
      subject: '民法',
      law: '中华人民共和国民法典',
      article: '第563条',
      title: '合同法定解除',
      content: '有下列情形之一的，当事人可以解除合同：（一）因不可抗力致使不能实现合同目的；（二）一方明确表示不履行主要债务。',
      fullText:
          '有下列情形之一的，当事人可以解除合同：\n（一）因不可抗力致使不能实现合同目的；\n（二）当事人一方明确表示或者以自己的行为表明不履行主要债务；\n（三）一方迟延履行主要债务，经催告后在合理期限内仍未履行。',
      chapter: '第三编 合同 · 第一分编 通则 · 第八章 合同的解除'),
  _LocalLawArticle(
      subject: '刑法',
      law: '中华人民共和国刑法',
      article: '第232条',
      title: '故意杀人罪',
      content: '故意杀人的，处死刑、无期徒刑或者十年以上有期徒刑；情节较轻的，处三年以上十年以下有期徒刑。',
      fullText: '故意杀人的，处死刑、无期徒刑或者十年以上有期徒刑；情节较轻的，处三年以上十年以下有期徒刑。',
      chapter: '第二编 分则 · 第四章 侵犯公民人身权利、民主权利罪'),
  _LocalLawArticle(
      subject: '民法',
      law: '中华人民共和国民法典',
      article: '第985条',
      title: '不当得利',
      content: '得利人没有法律根据取得不当利益的，受损失的人可以请求得利人返还取得的利益。',
      fullText: '得利人没有法律根据取得不当利益的，受损失的人可以请求得利人返还取得的利益，但是有法律规定的除外。',
      chapter: '第三编 合同 · 第三分编 准合同 · 第二章 不当得利'),
  _LocalLawArticle(
      subject: '行政法',
      law: '中华人民共和国行政诉讼法',
      article: '第46条',
      title: '起诉期限',
      content: '直接向人民法院提起诉讼的，应当自知道或者应当知道作出行政行为之日起六个月内提出。',
      fullText: '公民、法人或者其他组织直接向人民法院提起诉讼的，应当自知道或者应当知道作出行政行为之日起六个月内提出。',
      chapter: '第三章 诉讼参加人'),
  _LocalLawArticle(
      subject: '民诉法',
      law: '中华人民共和国民事诉讼法',
      article: '第122条',
      title: '起诉条件',
      content: '起诉必须符合原告与本案有直接利害关系、有明确被告等法定条件。',
      fullText:
          '起诉必须符合下列条件：\n（一）原告是与本案有直接利害关系的公民、法人和其他组织；\n（二）有明确的被告；\n（三）有具体的诉讼请求和事实、理由。',
      chapter: '第二编 审判程序 · 第一章 第一审普通程序'),
  _LocalLawArticle(
      subject: '刑诉法',
      law: '中华人民共和国刑事诉讼法',
      article: '第12条',
      title: '无罪推定',
      content: '未经人民法院依法判决，对任何人都不得确定有罪。',
      fullText: '未经人民法院依法判决，对任何人都不得确定有罪。',
      chapter: '第一编 总则 · 第一章 任务和基本原则'),
];

class _LocalLawSearchState extends State<_LocalLawSearchScreen> {
  String query = '';
  String searchedQuery = '';
  String subjectFilter = '全部';
  String forumTag = '全部';
  String? expandedSubject;
  final starred = <String>{};
  final controller = TextEditingController();

  bool get answerContext => widget.source == 'subjective-answer';

  static const subjects = [
    '全部',
    '民法',
    '刑法',
    '行政法',
    '民诉法',
    '刑诉法',
    '商法',
    '经济法',
    '国际法',
  ];

  @override
  void initState() {
    super.initState();
    final value = widget.subject?.trim();
    if (answerContext && value != null && subjects.contains(value)) {
      subjectFilter = value;
    }
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      backgroundColor: _page,
      appBar: AppBar(
          leading: const DebaoRouteBackButton(),
          title: const Text('\u6cd5\u6761\u68c0\u7d22'),
          centerTitle: true,
          actions: [
            if (answerContext)
              TextButton(
                key: const ValueKey('law-return-to-subjective'),
                onPressed: () => debaoPopOrFallback(context),
                child: const Text('返回作答',
                    style: TextStyle(
                        color: _brand,
                        fontSize: 11,
                        fontWeight: FontWeight.w600)),
              )
            else
              const SizedBox(width: 16),
          ],
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white),
      body: Column(children: [
        if (answerContext)
          Container(
              key: const ValueKey('law-answer-context'),
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: const BoxDecoration(
                color: Color(0xFFF0F0FF),
                border: Border(bottom: BorderSide(color: _line)),
              ),
              child: Text(
                  '正在作答${widget.subject == null || widget.subject!.trim().isEmpty ? '' : '：${widget.subject!.trim()}'}主观题，查询后可返回继续作答',
                  style: const TextStyle(
                      color: _brand, fontSize: 11, height: 16 / 11))),
        Expanded(child: _lawTab())
      ]));
  Widget _lawTab() {
    final submitted = searchedQuery.trim();
    final subjectItems = subjectFilter == '全部'
        ? _localLawArticles
        : _localLawArticles
            .where((item) => item.subject == subjectFilter)
            .toList(growable: false);
    final searchItems = submitted.isEmpty
        ? const <_LocalLawArticle>[]
        : _localLawArticles
            .where((item) =>
                '${item.subject}${item.law}${item.article}${item.title}${item.content}'
                    .contains(submitted))
            .toList(growable: false);
    final cards = submitted.isNotEmpty
        ? searchItems
        : subjectFilter == '全部'
            ? _localLawArticles
                .where((item) => const {'第311条', '第188条', '第563条', '第232条'}
                    .contains(item.article))
                .toList(growable: false)
            : subjectItems;
    return ListView(padding: EdgeInsets.zero, children: [
      Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: _lawSearchField()),
            const SizedBox(width: 8),
            SizedBox(
                height: 36,
                child: FilledButton(
                    key: const ValueKey('law-search-submit'),
                    onPressed: () =>
                        setState(() => searchedQuery = query.trim()),
                    style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8))),
                    child: const Text('搜索', style: TextStyle(fontSize: 12)))),
          ])),
      SizedBox(
          height: 48,
          child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              itemCount: subjects.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, index) {
                final value = subjects[index];
                return _LawFilterChip(
                    label: value,
                    selected: subjectFilter == value,
                    onTap: () => setState(() {
                          subjectFilter = value;
                          searchedQuery = '';
                        }));
              })),
      Container(
          decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: _line, width: 1))),
          child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                if (submitted.isNotEmpty)
                  Text(
                      searchItems.isEmpty
                          ? '未找到「$submitted」相关法条'
                          : '找到 ${searchItems.length} 条结果',
                      style: const TextStyle(color: _muted, fontSize: 12))
                else if (subjectFilter == '全部')
                  const Row(children: [
                    Icon(Icons.local_fire_department_outlined,
                        color: _errorColor, size: 15),
                    SizedBox(width: 6),
                    Text('高频考点法条',
                        style: TextStyle(
                            color: _ink,
                            fontSize: 13,
                            fontWeight: FontWeight.w600)),
                  ])
                else
                  Text('$subjectFilter · 共 ${subjectItems.length} 条法条',
                      style: const TextStyle(color: _muted, fontSize: 12)),
                const SizedBox(height: 10),
                if (cards.isEmpty)
                  const _ToolEmptyState(
                      icon: Icons.search_off,
                      title: '未找到相关法条',
                      message: '换个关键词再试试。')
                else
                  ...cards.map((article) => _RcLawCard(
                        key: ValueKey('law-article-${article.article}'),
                        article: article,
                        starred: starred.contains(article.article),
                        onStar: () => _toggleStar(article),
                        onOpen: () => _showLocalArticle(article),
                      )),
                if (submitted.isEmpty && subjectFilter == '全部') ...[
                  const SizedBox(height: 10),
                  const Text('按科目浏览',
                      style: TextStyle(
                          color: _ink,
                          fontSize: 13,
                          fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  ...subjects.skip(1).map(_subjectGroup),
                ],
              ])),
    ]);
  }

  Widget _lawSearchField() => SizedBox(
      height: 36,
      child: TextField(
          controller: controller,
          textInputAction: TextInputAction.search,
          onChanged: (value) => setState(() => query = value),
          onSubmitted: (_) => setState(() => searchedQuery = query.trim()),
          style: const TextStyle(fontSize: 13, color: _ink),
          decoration: InputDecoration(
              hintText: '搜索法条、关键词、条文编号…',
              hintStyle:
                  const TextStyle(color: Color(0xFFC0C5D0), fontSize: 13),
              prefixIcon: const Icon(Icons.search, color: _muted, size: 16),
              prefixIconConstraints:
                  const BoxConstraints.tightFor(width: 36, height: 36),
              suffixIcon: query.isEmpty
                  ? null
                  : IconButton(
                      tooltip: '清空搜索',
                      padding: EdgeInsets.zero,
                      onPressed: () => setState(() {
                            controller.clear();
                            query = '';
                            searchedQuery = '';
                          }),
                      icon: const Icon(Icons.clear,
                          color: Color(0xFFC0C5D0), size: 15)),
              filled: true,
              fillColor: _page,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none))));

  Widget _subjectGroup(String subject) {
    final items = _localLawArticles
        .where((item) => item.subject == subject)
        .toList(growable: false);
    if (items.isEmpty) return const SizedBox.shrink();
    final open = expandedSubject == subject;
    return Container(
        margin: const EdgeInsets.only(bottom: 8),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(8)),
        child: Column(children: [
          InkWell(
              key: ValueKey('law-group-$subject'),
              onTap: () =>
                  setState(() => expandedSubject = open ? null : subject),
              child: SizedBox(
                  height: 48,
                  child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Row(children: [
                        Text(subject,
                            style: const TextStyle(
                                color: _ink,
                                fontSize: 13,
                                fontWeight: FontWeight.w600)),
                        const SizedBox(width: 8),
                        Container(
                            height: 20,
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                                color: _page,
                                borderRadius: BorderRadius.circular(10)),
                            child: Text('${items.length} 条',
                                style: const TextStyle(
                                    color: _muted, fontSize: 11))),
                        const Spacer(),
                        Icon(
                            open
                                ? Icons.keyboard_arrow_up
                                : Icons.keyboard_arrow_down,
                            color: const Color(0xFFC0C5D0),
                            size: 17),
                      ])))),
          if (open)
            ...items.map((article) => _RcLawBrowseRow(
                  article: article,
                  starred: starred.contains(article.article),
                  onStar: () => _toggleStar(article),
                  onOpen: () => _showLocalArticle(article),
                )),
        ]));
  }

  void _toggleStar(_LocalLawArticle article) => setState(() {
        if (!starred.add(article.article)) starred.remove(article.article);
      });

  Future<void> _showLocalArticle(_LocalLawArticle article) async {
    await showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (sheetContext) => SafeArea(
              child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                  child: SingleChildScrollView(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        Row(children: [
                          Expanded(
                              child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                Text(article.law,
                                    style: const TextStyle(
                                        color: _muted, fontSize: 11)),
                                const SizedBox(height: 2),
                                Text('${article.article}  ${article.title}',
                                    style: const TextStyle(
                                        color: _ink,
                                        fontSize: 18,
                                        fontWeight: FontWeight.w700)),
                              ])),
                          IconButton(
                              tooltip: '收藏法条',
                              onPressed: () => _toggleStar(article),
                              icon: Icon(Icons.star,
                                  color: starred.contains(article.article)
                                      ? const Color(0xFFA87000)
                                      : const Color(0xFFC0C5D0),
                                  size: 18)),
                        ]),
                        const SizedBox(height: 12),
                        Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                                color: const Color(0xFFFAFAFE),
                                border:
                                    Border.all(color: _brand.withOpacity(.15)),
                                borderRadius: BorderRadius.circular(8)),
                            child: Text(article.fullText,
                                style: const TextStyle(
                                    color: _ink, fontSize: 14, height: 1.8))),
                        const SizedBox(height: 10),
                        Text(article.chapter,
                            style:
                                const TextStyle(color: _muted, fontSize: 11)),
                        const SizedBox(height: 14),
                        SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                                onPressed: () {
                                  Navigator.of(sheetContext).pop();
                                  Navigator.of(context).push(MaterialPageRoute(
                                      builder: (_) => ObjectiveAnswerScreen(
                                            title: '${article.article}相关练习',
                                          )));
                                },
                                icon: const Icon(Icons.chevron_right, size: 16),
                                label: const Text('相关练习题'))),
                      ]))),
            ));
  }
}

class _LawFilterChip extends StatelessWidget {
  const _LawFilterChip(
      {super.key,
      required this.label,
      required this.selected,
      required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.transparent,
        child: InkWell(
            key: ValueKey('law-filter-$label'),
            onTap: onTap,
            borderRadius: BorderRadius.circular(16),
            child: Container(
                height: 28,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                    color: selected ? _brand : Colors.white,
                    border:
                        Border.all(color: selected ? _brand : _line, width: 1),
                    borderRadius: BorderRadius.circular(16)),
                child: Text(label,
                    style: TextStyle(
                        color: selected ? Colors.white : _body,
                        fontSize: 12,
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w400)))),
      );
}

class _RcLawCard extends StatelessWidget {
  const _RcLawCard({
    super.key,
    required this.article,
    required this.starred,
    required this.onStar,
    required this.onOpen,
  });

  final _LocalLawArticle article;
  final bool starred;
  final VoidCallback onStar;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.transparent,
        child: InkWell(
            onTap: onOpen,
            borderRadius: BorderRadius.circular(12),
            child: Container(
                constraints: const BoxConstraints(minHeight: 164),
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12)),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                                child: Text(article.law,
                                    style: const TextStyle(
                                        color: _muted,
                                        fontSize: 11,
                                        height: 15 / 11))),
                            IconButton(
                                key: ValueKey('law-star-${article.article}'),
                                tooltip: starred ? '取消收藏' : '收藏法条',
                                onPressed: onStar,
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints.tightFor(
                                    width: 28, height: 28),
                                icon: Icon(Icons.star_border,
                                    color: starred
                                        ? const Color(0xFFA87000)
                                        : const Color(0xFFC0C5D0),
                                    size: 18)),
                          ]),
                      Text('${article.article}\u3000${article.title}',
                          style: const TextStyle(
                              color: _ink,
                              fontSize: 15,
                              height: 21 / 15,
                              fontWeight: FontWeight.w700)),
                      const SizedBox(height: 8),
                      Text(article.content,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: _body, fontSize: 13, height: 20 / 13)),
                      const SizedBox(height: 8),
                      const Divider(height: 1, color: _page),
                      const SizedBox(height: 8),
                      Row(children: [
                        Expanded(
                            child: Text(article.chapter,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    color: _muted, fontSize: 11))),
                        const Text('查看全文 →',
                            style: TextStyle(
                                color: _brand,
                                fontSize: 11,
                                fontWeight: FontWeight.w500)),
                      ]),
                    ]))),
      );
}

class _RcLawBrowseRow extends StatelessWidget {
  const _RcLawBrowseRow({
    required this.article,
    required this.starred,
    required this.onStar,
    required this.onOpen,
  });

  final _LocalLawArticle article;
  final bool starred;
  final VoidCallback onStar;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.transparent,
        child: InkWell(
            onTap: onOpen,
            child: Container(
                constraints: const BoxConstraints(minHeight: 58),
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: const BoxDecoration(
                    border: Border(top: BorderSide(color: _line, width: 1))),
                child: Row(children: [
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        Text('${article.article}\u3000${article.title}',
                            style: const TextStyle(color: _ink, fontSize: 13)),
                        const SizedBox(height: 3),
                        Text(article.chapter,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style:
                                const TextStyle(color: _muted, fontSize: 11)),
                      ])),
                  IconButton(
                      tooltip: starred ? '取消收藏' : '收藏法条',
                      onPressed: onStar,
                      padding: EdgeInsets.zero,
                      constraints:
                          const BoxConstraints.tightFor(width: 28, height: 28),
                      icon: Icon(Icons.star_border,
                          color: starred
                              ? const Color(0xFFA87000)
                              : const Color(0xFFC0C5D0),
                          size: 16)),
                  const Icon(Icons.chevron_right,
                      color: Color(0xFFC0C5D0), size: 15),
                ]))),
      );
}

final _announcementsProvider = FutureProvider<List<JsonMap>>(
    (ref) => ref.watch(legalRepositoryProvider).announcements());

/// Remote counterpart of the law-search surface. The local screen above
/// remains deterministic for screenshot previews.
class _RemoteLawSearchBody extends ConsumerStatefulWidget {
  const _RemoteLawSearchBody({this.source, this.subject});

  final String? source;
  final String? subject;

  @override
  ConsumerState<_RemoteLawSearchBody> createState() => _RemoteLawSearchState();
}

class _RemoteLawSearchState extends ConsumerState<_RemoteLawSearchBody> {
  String query = '';
  String submittedQuery = '';
  String? subjectId;
  String forumTag = '全部';
  final forumExtraPosts = <ForumPost>[];
  String? forumCursor;
  Object? forumLoadMoreError;
  bool forumLoadingMore = false;
  final controller = TextEditingController();

  bool get answerContext => widget.source == 'subjective-answer';

  @override
  void initState() {
    super.initState();
    // Subject ids in the API are stable slugs.  Preserve the subject passed
    // from the answer page when opening the remote law search surface.
    const subjectIds = <String, String>{
      '民法': 'civil',
      '刑法': 'criminal',
      '行政法': 'admin',
      '民事诉讼法': 'civil-proc',
      '刑事诉讼法': 'crim-proc',
      '商法': 'commercial',
      '经济法': 'economic',
      '理论法': 'theory',
    };
    final value = widget.subject?.trim();
    subjectId = value == null || value.isEmpty ? null : subjectIds[value];
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lawState = submittedQuery.isEmpty
        ? const AsyncValue<List<LegalDocument>>.data([])
        : ref.watch(filteredLegalSearchProvider(
            LegalSearchQuery(query: submittedQuery, subjectId: subjectId)));
    return Scaffold(
        backgroundColor: _page,
        appBar: AppBar(
            leading: const DebaoRouteBackButton(),
            title: const Text('法条检索'),
            actions: [
              if (answerContext)
                TextButton(
                  key: const ValueKey('law-return-to-subjective'),
                  onPressed: () => debaoPopOrFallback(context),
                  child: const Text('返回作答',
                      style: TextStyle(
                          color: _brand,
                          fontSize: 11,
                          fontWeight: FontWeight.w600)),
                )
              else
                const SizedBox(width: 16),
            ],
            backgroundColor: Colors.white,
            surfaceTintColor: Colors.white),
        body: Column(children: [
          if (answerContext)
            Container(
              key: const ValueKey('law-answer-context'),
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: const BoxDecoration(
                color: Color(0xFFF0F0FF),
                border: Border(bottom: BorderSide(color: _line)),
              ),
              child: Text(
                '正在作答${widget.subject == null || widget.subject!.trim().isEmpty ? '' : '：${widget.subject!.trim()}'}主观题，查询后可返回继续作答',
                style: const TextStyle(
                    color: _brand, fontSize: 11, height: 16 / 11),
              ),
            ),
          Expanded(child: _lawsTab(lawState)),
        ]));
  }

  Widget _lawsTab(AsyncValue<List<LegalDocument>> state) {
    final loading = state.isLoading && submittedQuery.isNotEmpty;
    final error = state.hasError && submittedQuery.isNotEmpty;
    final subjects =
        ref.watch(subjectsProvider).valueOrNull ?? const <Subject>[];
    final results = state.value ?? const <LegalDocument>[];
    final grouped = <String, List<LegalDocument>>{};
    for (final item in results) {
      final key = item.subjectId ?? _lawSubjectId(item) ?? 'other';
      grouped.putIfAbsent(key, () => <LegalDocument>[]).add(item);
    }
    String subjectName(String id) =>
        subjects
            .where((item) => item.id == id)
            .map((item) => item.name)
            .firstOrNull ??
        _subjectLabel(id);
    return ListView(padding: const EdgeInsets.all(16), children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: _searchField()),
        const SizedBox(width: 8),
        SizedBox(
            height: 56,
            child: FilledButton(
                onPressed: _submit,
                style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 14)),
                child: const Text('搜索'))),
      ]),
      const SizedBox(height: 8),
      DropdownButtonFormField<String>(
        value: subjectId ?? '',
        isExpanded: true,
        menuMaxHeight: 300,
        borderRadius: BorderRadius.circular(12),
        elevation: 4,
        dropdownColor: Colors.white,
        decoration: InputDecoration(
            labelText: '\u79d1\u76ee\u7b5b\u9009',
            filled: true,
            fillColor: Colors.white,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFE5E7ED))),
            enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFE5E7ED))),
            focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: _brand, width: 1.5))),
        items: [
          const DropdownMenuItem<String>(
              value: '', child: Text('\u5168\u90e8\u79d1\u76ee')),
          ...subjects.map((item) =>
              DropdownMenuItem<String>(value: item.id, child: Text(item.name))),
        ],
        onChanged: (value) => setState(
            () => subjectId = value == null || value.isEmpty ? null : value),
      ),
      const SizedBox(height: 16),
      if (submittedQuery.isEmpty)
        const _ToolEmptyState(
            icon: Icons.search, title: '输入关键词搜索法条', message: '支持法条名称、条文编号和关键词。')
      else if (loading)
        const _ToolLoadingState(label: '正在搜索法条…')
      else if (error)
        _ToolErrorState(
            error: state.error!,
            onRetry: () => ref.invalidate(filteredLegalSearchProvider(
                LegalSearchQuery(query: submittedQuery, subjectId: subjectId))))
      else if (results.isEmpty)
        const _ToolEmptyState(
            icon: Icons.search_off, title: '未找到相关法条', message: '请换一个关键词再试。')
      else ...[
        const Text('搜索结果',
            style: TextStyle(
                color: _ink, fontSize: 15, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        ...grouped.entries.map((entry) => _LawSubjectGroup(
              label: subjectName(entry.key),
              items: entry.value,
              onPractice: _openLawPractice,
            )),
      ],
    ]);
  }

  Widget _searchField() => TextField(
      controller: controller,
      textInputAction: TextInputAction.search,
      onChanged: (value) => setState(() => query = value),
      onSubmitted: (_) => _submit(),
      decoration: InputDecoration(
          hintText: '输入法条名称或关键词',
          prefixIcon: const Icon(Icons.search),
          suffixIcon: query.isEmpty
              ? null
              : IconButton(
                  tooltip: '清空搜索',
                  onPressed: () {
                    controller.clear();
                    setState(() {
                      query = '';
                      submittedQuery = '';
                    });
                  },
                  icon: const Icon(Icons.clear)),
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide.none)));

  void _submit() => setState(() => submittedQuery = query.trim());

  void _openLawPractice(LegalDocument item) {
    Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ObjectiveAnswerScreen(
              title: '${item.article}相关练习',
              remoteEnabled: true,
              mode: 'chapter',
              subjectId: _lawSubjectId(item),
              limit: 10,
              durationSeconds: 15 * 60,
            )));
  }

  String? _lawSubjectId(LegalDocument item) {
    final value = '${item.title}${item.article}${item.content}';
    if (value.contains('刑法')) return 'criminal';
    if (value.contains('行政')) return 'admin';
    if (value.contains('诉讼')) return 'civil-proc';
    if (value.contains('商法') || value.contains('公司')) return 'commercial';
    return value.isEmpty ? null : 'civil';
  }

  Widget _forumTab(AsyncValue<List<ForumPost>> state) {
    final repository = ref.read(communityRepositoryProvider);
    final basePosts = state.value ?? const <ForumPost>[];
    final filtered = forumTag == '全部'
        ? basePosts
        : basePosts
            .where((post) => post.category == forumTag)
            .toList(growable: false);
    final known = filtered.map((post) => post.id).toSet();
    final posts = <ForumPost>[
      ...filtered,
      ...forumExtraPosts.where((post) =>
          (forumTag == '全部' || post.category == forumTag) &&
          !known.contains(post.id)),
    ];
    final cursor = forumCursor ??
        repository.nextPostCursor(category: forumTag == '全部' ? null : forumTag);

    return Column(children: [
      SizedBox(
        height: 48,
        child: ListView.separated(
          key: const ValueKey('law-forum-category-scroll'),
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          itemCount: forumCategories.length + 1,
          separatorBuilder: (_, __) => const SizedBox(width: 8),
          itemBuilder: (context, index) {
            final value = index == 0 ? '全部' : forumCategories[index - 1];
            final selected = forumTag == value;
            return ChoiceChip(
              key: ValueKey('forum-tag-$value'),
              label: Text(value),
              selected: selected,
              showCheckmark: false,
              onSelected: (_) {
                setState(() {
                  forumTag = value;
                  forumExtraPosts.clear();
                  forumCursor = null;
                  forumLoadMoreError = null;
                });
              },
              side: BorderSide(color: selected ? _brand : _line),
              selectedColor: _brand,
              backgroundColor: Colors.white,
              labelStyle: TextStyle(
                  color: selected ? Colors.white : _body,
                  fontSize: 12,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400),
            );
          },
        ),
      ),
      Expanded(
        child: state.isLoading && !state.hasValue
            ? const _ToolLoadingState(label: '正在加载论坛…')
            : state.hasError && posts.isEmpty
                ? _ToolErrorState(
                    error: state.error!,
                    onRetry: () => ref.invalidate(forumPostsProvider('all')))
                : RefreshIndicator(
                    color: _brand,
                    onRefresh: () async {
                      ref.invalidate(forumPostsProvider('all'));
                      await Future<void>.delayed(
                          const Duration(milliseconds: 100));
                    },
                    child: ListView(
                      key: const ValueKey('law-forum-post-list'),
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                      children: [
                        if (state.hasError)
                          _InlineForumError(
                              message: _errorMessage(state.error!),
                              onRetry: () =>
                                  ref.invalidate(forumPostsProvider('all'))),
                        if (posts.isEmpty)
                          const _LawForumEmptyState()
                        else ...[
                          ...posts.map((post) => _lawForumCard(post)),
                          if (cursor != null)
                            Center(
                              child: TextButton(
                                key: const ValueKey('forum-list-more'),
                                onPressed: forumLoadingMore
                                    ? null
                                    : () => _loadMoreForum(cursor),
                                child: forumLoadingMore
                                    ? const SizedBox(
                                        width: 16,
                                        height: 16,
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2),
                                      )
                                    : const Text('加载更多'),
                              ),
                            ),
                        ],
                        if (forumLoadMoreError != null)
                          _InlineForumError(
                              message: _errorMessage(forumLoadMoreError!),
                              onRetry: () => _loadMoreForum(cursor)),
                      ],
                    ),
                  ),
      ),
      Container(
        height: 68,
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: const BoxDecoration(
            color: Colors.white, border: Border(top: BorderSide(color: _line))),
        child: SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            key: const ValueKey('forum-compose'),
            onPressed: () async {
              await Navigator.of(context).push<void>(MaterialPageRoute(
                  builder: (_) =>
                      const ForumComposeScreen(remoteEnabled: true)));
              if (mounted) ref.invalidate(forumPostsProvider('all'));
            },
            icon: const Icon(Icons.chat_bubble_outline, size: 17),
            label: const Text('发布帖子'),
          ),
        ),
      ),
    ]);
  }

  Future<void> _loadMoreForum(String? cursor) async {
    if (cursor == null || forumLoadingMore) return;
    setState(() {
      forumLoadingMore = true;
      forumLoadMoreError = null;
    });
    try {
      final page = await ref.read(communityRepositoryProvider).postPage(
            category: forumTag == '全部' ? null : forumTag,
            cursor: cursor,
            limit: 20,
          );
      if (!mounted) return;
      setState(() {
        final known = forumExtraPosts.map((post) => post.id).toSet();
        forumExtraPosts
            .addAll(page.items.where((post) => !known.contains(post.id)));
        forumCursor = page.nextCursor;
      });
    } catch (error) {
      if (mounted) setState(() => forumLoadMoreError = error);
    } finally {
      if (mounted) setState(() => forumLoadingMore = false);
    }
  }

  Widget _lawForumCard(ForumPost post) {
    final author = (post.author ?? '').trim().isEmpty ? '得宝用户' : post.author!;
    final category = post.category ?? '学习交流';
    return Card(
      key: ValueKey('forum-post-${post.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => Navigator.of(context).push<void>(MaterialPageRoute(
            builder: (_) => ForumDetailScreen(
                  postId: post.id,
                  initialPost: post,
                  title: post.title,
                  body: post.body,
                  category: category,
                  remoteEnabled: true,
                ))),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              CircleAvatar(
                radius: 14,
                backgroundColor: _brand,
                child: Text(author.characters.first,
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w700)),
              ),
              const SizedBox(width: 8),
              Expanded(
                  child: Text(author,
                      style: const TextStyle(
                          color: _body,
                          fontSize: 12,
                          fontWeight: FontWeight.w500))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                    color: const Color(0xFFF0F0FF),
                    borderRadius: BorderRadius.circular(10)),
                child: Text(category,
                    style: const TextStyle(
                        color: _brand,
                        fontSize: 10,
                        fontWeight: FontWeight.w600)),
              ),
            ]),
            const SizedBox(height: 10),
            Text(post.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    color: _ink,
                    fontSize: 14,
                    height: 1.45,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(post.body,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(color: _muted, fontSize: 12, height: 1.55)),
            const SizedBox(height: 10),
            Row(children: [
              const Icon(Icons.thumb_up_outlined, size: 13, color: _muted),
              const SizedBox(width: 4),
              Text('${post.likeCount}',
                  style: const TextStyle(color: _muted, fontSize: 11)),
              const SizedBox(width: 16),
              const Icon(Icons.chat_bubble_outline, size: 13, color: _muted),
              const SizedBox(width: 4),
              Text('${post.commentCount} 回复',
                  style: const TextStyle(color: _muted, fontSize: 11)),
              const Spacer(),
              Text(_lawForumTime(post.createdAt),
                  style:
                      const TextStyle(color: Color(0xFFC0C5D0), fontSize: 11)),
            ]),
          ]),
        ),
      ),
    );
  }

  Widget _noticesTab(AsyncValue<List<JsonMap>> state) {
    if (state.isLoading) {
      return const _ToolLoadingState(label: '正在加载公告…');
    }
    if (state.hasError) {
      return _ToolErrorState(
          error: state.error!,
          onRetry: () => ref.invalidate(_announcementsProvider));
    }
    final notices = state.value ?? const <JsonMap>[];
    if (notices.isEmpty) {
      return const _ToolEmptyState(
          icon: Icons.notifications_none,
          title: '暂无官方公告',
          message: '新的公告发布后会显示在这里。');
    }
    return ListView(
        padding: const EdgeInsets.all(16),
        children: notices
            .map((item) => _NoticeCard('${item['title'] ?? ''}',
                '${item['body'] ?? item['content'] ?? ''}'))
            .toList());
  }
}

class _InlineForumError extends StatelessWidget {
  const _InlineForumError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
            color: const Color(0xFFFFF4F1),
            borderRadius: BorderRadius.circular(8)),
        child: Row(children: [
          const Icon(Icons.cloud_off_outlined,
              color: Color(0xFFD04A3A), size: 16),
          const SizedBox(width: 7),
          Expanded(
              child: Text(message,
                  style:
                      const TextStyle(color: Color(0xFFD04A3A), fontSize: 11))),
          TextButton(onPressed: onRetry, child: const Text('重试')),
        ]),
      );
}

class _LawForumEmptyState extends StatelessWidget {
  const _LawForumEmptyState();

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(vertical: 54),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.forum_outlined, color: _muted, size: 30),
          SizedBox(height: 10),
          Text('暂无相关帖子',
              style: TextStyle(
                  color: _ink, fontSize: 14, fontWeight: FontWeight.w700)),
          SizedBox(height: 5),
          Text('换个分类看看，或发布第一篇帖子。',
              textAlign: TextAlign.center,
              style: TextStyle(color: _muted, fontSize: 12)),
        ]),
      );
}

String _lawForumTime(String? value) {
  if (value == null || value.trim().isEmpty) return '刚刚';
  final date = DateTime.tryParse(value);
  if (date == null) return value;
  final difference = DateTime.now().difference(date.toLocal());
  if (difference.isNegative || difference.inMinutes < 1) return '刚刚';
  if (difference.inMinutes < 60) return '${difference.inMinutes}分钟前';
  if (difference.inHours < 24) return '${difference.inHours}小时前';
  if (difference.inDays < 7) return '${difference.inDays}天前';
  final local = date.toLocal();
  return '${local.month}月${local.day}日';
}

class _LawSubjectGroup extends StatelessWidget {
  const _LawSubjectGroup({
    required this.label,
    required this.items,
    required this.onPractice,
  });

  final String label;
  final List<LegalDocument> items;
  final ValueChanged<LegalDocument> onPractice;

  @override
  Widget build(BuildContext context) => ExpansionTile(
        initiallyExpanded: true,
        tilePadding: const EdgeInsets.symmetric(horizontal: 4),
        childrenPadding: EdgeInsets.zero,
        title: Text(label,
            style: const TextStyle(
                color: _ink, fontSize: 14, fontWeight: FontWeight.w700)),
        subtitle: Text('${items.length} 条',
            style: const TextStyle(color: _muted, fontSize: 11)),
        children: items
            .map((item) => _RemoteLawCard(
                  item,
                  onPractice: () => onPractice(item),
                ))
            .toList(growable: false),
      );
}

class _RemoteLawCard extends ConsumerStatefulWidget {
  const _RemoteLawCard(this.item, {required this.onPractice});
  final LegalDocument item;
  final VoidCallback onPractice;

  @override
  ConsumerState<_RemoteLawCard> createState() => _RemoteLawCardState();
}

class _RemoteLawCardState extends ConsumerState<_RemoteLawCard> {
  bool busy = false;

  @override
  Widget build(BuildContext context) {
    final favoriteState = ref.watch(legalFavoritesProvider);
    final favorite = favoriteState.valueOrNull
        ?.where((item) => item.legalDocumentId == widget.item.id)
        .firstOrNull;
    final favorited = favorite != null;
    return InkWell(
      onTap: () async {
        final practice = await showModalBottomSheet<bool>(
          context: context,
          showDragHandle: true,
          builder: (sheetContext) => SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${widget.item.article}  ${widget.item.title}',
                        style: const TextStyle(
                            color: _ink,
                            fontSize: 17,
                            fontWeight: FontWeight.w700)),
                    const SizedBox(height: 14),
                    if (widget.item.version != null ||
                        widget.item.effectiveFrom != null)
                      Text(
                          '版本 ${widget.item.version ?? '-'} · 生效 ${widget.item.effectiveFrom ?? '-'}',
                          style: const TextStyle(color: _muted, fontSize: 11)),
                    if (widget.item.version != null ||
                        widget.item.effectiveFrom != null)
                      const SizedBox(height: 10),
                    Text(widget.item.content,
                        style: const TextStyle(
                            color: _body, fontSize: 14, height: 1.8)),
                    const SizedBox(height: 16),
                    Row(children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: busy
                              ? null
                              : () async {
                                  Navigator.of(sheetContext).pop();
                                  await _toggleFavorite(favorite);
                                },
                          icon:
                              Icon(favorited ? Icons.star : Icons.star_border),
                          label: Text(favorited ? '取消收藏' : '收藏'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: FilledButton(
                          onPressed: () => Navigator.of(sheetContext).pop(true),
                          child: const Text('相关练习题'),
                        ),
                      ),
                    ]),
                  ],
                ),
              ),
            ),
          ),
        );
        if (practice == true && context.mounted) widget.onPractice();
      },
      borderRadius: BorderRadius.circular(8),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(8)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Text(widget.item.article,
                    style: const TextStyle(
                        color: _brand,
                        fontSize: 14,
                        fontWeight: FontWeight.w700)),
              ),
              busy
                  ? const SizedBox(
                      width: 24,
                      height: 24,
                      child: Padding(
                        padding: EdgeInsets.all(4),
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ))
                  : IconButton(
                      tooltip: favorited ? '取消收藏' : '收藏法条',
                      visualDensity: VisualDensity.compact,
                      onPressed: favoriteState.isLoading
                          ? null
                          : () => _toggleFavorite(favorite),
                      icon: Icon(favorited ? Icons.star : Icons.star_border,
                          color: favorited ? const Color(0xFFA87000) : _muted),
                    ),
            ]),
            const SizedBox(height: 5),
            Text(widget.item.title,
                style: const TextStyle(
                    color: _ink, fontSize: 13, fontWeight: FontWeight.w600)),
            const SizedBox(height: 7),
            if (widget.item.version != null ||
                widget.item.effectiveFrom != null)
              Text(
                  '版本 ${widget.item.version ?? '-'} · 生效 ${widget.item.effectiveFrom ?? '-'}',
                  style: const TextStyle(color: _muted, fontSize: 10)),
            if (widget.item.version != null ||
                widget.item.effectiveFrom != null)
              const SizedBox(height: 5),
            Text(widget.item.content,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(color: _body, fontSize: 12, height: 1.55)),
            const SizedBox(height: 7),
            const Text('查看全文 ›', style: TextStyle(color: _brand, fontSize: 11)),
          ],
        ),
      ),
    );
  }

  Future<void> _toggleFavorite(LegalFavorite? favorite) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final repository = ref.read(questionRepositoryProvider);
      if (favorite == null) {
        await repository.addLegalFavorite(widget.item.id);
      } else {
        await repository.removeLegalFavorite(favorite.id);
      }
      ref.invalidate(legalFavoritesProvider);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(_errorMessage(error, fallback: '收藏操作失败'))));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}

const _laws = [
  ('民法第六百六十三条', '合同解除', '有法定情形之一的，当事人可以解除合同。'),
  ('刑法第二十五条', '共同犯罪', '共同犯罪是指二人以上共同故意犯罪。'),
  ('民法第五百零九条', '全面履行', '当事人应当按照约定全面履行义务。')
];

class _ForumCard extends StatelessWidget {
  const _ForumCard(this.title, this.body, this.likes);
  final String title, body, likes;
  @override
  Widget build(BuildContext context) => Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(8)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title,
            style: const TextStyle(
                fontSize: 14, fontWeight: FontWeight.w600, color: _ink)),
        const SizedBox(height: 6),
        Text(body,
            style: const TextStyle(fontSize: 12, color: _body, height: 1.5)),
        const SizedBox(height: 8),
        Text('$likes 个赞  ·  2 小时前',
            style: const TextStyle(fontSize: 11, color: _muted))
      ]));
}

class _LocalForumCard extends StatelessWidget {
  const _LocalForumCard({required this.post, required this.onTap});

  final ForumPost post;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final author = (post.author ?? '').trim().isEmpty ? '得宝用户' : post.author!;
    return Card(
      key: ValueKey('forum-post-${post.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              CircleAvatar(
                radius: 14,
                backgroundColor: _brand,
                child: Text(author.characters.first,
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w700)),
              ),
              const SizedBox(width: 8),
              Expanded(
                  child: Text(author,
                      style: const TextStyle(
                          color: _body,
                          fontSize: 12,
                          fontWeight: FontWeight.w500))),
              Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                      color: const Color(0xFFF0F0FF),
                      borderRadius: BorderRadius.circular(10)),
                  child: Text(post.category ?? '学习交流',
                      style: const TextStyle(
                          color: _brand,
                          fontSize: 10,
                          fontWeight: FontWeight.w600))),
            ]),
            const SizedBox(height: 10),
            Text(post.title,
                style: const TextStyle(
                    color: _ink,
                    fontSize: 14,
                    height: 1.45,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(post.body,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(color: _muted, fontSize: 12, height: 1.55)),
            const SizedBox(height: 10),
            Row(children: [
              const Icon(Icons.thumb_up_outlined, size: 13, color: _muted),
              const SizedBox(width: 4),
              Text('${post.likeCount}',
                  style: const TextStyle(color: _muted, fontSize: 11)),
              const SizedBox(width: 16),
              const Icon(Icons.chat_bubble_outline, size: 13, color: _muted),
              const SizedBox(width: 4),
              Text('${post.commentCount} 回复',
                  style: const TextStyle(color: _muted, fontSize: 11)),
              const Spacer(),
              Text(_lawForumTime(post.createdAt),
                  style:
                      const TextStyle(color: Color(0xFFC0C5D0), fontSize: 11)),
            ]),
          ]),
        ),
      ),
    );
  }
}

class _NoticeCard extends StatelessWidget {
  const _NoticeCard(this.title, this.body);
  final String title, body;
  @override
  Widget build(BuildContext context) => Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(8)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title,
            style: const TextStyle(
                fontSize: 14, fontWeight: FontWeight.w600, color: _ink)),
        const SizedBox(height: 7),
        Text(body,
            style: const TextStyle(fontSize: 12, color: _body, height: 1.55)),
        const SizedBox(height: 8),
        const Text('2026-08-20', style: TextStyle(fontSize: 11, color: _muted))
      ]));
}

class LearningReportScreen extends StatelessWidget {
  const LearningReportScreen(
      {super.key, this.remoteEnabled = remoteDataDefault});
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) =>
      ProviderScope(child: _LearningReportBody(remoteEnabled: remoteEnabled));
}

class _LearningReportBody extends ConsumerWidget {
  const _LearningReportBody({required this.remoteEnabled});
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!remoteEnabled) return _screen('学习报告', _localReportBody(context));
    final state = ref.watch(learningReportProvider('week'));
    if (state.isLoading) {
      return _screen('学习报告', const _ToolLoadingState(label: '正在生成学习报告…'));
    }
    if (state.hasError) {
      return _screen(
          '学习报告',
          _ToolErrorState(
              error: state.error!,
              onRetry: () => ref.invalidate(learningReportProvider('week'))));
    }
    final report = state.value;
    if (report == null) {
      return _screen(
          '学习报告',
          const _ToolEmptyState(
              icon: Icons.insights_outlined,
              title: '暂无学习报告',
              message: '完成课程或练习后，这里会生成你的学习数据。'));
    }
    // Match the RC empty state: do not render zero-valued charts and metrics
    // as if they were a populated report.
    if (report.minutes <= 0 && report.answered <= 0) {
      return _screen(
          '学习报告',
          const _ToolEmptyState(
              icon: Icons.insights_outlined,
              title: '暂无学习数据',
              message: '完成课程或练习后，报告会显示在这里。'));
    }
    return _screen('学习报告', _reportBody(context, report));
  }

  Widget _localReportBody(BuildContext context) => _reportBody(
        context,
        const LearningReport(
          period: 'week',
          minutes: 252,
          answered: 2847,
          correctRate: 68,
          subjects: [
            (subjectId: 'civil', minutes: 64, correctRate: 78),
            (subjectId: 'criminal', minutes: 48, correctRate: 91),
            (subjectId: 'admin', minutes: 36, correctRate: 69),
            (subjectId: 'civil-proc', minutes: 40, correctRate: 53),
            (subjectId: 'crim-proc', minutes: 30, correctRate: 86),
            (subjectId: 'commercial', minutes: 34, correctRate: 63),
          ],
        ),
        local: true,
      );

  Widget _reportBody(BuildContext context, LearningReport report,
      {bool local = false}) {
    final subjectRows = report.subjects
        .map((item) => _ReportSubject(
            name: _subjectName(item.subjectId),
            rate: item.correctRate.clamp(0, 100),
            minutes: item.minutes))
        .toList(growable: false);
    final rows = local
        ? subjectRows
        : subjectRows
            .where((item) => item.minutes > 0 || item.rate > 0)
            .toList();
    final weakest =
        rows.isEmpty ? null : rows.reduce((a, b) => a.rate <= b.rate ? a : b);
    final alertTitle =
        weakest == null ? '完成练习后，这里会根据薄弱科目给出复习建议。' : '${weakest.name}需要重点关注';
    final alertText = weakest == null ? '' : '正确率仅 ${weakest.rate}%，建议本周加强练习';
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      Container(
          height: 169,
          margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          decoration: BoxDecoration(
              color: Colors.white, borderRadius: BorderRadius.circular(8)),
          child: Padding(
              padding: const EdgeInsets.all(16),
              child: _ReportOverview(
                  minutes: report.minutes, dailyTrend: report.dailyTrend))),
      Container(
          constraints: const BoxConstraints(minHeight: 90),
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
              color: const Color(0xFFFFF1E8),
              borderRadius: BorderRadius.circular(8)),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.error_outline, color: Color(0xFFD2691E), size: 16),
            const SizedBox(width: 8),
            Expanded(
                child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(alertTitle,
                    style: const TextStyle(
                        fontSize: 13,
                        height: 18 / 13,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFFD2691E))),
                if (alertText.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(alertText,
                      style: const TextStyle(
                          fontSize: 12, height: 17 / 12, color: _muted)),
                  const SizedBox(height: 1),
                  TextButton(
                    key: const ValueKey('learning-report-practice'),
                    onPressed: weakest == null
                        ? null
                        : () => Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => ObjectiveAnswerScreen(
                                  title: '${weakest.name}专项练习',
                                  remoteEnabled: !local,
                                  subjectId: _subjectId(weakest.name),
                                ))),
                    child: const Text('进入专项练习 →'),
                    style: TextButton.styleFrom(
                        foregroundColor: _brand,
                        padding: EdgeInsets.zero,
                        minimumSize: const Size(0, 24),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                  )
                ],
              ],
            ))
          ])),
      Container(
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
              color: Colors.white, borderRadius: BorderRadius.circular(8)),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('各科正确率',
                style: TextStyle(
                    fontSize: 14,
                    height: 20 / 14,
                    fontWeight: FontWeight.w600,
                    color: _ink)),
            const SizedBox(height: 14),
            if (rows.isEmpty)
              const _ToolEmptyState(
                  icon: Icons.bar_chart_outlined,
                  title: '暂无科目统计',
                  message: '完成题目后会显示各科正确率。')
            else
              ...rows.map((item) => _ReportSubjectRow(item: item)),
          ])),
      Container(
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
              color: Colors.white, borderRadius: BorderRadius.circular(8)),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('做题统计',
                style: TextStyle(
                    fontSize: 14,
                    height: 20 / 14,
                    fontWeight: FontWeight.w600,
                    color: _ink)),
            const SizedBox(height: 14),
            Row(children: [
              Expanded(
                  child: _ReportStat(
                      value: report.answered.toString(), label: '累计做题')),
              const SizedBox(width: 12),
              Expanded(
                  child: _ReportStat(
                      value: '${report.correctRate}%', label: '正确率')),
              const SizedBox(width: 12),
              const Expanded(child: _ReportStat(value: '28', label: '错题待复习')),
            ]),
          ])),
    ]);
  }

  String _hours(int minutes) => '${(minutes / 60).toStringAsFixed(1)}h';

  String _subjectName(String id) => switch (id) {
        'civil' => '民法',
        'criminal' => '刑法',
        'admin' => '行政法',
        'civil-proc' => '民事诉讼法',
        'crim-proc' => '刑事诉讼法',
        'commercial' => '商法',
        'economic' => '经济法',
        'theory' => '理论法',
        _ => id.isEmpty ? '其他' : id,
      };

  Color _subjectColor(String name) => switch (name) {
        '民法' => _brand,
        '刑法' => const Color(0xFFD2691E),
        '民事诉讼法' => const Color(0xFF1A8B8B),
        '行政法' => const Color(0xFF1A5FA8),
        '刑事诉讼法' => const Color(0xFF3A7A46),
        _ => const Color(0xFFA87000),
      };

  String? _subjectId(String name) => switch (name) {
        '民法' => 'civil',
        '刑法' => 'criminal',
        '行政法' => 'admin',
        '民事诉讼法' => 'civil-proc',
        '刑事诉讼法' => 'crim-proc',
        '商法' => 'commercial',
        '经济法' => 'economic',
        '理论法' => 'theory',
        _ => null,
      };
}

class _ReportSubject {
  const _ReportSubject(
      {required this.name, required this.rate, required this.minutes});
  final String name;
  final int rate;
  final int minutes;
}

class _ReportOverview extends StatelessWidget {
  const _ReportOverview({required this.minutes, required this.dailyTrend});

  final int minutes;
  final List<({String date, int minutes})> dailyTrend;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now().toUtc();
    final weekStart = DateTime(now.year, now.month, now.day)
        .subtract(Duration(days: now.weekday - 1));
    final dates = List.generate(7, (i) => weekStart.add(Duration(days: i)));
    final days = dates.map((date) => '${date.month}/${date.day}').toList();
    final values = dates.map((date) {
      final key =
          '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
      return dailyTrend
          .where((item) => item.date == key)
          .fold<int>(0, (sum, item) => sum + item.minutes);
    }).toList();
    final maxMinutes =
        values.fold<int>(0, (max, value) => value > max ? value : max);
    final bars = values
        .map((value) => maxMinutes == 0 ? 0.0 : value / maxMinutes * 32)
        .toList();
    final hours = (minutes / 60).toStringAsFixed(1);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('本周学习时长',
          style: TextStyle(color: _muted, fontSize: 13, height: 18 / 13)),
      Text.rich(
        TextSpan(children: [
          TextSpan(
              text: hours,
              style: const TextStyle(
                  color: _ink,
                  fontSize: 28,
                  height: 37 / 28,
                  fontWeight: FontWeight.w700)),
          const TextSpan(
              text: ' 小时',
              style: TextStyle(
                  color: _muted,
                  fontSize: 16,
                  height: 24 / 16,
                  fontWeight: FontWeight.w500)),
        ]),
      ),
      const SizedBox(height: 9),
      SizedBox(
          height: 59,
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (var index = 0; index < days.length; index++)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: Column(
                    children: [
                      Expanded(
                        child: Align(
                          alignment: Alignment.bottomCenter,
                          child: Container(
                            width: double.infinity,
                            height: bars[index],
                            decoration: BoxDecoration(
                              color: _brand,
                              borderRadius: const BorderRadius.vertical(
                                top: Radius.circular(4),
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(days[index],
                          style: const TextStyle(color: _muted, fontSize: 10))
                    ],
                  ),
                ),
              ),
          ])),
    ]);
  }
}

class _ReportSubjectRow extends StatelessWidget {
  const _ReportSubjectRow({required this.item});

  final _ReportSubject item;

  @override
  Widget build(BuildContext context) {
    final rate = item.rate.clamp(0, 100);
    final tone = _reportSubjectTone(item.name, rate);
    return SizedBox(
        height: 49,
        child: Column(children: [
          SizedBox(
              height: 23,
              child: Row(children: [
                Text(item.name,
                    style: const TextStyle(
                        color: _body, fontSize: 13, height: 18 / 13)),
                const Spacer(),
                Container(
                    height: 20,
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                        color: tone.background,
                        borderRadius: BorderRadius.circular(4)),
                    child: Text(tone.rank,
                        style: TextStyle(
                            color: tone.foreground,
                            fontSize: 11,
                            height: 15 / 11,
                            fontWeight: FontWeight.w500))),
                const SizedBox(width: 8),
                SizedBox(
                    width: 31,
                    child: Text('$rate%',
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                            color: _ink,
                            fontSize: 13,
                            height: 18 / 13,
                            fontWeight: FontWeight.w600))),
              ])),
          const SizedBox(height: 6),
          LinearProgressIndicator(
              value: rate / 100,
              minHeight: 5,
              borderRadius: const BorderRadius.all(Radius.circular(3)),
              backgroundColor: _line,
              valueColor: AlwaysStoppedAnimation(tone.foreground)),
        ]));
  }
}

class _ReportStat extends StatelessWidget {
  const _ReportStat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
      height: 72,
      decoration:
          BoxDecoration(color: _page, borderRadius: BorderRadius.circular(8)),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text(value,
            style: const TextStyle(
                color: _ink,
                fontSize: 18,
                height: 24 / 18,
                fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(label,
            textAlign: TextAlign.center,
            style:
                const TextStyle(color: _muted, fontSize: 11, height: 15 / 11)),
      ]));
}

({Color foreground, Color background, String rank}) _reportSubjectTone(
    String name, int rate) {
  // The RC fixture intentionally carries a few non-monotonic rank labels;
  // retain those labels for the local preview while keeping sensible remote
  // fallbacks for subjects not present in the fixture.
  const fixture = <String, ({Color foreground, Color background, String rank})>{
    '民法': (
      foreground: Color(0xFF5DA765),
      background: Color(0xFFEAF6EF),
      rank: '中等'
    ),
    '刑法': (
      foreground: Color(0xFF5DA765),
      background: Color(0xFFEAF6EF),
      rank: '良好'
    ),
    '行政法': (foreground: _brand, background: Color(0xFFF0F0FF), rank: '较弱'),
    '民事诉讼法': (
      foreground: Color(0xFFFF7252),
      background: Color(0xFFFFF1E8),
      rank: '薄弱'
    ),
    '刑事诉讼法': (
      foreground: Color(0xFF5DA765),
      background: Color(0xFFEAF6EF),
      rank: '中等'
    ),
    '商法': (foreground: _brand, background: Color(0xFFF0F0FF), rank: '中等'),
  };
  final known = fixture[name];
  if (known != null) return known;
  if (rate >= 75) {
    return (
      foreground: const Color(0xFF5DA765),
      background: const Color(0xFFEAF6EF),
      rank: rate >= 85 ? '良好' : '中等'
    );
  }
  if (rate >= 60) {
    return (
      foreground: _brand,
      background: const Color(0xFFF0F0FF),
      rank: '较弱'
    );
  }
  return (
    foreground: const Color(0xFFFF7252),
    background: const Color(0xFFFFF1E8),
    rank: '薄弱'
  );
}

class _WeekChartPainter extends CustomPainter {
  const _WeekChartPainter({this.active = true});
  final bool active;

  @override
  void paint(Canvas canvas, Size size) {
    final grid = Paint()
      ..color = const Color(0xFFE5E7ED)
      ..strokeWidth = 1;
    for (var i = 0; i < 4; i++) {
      final y = size.height - i * size.height / 3;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }
    final values = active
        ? const [.35, .58, .45, .8, .62, .94, .5]
        : const [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02];
    final bar = Paint()..color = active ? const Color(0xFF4C4BEA) : _line;
    final width = size.width / values.length;
    for (var i = 0; i < values.length; i++) {
      final h = values[i] * (size.height - 8);
      canvas.drawRRect(
          RRect.fromRectAndRadius(
              Rect.fromLTWH(
                  i * width + width * .25, size.height - h, width * .5, h),
              const Radius.circular(3)),
          bar);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
