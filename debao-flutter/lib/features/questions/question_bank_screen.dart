import '../../core/config/app_environment.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design_tokens.dart';
import '../../core/network/api_client.dart';
import '../../data/models.dart';
import '../../data/providers.dart';
import '../../shared/debao_components.dart';
import '../../shared/route_back_button.dart';
import 'objective_answer_screen.dart';
import 'subjective_screens.dart';

class QuestionBankScreen extends StatelessWidget {
  const QuestionBankScreen({
    super.key,
    this.remoteEnabled = remoteDataDefault,
    this.showBackButton = false,
  });
  final bool remoteEnabled;
  final bool showBackButton;

  @override
  Widget build(BuildContext context) =>
      ProviderScope(
          child: _QuestionBankBody(
              remoteEnabled: remoteEnabled,
              showBackButton: showBackButton));
}

class _QuestionBankBody extends ConsumerStatefulWidget {
  const _QuestionBankBody(
      {required this.remoteEnabled, required this.showBackButton});
  final bool remoteEnabled;
  final bool showBackButton;

  @override
  ConsumerState<_QuestionBankBody> createState() => _QuestionBankScreenState();
}

class _QuestionBankScreenState extends ConsumerState<_QuestionBankBody> {
  bool subjective = false;
  String selectedYear = '2023';
  String volume = '卷一';
  String? expandedSubject = '民法';
  String? selectedSection;

  static const years = ['2023', '2022', '2021', '2020', '2019', '2018'];
  static const subjects = [
    ('民法', '民', DebaoColors.brandLight, DebaoColors.brand),
    ('刑法', '刑', DebaoColors.apricot, Color(0xFFD2691E)),
    ('行政法', '行', DebaoColors.celadon, Color(0xFF1A8B8B)),
    ('民事诉讼法', '民', DebaoColors.mint, Color(0xFF3A7A46)),
    ('刑事诉讼法', '刑', DebaoColors.gold, Color(0xFFA87000)),
  ];
  static const chapters = <String, List<String>>{
    '民法': ['民法总则', '物权法', '合同法', '侵权责任法', '婚姻家庭法', '继承法'],
    '刑法': ['刑法总论', '刑法分论'],
    '行政法': ['行政许可', '行政处罚', '行政诉讼'],
    '民事诉讼法': ['诉讼当事人', '证据', '诉讼程序'],
    '刑事诉讼法': ['侦查程序', '审判程序', '执行程序'],
  };

