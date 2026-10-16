import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/providers.dart';
import 'models.dart';
import 'repositories.dart';

final userRepositoryProvider = Provider<UserRepository>(
    (ref) => UserRepository(ref.watch(apiClientProvider)));
final accountSecurityRepositoryProvider = Provider<AccountSecurityRepository>(
    (ref) => AccountSecurityRepository(ref.watch(apiClientProvider)));
final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository(
    ref.watch(apiClientProvider), ref.watch(secureTokenStoreProvider)));
final homeRepositoryProvider = Provider<HomeRepository>(
    (ref) => HomeRepository(ref.watch(apiClientProvider)));
final aiRepositoryProvider =
    Provider<AiRepository>((ref) => AiRepository(ref.watch(apiClientProvider)));
final questionRepositoryProvider = Provider<QuestionRepository>(
    (ref) => QuestionRepository(ref.watch(apiClientProvider)));
final courseRepositoryProvider = Provider<CourseRepository>(
    (ref) => CourseRepository(ref.watch(apiClientProvider)));
final commerceRepositoryProvider = Provider<CommerceRepository>(
    (ref) => CommerceRepository(ref.watch(apiClientProvider)));
final communityRepositoryProvider = Provider<CommunityRepository>(
    (ref) => CommunityRepository(ref.watch(apiClientProvider)));
final legalRepositoryProvider = Provider<LegalRepository>(
    (ref) => LegalRepository(ref.watch(apiClientProvider)));
final settingsRepositoryProvider = Provider<SettingsRepository>(
    (ref) => SettingsRepository(ref.watch(apiClientProvider)));
final gradingRepositoryProvider = Provider<GradingRepository>(
    (ref) => GradingRepository(ref.watch(apiClientProvider)));

final currentUserProvider = FutureProvider<UserProfile>(
    (ref) => ref.watch(userRepositoryProvider).me());
final accountIdentitiesProvider = FutureProvider<List<AccountIdentity>>(
    (ref) => ref.watch(accountSecurityRepositoryProvider).identities());
final accountDevicesProvider = FutureProvider<List<UserDevice>>(
    (ref) => ref.watch(accountSecurityRepositoryProvider).devices());
final accountDeletionProvider = FutureProvider<AccountDeletionStatus>(
    (ref) => ref.watch(accountSecurityRepositoryProvider).deletionStatus());
final homeDataProvider =
    FutureProvider<HomeData>((ref) => ref.watch(homeRepositoryProvider).home());
final studyMaterialsProvider = FutureProvider<List<JsonMap>>(
    (ref) => ref.watch(homeRepositoryProvider).materials());
final subjectsProvider = FutureProvider<List<Subject>>(
    (ref) => ref.watch(questionRepositoryProvider).subjects());
final objectivePapersProvider = FutureProvider<List<JsonMap>>(
    (ref) => ref.watch(questionRepositoryProvider).papers());
final questionListProvider = FutureProvider.family<List<Question>, String?>(
    (ref, subjectId) =>
        ref.watch(questionRepositoryProvider).questions(subjectId: subjectId));
final questionProvider = FutureProvider.family<Question?, String>(
    (ref, questionId) async => questionId.isEmpty
        ? null
        : ref.watch(questionRepositoryProvider).question(questionId));
final objectiveSessionProvider =
    FutureProvider.family<ObjectiveSession, ObjectiveSessionRequest>((ref,
            request) =>
        ref.watch(questionRepositoryProvider).openObjectiveSession(request));
final objectiveReportProvider = FutureProvider.family<ObjectiveReport, String>(
    (ref, sessionId) =>
        ref.watch(questionRepositoryProvider).objectiveReport(sessionId));
final learningInquiriesProvider = FutureProvider<List<LearningInquiry>>(
    (ref) => ref.watch(questionRepositoryProvider).inquiries());
final questionRecordsProvider = FutureProvider<List<JsonMap>>(
    (ref) => ref.watch(questionRepositoryProvider).records());
final questionRecordPageProvider =
    FutureProvider.family<QuestionRecordPage, QuestionRecordQuery>(
  (ref, query) => ref.watch(questionRepositoryProvider).recordPage(
        page: query.page,
        pageSize: query.pageSize,
        subjectId: query.subjectId,
        mode: query.mode,
      ),
);
final typedQuestionRecordsProvider = FutureProvider<List<QuestionRecord>>(
    (ref) => ref.watch(questionRepositoryProvider).typedRecords());
final learningQuestionRecordsProvider = FutureProvider<List<QuestionRecord>>(
    (ref) => ref.watch(questionRepositoryProvider).learningRecords());
final questionRecordReportProvider = FutureProvider.family<JsonMap, String>(
    (ref, submissionId) =>
        ref.watch(questionRepositoryProvider).recordReport(submissionId));
final favoritesProvider = FutureProvider<List<JsonMap>>(
    (ref) => ref.watch(questionRepositoryProvider).favorites());
final typedFavoritesProvider = FutureProvider<List<FavoriteItem>>(
    (ref) => ref.watch(questionRepositoryProvider).typedFavorites());
final legalFavoritesProvider = FutureProvider<List<LegalFavorite>>(
    (ref) => ref.watch(questionRepositoryProvider).legalFavorites());
final mistakesProvider = FutureProvider<List<JsonMap>>(
    (ref) => ref.watch(questionRepositoryProvider).mistakes());
final typedMistakesProvider = FutureProvider<List<MistakeItem>>(
    (ref) => ref.watch(questionRepositoryProvider).typedMistakes());
final coursesProvider = FutureProvider<List<Course>>(
    (ref) => ref.watch(courseRepositoryProvider).courses());
final courseProvider = FutureProvider.family<Course?, String>(
    (ref, id) => ref.watch(courseRepositoryProvider).detail(id));
