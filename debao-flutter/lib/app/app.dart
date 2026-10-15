import '../core/config/app_environment.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/home/home_screen.dart';
import '../features/commerce/mall_screen.dart';
import '../features/courses/courses_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/questions/question_bank_screen.dart';
import '../features/questions/objective_answer_screen.dart';
import '../features/questions/subjective_screens.dart';
import '../features/account/account_service_screens.dart';
import '../features/account/security_screens.dart';
import '../features/community/forum_screens.dart';
import '../features/community/announcements_screen.dart';
import '../features/tools/study_tools_screens.dart';
import '../features/courses/course_detail_screens.dart';
import '../features/commerce/commerce_detail_screens.dart';
import '../features/auth/login_screen.dart';
import '../features/learning/learning_center_screens.dart';
import '../features/learning/learning_inquiries_screen.dart';
import '../shared/web_phone_frame.dart';
import '../data/models.dart';
import '../data/providers.dart';
import '../core/network/api_client.dart';

String _query(GoRouterState state, String key, [String fallback = '']) =>
    state.uri.queryParameters[key] ?? fallback;

/// Accept the navigation parameter names used by the RN reference app as
/// well as the legacy Flutter deep-link names.  Native bridges and web links
/// can therefore target the same screen without dropping context.
String _queryAny(GoRouterState state, List<String> keys,
        [String fallback = '']) =>
    keys
        .map((key) => state.uri.queryParameters[key])
        .whereType<String>()
        .firstWhere((value) => value.trim().isNotEmpty, orElse: () => fallback);

int _queryInt(GoRouterState state, List<String> keys, [int fallback = 0]) =>
    int.tryParse(_queryAny(state, keys)) ?? fallback;

bool _queryBool(GoRouterState state, String key) =>
    _query(state, key).toLowerCase() == 'true';

List<int?> _queryAnswers(GoRouterState state) {
  final raw = _query(state, 'answers');
  if (raw.trim().isEmpty) return const <int?>[];
  return raw.split(',').map((item) {
    final value = int.tryParse(item.trim());
    return value;
  }).toList();
}