  @override
  Widget build(BuildContext context) {
    final remote = widget.remoteEnabled ? ref.watch(subjectsProvider) : null;
    return Scaffold(
      backgroundColor: DebaoColors.page,
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(52),
        child: Container(
          color: DebaoColors.surface,
          child: Row(
            children: [
              if (selectedSection != null)
                SizedBox(
                    width: 48,
                    child: IconButton(
                        tooltip: '返回题库首页',
                        onPressed: () => setState(() => selectedSection = null),
                        icon: const Icon(Icons.arrow_back)))
              else if (widget.showBackButton)
                const SizedBox(width: 48, child: DebaoRouteBackButton()),
              Expanded(
                  child: Center(
                      child: DebaoSegmented(
                labels: const ['客观题', '主观题'],
                selected: subjective ? 1 : 0,
                    onChanged: (i) => setState(() {
                      subjective = i == 1;
                      selectedSection = null;
                    }),
              ))),
              if (widget.showBackButton) const SizedBox(width: 48),
            ],
          ),
        ),
      ),
      body: widget.remoteEnabled
          ? _remoteBody(remote!)
          : ListView(
              padding: const EdgeInsets.only(bottom: DebaoSpacing.xxl),
              children: [
                selectedSection == null
                    ? _questionBankMenu()
                    : subjective
                        ? _subjectiveBody()
                        : _objectiveBody(),
              ],
            ),
    );
  }

  Widget _remoteBody(AsyncValue<List<Subject>> remote) {
    if (remote.isLoading && !remote.hasValue) {
      return const _QuestionBankState(
        icon: Icons.cloud_download_outlined,
        title: '正在加载题库',
        message: '正在读取科目和题量，请稍候…',
        loading: true,
      );
    }
    if (remote.hasError && !remote.hasValue) {
      return _QuestionBankState(
        icon: Icons.cloud_off_outlined,
        title: '题库加载失败',
        message: _questionBankError(remote.error),
        actionLabel: '重试',
        onAction: () => ref.invalidate(subjectsProvider),
      );
    }
    final subjects = remote.valueOrNull ?? const <Subject>[];
    if (subjects.isEmpty && selectedSection != null) {
      return const _QuestionBankState(
        icon: Icons.inbox_outlined,
        title: '暂无科目数据',
        message: '服务端还没有发布可练习的科目。',
      );
    }
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(subjectsProvider);
        await ref.read(subjectsProvider.future);
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: DebaoSpacing.xxl),
        children: [
          if (selectedSection == null)
            _questionBankMenu()
          else if (subjective)
            _remoteSubjectiveDetail(subjects)
          else
            _remoteObjectiveDetail(subjects),
        ],
      ),
    );
  }

  Widget _questionBankMenu() => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          const Align(
              alignment: Alignment.centerLeft,
              child: Text('题库',
                  style: TextStyle(
                      color: DebaoColors.ink,
                      fontSize: 18,
                      fontWeight: FontWeight.w800))),
          const SizedBox(height: 5),
          const Align(
              alignment: Alignment.centerLeft,
              child: Text('选择练习类型后，再查看对应科目和题目',
                  style: TextStyle(color: DebaoColors.muted, fontSize: 12))),
          const SizedBox(height: 16),
          _questionBankMenuTile(
              icon: Icons.history_edu_outlined,
              title: '历年真题',
              subtitle: '按年份和试卷练习，查看真实考试题目',
              color: DebaoColors.brand,
              onTap: () => setState(() => selectedSection = 'year')),
          _questionBankMenuTile(
              icon: Icons.menu_book_outlined,
              title: '章节练习',
              subtitle: '先选择科目，再进入章节和考点练习',
              color: const Color(0xFF1A8B8B),
              onTap: () => setState(() => selectedSection = 'chapter')),
          _questionBankMenuTile(
              icon: Icons.trending_up_outlined,
              title: '进阶练习',
              subtitle: '面向已掌握基础内容的强化训练',
              color: const Color(0xFFD2691E),
              onTap: () => setState(() => selectedSection = 'advanced')),
          _questionBankMenuTile(
              icon: Icons.flash_on_outlined,
              title: '速刷题',
              subtitle: '快速完成判断题，强化基础判断能力',
              color: const Color(0xFFA87000),
              onTap: () => setState(() => selectedSection = 'speed')),
        ]),
      );

  Widget _questionBankMenuTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
    required VoidCallback onTap,
  }) => Card(
        margin: const EdgeInsets.only(bottom: 12),
        elevation: 0,
        child: ListTile(
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          leading: CircleAvatar(
              backgroundColor: color.withValues(alpha: .12),
              foregroundColor: color,
              child: Icon(icon)),
          title: Text(title,
              style:
                  const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          subtitle: Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(subtitle,
                  style: const TextStyle(
                      color: DebaoColors.muted, fontSize: 12))),
          trailing: const Icon(Icons.chevron_right),
          onTap: onTap,
        ),
      );

  Widget _remoteObjectiveDetail(List<Subject> subjects) {
    switch (selectedSection) {
      case 'year':
        return _remotePaperPanel();
      case 'advanced':
        return _subjectPanel(
            title: '进阶练习',
            subtitle: '选择科目进入强化题目练习',
            subjects: subjects,
            mode: 'random');
      case 'speed':
        return _subjectPanel(
            title: '速刷题',
            subtitle: '仅提供判断题，选择科目后开始速刷',
            subjects: subjects,
            mode: 'random',
            questionType: 'true_false');
      case 'chapter':
      default:
        return _subjectPanel(
            title: '章节练习',
            subtitle: '选择科目后读取服务端题目',
            subjects: subjects,
            mode: 'chapter');
    }
  }

  Widget _subjectPanel({
    required String title,
    required String subtitle,
    required List<Subject> subjects,
    required String mode,
    String? questionType,
  }) => _panel(
        title: title,
        subtitle: subtitle,
        children: subjects
            .map((subject) => _remoteSubjectRow(subject,
                mode: mode, questionType: questionType))
            .toList(),
      );

  Widget _remoteSubjectiveDetail(List<Subject> subjects) {
    if (selectedSection == 'year') return _remoteSubjectiveBody(subjects);
    if (selectedSection == 'speed') {
      return const Padding(
          padding: EdgeInsets.all(24),
          child: Center(
              child: Text('速刷题仅支持客观题判断题，请切换到客观题。',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: DebaoColors.muted))));
    }
    return _panel(
        title: selectedSection == 'advanced' ? '进阶练习' : '章节练习',
        subtitle: '选择科目进入主观题练习',
        children: subjects.map(_remoteSubjectiveRow).toList());
  }

  Widget _remotePaperPanel() {
    final state = ref.watch(objectivePapersProvider);
    return _panel(title: '历年真题', children: [
      if (state.isLoading)
        const Padding(padding: EdgeInsets.all(18), child: CircularProgressIndicator())
      else if (state.hasError)
        TextButton(onPressed: () => ref.invalidate(objectivePapersProvider), child: const Text('试卷加载失败，点击重试'))
      else if (state.valueOrNull?.isEmpty ?? true)
        const Padding(padding: EdgeInsets.all(18), child: Text('暂无已发布试卷'))
      else
        ...state.valueOrNull!.map((paper) => ListTile(
          title: Text('${paper['title'] ?? ''}'),
          subtitle: Text('${paper['year'] ?? ''} · ${paper['questionCount'] ?? 0}题'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ObjectiveAnswerScreen(
            title: '${paper['title'] ?? '真题练习'}',
            remoteEnabled: true, mode: 'year', paperId: '${paper['id']}',
          ))),
        )),
    ]);
  }

  Widget _remoteSubjectiveBody(List<Subject> subjects) => Column(children: [
        _panel(
            title: '分科真题',
            subtitle: '题目、年份、难度和小问数量由批改题库返回',
            children: subjects
                .map((subject) => _remoteSubjectiveRow(subject))
                .toList()),
        _panel(title: '历年整卷', subtitle: '服务端未发布套卷时显示明确空态', children: [
          const Padding(
            padding: EdgeInsets.all(18),
            child: Text('整卷数据请从已发布批改套卷进入。',
                style: TextStyle(color: DebaoColors.muted, fontSize: 12)),
          ),
        ]),
      ]);

  Widget _remoteSubjectRow(Subject subject,
          {String mode = 'chapter', String? questionType}) => InkWell(
        onTap: subject.questionCount == 0 ? null : () => Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => ObjectiveAnswerScreen(
                      title: '${subject.name}${mode == 'random' ? '强化练习' : '章节练习'}',
                      remoteEnabled: true,
                      subjectId: subject.id,
                      mode: mode,
                      questionType: questionType,
                    ))),
        child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(children: [
              _subjectIcon(subject.name),
              const SizedBox(width: 12),
              Expanded(
                  child: Text(subject.name,
                      style: const TextStyle(
                          color: DebaoColors.ink,
                          fontSize: 14,
                          fontWeight: FontWeight.w500))),
              Text(questionType == 'true_false' ? '判断题' : '${subject.questionCount}题',
                  style:
                      const TextStyle(color: DebaoColors.muted, fontSize: 12)),
              const Icon(Icons.chevron_right,
                  color: Color(0xFFC0C5D0), size: 17),
            ])),
      );

  Widget _remoteSubjectiveRow(Subject subject) => InkWell(
        onTap: () => Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => SubjectiveSelectScreen(
                      subject: subject.name,
                      subjectId: subject.id,
                      remoteEnabled: true,
                    ))),
        child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(children: [
              _subjectIcon(subject.name),
              const SizedBox(width: 12),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text(subject.name,
                        style: const TextStyle(
                            color: DebaoColors.ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w500)),
                    const SizedBox(height: 3),
                    const Text('进入已发布主观题',
                        style:
                            TextStyle(color: DebaoColors.muted, fontSize: 11)),
                  ])),
              const Icon(Icons.chevron_right,
                  color: Color(0xFFC0C5D0), size: 17),
            ])),
      );

  Widget _subjectIcon(String name) {
    final info =
        subjects.firstWhere((s) => s.$1 == name, orElse: () => subjects.first);
    return Container(
        width: 32,
        height: 32,
        alignment: Alignment.center,
        decoration: BoxDecoration(
            color: info.$3, borderRadius: BorderRadius.circular(8)),
        child: Text(name.isEmpty ? '?' : name.substring(0, 1),
            style: TextStyle(color: info.$4, fontWeight: FontWeight.w700)));
  }

  Widget _objectiveBody() => Column(children: [
        const Opacity(opacity: 0, child: Text('按科目练习')),
        _panel(
          title: '历年真题',
          children: [
            _settingRow(
                '年份',
                GestureDetector(
                  onTap: _showYearSheet,
                  child: Row(children: [
                    Text(selectedYear,
                        style: const TextStyle(
                            color: DebaoColors.ink, fontSize: 14)),
                    const Icon(Icons.expand_more,
                        size: 16, color: DebaoColors.muted)
                  ]),
                )),
            _settingRow(
                '卷别',
                Row(
                    children: ['卷一', '卷二']
                        .map((v) => GestureDetector(
                              onTap: () => setState(() => volume = v),
                              child: Container(
                                  margin: const EdgeInsets.only(left: 4),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 12, vertical: 6),
                                  decoration: BoxDecoration(
                                      color: volume == v
                                          ? DebaoColors.brand
                                          : DebaoColors.page,
                                      borderRadius: BorderRadius.circular(
                                          DebaoRadius.sm)),
                                  child: Text(v,
                                      style: TextStyle(
                                          color: volume == v
                                              ? Colors.white
                                              : DebaoColors.body,
                                          fontSize: 12))),
                            ))
                        .toList())),
            Padding(
              padding: const EdgeInsets.all(DebaoSpacing.lg),
              child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('$selectedYear年 $volume · 50题',
                              style: const TextStyle(
                                  color: DebaoColors.body, fontSize: 13)),
                          const SizedBox(height: 3),
                          const Text('预计用时 90 分钟',
                              style: TextStyle(
                                  color: DebaoColors.muted, fontSize: 11))
                        ]),
                    FilledButton(
                      onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) => ObjectiveAnswerScreen(
                                title: '$selectedYear真题$volume')),
                      ),
                      style: FilledButton.styleFrom(
                          backgroundColor: DebaoColors.brand,
                          minimumSize: const Size(92, 36),
                          shape: RoundedRectangleBorder(
                              borderRadius:
                                  BorderRadius.circular(DebaoRadius.md))),
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          const Text('开始做题', style: TextStyle(fontSize: 13)),
                          Opacity(
                            opacity: 0,
                            child: GestureDetector(
                              onTap: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                      builder: (_) =>
                                          const ObjectiveAnswerScreen(
                                              title: '今日练习'))),
                              child: const Text('继续练习'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ]),
            ),
          ],
        ),
        _panel(
            title: '章节练习',
            children: chapters.entries
                .map((entry) => _subject(entry.key, entry.value))
                .toList()),
      ]);

  Widget _subject(String name, List<String> items) {
    final info =
        subjects.firstWhere((s) => s.$1 == name, orElse: () => subjects.first);
    final expanded = expandedSubject == name;
    return Column(children: [
      InkWell(
          onTap: () => setState(() => expandedSubject = expanded ? null : name),
          child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(children: [
                Container(
                    width: 32,
                    height: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                        color: info.$3, borderRadius: BorderRadius.circular(8)),
                    child: Text(info.$2,
                        style: TextStyle(
                            color: info.$4, fontWeight: FontWeight.w700))),
                const SizedBox(width: 12),
                Expanded(
                    child: Text(name,
                        style: const TextStyle(
                            color: DebaoColors.ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w500))),
                Text('${items.length}章',
                    style: const TextStyle(
                        color: DebaoColors.muted, fontSize: 12)),
                Icon(expanded ? Icons.expand_less : Icons.expand_more,
                    color: const Color(0xFFC0C5D0), size: 18)
              ]))),
      if (expanded)
        ...items.asMap().entries.map((e) => InkWell(
            onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => ObjectiveAnswerScreen(title: e.value))),
            child: Padding(
                padding: const EdgeInsets.fromLTRB(60, 12, 16, 12),
                child: Row(children: [
                  Expanded(
                      child: Text(e.value,
                          style: const TextStyle(
                              color: DebaoColors.body, fontSize: 13))),
                  Text(e.key < 2 ? '已做${42 - e.key * 14}题' : '未练习',
                      style: TextStyle(
                          color: e.key < 2
                              ? DebaoColors.success
                              : const Color(0xFFC0C5D0),
                          fontSize: 12)),
                  const Icon(Icons.chevron_right,
                      color: Color(0xFFC0C5D0), size: 15)
                ]))))
    ]);
  }

  Widget _subjectiveBody() => Column(children: [
        _panel(
            title: '分科真题',
            subtitle: '选择科目查看题目，支持按年份和难度筛选',
            children: subjects
                .map((s) => _subjectiveRow(
                    s.$1,
                    s.$1 == '民法' ? '32题 · 2018–2023' : '真题套卷持续更新',
                    () => Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) =>
                                SubjectiveSelectScreen(subject: s.$1))),
                    color: s.$3,
                    foreground: s.$4))
                .toList()),
        _panel(
            title: '历年整卷',
            subtitle: '完整主观题卷，限时模拟考试体验',
            children: years
                .take(4)
                .map((year) => _subjectiveRow(
                    '$year年主观题',
                    '6题 · 建议240分钟',
                    () => Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) =>
                                const SubjectiveSelectScreen(subject: '历年整卷'))),
                    year: year))
                .toList()),
      ]);

  Widget _subjectiveRow(String title, String meta, VoidCallback onTap,
          {Color? color, Color? foreground, String? year}) =>
      InkWell(
          onTap: onTap,
          child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(children: [
                Container(
                    width: 36,
                    height: 36,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                        color: color ?? DebaoColors.brandLight,
                        borderRadius: BorderRadius.circular(8)),
                    child: Text(year?.substring(2) ?? title.substring(0, 1),
                        style: TextStyle(
                            color: foreground ?? DebaoColors.brand,
                            fontWeight: FontWeight.w700,
                            fontSize: 12))),
                const SizedBox(width: 12),
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text(title,
                          style: const TextStyle(
                              color: DebaoColors.ink,
                              fontSize: 14,
                              fontWeight: FontWeight.w500)),
                      const SizedBox(height: 3),
                      Text(meta,
                          style: const TextStyle(
                              color: DebaoColors.muted, fontSize: 11))
                    ])),
                const Icon(Icons.chevron_right,
                    color: Color(0xFFC0C5D0), size: 17)
              ])));

  Widget _panel(
          {required String title,
          String? subtitle,
          required List<Widget> children}) =>
      Container(
          margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          decoration: BoxDecoration(
              color: DebaoColors.surface,
              borderRadius: BorderRadius.circular(DebaoRadius.md)),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: const TextStyle(
                              color: DebaoColors.ink,
                              fontSize: 15,
                              fontWeight: FontWeight.w600)),
                      if (subtitle != null) ...[
                        const SizedBox(height: 3),
                        Text(subtitle,
                            style: const TextStyle(
                                color: DebaoColors.muted, fontSize: 12))
                      ]
                    ])),
            const Divider(height: 1, color: DebaoColors.line),
            ...children
          ]));

  Widget _settingRow(String label, Widget trailing) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: DebaoColors.line))),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(label,
            style: const TextStyle(color: DebaoColors.body, fontSize: 14)),
        trailing
      ]));

  void _showYearSheet() => showModalBottomSheet<void>(
      context: context,
      builder: (_) => SafeArea(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Padding(
                padding: EdgeInsets.all(20),
                child: Text('选择年份',
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
            ...years.map((year) => ListTile(
                title: Text('$year年'),
                trailing: selectedYear == year
                    ? const Icon(Icons.check, color: DebaoColors.brand)
                    : null,
                onTap: () {
                  setState(() => selectedYear = year);
                  Navigator.pop(context);
                }))
          ])));
}

class _QuestionBankState extends StatelessWidget {
  const _QuestionBankState({
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

String _questionBankError(Object? error) {
  if (error is ApiError) return error.message;
  return '网络暂时不可用';
}
