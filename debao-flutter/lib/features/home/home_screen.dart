import '../../core/config/app_environment.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../account/account_service_screens.dart';
import '../../data/providers.dart';
import '../../data/models.dart';
import '../commerce/commerce_detail_screens.dart';
import '../community/announcements_screen.dart';
import '../community/forum_screens.dart';
import '../courses/courses_screen.dart';
import '../courses/course_detail_screens.dart';
import '../tools/study_tools_screens.dart';
import '../questions/question_bank_screen.dart';
import '../questions/objective_answer_screen.dart';

const _brand = Color(0xFF4C4BEA);
const _page = Color(0xFFF4F5F7);
const _ink = Color(0xFF171925);
const _body = Color(0xFF5F6574);
const _muted = Color(0xFF707684);
const _line = Color(0xFFE5E7ED);

class HomeScreen extends StatelessWidget {
  const HomeScreen(
      {super.key,
      required this.onOpenQuestionBank,
      this.onOpenQuestionRecords,
      this.onOpenNotifications,
      this.onOpenCourses,
      this.onOpenForum,
      this.onOpenAnnouncements,
      this.remoteEnabled = remoteDataDefault});
  final VoidCallback onOpenQuestionBank;
  final VoidCallback? onOpenQuestionRecords;
  final VoidCallback? onOpenNotifications;
  final VoidCallback? onOpenCourses;
  final VoidCallback? onOpenForum;
  final VoidCallback? onOpenAnnouncements;
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) => ProviderScope(
      child: _HomeBody(
          onOpenQuestionBank: onOpenQuestionBank,
          onOpenQuestionRecords: onOpenQuestionRecords,
          onOpenNotifications: onOpenNotifications,
          onOpenCourses: onOpenCourses,
          onOpenForum: onOpenForum,
          onOpenAnnouncements: onOpenAnnouncements,
          remoteEnabled: remoteEnabled));
}

