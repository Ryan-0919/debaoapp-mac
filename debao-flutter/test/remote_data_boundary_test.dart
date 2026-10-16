import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:debao_flutter/data/models.dart';
import 'package:debao_flutter/data/providers.dart';
import 'package:debao_flutter/features/commerce/commerce_detail_screens.dart';
import 'package:debao_flutter/features/courses/courses_screen.dart';
import 'package:debao_flutter/features/account/account_service_screens.dart';
import 'package:debao_flutter/features/profile/profile_screen.dart';
import 'package:debao_flutter/features/questions/subjective_screens.dart';
import 'package:debao_flutter/features/questions/objective_answer_screen.dart';
import 'package:debao_flutter/features/community/forum_screens.dart';
import 'package:debao_flutter/features/tools/study_tools_screens.dart';

void main() {
  testWidgets('远端订单空列表不回退到本地演示订单', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        ordersProvider.overrideWith((ref) async => const <Order>[]),
      ],
      child: const MaterialApp(home: OrderListScreen(remoteEnabled: true)),
    ));
    await tester.pump();
    expect(find.byKey(const ValueKey('orders-loading')), findsNothing);
    expect(find.text('暂无订单'), findsOneWidget);
    expect(find.text('民法精讲课（2024版）'), findsNothing);
  });

  testWidgets('远端订单初次失败显示错误和重试', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        ordersProvider.overrideWith((ref) async => throw StateError('offline')),
      ],
      child: const MaterialApp(home: OrderListScreen(remoteEnabled: true)),
    ));
    await tester.pump();
    expect(find.text('订单服务暂不可用'), findsOneWidget);
    expect(find.byKey(const ValueKey('orders-retry')), findsOneWidget);
    expect(find.text('DB202608270001'), findsNothing);
  });

  testWidgets('远端订单详情按订单编号读取服务端字段', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        orderProvider('o1').overrideWith((ref) async => const Order(
              id: 'o1',
              productName: '服务端课程',
              amount: 129,
              status: 'paid',
              createdAt: '2026-09-01T12:00:00Z',
              productId: 'p1',
              courseId: 'c1',
            )),
      ],
      child: const MaterialApp(
        home: OrderDetailScreen(
          title: '列表占位标题',
          amount: '¥0',
          status: '处理中',
          orderNo: 'o1',
          remoteEnabled: true,
        ),
      ),
    ));
    await tester.pump();
    await tester.pumpAndSettle();
    expect(find.text('服务端课程'), findsOneWidget);
    expect(find.text('¥129'), findsOneWidget);
    expect(find.text('列表占位标题'), findsNothing);
    expect(find.text('处理中'), findsNothing);
  });

  testWidgets('远端订单详情失败不渲染列表占位内容', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        orderProvider('missing')
            .overrideWith((ref) async => throw StateError('order unavailable')),
      ],
      child: const MaterialApp(
        home: OrderDetailScreen(
          title: '不应显示',
          amount: '¥1',
          orderNo: 'missing',
          remoteEnabled: true,
        ),
      ),
    ));
    await tester.pump();
    await tester.pumpAndSettle();
    expect(find.text('订单详情暂不可用'), findsOneWidget);
    expect(find.byKey(const ValueKey('order-detail-retry')), findsOneWidget);
    expect(find.text('不应显示'), findsNothing);
  });

  testWidgets('远端个人中心空数据使用明确空态而非固定用户摘要', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) async =>
            const UserProfile(id: 'u1', name: '', examYear: null)),
        coursesProvider.overrideWith((ref) async => const <Course>[]),
        ordersProvider.overrideWith((ref) async => const <Order>[]),
        learningReportProvider('week').overrideWith((ref) async =>
            const LearningReport(
                period: 'week',
                minutes: 0,
                answered: 0,
                correctRate: 0,
                subjects: [])),
        typedMistakesProvider
            .overrideWith((ref) async => const <MistakeItem>[]),
      ],
      child: const MaterialApp(home: ProfileScreen(remoteEnabled: true)),
    ));
    await tester.pump();
    expect(find.text('暂无已开通课程'), findsOneWidget);
    expect(find.text('未设置昵称'), findsOneWidget);
    expect(find.text('民法精讲课（2024版）'), findsNothing);
    expect(find.text('2'), findsNothing);
  });

  testWidgets('远端商品详情加载失败不显示静态商品详情', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        productProvider('p1').overrideWith(
            (ref) async => throw StateError('product unavailable')),
      ],
      child: const MaterialApp(
        home: ProductDetailScreen(
          name: 'placeholder',
          brief: 'placeholder',
          price: '0',
          originalPrice: '0',
          coverColor: Colors.blue,
          icon: Icons.menu_book,
          productId: 'p1',
          remoteEnabled: true,
        ),
      ),
    ));
    await tester.pump();
    expect(find.text('商品详情暂不可用'), findsOneWidget);
    expect(find.byKey(const ValueKey('product-retry')), findsOneWidget);
    expect(find.text('placeholder'), findsNothing);
  });

  testWidgets('远端商品详情只显示服务端可用字段', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        productProvider('p9').overrideWith((ref) async => const Product(
              id: 'p9',
              name: '服务端商品',
              category: '客观题',
              type: 'video',
              price: 680,
              originalPrice: 880,
              sold: 12,
              benefits: ['服务端权益'],
            )),
      ],
      child: const MaterialApp(
        home: ProductDetailScreen(
          name: 'placeholder',
          brief: 'placeholder',
          price: '0',
          originalPrice: '0',
          coverColor: Colors.blue,
          icon: Icons.menu_book,
          productId: 'p9',
          remoteEnabled: true,
        ),
      ),
    ));
    await tester.pump();
    expect(find.text('服务端商品'), findsOneWidget);
    expect(find.text('服务端权益'), findsAtLeastNWidgets(1));
    expect(find.text('已售 12 份'), findsOneWidget);
    await tester.drag(find.byType(ListView).last, const Offset(0, -900));
    await tester.pump();
    expect(find.text('服务端暂未提供评价数据'), findsOneWidget);
    expect(find.text('张明远'), findsNothing);
    expect(find.text('placeholder'), findsNothing);
  });

  testWidgets('学习中心不提供本地全部课程回退入口', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        learningInquiriesProvider.overrideWith((ref) async => []),
        coursesProvider.overrideWith((ref) async => const <Course>[]),
        learningTasksProvider
            .overrideWith((ref) async => const <LearningTask>[]),
        learningDiagnosticProvider.overrideWith((ref) async =>
            const LearningDiagnosticState(
                access: 'none', productId: '', completed: true, questions: [])),
      ],
      child: const MaterialApp(home: CoursesScreen(remoteEnabled: true)),
    ));
    await tester.pump();
    expect(find.text('全部课程'), findsNothing);
    expect(find.text('请求权基础答题训练'), findsNothing);
    expect(find.text('法考全科音频串讲班'), findsNothing);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('learning-my-inquiries')), findsNothing);
  });

  testWidgets('远端批改套卷缺少编号时不回退本地演示页', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: GradingPaperDetailScreen(
        title: '本地占位套卷',
        remoteEnabled: true,
      ),
    ));
    expect(find.text('套卷编号缺失，请从批改服务重新打开。'), findsOneWidget);
    expect(find.text('上传答卷并提交'), findsNothing);
  });

  testWidgets('远端批改报告缺少编号时不回退本地报告', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: GradingReportScreen(
        title: '本地占位报告',
        remoteEnabled: true,
      ),
    ));
    expect(find.text('批改记录编号缺失，请从批改服务重新打开。'), findsOneWidget);
    expect(find.text('已提交，等待批改结果。'), findsNothing);
  });

  testWidgets('远端主观题缺少题目编号时不回退本地答案页', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: SubjectiveAnswerScreen(
        subject: '民法',
        paperTitle: '本地占位题',
        remoteEnabled: true,
      ),
    ));
    expect(find.text('题目编号缺失'), findsOneWidget);
    expect(find.text('请从题库重新打开这道题后再继续作答。'), findsOneWidget);
    expect(find.text('本地占位题'), findsNothing);
    expect(find.text('提交答案'), findsNothing);
  });

  testWidgets('远端帖子缺少编号时不回退占位详情', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: ForumDetailScreen(
        title: '本地占位帖子',
        body: '不应渲染的本地内容',
        category: '经验分享',
        remoteEnabled: true,
      ),
    ));
    expect(find.text('帖子编号缺失'), findsOneWidget);
    expect(find.text('本地占位帖子'), findsNothing);
    expect(find.text('不应渲染的本地内容'), findsNothing);
  });

  testWidgets('本地做题记录详情不发起远端报告请求', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: QuestionRecordDetailScreen(
        recordId: '',
        questionId: '',
        title: '本地做题记录',
        remoteEnabled: false,
      ),
    ));
    await tester.pump();
    expect(find.text('本地做题记录'), findsOneWidget);
    expect(find.text('正在加载答题详情…'), findsNothing);
  });

  testWidgets('远端客观题报告缺少会话编号时不读取任意历史记录', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: ObjectiveReportScreen(
        answers: <int?>[],
        remoteEnabled: true,
      ),
    ));
    expect(find.text('答题会话编号缺失'), findsOneWidget);
    expect(find.text('正在加载成绩'), findsNothing);
  });
}