GoRouter _createRouter({bool remoteEnabled = remoteDataDefault}) => GoRouter(
      initialLocation: '/',
      routes: <RouteBase>[
        GoRoute(
          path: '/login',
          name: 'login',
          builder: (BuildContext context, GoRouterState state) =>
              LoginScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/',
          name: 'home',
          builder: (BuildContext context, GoRouterState state) => AppShell(
            remoteEnabled: remoteEnabled,
            initialTab: _tabIndex(state),
          ),
        ),

        // Question flows
        GoRoute(
          path: '/questions/subjective',
          name: 'subjective-select',
          builder: (context, state) => SubjectiveSelectScreen(
              subject: _query(state, 'subject', '主观题'),
              subjectId: _query(state, 'subjectId'),
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/questions/subjective/answer',
          name: 'subjective-answer',
          builder: (context, state) => SubjectiveAnswerScreen(
              subject: _queryAny(state, const ['subjectName', 'subject'], '民法'),
              paperTitle: _queryAny(state, const ['paperTitle', 'title']),
              questionIndex: _queryInt(state, const ['questionIndex', 'index']),
              questionId:
                  _queryAny(state, const ['gradingQuestionId', 'questionId']),
              paperId: _queryAny(state, const ['gradingPaperId', 'paperId']),
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/questions/subjective/success',
          name: 'subjective-submit-success',
          builder: (context, state) => SubjectiveSubmitSuccessScreen(
              submissionId: _query(state, 'submissionId'),
              status: _query(state, 'status'),
              reportTitle: _queryAny(
                  state, const ['reportTitle', 'questionTitle', 'title']),
              paperId: _queryAny(state, const ['paperId', 'gradingPaperId']),
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/questions/objective',
          name: 'objective-answer',
          builder: (context, state) => ObjectiveAnswerScreen(
              title: _query(state, 'title', '民法总则'),
              subjectId: _query(state, 'subjectId'),
              mode: _query(state, 'mode', 'chapter'),
              paperId: _query(state, 'paperId'),
              sessionId: _query(state, 'sessionId'),
              questionIds: _query(state, 'questionId').isEmpty
                  ? const []
                  : <String>[_query(state, 'questionId')],
              learningTaskId: _query(state, 'taskId'),
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/questions/objective/report',
          name: 'objective-report',
          builder: (context, state) => ObjectiveReportScreen(
              answers: _queryAnswers(state),
              title: _query(state, 'title', '答题报告'),
              sessionId: _query(state, 'sessionId'),
              // Only the local fixture router may render the deterministic
              // RC sample. Remote deep links must provide a server session;
              // otherwise ObjectiveReportScreen shows its explicit boundary.
              demoFixture: !remoteEnabled,
              remoteEnabled: remoteEnabled),
        ),

        // Commerce flows
        GoRoute(
          path: '/commerce/product/:productId',
          name: 'product-detail',
          builder: (context, state) => ProductDetailScreen(
              name: _query(state, 'name', '课程商品'),
              brief: _query(state, 'brief', '得宝法考课程'),
              price: _query(state, 'price', '1980'),
              originalPrice: _query(state, 'originalPrice', '2280'),
              coverColor: const Color(0xFF4C4BEA),
              icon: Icons.menu_book_outlined,
              productId: state.pathParameters['productId'],
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/commerce/purchase/success',
          name: 'purchase-success',
          builder: (context, state) => PurchaseSuccessScreen(
              productName: _query(state, 'productName', '得宝课程'),
              productId: _query(state, 'productId'),
              orderId: _query(state, 'orderId'),
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/commerce/purchase/pending',
          name: 'purchase-pending',
          builder: (context, state) => PurchasePendingScreen(
              productName: _query(state, 'productName', '得宝课程'),
              orderId: _query(state, 'orderId')),
        ),
        GoRoute(
          path: '/commerce/orders',
          name: 'order-list',
          builder: (context, state) =>
              OrderListScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/commerce/orders/:orderId',
          name: 'order-detail',
          builder: (context, state) => OrderDetailScreen(
              title: _query(state, 'title', '课程订单'),
              amount: _query(state, 'amount', '¥0'),
              status: _query(state, 'status', '待支付'),
              orderNo: state.pathParameters['orderId'] ?? '',
              productId: _query(state, 'productId'),
              courseId: _query(state, 'courseId'),
              remoteEnabled: remoteEnabled),
        ),

        // Course and media flows
        GoRoute(
          path: '/courses/:courseId',
          name: 'course-detail',
          builder: (context, state) => CourseDetailScreen(
              courseId: state.pathParameters['courseId'] ?? 'c1',
              title: _query(state, 'title'),
              audio: _queryBool(state, 'audio'),
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/courses/:courseId/video',
          name: 'video-player',
          builder: (context, state) => VideoPlayerScreen(
              courseId: state.pathParameters['courseId'] ?? 'c1',
              lessonId: _query(state, 'lessonId'),
              title: _query(state, 'title'),
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/courses/:courseId/audio',
          name: 'audio-player',
          builder: (context, state) => AudioPlayerScreen(
              courseId: state.pathParameters['courseId'] ?? 'c1',
              lessonId: _query(state, 'lessonId'),
              title: _query(state, 'title'),
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/courses/:courseId/live',
          name: 'live-course',
          builder: (context, state) => CourseDetailScreen(
              courseId: state.pathParameters['courseId'] ?? 'c3',
              title: _query(state, 'title'),
              remoteEnabled: remoteEnabled),
        ),

        // Study tools
        GoRoute(
          path: '/learning',
          name: 'learning-center',
          builder: (context, state) =>
              LearningCenterScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(path: '/learning/inquiries',
          builder: (context, state) => const LearningInquiriesScreen()),
        GoRoute(
          path: '/learning/diagnostic',
          name: 'learning-diagnostic',
          builder: (context, state) => const LearningDiagnosticRouteScreen(),
        ),
        GoRoute(
          path: '/tools/learning-report',
          name: 'learning-report',
          builder: (context, state) =>
              LearningReportScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/tools/learning-plan',
          name: 'learning-plan',
          builder: (context, state) =>
              LearningPlanScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/tools/mistakes',
          name: 'mistake-book',
          builder: (context, state) =>
              MistakeBookScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/tools/favorites',
          name: 'favorites',
          builder: (context, state) =>
              FavoritesScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/tools/law',
          name: 'law-search',
          builder: (context, state) => LawSearchScreen(
              remoteEnabled: remoteEnabled,
              source: _query(state, 'source'),
              subject: _query(state, 'subject')),
        ),
        GoRoute(
          path: '/tools/question-records',
          name: 'question-records',
          builder: (context, state) =>
              QuestionRecordsScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/tools/question-records/:recordId',
          name: 'question-record-detail',
          builder: (context, state) => QuestionRecordDetailScreen(
              recordId: state.pathParameters['recordId'] ?? '',
              questionId: _query(state, 'questionId'),
              title: _query(state, 'title', '答题记录'),
              remoteEnabled: remoteEnabled),
        ),

        // Community and account flows
        GoRoute(
          path: '/community/forum',
          name: 'forum',
          builder: (context, state) =>
              CommunityForumScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/community/forum/compose',
          name: 'forum-compose',
          builder: (context, state) =>
              ForumComposeScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/community/forum/:postId',
          name: 'forum-detail',
          builder: (context, state) {
            final postId = state.pathParameters['postId'];
            // A clean local deep link should open the same deterministic RC
            // fixture as the forum list.  Query parameters still override
            // the copy so native/deep-link callers can supply a new post.
            final matchingFixtures = !remoteEnabled && postId != null
                ? localForumFixtures.where((item) => item.id == postId)
                : const <ForumPost>[];
            final fixture =
                matchingFixtures.isEmpty ? null : matchingFixtures.first;
            return ForumDetailScreen(
                title: _query(state, 'title', fixture?.title ?? '社区帖子'),
                body: _query(state, 'body', fixture?.body ?? ''),
                category:
                    _query(state, 'category', fixture?.category ?? '经验分享'),
                postId: remoteEnabled ? postId : null,
                initialPost: fixture,
                remoteEnabled: remoteEnabled);
          },
        ),
        GoRoute(
          path: '/account/ai',
          name: 'ai-chat',
          builder: (context, state) =>
              AIChatScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/account/profile',
          name: 'user-profile',
          builder: (context, state) =>
              UserProfileScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/account/settings',
          name: 'settings',
          builder: (context, state) =>
              SettingsScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/account/security',
          name: 'account-security',
          builder: (context, state) =>
              AccountSecurityScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/account/legal/:document',
          name: 'legal-document',
          builder: (context, state) => LegalDocumentScreen(
              document: state.pathParameters['document'] ?? 'privacy',
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/account/notifications',
          name: 'notifications',
          builder: (context, state) =>
              NotificationsScreen(remoteEnabled: remoteEnabled),
        ),

        // Grading flows
        GoRoute(
          path: '/grading',
          name: 'grading',
          builder: (context, state) =>
              GradingServiceScreen(remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/grading/paper/:paperId',
          name: 'grading-paper-detail',
          builder: (context, state) => GradingPaperDetailScreen(
              title: _query(state, 'title', '主观题试卷'),
              paperId: state.pathParameters['paperId'],
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/grading/success',
          name: 'grading-submit-success',
          builder: (context, state) => SubjectiveSubmitSuccessScreen(
              submissionId: _query(state, 'submissionId'),
              status: _query(state, 'status'),
              reportTitle: _queryAny(
                  state, const ['questionTitle', 'title', 'reportTitle']),
              paperId: _queryAny(state, const ['paperId', 'gradingPaperId']),
              remoteEnabled: remoteEnabled),
        ),
        GoRoute(
          path: '/grading/report/:submissionId',
          name: 'grading-report',
          builder: (context, state) => GradingReportScreen(
              title: _query(state, 'title', '批改报告'),
              submissionId: state.pathParameters['submissionId'],
              remoteEnabled: remoteEnabled),
        ),
      ],
    );

int _tabIndex(GoRouterState state) {
  switch (_query(state, 'tab').trim().toLowerCase()) {
    case 'questions':
    case 'question':
    case '题库':
      return 1;
    case 'mall':
    case '商城':
      return 2;
    case 'courses':
    case 'course':
    case '课程':
    case '学习中心':
      return 3;
    case 'profile':
    case 'me':
    case '我的':
      return 4;
    default:
      return 0;
  }
}

/// Creates an isolated router for deep-link and integration tests. The
/// production entry point uses the same route table with remote data enabled.
GoRouter createAppRouter({bool remoteEnabled = remoteDataDefault}) =>
    _createRouter(remoteEnabled: remoteEnabled);

/// Local fixture router retained for deterministic widget previews.
final GoRouter appRouter = createAppRouter(remoteEnabled: false);

class DebaoApp extends StatelessWidget {
  const DebaoApp({super.key, this.remoteEnabled = remoteDataDefault});
  final bool remoteEnabled;

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      child: MaterialApp.router(
        title: '得宝',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1D4ED8)),
          useMaterial3: true,
          scaffoldBackgroundColor: const Color(0xFFF7F8FA),
          fontFamily: 'NotoSansSC',
          appBarTheme: const AppBarTheme(
            toolbarHeight: 52,
            titleTextStyle: TextStyle(
                color: Color(0xFF171925),
                fontSize: 16,
                fontWeight: FontWeight.w700),
            elevation: 0,
          ),
        ),
        builder: (context, child) =>
            DebaoWebPhoneFrame(child: child ?? const SizedBox.shrink()),
        routerConfig:
            remoteEnabled ? createAppRouter(remoteEnabled: true) : appRouter,
      ),
    );
  }
}

class AppShell extends ConsumerStatefulWidget {
  const AppShell({
    super.key,
    this.remoteEnabled = remoteDataDefault,
    this.initialTab = 0,
  });
  final bool remoteEnabled;
  final int initialTab;

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int tabIndex = 0;

  @override
  void initState() {
    super.initState();
    tabIndex = widget.initialTab.clamp(0, 4).toInt();
  }

  @override
  void didUpdateWidget(covariant AppShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialTab != widget.initialTab) {
      tabIndex = widget.initialTab.clamp(0, 4).toInt();
    }
  }

  @override
  Widget build(BuildContext context) {
    final privateTab = tabIndex == 3 || tabIndex == 4;
    final user = widget.remoteEnabled && privateTab
        ? ref.watch(currentUserProvider)
        : null;
    final needsLogin = user?.error is ApiError &&
        (user!.error as ApiError).statusCode == 401;
    final screens = <Widget>[
      HomeScreen(
        onOpenQuestionBank: () => setState(() => tabIndex = 1),
        onOpenQuestionRecords: () => Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => QuestionRecordsScreen(
                    remoteEnabled: widget.remoteEnabled))),
        onOpenCourses: () => Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => CoursesScreen(
                    remoteEnabled: widget.remoteEnabled,
                    coursePage: true,
                    showBackButton: true))),
        remoteEnabled: widget.remoteEnabled,
        onOpenNotifications: () => Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) =>
                    NotificationsScreen(remoteEnabled: widget.remoteEnabled))),
        onOpenForum: () => Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) =>
                    CommunityForumScreen(remoteEnabled: widget.remoteEnabled))),
        onOpenAnnouncements: () => Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => AnnouncementListScreen(
                    remoteEnabled: widget.remoteEnabled))),
      ),
      QuestionBankScreen(remoteEnabled: widget.remoteEnabled),
      // Only fetch tab-specific remote data once its tab is visible. This
      // keeps the shell from starting duplicate requests for hidden tabs.
      MallScreen(remoteEnabled: widget.remoteEnabled),
      CoursesScreen(remoteEnabled: widget.remoteEnabled),
      ProfileScreen(remoteEnabled: widget.remoteEnabled),
    ];

    return Scaffold(
      body: needsLogin
          ? LoginScreen(remoteEnabled: true)
          : screens[tabIndex],
      bottomNavigationBar: _BottomNav(
        index: tabIndex,
        onChanged: (index) => setState(() => tabIndex = index),
      ),
    );
  }
}

class _BottomNav extends StatelessWidget {
  const _BottomNav({required this.index, required this.onChanged});

  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    const items = <({IconData inactive, IconData active, String label})>[
      (inactive: Icons.home_outlined, active: Icons.home, label: '首页'),
      (
        inactive: Icons.menu_book_outlined,
        active: Icons.menu_book,
        label: '题库'
      ),
      (
        inactive: Icons.shopping_bag_outlined,
        active: Icons.shopping_bag,
        label: '商城'
      ),
      (
        inactive: Icons.play_circle_outline,
        active: Icons.play_circle,
        label: '学习中心'
      ),
      (inactive: Icons.person_outline, active: Icons.person, label: '我的'),
    ];

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFE5E7ED))),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: items.asMap().entries.map((entry) {
            final selected = entry.key == index;
            final item = entry.value;
            return Expanded(
              child: InkWell(
                onTap: () => onChanged(entry.key),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        selected ? item.active : item.inactive,
                        color: selected
                            ? const Color(0xFF4C4BEA)
                            : const Color(0xFF707684),
                        size: 22,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item.label,
                        style: TextStyle(
                          color: selected
                              ? const Color(0xFF4C4BEA)
                              : const Color(0xFF707684),
                          fontSize: 10,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }
}