class _HomeBody extends ConsumerStatefulWidget {
  const _HomeBody(
      {required this.onOpenQuestionBank,
      this.onOpenQuestionRecords,
      this.onOpenNotifications,
      this.onOpenCourses,
      this.onOpenForum,
      this.onOpenAnnouncements,
      required this.remoteEnabled});
  final VoidCallback onOpenQuestionBank;
  final VoidCallback? onOpenQuestionRecords;
  final VoidCallback? onOpenNotifications;
  final VoidCallback? onOpenCourses;
  final VoidCallback? onOpenForum;
  final VoidCallback? onOpenAnnouncements;
  final bool remoteEnabled;
  @override
  ConsumerState<_HomeBody> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<_HomeBody> {
  bool subjective = false;
  int bannerIndex = 0;
  int noticeIndex = 0;
  bool showNotice = true;

  @override
  Widget build(BuildContext context) {
    final remote = widget.remoteEnabled
        ? ref.watch(homeDataProvider)
        : const AsyncValue<HomeData>.data(HomeData());
    final forum = widget.remoteEnabled
        ? ref.watch(forumPostsProvider('all'))
        : const AsyncValue<List<ForumPost>>.data([]);
    if (widget.remoteEnabled &&
        ((remote.isLoading && !remote.hasValue) ||
            (forum.isLoading && !forum.hasValue))) {
      return const ColoredBox(
        color: _page,
        child: Center(
            child: CircularProgressIndicator(key: ValueKey('home-loading'))),
      );
    }
    if (widget.remoteEnabled && remote.hasError && !remote.hasValue) {
      return _remoteState(
        context,
        message: '首页内容暂时不可用',
        error: remote.error,
        onRetry: () {
          ref.invalidate(homeDataProvider);
          ref.invalidate(forumPostsProvider('all'));
        },
      );
    }
    final data = remote.valueOrNull ?? const HomeData();
    return ColoredBox(
      color: _page,
      child: SafeArea(
        bottom: false,
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(child: _header(context)),
            if (remote.hasError || forum.hasError)
              SliverToBoxAdapter(
                  child: _remoteBanner(context,
                      remoteError: remote.error ?? forum.error, onRetry: () {
                ref.invalidate(homeDataProvider);
                ref.invalidate(forumPostsProvider('all'));
              })),
            SliverToBoxAdapter(child: _banner(data)),
            SliverToBoxAdapter(child: _entries(data.featureFlags)),
            SliverToBoxAdapter(child: _promo(data.featuredProduct)),
            SliverToBoxAdapter(child: _countdown(data)),
            if (data.featureFlags['hotCourses'] != false)
              SliverToBoxAdapter(child: _courses(context, data)),
            if (showNotice &&
                (!widget.remoteEnabled || data.announcements.isNotEmpty))
              SliverToBoxAdapter(child: _notice(data)),
            SliverToBoxAdapter(
                child: _community(context, forum.valueOrNull ?? const [])),
            const SliverToBoxAdapter(child: SizedBox(height: 20)),
          ],
        ),
      ),
    );
  }

  Widget _remoteState(BuildContext context,
      {required String message, Object? error, required VoidCallback onRetry}) {
    return ColoredBox(
      color: _page,
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.cloud_off_outlined, color: _muted, size: 34),
              const SizedBox(height: 10),
              Text(message,
                  style: const TextStyle(
                      color: _ink, fontSize: 15, fontWeight: FontWeight.w600)),
              if (error != null) ...[
                const SizedBox(height: 6),
                Text('$error',
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: _muted, fontSize: 11)),
              ],
              const SizedBox(height: 14),
              OutlinedButton.icon(
                  key: const ValueKey('home-retry'),
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh, size: 16),
                  label: const Text('重试')),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _remoteBanner(BuildContext context,
      {Object? remoteError, required VoidCallback onRetry}) {
    return MaterialBanner(
        content: Text(remoteError == null ? '部分首页内容暂时不可用' : '部分首页内容加载失败'),
        leading: const Icon(Icons.cloud_off_outlined),
        actions: [
          TextButton(onPressed: onRetry, child: const Text('重试')),
        ]);
  }

  Widget _header(BuildContext context) {
    final user = widget.remoteEnabled
        ? ref.watch(currentUserProvider).valueOrNull
        : null;
    final hasUnread = user != null &&
        (ref.watch(notificationsProvider).valueOrNull ?? const [])
            .any((item) => !item.read);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: _line)),
      ),
      child: Row(
        children: [
          const Text('得宝法考',
              style: TextStyle(
                  color: _brand, fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(width: 8),
          Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
              decoration: BoxDecoration(
                  color: _page, borderRadius: BorderRadius.circular(4)),
              child: Text(widget.remoteEnabled ? '在线数据' : '演示数据',
                  style: const TextStyle(color: _muted, fontSize: 11))),
          const Spacer(),
          Container(
            padding: const EdgeInsets.all(2),
            decoration: BoxDecoration(
                color: _page, borderRadius: BorderRadius.circular(8)),
            child: Row(children: [
              _channel('客观题', !subjective),
              _channel('主观题', subjective)
            ]),
          ),
          IconButton(
              tooltip: '通知',
              onPressed: widget.onOpenNotifications ??
                  () => Navigator.push(
                      context,
                      MaterialPageRoute(
                          builder: (_) => NotificationsScreen(
                              remoteEnabled: widget.remoteEnabled))),
              icon: Stack(clipBehavior: Clip.none, children: [
                const Icon(Icons.notifications_none, color: _body, size: 22),
                if (hasUnread || !widget.remoteEnabled)
                  Positioned(
                      top: -1,
                      right: -1,
                      child: Container(
                          width: 6,
                          height: 6,
                          decoration: const BoxDecoration(
                              color: Color(0xFFFF7252),
                              shape: BoxShape.circle))),
              ]),
              visualDensity: VisualDensity.compact),
        ],
      ),
    );
  }

  Widget _channel(String text, bool selected) {
    return GestureDetector(
      onTap: () => setState(() => subjective = text == '主观题'),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        height: 28,
        padding: const EdgeInsets.symmetric(horizontal: 11),
        alignment: Alignment.center,
        decoration: BoxDecoration(
            color: selected ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(7),
            boxShadow: selected
                ? const [BoxShadow(color: Color(0x12000000), blurRadius: 3)]
                : null),
        child: Text(text,
            style: TextStyle(
                color: selected ? _brand : _muted,
                fontSize: 12,
                fontWeight: FontWeight.w600)),
      ),
    );
  }

  Widget _banner(HomeData data) {
    const images = [
      'assets/images/home-banner-library.jpg',
      'assets/images/home-banner-office.jpg',
    ];
    if (widget.remoteEnabled && data.banners.isEmpty) {
      return Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Container(
              height: 140,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(8)),
              child: const Text('暂无活动内容',
                  style: TextStyle(color: _muted, fontSize: 12))));
    }
    final remoteBanner = widget.remoteEnabled && data.banners.isNotEmpty
        ? data.banners[bannerIndex.clamp(0, data.banners.length - 1)]
        : null;
    final image = remoteBanner?.imageUrl ??
        images[bannerIndex.clamp(0, images.length - 1)];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          height: 140,
          child: Stack(fit: StackFit.expand, children: [
            remoteBanner != null
                ? Image.network(image,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) =>
                        const ColoredBox(color: Color(0xFFDDE2EE)))
                : Image.asset(image,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) =>
                        const ColoredBox(color: Color(0xFFDDE2EE))),
            const DecoratedBox(
                decoration: BoxDecoration(
                    gradient: LinearGradient(
                        colors: [Color(0x99171925), Colors.transparent],
                        begin: Alignment.centerLeft,
                        end: Alignment.centerRight))),
            Positioned(
                left: 16,
                bottom: 14,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                          remoteBanner?.title ??
                              (subjective ? '2024主观题冲刺班' : '2024客观题精英班'),
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 13,
                              fontWeight: FontWeight.w600)),
                      const SizedBox(height: 3),
                      Text(
                          remoteBanner == null
                              ? (subjective
                                  ? '批改服务 · 已有1893人报名'
                                  : '限时特惠 · 已有5312人报名')
                              : '服务端活动内容',
                          style: const TextStyle(
                              color: Color(0xCCFFFFFF), fontSize: 11))
                    ])),
            Positioned(
                right: 10,
                bottom: 9,
                child: Row(
                    children: List.generate(
                        remoteBanner == null
                            ? images.length
                            : data.banners.length,
                        (i) => GestureDetector(
                            onTap: () => setState(() => bannerIndex = i),
                            child: Container(
                                width: i == bannerIndex ? 16 : 6,
                                height: 6,
                                margin: const EdgeInsets.only(left: 4),
                                decoration: BoxDecoration(
                                    color: i == bannerIndex
                                        ? Colors.white
                                        : const Color(0x80FFFFFF),
                                    borderRadius:
                                        BorderRadius.circular(5))))))),
          ]),
        ),
      ),
    );
  }

  Widget _entries(Map<String, bool> flags) {
    final base = subjective ? _subjectiveEntries : _objectiveEntries;
    final entries = base.where((entry) {
      if (entry.label == '题库' || entry.label == '题库入口') return flags['objectiveBank'] != false;
      if (entry.label == '考试') return flags['objectiveExam'] != false;
      if (entry.label == '学习资料') return flags['studyMaterials'] != false;
      return true;
    }).toList();
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 16),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(8)),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
            children: entries
                .map((entry) => GestureDetector(
                    onTap: entry.icon == Icons.chat_bubble_outline
                        ? () => Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: (_) => AIChatScreen(
                                    remoteEnabled: widget.remoteEnabled)))
                        : entry.label == '题库' || entry.label == '题库入口'
                            ? () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => QuestionBankScreen(
                                        remoteEnabled: widget.remoteEnabled)))
                            : entry.label == '考试'
                                ? () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                        builder: (_) => ObjectiveExamListScreen(
                                            remoteEnabled:
                                                widget.remoteEnabled)))
                                : entry.label == '学习资料'
                                    ? () => Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                            builder: (_) =>
                                                StudyMaterialsScreen(
                                                    remoteEnabled:
                                                        widget.remoteEnabled)))
                                    : entry.label == '做题记录'
                                        ? (widget.onOpenQuestionRecords ??
                                            () => Navigator.push(
                                                context,
                                                MaterialPageRoute(
                                                    builder: (_) =>
                                                        QuestionRecordsScreen(remoteEnabled: widget.remoteEnabled))))
                                        : entry.label == '我的课程' || entry.label == '课程'
                                            ? (widget.onOpenCourses ?? () => Navigator.push(context, MaterialPageRoute(builder: (_) => CoursesScreen(remoteEnabled: widget.remoteEnabled))))
                                            : entry.label == '批改'
                                                ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => GradingServiceScreen(remoteEnabled: widget.remoteEnabled)))
                                                : entry.label == '法条检索'
                                                    ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => LawSearchScreen(remoteEnabled: widget.remoteEnabled)))
                                                    : null,
                    child: SizedBox(
                        width: 64,
                        height: 76,
                        child: Column(children: [
                          Container(
                              width: 44,
                              height: 44,
                              decoration: BoxDecoration(
                                  color: entry.background,
                                  borderRadius: BorderRadius.circular(12)),
                              child: Icon(entry.icon,
                                  color: entry.foreground, size: 22)),
                          const SizedBox(height: 6),
                          Text(entry.label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style:
                                  const TextStyle(color: _body, fontSize: 11))
                        ]))))
                .toList()),
      ),
    );
  }

  Widget _promo(Product? featuredProduct) {
    if (widget.remoteEnabled && featuredProduct == null) {
      return const SizedBox.shrink();
    }
    final title = featuredProduct?.name ?? '2024法考全程班';
    final price =
        featuredProduct == null ? '¥3,980' : '¥${featuredProduct.price}';
    final original = featuredProduct == null
        ? '¥5,200'
        : '¥${featuredProduct.originalPrice ?? featuredProduct.price}';
    return Container(
      height: 120,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(10)),
      child: Stack(fit: StackFit.expand, children: [
        widget.remoteEnabled
            ? const ColoredBox(color: _brand)
            : Image.asset('assets/images/home-banner-library.jpg',
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => const ColoredBox(color: _brand)),
        const DecoratedBox(
            decoration: BoxDecoration(
                gradient: LinearGradient(colors: [
          Color(0xEE4C4BEA),
          Color(0x884C4BEA),
          Colors.transparent
        ], begin: Alignment.centerLeft, end: Alignment.centerRight))),
        Padding(
            padding: EdgeInsets.all(14),
            child: Row(children: [
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                    Text(widget.remoteEnabled ? '课程推荐' : '限时特惠 · 倒计时 3 天',
                        style:
                            TextStyle(color: Color(0xCCFFFFFF), fontSize: 11)),
                    SizedBox(height: 3),
                    Text(title,
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 15,
                            fontWeight: FontWeight.w700)),
                    SizedBox(height: 3),
                    Text(
                        widget.remoteEnabled
                            ? (featuredProduct?.benefits.isNotEmpty == true
                                ? featuredProduct!.benefits.join(' · ')
                                : '暂无已配置商品推荐')
                            : '主客一体 · 名师精讲 · 含批改服务',
                        style:
                            TextStyle(color: Color(0xB3FFFFFF), fontSize: 11))
                  ])),
              Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(price,
                        style: TextStyle(
                            color: Color(0xFFC9F456),
                            fontSize: 17,
                            fontWeight: FontWeight.w700)),
                    Text(original,
                        style: TextStyle(
                            color: Color(0x80FFFFFF),
                            fontSize: 11,
                            decoration: TextDecoration.lineThrough)),
                    SizedBox(height: 2),
                    DecoratedBox(
                        decoration: BoxDecoration(
                            color: Color(0xFFC9F456),
                            borderRadius:
                                BorderRadius.all(Radius.circular(20))),
                        child: Padding(
                            padding: EdgeInsets.symmetric(
                                horizontal: 12, vertical: 3),
                            child: Text('立即报名',
                                style: TextStyle(
                                    color: _ink,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700))))
                  ])
            ])),
      ]),
    );
  }

  Widget _countdown(HomeData data) {
    final hasExam = !widget.remoteEnabled ||
        (data.examYear?.isNotEmpty == true && data.daysRemaining != null);
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(8)),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(
              hasExam
                  ? '${data.examYear ?? (subjective ? '2024' : '2024')}${subjective ? '主观题' : '客观题'}考试'
                  : '考试安排暂未发布',
              style: const TextStyle(color: _muted, fontSize: 11)),
          const SizedBox(height: 3),
          const Text('距今还有',
              style: TextStyle(
                  color: _ink, fontSize: 13, fontWeight: FontWeight.w500))
        ]),
        Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(hasExam ? '${data.daysRemaining ?? 42}' : '--',
                  style: const TextStyle(
                      color: _brand,
                      fontSize: 28,
                      fontWeight: FontWeight.w700)),
              const SizedBox(width: 4),
              const Text('天', style: TextStyle(color: _body, fontSize: 13))
            ])
      ]),
    );
  }

  Widget _courses(BuildContext context, HomeData data) {
    const courses = [
      ('民法精讲课', '张明远', '¥1,980', 'p2', 'assets/images/course-civil-law.jpg'),
      ('刑法体系课', '李东明', '¥2,280', 'p1', 'assets/images/course-criminal-law.png'),
      ('主观题冲刺', '王晓峰', '¥1,280', 'p3', 'assets/images/course-subjective.jpg'),
    ];
    final remoteCourses = data.hotCourses;
    final count = widget.remoteEnabled ? remoteCourses.length : courses.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('热门课程',
                  style: TextStyle(
                      color: _ink, fontSize: 15, fontWeight: FontWeight.w600)),
              TextButton(
                  onPressed: widget.onOpenCourses ??
                      () => Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => CoursesScreen(
                                  remoteEnabled: widget.remoteEnabled))),
                  child: const Text('查看更多  ›',
                      style: TextStyle(color: _brand, fontSize: 13))),
            ],
          ),
        ),
        SizedBox(
          height: 174,
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            scrollDirection: Axis.horizontal,
            itemCount: count,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (_, index) {
              final course = widget.remoteEnabled ? null : courses[index];
              final remoteCourse =
                  widget.remoteEnabled ? remoteCourses[index] : null;
              final title = remoteCourse?.title ?? course!.$1;
              final teacher = remoteCourse?.teacher ?? course!.$2;
              final price = course?.$3 ??
                  (remoteCourse?.hasAccess == true
                      ? '已购课程'
                      : remoteCourse?.price != null
                          ? '¥${remoteCourse!.price!.toStringAsFixed(0)}'
                          : '查看课程');
              final cover = course?.$5 ?? 'assets/images/course-civil-law.jpg';
              return GestureDetector(
                onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => widget.remoteEnabled
                            ? CourseDetailScreen(
                                courseId: remoteCourse!.id,
                                title: remoteCourse.title,
                                remoteEnabled: true,
                              )
                            : ProductDetailScreen(
                                name: title,
                                brief: '$teacher主讲 · 系统课程',
                                price: price,
                                originalPrice: price,
                                coverColor: _brand,
                                icon: Icons.menu_book_outlined,
                                productId: course?.$4,
                                remoteEnabled: false,
                              ))),
                child: SizedBox(
                  width: 148,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(8)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        ClipRRect(
                          borderRadius: const BorderRadius.vertical(
                              top: Radius.circular(8)),
                          child: widget.remoteEnabled
                              ? const SizedBox(
                                  height: 88,
                                  width: double.infinity,
                                  child: ColoredBox(
                                      color: Color(0xFFE5E7ED),
                                      child: Icon(Icons.menu_book_outlined)))
                              : Image.asset(cover,
                                  height: 88,
                                  width: double.infinity,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) =>
                                      const ColoredBox(
                                          color: Color(0xFFDDE2EE))),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(10),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        color: _ink,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600)),
                                const SizedBox(height: 3),
                                Text('$teacher主讲',
                                    style: const TextStyle(
                                        color: _muted, fontSize: 11)),
                                const SizedBox(height: 6),
                                Text(price,
                                    style: const TextStyle(
                                        color: _brand,
                                        fontSize: 13,
                                        fontWeight: FontWeight.w700)),
                              ]),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _notice(HomeData data) {
    const notices = [
      ('考试', '2024年法律职业资格考试客观题考试时间定于9月14日、15日举行，请提前做好准备。'),
      ('课程', '民法精讲课第19-22讲已更新上线，已购学员可直接进入课程观看。'),
    ];
    final remoteNotices = data.announcements;
    final notice = widget.remoteEnabled && remoteNotices.isNotEmpty
        ? null
        : notices[noticeIndex.clamp(0, notices.length - 1)];
    final remoteNotice = remoteNotices.isEmpty
        ? null
        : remoteNotices[noticeIndex.clamp(0, remoteNotices.length - 1)];
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
      decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(left: BorderSide(color: _brand, width: 4))),
      child: Column(children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
              decoration: BoxDecoration(
                  color: const Color(0xFFFFF1E8),
                  borderRadius: BorderRadius.circular(4)),
              child: Text(remoteNotice?.title ?? notice!.$1,
                  style: const TextStyle(
                      color: Color(0xFFD2691E),
                      fontSize: 10,
                      fontWeight: FontWeight.w600))),
          const SizedBox(width: 8),
          Expanded(
              child: Text(remoteNotice?.body ?? notice!.$2,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: _body, fontSize: 12, height: 1.5))),
          GestureDetector(
              onTap: () => setState(() => showNotice = false),
              child:
                  const Icon(Icons.close, color: Color(0xFFC0C5D0), size: 15))
        ]),
        if ((widget.remoteEnabled ? remoteNotices.length : notices.length) > 1)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                  widget.remoteEnabled ? remoteNotices.length : notices.length,
                  (i) {
                return GestureDetector(
                  onTap: () => setState(() => noticeIndex = i),
                  child: Container(
                    width: i == noticeIndex ? 14 : 5,
                    height: 5,
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    decoration: BoxDecoration(
                      color:
                          i == noticeIndex ? _brand : const Color(0xFFC0C5D0),
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                );
              }),
            ),
          ),
        Align(
          alignment: Alignment.centerRight,
          child: GestureDetector(
            onTap: widget.onOpenAnnouncements ??
                () => Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => AnnouncementListScreen(
                            remoteEnabled: widget.remoteEnabled))),
            child: const Padding(
              padding: EdgeInsets.only(top: 7),
              child: Text('查看全部公告 →',
                  style: TextStyle(color: _brand, fontSize: 11)),
            ),
          ),
        ),
      ]),
    );
  }

  Widget _community(BuildContext context, List<ForumPost> remotePosts) {
    const posts = [
      (
        tag: '经验分享',
        title: '三战上岸经验分享：客观题从108到213的蜕变之路',
        likes: 342,
        replies: 87,
        pinned: true,
      ),
      (
        tag: '知识整理',
        title: '共同犯罪8大考点汇总，附真题解析（2019-2023）',
        likes: 186,
        replies: 43,
        pinned: false,
      ),
      (
        tag: '答疑求助',
        title: '善意取得中「合理价格」如何认定？有没有具体标准？',
        likes: 28,
        replies: 15,
        pinned: false,
      ),
    ];
    final postsToShow = widget.remoteEnabled
        ? remotePosts
        : posts
            .map((post) => ForumPost(
                  id: post.title,
                  title: post.title,
                  body: '',
                  likeCount: post.likes,
                  commentCount: post.replies,
                  category: post.tag,
                ))
            .toList();
    if (widget.remoteEnabled && postsToShow.isEmpty) {
      return Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: _emptySection('社区热帖', '暂无社区内容'));
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                '社区热帖',
                style: TextStyle(
                    color: _ink, fontSize: 15, fontWeight: FontWeight.w600),
              ),
              TextButton(
                onPressed: widget.onOpenForum ??
                    () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => CommunityForumScreen(
                                remoteEnabled: widget.remoteEnabled),
                          ),
                        ),
                child: const Text(
                  '进入论坛  ›',
                  style: TextStyle(color: _brand, fontSize: 13),
                ),
              ),
            ],
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              children: postsToShow.asMap().entries.map((entry) {
                final post = entry.value;
                final isLast = entry.key == postsToShow.length - 1;
                return InkWell(
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => ForumDetailScreen(
                        postId: widget.remoteEnabled ? post.id : null,
                        initialPost: widget.remoteEnabled ? post : null,
                        title: post.title,
                        body: post.body,
                        category: post.category ??
                            (widget.remoteEnabled ? '学习交流' : '经验分享'),
                        remoteEnabled: widget.remoteEnabled,
                      ),
                    ),
                  ),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 12),
                    decoration: BoxDecoration(
                      border: isLast
                          ? null
                          : const Border(
                              bottom: BorderSide(color: _line),
                            ),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  _postTag(post.category),
                                  if (!widget.remoteEnabled &&
                                      entry.key == 0) ...[
                                    const SizedBox(width: 5),
                                    const Icon(Icons.push_pin,
                                        color: Color(0xFFFF7252), size: 12),
                                  ],
                                ],
                              ),
                              const SizedBox(height: 5),
                              Text(
                                post.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style:
                                    const TextStyle(color: _ink, fontSize: 13),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.thumb_up_alt_outlined,
                                    color: Color(0xFFC0C5D0), size: 11),
                                const SizedBox(width: 3),
                                Text(
                                  '${post.likeCount}',
                                  style: const TextStyle(
                                      color: Color(0xFFC0C5D0), fontSize: 10),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${post.commentCount} 回复',
                              style: const TextStyle(
                                  color: Color(0xFFC0C5D0), fontSize: 10),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _postTag(String? category) {
    final tag = category?.trim().isNotEmpty == true ? category! : '经验分享';
    final Color background;
    final Color foreground;
    switch (tag) {
      case '答疑求助':
        background = const Color(0xFFFFF5DD);
        foreground = const Color(0xFFA87000);
      case '经验分享':
        background = const Color(0xFFEAF6EF);
        foreground = const Color(0xFF3A7A46);
      default:
        background = const Color(0xFFF0F0FF);
        foreground = _brand;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
          color: background, borderRadius: BorderRadius.circular(10)),
      child: Text(tag,
          style: TextStyle(
              color: foreground, fontSize: 10, fontWeight: FontWeight.w500)),
    );
  }

  Widget _emptySection(String title, String message) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(
                  color: _ink, fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Container(
              width: double.infinity,
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(8)),
              child: Text(message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: _muted, fontSize: 12))),
        ],
      );
}