final courseEntitlementProvider =
    FutureProvider.family<CourseEntitlement, String>(
        (ref, id) => ref.watch(courseRepositoryProvider).entitlement(id));
final liveSessionsProvider = FutureProvider.family<List<LiveSession>, String>(
    (ref, courseId) =>
        ref.watch(courseRepositoryProvider).liveSessions(courseId));
String mediaAvailabilityKey(String courseId, String kind) => '$kind:$courseId';

final mediaAvailabilityProvider =
    FutureProvider.family<MediaAvailability, String>((ref, key) {
  final separator = key.indexOf(':');
  final kind = separator < 0 ? 'media' : key.substring(0, separator);
  final courseId = separator < 0 ? key : key.substring(separator + 1);
  return ref.watch(courseRepositoryProvider).prepareMedia(courseId, kind);
});
final learningPlansProvider = FutureProvider<List<LearningPlan>>(
    (ref) => ref.watch(courseRepositoryProvider).plans());
final learningTasksProvider = FutureProvider<List<LearningTask>>(
    (ref) => ref.watch(courseRepositoryProvider).tasks());
final earlyAccessProvider = FutureProvider<List<EarlyAccessRequest>>(
    (ref) => ref.watch(courseRepositoryProvider).earlyAccessRequests());
final learningDiagnosticProvider = FutureProvider<LearningDiagnosticState>(
    (ref) => ref.watch(courseRepositoryProvider).diagnostic());
final learningCardProvider = FutureProvider.family<LearningCard?, String>(
    (ref, id) => ref.watch(courseRepositoryProvider).card(id));
final learningSubjectiveQuestionProvider =
    FutureProvider.family<LearningSubjectiveQuestion?, String>((ref, id) =>
        ref.watch(courseRepositoryProvider).subjectiveQuestion(id));
final learningReportProvider = FutureProvider.family<LearningReport, String>(
    (ref, period) =>
        ref.watch(courseRepositoryProvider).report(period: period));
final productsProvider = FutureProvider<List<Product>>(
    (ref) => ref.watch(commerceRepositoryProvider).products());
final productProvider = FutureProvider.family<Product, String>(
    (ref, id) => ref.watch(commerceRepositoryProvider).product(id));
final ordersProvider = FutureProvider<List<Order>>(
    (ref) => ref.watch(commerceRepositoryProvider).orders());
final orderProvider = FutureProvider.family<Order, String>(
    (ref, id) => ref.watch(commerceRepositoryProvider).order(id));
final notificationsProvider = FutureProvider<List<NotificationItem>>(
    (ref) => ref.watch(communityRepositoryProvider).notifications());
final forumPostsProvider = FutureProvider.family<List<ForumPost>, String>(
    (ref, scope) => ref.watch(communityRepositoryProvider).posts(scope: scope));
// Cursor-aware providers are used by the RC-aligned forum surfaces.  The
// existing list provider above is retained for simple dashboard widgets and
// backwards-compatible tests.
final forumPostPageProvider = FutureProvider.family<ForumPage<ForumPost>,
        ({String? category, String scope, String? cursor})>(
    (ref, input) => ref.watch(communityRepositoryProvider).postPage(
        category: input.category, scope: input.scope, cursor: input.cursor));
final forumPostProvider = FutureProvider.family<ForumPost, String>(
    (ref, id) => ref.watch(communityRepositoryProvider).postDetail(id));
final forumCommentsProvider = FutureProvider.family<List<ForumComment>, String>(
    (ref, postId) => ref.watch(communityRepositoryProvider).comments(postId));
final forumCommentPageProvider = FutureProvider.family<ForumPage<ForumComment>,
        ({String postId, String? cursor})>(
    (ref, input) => ref
        .watch(communityRepositoryProvider)
        .commentPage(input.postId, cursor: input.cursor));
final gradingSubmissionsProvider = FutureProvider<List<GradingSubmission>>(
    (ref) => ref.watch(gradingRepositoryProvider).submissions());
final gradingQuestionsProvider =
    FutureProvider.family<List<GradingQuestion>, String?>((ref, subjectId) =>
        ref.watch(gradingRepositoryProvider).questions(subjectId: subjectId));
final gradingPapersProvider =
    FutureProvider.family<List<GradingPaper>, String?>((ref, subjectId) =>
        ref.watch(gradingRepositoryProvider).typedPapers(subjectId: subjectId));
final gradingPaperProvider = FutureProvider.family<GradingPaper, String>(
    (ref, id) => ref.watch(gradingRepositoryProvider).paper(id));
final gradingQuestionProvider = FutureProvider.family<GradingQuestion, String>(
    (ref, id) => ref.watch(gradingRepositoryProvider).question(id));
final gradingSubmissionProvider =
    FutureProvider.family<GradingSubmission, String>(
        (ref, id) => ref.watch(gradingRepositoryProvider).submission(id));
final gradingReportProvider = FutureProvider.family<GradingReport, String>(
    (ref, id) => ref.watch(gradingRepositoryProvider).report(id));
final legalSearchProvider = FutureProvider.family<List<LegalDocument>, String>(
    (ref, query) => ref.watch(legalRepositoryProvider).search(query));
final filteredLegalSearchProvider =
    FutureProvider.family<List<LegalDocument>, LegalSearchQuery>(
        (ref, request) => ref.watch(legalRepositoryProvider).search(
              request.query,
              subjectId: request.subjectId,
            ));
final legalDocumentProvider = FutureProvider.family<AppLegalDocument, String>(
    (ref, key) => ref.watch(legalRepositoryProvider).document(key));
final userSettingsProvider = FutureProvider<UserSettings>(
    (ref) => ref.watch(settingsRepositoryProvider).settings());