class _Entry {
  const _Entry(this.icon, this.label, this.background, this.foreground);
  final IconData icon;
  final String label;
  final Color background;
  final Color foreground;
}

const _objectiveEntries = <_Entry>[
  _Entry(Icons.play_circle_outline, '我的课程', Color(0xFFF0F0FF), _brand),
  _Entry(Icons.menu_book_outlined, '题库入口', Color(0xFFEDF5FF), Color(0xFF1A5FA8)),
  _Entry(Icons.fact_check_outlined, '考试', Color(0xFFFFF1E8), Color(0xFFD2691E)),
  _Entry(
      Icons.folder_open_outlined, '学习资料', Color(0xFFEAF7F7), Color(0xFF1A8B8B)),
  _Entry(Icons.error_outline, '错题本', Color(0xFFFFF1E8), Color(0xFFD2691E)),
  _Entry(Icons.star_border, '收藏夹', Color(0xFFFFF5DD), Color(0xFFA87000)),
  _Entry(
      Icons.chat_bubble_outline, 'AI答疑', Color(0xFFEAF6EF), Color(0xFF1A8B8B)),
];

const _subjectiveEntries = <_Entry>[
  _Entry(Icons.play_circle_outline, '课程', Color(0xFFF0F0FF), _brand),
  _Entry(Icons.balance_outlined, '法条检索', Color(0xFFEAF7F7), Color(0xFF1A8B8B)),
  _Entry(
      Icons.folder_open_outlined, '学习资料', Color(0xFFEAF7F7), Color(0xFF1A8B8B)),
  _Entry(Icons.star_border, '收藏夹', Color(0xFFFFF5DD), Color(0xFFA87000)),
  _Entry(Icons.edit_note, '批改', Color(0xFFFFF1E8), Color(0xFFD2691E)),
  _Entry(
      Icons.chat_bubble_outline, 'AI答疑', Color(0xFFEAF6EF), Color(0xFF1A8B8B)),
];

class ObjectiveExamListScreen extends ConsumerWidget {
  const ObjectiveExamListScreen({super.key, this.remoteEnabled = true});
  final bool remoteEnabled;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = remoteEnabled
        ? ref.watch(objectivePapersProvider)
        : const AsyncValue<List<JsonMap>>.data([]);
    return Scaffold(
        appBar: AppBar(title: const Text('客观题考试')),
        body: state.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(child: Text('考试内容暂时不可用：$error')),
          data: (items) => items.isEmpty
              ? const Center(child: Text('暂无已发布考试'))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: items.map((paper) {
                    final advanced = paper['mode'] == 'advanced';
                    return Card(
                        child: ListTile(
                            leading: Icon(advanced
                                ? Icons.lock_outline
                                : Icons.fact_check_outlined),
                            title: Text('${paper['title'] ?? '客观题考试'}'),
                            subtitle: Text(
                                '${advanced ? '进阶考试 · 付费' : paper['mode'] == 'marketing' ? '营销考试' : '公开考试'} · ${paper['questionCount'] ?? 0}题'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => ObjectiveAnswerScreen(
                                        title: '${paper['title'] ?? '客观题考试'}',
                                        remoteEnabled: remoteEnabled,
                                        mode: 'exam',
                                        paperId: '${paper['id']}')))));
                  }).toList()),
        ));
  }
}

class StudyMaterialsScreen extends StatelessWidget {
  const StudyMaterialsScreen({super.key, this.remoteEnabled = true});
  final bool remoteEnabled;
  @override
  Widget build(BuildContext context) =>
      ProviderScope(child: _StudyMaterialsBody(remoteEnabled: remoteEnabled));
}

class _StudyMaterialsBody extends ConsumerStatefulWidget {
  const _StudyMaterialsBody({required this.remoteEnabled});
  final bool remoteEnabled;

  @override
  ConsumerState<_StudyMaterialsBody> createState() => _StudyMaterialsBodyState();
}

class _StudyMaterialsBodyState extends ConsumerState<_StudyMaterialsBody> {
  String _selectedCategory = '全部';

  @override
  Widget build(BuildContext context) {
    final state = widget.remoteEnabled
        ? ref.watch(studyMaterialsProvider)
        : const AsyncValue<List<JsonMap>>.data([]);
    return Scaffold(
      appBar: AppBar(title: const Text('学习资料')),
      body: state.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('资料暂时不可用：$e')),
        data: (items) {
          if (items.isEmpty) return const Center(child: Text('暂无已发布学习资料'));
          final categories = <String>{
            '全部',
            ...items.map((item) => '${item['category'] ?? '未分类'}')
          };
          final filtered = _selectedCategory == '全部'
              ? items
              : items.where((item) => '${item['category'] ?? '未分类'}' == _selectedCategory).toList();
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Wrap(
                  spacing: 8,
                  children: categories
                      .map((category) => ChoiceChip(
                            label: Text(category),
                            selected: category == _selectedCategory,
                            onSelected: (_) => setState(() => _selectedCategory = category),
                          ))
                      .toList()),
              if (filtered.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: Text('该分类暂无资料')),
                ),
              ...filtered
                  .map((item) => Card(
                          child: ListTile(
                        leading: const Icon(Icons.article_outlined),
                        title: Text('${item['title'] ?? ''}'),
                        subtitle: Text(
                            '${item['category'] ?? '未分类'} · ${item['kind'] == 'article' ? '文章不可下载' : item['downloadable'] == true ? '资料可下载' : '资料在线查看'}'),
                        onTap: () => showDialog<void>(
                            context: context,
                            builder: (_) => AlertDialog(
                                  title: Text('${item['title'] ?? ''}'),
                                  content: Text(item['kind'] == 'article' &&
                                          '${item['content'] ?? ''}'
                                              .trim()
                                              .isNotEmpty
                                      ? '${item['content']}'
                                      : '该资料由后台上传，当前支持在线查看。\n\n${item['reference'] ?? ''}'),
                                  actions: [
                                    TextButton(
                                        onPressed: () => Navigator.pop(context),
                                        child: const Text('关闭'))
                                  ],
                                )),
                      )))
                  .toList()
            ],
          );
        },
      ),
    );
  }
}
