typedef JsonMap = Map<String, dynamic>;

class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
    this.profile,
  });

  final String accessToken;
  final String refreshToken;
  final int expiresIn;
  final UserProfile? profile;

  factory AuthSession.fromJson(JsonMap json) => AuthSession(
        accessToken: '${json['accessToken'] ?? ''}',
        refreshToken: '${json['refreshToken'] ?? ''}',
        expiresIn: (json['expiresIn'] as num?)?.toInt() ?? 0,
        profile: json['profile'] is JsonMap
            ? UserProfile.fromJson(json['profile'] as JsonMap)
            : null,
      );
}

class AuthCodeResult {
  const AuthCodeResult({
    required this.accepted,
    required this.expiresIn,
    this.developmentCode,
  });

  final bool accepted;
  final int expiresIn;
  final String? developmentCode;

  factory AuthCodeResult.fromJson(JsonMap json) => AuthCodeResult(
        accepted: json['accepted'] == true,
        expiresIn: (json['expiresIn'] as num?)?.toInt() ?? 0,
        developmentCode: json['developmentCode'] as String?,
      );
}

class AuthProviderAvailability {
  const AuthProviderAvailability({
    required this.sms,
    required this.wechat,
    required this.oneClick,
  });

  final bool sms;
  final bool wechat;
  final bool oneClick;

  factory AuthProviderAvailability.fromJson(JsonMap json) {
    bool available(String key) {
      final value = json[key];
      return value is JsonMap ? value['available'] == true : value == true;
    }

    return AuthProviderAvailability(
      sms: available('sms'),
      wechat: available('wechat'),
      oneClick: available('oneClick'),
    );
  }
}

class UserProfile {
  const UserProfile(
      {required this.id,
      required this.name,
      this.phone,
      this.examYear,
      this.studyDays,
      this.avatarColor,
      this.avatarUrl});
  final String id;
  final String name;
  final String? phone;
  final String? examYear;
  final int? studyDays;
  final String? avatarColor;
  final String? avatarUrl;

  factory UserProfile.fromJson(JsonMap json) => UserProfile(
        id: '${json['id'] ?? ''}',
        name: '${json['name'] ?? json['nickname'] ?? ''}',
        phone: json['phone'] as String?,
        examYear: json['examYear'] as String?,
        studyDays: (json['studyDays'] as num?)?.toInt(),
        avatarColor: json['avatarColor'] as String?,
        avatarUrl: json['avatarUrl'] as String?,
      );
}

class HomeBanner {
  const HomeBanner({
    required this.id,
    required this.title,
    required this.imageUrl,
    required this.target,
  });

  final String id;
  final String title;
  final String imageUrl;
  final String target;

  factory HomeBanner.fromJson(JsonMap json) => HomeBanner(
        id: '${json['id'] ?? ''}',
        title: '${json['title'] ?? ''}',
        imageUrl: '${json['imageUrl'] ?? ''}',
        target: '${json['target'] ?? ''}',
      );
}

class HomeAnnouncement {
  const HomeAnnouncement({
    required this.id,
    required this.title,
    required this.body,
    this.important = false,
  });

  final String id;
  final String title;
  final String body;
  final bool important;

  factory HomeAnnouncement.fromJson(JsonMap json) => HomeAnnouncement(
        id: '${json['id'] ?? ''}',
        title: '${json['title'] ?? ''}',
        body: '${json['body'] ?? ''}',
        important: json['important'] == true,
      );
}

class HomeData {
  const HomeData({
    this.banners = const [],
    this.announcements = const [],
    this.hotCourses = const [],
    this.hotPosts = const [],
    this.featuredProduct,
    this.examYear,
    this.daysRemaining,
    this.featureFlags = const {},
  });

  final List<HomeBanner> banners;
  final List<HomeAnnouncement> announcements;
  final List<Course> hotCourses;
  final List<ForumPost> hotPosts;
  final Product? featuredProduct;
  final String? examYear;
  final int? daysRemaining;
  final Map<String, bool> featureFlags;

  factory HomeData.fromJson(JsonMap json) => HomeData(
        banners: (json['banners'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(HomeBanner.fromJson)
            .toList(growable: false),
        announcements: (json['announcements'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(HomeAnnouncement.fromJson)
            .toList(growable: false),
        hotCourses: (json['hotCourses'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(Course.fromJson)
            .toList(growable: false),
        hotPosts: (json['hotPosts'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(ForumPost.fromJson)
            .toList(growable: false),
        featuredProduct: json['featuredProduct'] is JsonMap
            ? Product.fromJson(json['featuredProduct'] as JsonMap)
            : null,
        examYear: (json['exam'] as JsonMap?)?['year'] as String?,
        daysRemaining:
            ((json['exam'] as JsonMap?)?['daysRemaining'] as num?)?.toInt(),
        featureFlags: (json['featureFlags'] as JsonMap? ?? const {})
            .map((key, value) => MapEntry(key, value == true)),
      );
}

class Subject {
  const Subject(
      {required this.id,
      required this.name,
      this.questionCount = 0,
      this.color});
  final String id;
  final String name;
  final int questionCount;
  final String? color;

  factory Subject.fromJson(JsonMap json) => Subject(
        id: '${json['id'] ?? ''}',
        name: '${json['name'] ?? ''}',
        questionCount: (json['questionCount'] as num?)?.toInt() ?? 0,
        color: json['color'] as String?,
      );
}

class Question {
  const Question(
      {required this.id,
      required this.stem,
      required this.options,
      this.answer,
      this.analysis,
      this.subjectId,
      this.questionType,
      this.version,
      this.source,
      this.answerIndexes = const []});
  final String id;
  final String stem;
  final List<String> options;
  final int? answer;
  final String? analysis;
  final String? subjectId;
  final String? questionType;
  final int? version;
  final String? source;
  final List<int> answerIndexes;

  factory Question.fromJson(JsonMap json) => Question(
        id: '${json['id'] ?? ''}',
        stem: '${json['stem'] ?? ''}',
        options: (json['options'] as List<dynamic>? ?? const [])
            .map((e) => '$e')
            .toList(growable: false),
        answer: (json['answer'] as num?)?.toInt(),
        analysis: json['analysis'] as String?,
        subjectId: json['subjectId'] as String?,
        questionType: json['questionType'] as String?,
        version: (json['version'] as num?)?.toInt(),
        source: json['source'] as String?,
        answerIndexes: (json['answerIndexes'] as List<dynamic>? ?? const [])
            .map((value) => int.tryParse('$value'))
            .whereType<int>()
            .toList(growable: false),
      );
}

/// A question snapshot embedded in an objective quiz session. The server
/// deliberately omits answer keys while the session is in progress and adds
/// them to the report after submission.
class ObjectiveSessionQuestion {
  const ObjectiveSessionQuestion({
    required this.id,
    required this.stem,
    required this.options,
    required this.version,
    this.subjectId,
    this.questionType,
    this.source,
    this.answerIndexes = const [],
  });

  final String id;
  final String stem;
  final List<String> options;
  final int version;
  final String? subjectId;
  final String? questionType;
  final String? source;
  final List<int> answerIndexes;

  bool get isMultiple =>
      questionType == 'multiple' ||
      questionType == 'indeterminate' ||
      answerIndexes.length > 1;

  String get questionTypeLabel => switch (questionType) {
        'true_false' => '判断题',
        'multiple' => '多选题',
        'indeterminate' => '不定项选择题',
        _ => '单选题',
      };

  factory ObjectiveSessionQuestion.fromJson(JsonMap json) =>
      ObjectiveSessionQuestion(
        id: '${json['id'] ?? ''}',
        stem: '${json['stem'] ?? json['title'] ?? ''}',
        options: (json['options'] as List<dynamic>? ?? const [])
            .map((value) => '$value')
            .toList(growable: false),
        version: (json['version'] as num?)?.toInt() ?? 1,
        subjectId: json['subjectId'] as String?,
        questionType: json['questionType'] as String?,
        source: json['source'] as String?,
        answerIndexes: (json['answerIndexes'] as List<dynamic>? ?? const [])
            .map((value) => int.tryParse('$value'))
            .whereType<int>()
            .toList(growable: false),
      );
}

class ObjectiveSessionAnswer {
  const ObjectiveSessionAnswer({
    required this.questionId,
    required this.answers,
    required this.updatedAt,
  });

  final String questionId;
  final List<String> answers;
  final String updatedAt;

  factory ObjectiveSessionAnswer.fromJson(JsonMap json) =>
      ObjectiveSessionAnswer(
        questionId: '${json['questionId'] ?? ''}',
        answers: (json['answers'] as List<dynamic>? ?? const [])
            .map((value) => '$value')
            .toList(growable: false),
        updatedAt: '${json['updatedAt'] ?? ''}',
      );
}

class ObjectiveSession {
  const ObjectiveSession({
    required this.id,
    required this.mode,
    required this.title,
    required this.questionIds,
    required this.questions,
    required this.answers,
    required this.durationSeconds,
    required this.startedAt,
    required this.expiresAt,
    required this.status,
    this.subjectId,
    this.paperId,
    this.submittedAt,
    this.reportId,
    this.userId = '',
    this.createIdempotencyKey,
    this.submissionIdempotencyKey,
    this.idempotencyKey,
  });

  final String id;
  final String userId;
  final String mode;
  final String title;
  final String? subjectId;
  final String? paperId;
  final List<String> questionIds;
  final List<ObjectiveSessionQuestion> questions;
  final List<ObjectiveSessionAnswer> answers;
  final int durationSeconds;
  final String startedAt;
  final String expiresAt;
  final String status;
  final String? submittedAt;
  final String? reportId;
  final String? createIdempotencyKey;
  final String? submissionIdempotencyKey;
  final String? idempotencyKey;

  factory ObjectiveSession.fromJson(JsonMap json) => ObjectiveSession(
        id: '${json['id'] ?? ''}',
        userId: '${json['userId'] ?? ''}',
        mode: '${json['mode'] ?? 'chapter'}',
        title: '${json['title'] ?? '客观题练习'}',
        subjectId: json['subjectId'] as String?,
        paperId: json['paperId'] as String?,
        questionIds: (json['questionIds'] as List<dynamic>? ?? const [])
            .map((value) => '$value')
            .toList(growable: false),
        questions: (json['questions'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(ObjectiveSessionQuestion.fromJson)
            .toList(growable: false),
        answers: (json['answers'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(ObjectiveSessionAnswer.fromJson)
            .toList(growable: false),
        durationSeconds: (json['durationSeconds'] as num?)?.toInt() ?? 0,
        startedAt: '${json['startedAt'] ?? ''}',
        expiresAt: '${json['expiresAt'] ?? ''}',
        status: '${json['status'] ?? 'in_progress'}',
        submittedAt: json['submittedAt'] as String?,
        reportId: json['reportId'] as String?,
        createIdempotencyKey: json['createIdempotencyKey'] as String?,
        submissionIdempotencyKey: json['submissionIdempotencyKey'] as String?,
        idempotencyKey: json['idempotencyKey'] as String?,
      );
}

class ObjectiveReportResult {
  const ObjectiveReportResult({
    required this.questionId,
    required this.stem,
    required this.options,
    required this.version,
    required this.answers,
    required this.correctAnswers,
    required this.correct,
    required this.analysis,
    this.subjectId,
    this.questionType,
    this.explanationMediaType,
    this.explanationMediaReference,
  });

  final String questionId;
  final String? subjectId;
  final String stem;
  final List<String> options;
  final int version;
  final List<String> answers;
  final List<String> correctAnswers;
  final bool correct;
  final String analysis;
  final String? questionType;
  final String? explanationMediaType;
  final String? explanationMediaReference;

  factory ObjectiveReportResult.fromJson(JsonMap json) => ObjectiveReportResult(
        questionId: '${json['questionId'] ?? ''}',
        subjectId: json['subjectId'] as String?,
        stem: '${json['stem'] ?? json['title'] ?? ''}',
        options: (json['options'] as List<dynamic>? ?? const [])
            .map((value) => '$value')
            .toList(growable: false),
        version: (json['version'] as num?)?.toInt() ?? 1,
        answers: (json['answers'] as List<dynamic>? ?? const [])
            .map((value) => '$value')
            .toList(growable: false),
        correctAnswers: (json['correctAnswers'] as List<dynamic>? ?? const [])
            .map((value) => '$value')
            .toList(growable: false),
        correct: json['correct'] == true,
        analysis: '${json['analysis'] ?? ''}',
        questionType: json['questionType'] as String?,
        explanationMediaType: json['explanationMediaType'] as String?,
        explanationMediaReference: json['explanationMediaReference'] as String?,
      );
}

class LearningInquiry {
  const LearningInquiry({
    required this.id,
    required this.reportId,
    required this.questionId,
    required this.question,
    required this.reason,
    required this.status,
    required this.createdAt,
    this.reply,
    this.teacherName,
    this.repliedAt,
  });
  final String id, reportId, questionId, reason, status, createdAt;
  final ObjectiveReportResult question;
  final String? reply, teacherName, repliedAt;
  factory LearningInquiry.fromJson(JsonMap json) => LearningInquiry(
        id: '${json['id']}',
        reportId: '${json['reportId']}',
        questionId: '${json['questionId']}',
        question: ObjectiveReportResult.fromJson(
            (json['question'] as JsonMap?) ?? <String, dynamic>{}),
        reason: '${json['reason'] ?? ''}',
        status: '${json['status'] ?? 'pending'}',
        createdAt: '${json['createdAt'] ?? ''}',
        reply: json['reply'] as String?,
        teacherName: json['teacherName'] as String?,
        repliedAt: json['repliedAt'] as String?,
      );
}

class ObjectiveReport {
  const ObjectiveReport({
    required this.id,
    required this.sessionId,
    required this.mode,
    required this.title,
    required this.total,
    required this.answered,
    required this.correct,
    required this.score,
    required this.maxScore,
    required this.results,
    required this.subjectStats,
    required this.submittedAt,
  });

  final String id;
  final String sessionId;
  final String mode;
  final String title;
  final int total;
  final int answered;
  final int correct;
  final int score;
  final int maxScore;
  final List<ObjectiveReportResult> results;
  final List<({String subjectId, int total, int correct, int correctRate})>
      subjectStats;
  final String submittedAt;

  factory ObjectiveReport.fromJson(JsonMap json) => ObjectiveReport(
        id: '${json['id'] ?? ''}',
        sessionId: '${json['sessionId'] ?? ''}',
        mode: '${json['mode'] ?? 'chapter'}',
        title: '${json['title'] ?? '答题报告'}',
        total: (json['total'] as num?)?.toInt() ?? 0,
        answered: (json['answered'] as num?)?.toInt() ?? 0,
        correct: (json['correct'] as num?)?.toInt() ?? 0,
        score: (json['score'] as num?)?.toInt() ?? 0,
        maxScore: (json['maxScore'] as num?)?.toInt() ?? 100,
        results: (json['results'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(ObjectiveReportResult.fromJson)
            .toList(growable: false),
        subjectStats: (json['subjectStats'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map((item) => (
                  subjectId: '${item['subjectId'] ?? ''}',
                  total: (item['total'] as num?)?.toInt() ?? 0,
                  correct: (item['correct'] as num?)?.toInt() ?? 0,
                  correctRate: (item['correctRate'] as num?)?.toInt() ?? 0,
                ))
            .toList(growable: false),
        submittedAt: '${json['submittedAt'] ?? ''}',
      );
}

/// Parameters used by the Riverpod objective-session provider. Value equality
/// keeps the provider stable across rebuilds, while the derived key makes
/// creation idempotent for a quiz opened repeatedly during one app run.
class ObjectiveSessionRequest {
  const ObjectiveSessionRequest({
    required this.title,
    this.mode = 'chapter',
    this.subjectId,
    this.paperId,
    this.questionIds = const [],
    this.limit,
    this.durationSeconds,
    this.sessionId,
    this.idempotencyKey,
  });

  final String mode;
  final String title;
  final String? subjectId;
  final String? paperId;
  final List<String> questionIds;
  final int? limit;
  final int? durationSeconds;
  final String? sessionId;
  final String? idempotencyKey;

  String get effectiveIdempotencyKey {
    final explicit = idempotencyKey?.trim();
    if (explicit != null && explicit.length >= 8) return explicit;
    final fingerprint = Object.hash(
      mode,
      title,
      subjectId,
      paperId,
      Object.hashAll(questionIds),
      limit,
      durationSeconds,
    ).abs();
    return 'flutter-objective-$fingerprint';
  }

  @override
  bool operator ==(Object other) =>
      other is ObjectiveSessionRequest &&
      other.mode == mode &&
      other.title == title &&
      other.subjectId == subjectId &&
      other.paperId == paperId &&
      _listEquals(other.questionIds, questionIds) &&
      other.limit == limit &&
      other.durationSeconds == durationSeconds &&
      other.sessionId == sessionId &&
      other.idempotencyKey == idempotencyKey;

  @override
  int get hashCode => Object.hash(
        mode,
        title,
        subjectId,
        paperId,
        Object.hashAll(questionIds),
        limit,
        durationSeconds,
        sessionId,
        idempotencyKey,
      );

  static bool _listEquals(List<String> left, List<String> right) {
    if (left.length != right.length) return false;
    for (var index = 0; index < left.length; index++) {
      if (left[index] != right[index]) return false;
    }
    return true;
  }
}

class QuestionRecord {
  const QuestionRecord({
    required this.id,
    required this.questionId,
    required this.answers,
    required this.correct,
    required this.createdAt,
    this.analysis,
    this.subjectId,
    this.mode,
    this.title,
    this.total,
    this.correctCount,
  });

  final String id;
  final String questionId;
  final List<String> answers;
  final bool correct;
  final String createdAt;
  final String? analysis;
  final String? subjectId;
  final String? mode;
  final String? title;
  final int? total;
  final int? correctCount;

  factory QuestionRecord.fromJson(JsonMap json) => QuestionRecord(
        id: '${json['id'] ?? json['submissionId'] ?? ''}',
        questionId: '${json['questionId'] ?? ''}',
        answers: (json['answers'] as List<dynamic>? ?? const [])
            .map((value) => '$value')
            .toList(growable: false),
        correct: json['correct'] == true,
        createdAt: '${json['createdAt'] ?? ''}',
        analysis: json['analysis'] as String?,
        subjectId: json['subjectId'] as String?,
        mode: json['mode'] as String?,
        title: json['title'] as String?,
        total: (json['total'] as num?)?.toInt(),
        correctCount: (json['correctCount'] as num?)?.toInt(),
      );
}

/// A server-paginated page of question activity.  The legacy list endpoint
/// remains accepted by [QuestionRecordPage.fromJson] so older development
/// servers and deterministic widget fakes continue to work.
class QuestionRecordPage {
  const QuestionRecordPage({
    required this.items,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.answered,
    required this.correct,
  });

  final List<QuestionRecord> items;
  final int page;
  final int pageSize;
  final int total;
  final int answered;
  final int correct;

  bool get hasMore => page * pageSize < total;

  factory QuestionRecordPage.fromJson(dynamic value) {
    final map = value is JsonMap ? value : const <String, dynamic>{};
    final rawItems = value is List
        ? value
        : map['items'] is List
            ? map['items'] as List
            : const <dynamic>[];
    final items = rawItems
        .whereType<JsonMap>()
        .map(QuestionRecord.fromJson)
        .toList(growable: false);
    final page = (map['page'] as num?)?.toInt() ?? 1;
    final pageSize = (map['pageSize'] as num?)?.toInt() ?? items.length;
    final total = (map['total'] as num?)?.toInt() ?? items.length;
    final fallbackAnswered =
        items.fold<int>(0, (sum, item) => sum + (item.total ?? 1));
    final fallbackCorrect = items.fold<int>(
        0, (sum, item) => sum + (item.correctCount ?? (item.correct ? 1 : 0)));
    final answered = (map['answered'] as num?)?.toInt() ?? fallbackAnswered;
    final correct = (map['correct'] as num?)?.toInt() ?? fallbackCorrect;
    return QuestionRecordPage(
      items: items,
      page: page < 1 ? 1 : page,
      pageSize: pageSize < 1 ? items.length : pageSize,
      total: total < 0 ? items.length : total,
      answered: answered < 0 ? fallbackAnswered : answered,
      correct: correct < 0 ? fallbackCorrect : correct,
    );
  }
}

class QuestionRecordQuery {
  const QuestionRecordQuery({
    this.page = 1,
    this.pageSize = 20,
    this.subjectId,
    this.mode,
  });

  final int page;
  final int pageSize;
  final String? subjectId;
  final String? mode;

  @override
  bool operator ==(Object other) =>
      other is QuestionRecordQuery &&
      other.page == page &&
      other.pageSize == pageSize &&
      other.subjectId == subjectId &&
      other.mode == mode;

  @override
  int get hashCode => Object.hash(page, pageSize, subjectId, mode);
}

class LegalSearchQuery {
  const LegalSearchQuery({required this.query, this.subjectId});

  final String query;
  final String? subjectId;

  @override
  bool operator ==(Object other) =>
      other is LegalSearchQuery &&
      other.query == query &&
      other.subjectId == subjectId;

  @override
  int get hashCode => Object.hash(query, subjectId);
}

class FavoriteItem {
  const FavoriteItem({
    required this.id,
    required this.questionId,
    required this.createdAt,
    this.question,
  });

  final String id;
  final String questionId;
  final String createdAt;
  final Question? question;

  factory FavoriteItem.fromJson(JsonMap json) => FavoriteItem(
        id: '${json['id'] ?? ''}',
        questionId: '${json['questionId'] ?? ''}',
        createdAt: '${json['createdAt'] ?? ''}',
        question: json['question'] is JsonMap
            ? Question.fromJson(json['question'] as JsonMap)
            : null,
      );
}

class MistakeItem {
  const MistakeItem({
    required this.id,
    required this.questionId,
    required this.wrongCount,
    required this.lastAnswer,
    required this.resolved,
    this.question,
  });

  final String id;
  final String questionId;
  final int wrongCount;
  final String lastAnswer;
  final bool resolved;
  final Question? question;

  factory MistakeItem.fromJson(JsonMap json) => MistakeItem(
        id: '${json['id'] ?? ''}',
        questionId: '${json['questionId'] ?? ''}',
        wrongCount: (json['wrongCount'] as num?)?.toInt() ?? 0,
        lastAnswer: '${json['lastAnswer'] ?? ''}',
        resolved: json['resolved'] == true,
        question: json['question'] is JsonMap
            ? Question.fromJson(json['question'] as JsonMap)
            : null,
      );
}

class Course {
  const Course(
      {required this.id,
      required this.title,
      required this.teacher,
      required this.type,
      this.questionType,
      this.progress = 0,
      this.lessons = 0,
      this.accent,
      this.productId,
      this.price,
      this.originalPrice,
      this.hasAccess,
      this.sourceOrderId,
      this.expiresAt,
      this.sections = const []});
  final String id;
  final String title;
  final String teacher;
  final String type;
  final String? questionType;
  final double progress;
  final int lessons;
  final String? accent;
  final String? productId;
  final double? price;
  final double? originalPrice;
  final bool? hasAccess;
  final String? sourceOrderId;
  final String? expiresAt;
  final List<CourseSection> sections;

  factory Course.fromJson(JsonMap json) => Course(
        id: '${json['id'] ?? ''}',
        title: '${json['title'] ?? json['name'] ?? ''}',
        teacher: '${json['teacher'] ?? ''}',
        type: '${json['type'] ?? 'video'}',
        questionType:
            (json['questionType'] ?? json['question_type'] ?? json['category'])
                ?.toString(),
        progress: (json['progress'] as num?)?.toDouble() ?? 0,
        lessons: (json['lessons'] as num?)?.toInt() ?? 0,
        accent: json['accent'] as String?,
        productId: json['productId'] as String?,
        price: (json['price'] as num?)?.toDouble(),
        originalPrice: (json['originalPrice'] as num?)?.toDouble(),
        hasAccess:
            json.containsKey('hasAccess') ? json['hasAccess'] == true : null,
        sourceOrderId: json['sourceOrderId'] as String?,
        expiresAt: json['expiresAt'] as String?,
        sections: (json['sections'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(CourseSection.fromJson)
            .toList(growable: false),
      );
}

/// A lesson returned by the course detail endpoint.
///
/// The server may omit progress flags for a newly published lesson.  The
/// defaults keep the object usable while preserving the distinction between
/// an omitted flag and a locally fabricated lesson.
class CourseLesson {
  const CourseLesson({
    required this.id,
    required this.title,
    required this.mediaKind,
    this.mediaReference,
    this.durationSeconds = 0,
    this.trialEnabled = false,
    this.sortOrder = 0,
    this.done = false,
    this.current = false,
    this.liveSession,
  });

  final String id;
  final String title;
  final String mediaKind;
  final String? mediaReference;
  final int durationSeconds;
  final bool trialEnabled;
  final int sortOrder;
  final bool done;
  final bool current;
  final LiveSession? liveSession;

  factory CourseLesson.fromJson(JsonMap json) => CourseLesson(
        id: '${json['id'] ?? ''}',
        title: '${json['title'] ?? ''}',
        mediaKind: '${json['mediaKind'] ?? json['media_kind'] ?? 'video'}',
        mediaReference: json['mediaReference'] as String? ??
            json['media_reference'] as String?,
        durationSeconds: (json['durationSeconds'] as num?)?.toInt() ??
            (json['duration_seconds'] as num?)?.toInt() ??
            0,
        trialEnabled:
            json['trialEnabled'] == true || json['trial_enabled'] == true,
        sortOrder: (json['sortOrder'] as num?)?.toInt() ??
            (json['sort_order'] as num?)?.toInt() ??
            0,
        done: json['done'] == true || json['completed'] == true,
        current: json['current'] == true,
        liveSession: json['liveSession'] is JsonMap
            ? LiveSession.fromJson(json['liveSession'] as JsonMap)
            : json['live_session'] is JsonMap
                ? LiveSession.fromJson(json['live_session'] as JsonMap)
                : null,
      );
}

class LiveSession {
  const LiveSession({
    required this.id,
    required this.courseId,
    required this.lessonId,
    required this.title,
    required this.teacher,
    required this.startsAt,
    required this.endsAt,
    required this.status,
    this.provider = 'polyv',
    this.replayAvailable = false,
  });

  final String id;
  final String courseId;
  final String lessonId;
  final String title;
  final String teacher;
  final DateTime startsAt;
  final DateTime endsAt;
  final String status;
  final String provider;
  final bool replayAvailable;

  factory LiveSession.fromJson(JsonMap json) => LiveSession(
        id: '${json['id'] ?? ''}',
        courseId: '${json['courseId'] ?? json['course_id'] ?? ''}',
        lessonId: '${json['lessonId'] ?? json['lesson_id'] ?? ''}',
        title: '${json['title'] ?? ''}',
        teacher: '${json['teacher'] ?? ''}',
        startsAt: DateTime.tryParse(
                '${json['startsAt'] ?? json['starts_at'] ?? ''}') ??
            DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        endsAt:
            DateTime.tryParse('${json['endsAt'] ?? json['ends_at'] ?? ''}') ??
                DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        status: '${json['status'] ?? 'scheduled'}',
        provider: '${json['provider'] ?? 'polyv'}',
        replayAvailable:
            json['replayAvailable'] == true || json['replay_available'] == true,
      );
}

class LiveJoinResult {
  const LiveJoinResult({
    required this.provider,
    required this.channelId,
    required this.mode,
    required this.watchUrl,
  });

  final String provider;
  final String channelId;
  final String mode;
  final String watchUrl;

  factory LiveJoinResult.fromJson(JsonMap json) => LiveJoinResult(
        provider: '${json['provider'] ?? ''}',
        channelId: '${json['channelId'] ?? json['channel_id'] ?? ''}',
        mode: '${json['mode'] ?? 'live'}',
        watchUrl: '${json['watchUrl'] ?? json['watch_url'] ?? ''}',
      );
}

class CourseSection {
  const CourseSection({
    required this.id,
    required this.courseId,
    required this.title,
    this.sortOrder = 0,
    this.lessons = const [],
  });

  final String id;
  final String courseId;
  final String title;
  final int sortOrder;
  final List<CourseLesson> lessons;

  factory CourseSection.fromJson(JsonMap json) => CourseSection(
        id: '${json['id'] ?? ''}',
        courseId: '${json['courseId'] ?? json['course_id'] ?? ''}',
        title: '${json['title'] ?? ''}',
        sortOrder: (json['sortOrder'] as num?)?.toInt() ??
            (json['sort_order'] as num?)?.toInt() ??
            0,
        lessons: (json['lessons'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(CourseLesson.fromJson)
            .toList(growable: false),
      );
}

class CourseEntitlement {
  const CourseEntitlement({
    required this.hasAccess,
    this.sourceOrderId,
    this.expiresAt,
  });

  final bool hasAccess;
  final String? sourceOrderId;
  final String? expiresAt;

  factory CourseEntitlement.fromJson(JsonMap json) => CourseEntitlement(
        hasAccess: json['hasAccess'] == true,
        sourceOrderId: json['sourceOrderId'] as String?,
        expiresAt: json['expiresAt'] as String?,
      );
}

class Product {
  const Product(
      {required this.id,
      required this.name,
      required this.category,
      required this.price,
      this.originalPrice,
      this.sold = 0,
      this.accent,
      this.benefits = const [],
      this.type,
      this.brief,
      this.stage,
      this.rating,
      this.reviewCount});
  final String id;
  final String name;
  final String category;
  final num price;
  final num? originalPrice;
  final int sold;
  final String? accent;
  final List<String> benefits;
  final String? type;
  final String? brief;
  final String? stage;
  final num? rating;
  final int? reviewCount;

  factory Product.fromJson(JsonMap json) => Product(
        id: '${json['id'] ?? ''}',
        name: '${json['name'] ?? ''}',
        category: '${json['category'] ?? ''}',
        price: (json['price'] as num?) ?? 0,
        originalPrice: json['originalPrice'] as num?,
        sold: (json['sold'] as num?)?.toInt() ?? 0,
        accent: json['accent'] as String?,
        benefits: (json['benefits'] as List<dynamic>? ?? const [])
            .map((e) => '$e')
            .toList(growable: false),
        type: json['type'] as String?,
        brief: json['brief'] as String? ?? json['description'] as String?,
        stage: json['stage'] as String?,
        rating: json['rating'] as num?,
        reviewCount: (json['reviewCount'] as num?)?.toInt(),
      );
}

class Order {
  const Order(
      {required this.id,
      required this.productName,
      required this.amount,
      required this.status,
      required this.createdAt,
      this.productId,
      this.courseId});
  final String id;
  final String productName;
  final num amount;
  final String status;
  final String createdAt;
  final String? productId;
  final String? courseId;

  factory Order.fromJson(JsonMap json) => Order(
        id: '${json['id'] ?? ''}',
        productName: '${json['productName'] ?? ''}',
        amount: (json['amount'] as num?) ?? 0,
        status: '${json['status'] ?? ''}',
        createdAt: '${json['createdAt'] ?? ''}',
        productId: json['productId'] as String?,
        courseId: json['courseId'] as String?,
      );
}

class NotificationItem {
  const NotificationItem(
      {required this.id,
      required this.title,
      required this.body,
      required this.createdAt,
      this.read = false});
  final String id;
  final String title;
  final String body;
  final String createdAt;
  final bool read;

  factory NotificationItem.fromJson(JsonMap json) => NotificationItem(
        id: '${json['id'] ?? ''}',
        title: '${json['title'] ?? ''}',
        body: '${json['body'] ?? ''}',
        createdAt: '${json['createdAt'] ?? json['time'] ?? ''}',
        read: json['read'] == true,
      );
}

class ForumPost {
  const ForumPost(
      {required this.id,
      required this.title,
      required this.body,
      this.author,
      this.createdAt,
      this.likeCount = 0,
      this.category,
      this.liked = false,
      this.favorited = false,
      this.commentCount = 0,
      this.canDelete = false});
  final String id;
  final String title;
  final String body;
  final String? author;
  final String? createdAt;
  final int likeCount;
  final String? category;
  final bool liked;
  final bool favorited;
  final int commentCount;
  final bool canDelete;

  factory ForumPost.fromJson(JsonMap json) => ForumPost(
        id: '${json['id'] ?? ''}',
        title: '${json['title'] ?? ''}',
        body: '${json['body'] ?? ''}',
        author: json['author'] is JsonMap
            ? '${(json['author'] as JsonMap)['name'] ?? ''}'
            : (json['author'] as String?) ?? json['userName'] as String?,
        createdAt: json['createdAt'] as String?,
        likeCount: (json['likeCount'] as num?)?.toInt() ??
            (json['likes'] as num?)?.toInt() ??
            0,
        category: json['category'] as String?,
        liked: json['liked'] == true,
        favorited: json['favorited'] == true,
        commentCount: (json['commentCount'] as num?)?.toInt() ??
            (json['comments'] as num?)?.toInt() ??
            0,
        canDelete: json['canDelete'] == true,
      );
}

/// A cursor page returned by the forum endpoints.  The mobile API uses an
/// opaque cursor rather than an integer page so clients can safely append
/// records while new posts are created.  Keeping the cursor in the typed data
/// layer lets the Flutter screens implement the same "加载更多" behaviour as
/// the RC client without having to parse response maps in widgets.
class ForumPage<T> {
  const ForumPage({required this.items, this.nextCursor});

  final List<T> items;
  final String? nextCursor;
}

class ForumComment {
  const ForumComment({
    required this.id,
    required this.postId,
    required this.body,
    this.author,
    this.createdAt,
    this.canDelete = false,
  });

  final String id;
  final String postId;
  final String body;
  final String? author;
  final String? createdAt;
  final bool canDelete;

  factory ForumComment.fromJson(JsonMap json) => ForumComment(
        id: '${json['id'] ?? ''}',
        postId: '${json['postId'] ?? ''}',
        body: '${json['body'] ?? ''}',
        author: json['userName'] as String? ?? json['author'] as String?,
        createdAt: json['createdAt'] as String?,
        canDelete: json['canDelete'] == true,
      );
}

class LearningPlan {
  const LearningPlan(
      {required this.id,
      required this.title,
      required this.dailyMinutes,
      required this.startDate,
      required this.endDate,
      required this.status,
      this.earlyUnlockedThrough});
  final String id;
  final String title;
  final int dailyMinutes;
  final String startDate;
  final String endDate;
  final String status;
  final String? earlyUnlockedThrough;
  factory LearningPlan.fromJson(JsonMap json) => LearningPlan(
      id: '${json['id'] ?? ''}',
      title: '${json['title'] ?? ''}',
      dailyMinutes: (json['dailyMinutes'] as num?)?.toInt() ?? 0,
      startDate: '${json['startDate'] ?? ''}',
      endDate: '${json['endDate'] ?? ''}',
      status: '${json['status'] ?? ''}',
      earlyUnlockedThrough: json['earlyUnlockedThrough'] as String?);
}

class EarlyAccessRequest {
  const EarlyAccessRequest(
      {required this.id,
      required this.planId,
      required this.requestedThrough,
      required this.status,
      this.reason});
  final String id, planId, requestedThrough, status;
  final String? reason;
  factory EarlyAccessRequest.fromJson(JsonMap json) => EarlyAccessRequest(
      id: '${json['id'] ?? ''}',
      planId: '${json['planId'] ?? ''}',
      requestedThrough: '${json['requestedThrough'] ?? ''}',
      status: '${json['status'] ?? 'pending'}',
      reason: json['reason'] as String?);
}

class LearningTask {
  const LearningTask(
      {required this.id,
      required this.planId,
      required this.title,
      required this.dueDate,
      required this.minutes,
      required this.status,
      this.description,
      this.contentType,
      this.contentId,
      this.locked = false,
      this.completedAt});
  final String id;
  final String planId;
  final String title;
  final String dueDate;
  final int minutes;
  final String status;
  final String? description;
  final String? contentType;
  final String? contentId;
  final bool locked;
  final String? completedAt;
  factory LearningTask.fromJson(JsonMap json) => LearningTask(
      id: '${json['id'] ?? ''}',
      planId: '${json['planId'] ?? ''}',
      title: '${json['title'] ?? ''}',
      dueDate: '${json['dueDate'] ?? ''}',
      minutes: (json['minutes'] as num?)?.toInt() ?? 0,
      status: '${json['status'] ?? ''}',
      description: json['description'] as String?,
      contentType: json['contentType'] as String?,
      contentId: json['contentId'] as String?,
      locked: json['locked'] == true || json['status'] == 'locked',
      completedAt: json['completedAt'] as String?);
}

class LearningDiagnosticForm {
  const LearningDiagnosticForm(
      {required this.id,
      required this.title,
      this.subtitle,
      this.description,
      this.estimatedMinutes = 0,
      this.submitLabel = '提交诊断',
      this.successTitle,
      this.successDescription});
  final String id;
  final String title;
  final String? subtitle;
  final String? description;
  final int estimatedMinutes;
  final String submitLabel;
  final String? successTitle;
  final String? successDescription;
  factory LearningDiagnosticForm.fromJson(JsonMap json) =>
      LearningDiagnosticForm(
          id: '${json['id'] ?? ''}',
          title: '${json['title'] ?? '首次学习诊断'}',
          subtitle: json['subtitle'] as String?,
          description: json['description'] as String?,
          estimatedMinutes: (json['estimatedMinutes'] as num?)?.toInt() ?? 0,
          submitLabel: '${json['submitLabel'] ?? '提交诊断'}',
          successTitle: json['successTitle'] as String?,
          successDescription: json['successDescription'] as String?);
}

class LearningDiagnosticQuestion {
  const LearningDiagnosticQuestion(
      {required this.id,
      required this.stem,
      required this.type,
      required this.required,
      required this.options,
      this.description,
      this.section,
      this.placeholder,
      this.min,
      this.max,
      this.minLength,
      this.maxLength});
  final String id;
  final String stem;
  final String type;
  final bool required;
  final List<({String id, String label})> options;
  final String? description;
  final String? section;
  final String? placeholder;
  final num? min;
  final num? max;
  final int? minLength;
  final int? maxLength;
  factory LearningDiagnosticQuestion.fromJson(JsonMap json) {
    final validation = json['validation'] is JsonMap
        ? json['validation'] as JsonMap
        : const <String, dynamic>{};
    return LearningDiagnosticQuestion(
        id: '${json['id'] ?? ''}',
        stem: '${json['stem'] ?? ''}',
        type: '${json['type'] ?? json['questionType'] ?? 'single'}',
        required: json['required'] != false,
        description: json['description'] as String?,
        section: json['section'] as String?,
        placeholder: json['placeholder'] as String?,
        min: validation['min'] as num?,
        max: validation['max'] as num?,
        minLength: (validation['minLength'] as num?)?.toInt(),
        maxLength: (validation['maxLength'] as num?)?.toInt(),
        options: (json['options'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map((item) =>
                (id: '${item['id'] ?? ''}', label: '${item['label'] ?? ''}'))
            .toList(growable: false));
  }
}

class LearningTeacherAssignment {
  const LearningTeacherAssignment(
      {required this.status,
      this.stageName,
      this.teacherName,
      this.teacherSubject,
      this.teacherSpecialty});
  final String status;
  final String? stageName;
  final String? teacherName;
  final String? teacherSubject;
  final String? teacherSpecialty;
  factory LearningTeacherAssignment.fromJson(JsonMap json) {
    final teacher = json['teacher'] is JsonMap
        ? json['teacher'] as JsonMap
        : const <String, dynamic>{};
    final stage = json['stage'] is JsonMap
        ? json['stage'] as JsonMap
        : const <String, dynamic>{};
    return LearningTeacherAssignment(
        status: '${json['status'] ?? 'pending'}',
        stageName: stage['name'] as String?,
        teacherName: teacher['name'] as String?,
        teacherSubject: teacher['subject'] as String?,
        teacherSpecialty: teacher['specialty'] as String?);
  }
}

class LearningDiagnosticResult {
  const LearningDiagnosticResult(
      {required this.attemptId,
      required this.scores,
      required this.submittedAt,
      this.assignment});
  final String attemptId;
  final Map<String, int> scores;
  final String submittedAt;
  final LearningTeacherAssignment? assignment;
  factory LearningDiagnosticResult.fromJson(JsonMap json) =>
      LearningDiagnosticResult(
          attemptId: '${json['attemptId'] ?? ''}',
          scores: (json['scores'] is JsonMap
                  ? json['scores'] as JsonMap
                  : const <String, dynamic>{})
              .map(
                  (key, value) => MapEntry(key, (value as num?)?.toInt() ?? 0)),
          submittedAt: '${json['submittedAt'] ?? ''}',
          assignment: json['assignment'] is JsonMap
              ? LearningTeacherAssignment.fromJson(
                  json['assignment'] as JsonMap)
              : null);
}

class LearningDiagnosticState {
  const LearningDiagnosticState(
      {required this.access,
      required this.productId,
      required this.completed,
      required this.questions,
      this.form,
      this.dimensions = const [],
      this.classTypeName,
      this.result});
  final String access;
  final String productId;
  final bool completed;
  final List<LearningDiagnosticQuestion> questions;
  final LearningDiagnosticForm? form;
  final List<({String code, String label})> dimensions;
  final String? classTypeName;
  final LearningDiagnosticResult? result;
  factory LearningDiagnosticState.fromJson(
          JsonMap json) =>
      LearningDiagnosticState(
          access: '${json['access'] ?? 'locked'}',
          productId: '${json['productId'] ?? ''}',
          completed: json['completed'] == true,
          form:
              json[
                      'form'] is JsonMap
                  ? LearningDiagnosticForm.fromJson(json['form'] as JsonMap)
                  : null,
          classTypeName:
              json[
                      'classType'] is JsonMap
                  ? (json['classType'] as JsonMap)['name'] as String?
                  : null,
          dimensions:
              (json['dimensions'] as List<
                          dynamic>? ??
                      const [])
                  .whereType<JsonMap>()
                  .map(
                      (item) =>
                          (
                            code: '${item['code'] ?? ''}',
                            label: '${item['label'] ?? ''}'
                          ))
                  .toList(growable: false),
          questions:
              (json['questions']
                          as List<dynamic>? ??
                      const [])
                  .whereType<JsonMap>()
                  .map(LearningDiagnosticQuestion.fromJson)
                  .toList(growable: false),
          result: json['result'] is JsonMap
              ? LearningDiagnosticResult.fromJson(json['result'] as JsonMap)
              : null);
}

class LearningCard {
  const LearningCard(
      {required this.id,
      required this.title,
      required this.contentType,
      required this.assets,
      this.version = 1,
      this.recallItems = const [],
      this.description});
  final String id;
  final String title;
  final String contentType;
  final List<({String type, String reference, String? filename})> assets;
  final List<({String prompt, String answer})> recallItems;
  final int version;
  final String? description;
  factory LearningCard.fromJson(JsonMap json) => LearningCard(
      id: '${json['id'] ?? ''}',
      title: '${json['title'] ?? ''}',
      contentType: '${json['contentType'] ?? 'image_gallery'}',
      description: json['description'] as String?,
      recallItems: (json['recallItems'] as List<dynamic>? ?? const [])
          .whereType<JsonMap>()
          .map((item) => (
                prompt: '${item['prompt'] ?? ''}',
                answer: '${item['answer'] ?? ''}'
              ))
          .toList(growable: false),
      version: (json['version'] as num?)?.toInt() ?? 1,
      assets: (json['assets'] as List<dynamic>? ?? const [])
          .whereType<JsonMap>()
          .map((item) => (
                type: '${item['type'] ?? ''}',
                reference: '${item['reference'] ?? ''}',
                filename: item['filename'] as String?
              ))
          .toList(growable: false));
}

class LearningSubjectiveQuestion {
  const LearningSubjectiveQuestion(
      {required this.id,
      required this.title,
      required this.stem,
      required this.subQuestions,
      this.caseMaterial});
  final String id;
  final String title;
  final String stem;
  final String? caseMaterial;
  final List<({String id, String prompt, num score})> subQuestions;
  factory LearningSubjectiveQuestion.fromJson(JsonMap json) =>
      LearningSubjectiveQuestion(
          id: '${json['id'] ?? ''}',
          title: '${json['title'] ?? ''}',
          stem: '${json['stem'] ?? ''}',
          caseMaterial: json['caseMaterial'] as String?,
          subQuestions: (json['subQuestions'] as List<dynamic>? ?? const [])
              .whereType<JsonMap>()
              .map((item) => (
                    id: '${item['id'] ?? ''}',
                    prompt: '${item['prompt'] ?? ''}',
                    score: (item['score'] as num?) ?? 0
                  ))
              .toList(growable: false));
}

class GradingSubQuestion {
  const GradingSubQuestion({
    required this.id,
    required this.prompt,
    required this.maxScore,
  });

  final String id;
  final String prompt;
  final num maxScore;

  factory GradingSubQuestion.fromJson(JsonMap json) => GradingSubQuestion(
        id: '${json['id'] ?? ''}',
        prompt: '${json['prompt'] ?? ''}',
        maxScore: (json['maxScore'] as num?) ?? 0,
      );
}

class GradingPoint {
  const GradingPoint({
    required this.id,
    required this.title,
    this.description,
    this.maxScore = 0,
  });

  final String id;
  final String title;
  final String? description;
  final num maxScore;

  factory GradingPoint.fromJson(JsonMap json) => GradingPoint(
        id: '${json['id'] ?? ''}',
        title: '${json['title'] ?? ''}',
        description: json['description'] as String?,
        maxScore: (json['maxScore'] as num?) ?? 0,
      );
}

class GradingQuestion {
  const GradingQuestion({
    required this.id,
    required this.title,
    required this.subjectId,
    required this.caseMaterial,
    required this.subQuestions,
    required this.totalScore,
    required this.suggestedMinutes,
    this.rubricId,
    this.version,
    this.allowedAnswerTypes = const [],
    this.points = const [],
  });

  final String id;
  final String title;
  final String subjectId;
  final String caseMaterial;
  final List<GradingSubQuestion> subQuestions;
  final num totalScore;
  final int suggestedMinutes;
  final String? rubricId;
  final int? version;
  final List<String> allowedAnswerTypes;
  final List<GradingPoint> points;

  factory GradingQuestion.fromJson(JsonMap json) => GradingQuestion(
        id: '${json['id'] ?? json['questionId'] ?? ''}',
        title: '${json['title'] ?? ''}',
        subjectId: '${json['subjectId'] ?? ''}',
        caseMaterial: '${json['caseMaterial'] ?? ''}',
        subQuestions: (json['subQuestions'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(GradingSubQuestion.fromJson)
            .toList(growable: false),
        totalScore: (json['totalScore'] as num?) ?? 0,
        suggestedMinutes: (json['suggestedMinutes'] as num?)?.toInt() ?? 0,
        rubricId: json['rubricId'] as String?,
        version: (json['version'] as num?)?.toInt(),
        allowedAnswerTypes:
            (json['allowedAnswerTypes'] as List<dynamic>? ?? const [])
                .map((value) => '$value')
                .toList(growable: false),
        points: (json['points'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(GradingPoint.fromJson)
            .toList(growable: false),
      );
}

class GradingPaper {
  const GradingPaper({
    required this.id,
    required this.title,
    required this.subjectId,
    required this.year,
    required this.totalScore,
    required this.questionIds,
    required this.status,
    this.questions = const [],
  });

  final String id;
  final String title;
  final String subjectId;
  final String year;
  final num totalScore;
  final List<String> questionIds;
  final String status;
  final List<GradingQuestion> questions;

  int get questionCount =>
      questions.isNotEmpty ? questions.length : questionIds.length;

  factory GradingPaper.fromJson(JsonMap json) => GradingPaper(
        id: '${json['id'] ?? ''}',
        title: '${json['title'] ?? json['name'] ?? ''}',
        subjectId: '${json['subjectId'] ?? ''}',
        year: '${json['year'] ?? json['examYear'] ?? ''}',
        totalScore: (json['totalScore'] as num?) ?? 0,
        questionIds: (json['questionIds'] as List<dynamic>? ?? const [])
            .map((value) => '$value')
            .toList(growable: false),
        status: '${json['status'] ?? ''}',
        questions: (json['questions'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(GradingQuestion.fromJson)
            .toList(growable: false),
      );
}

class LearningReport {
  const LearningReport(
      {required this.period,
      required this.minutes,
      required this.answered,
      required this.correctRate,
      required this.subjects,
      this.dailyTrend = const []});
  final String period;
  final int minutes;
  final int answered;
  final int correctRate;
  final List<({String subjectId, int minutes, int correctRate})> subjects;
  final List<({String date, int minutes})> dailyTrend;
  factory LearningReport.fromJson(JsonMap json) => LearningReport(
      period: '${json['period'] ?? 'week'}',
      minutes: (json['minutes'] as num?)?.toInt() ?? 0,
      answered: (json['answered'] as num?)?.toInt() ?? 0,
      correctRate: (json['correctRate'] as num?)?.toInt() ?? 0,
      dailyTrend: (json['dailyTrend'] as List<dynamic>? ?? const [])
          .whereType<JsonMap>()
          .map((item) => (
                date: '${item['date'] ?? ''}',
                minutes: (item['minutes'] as num?)?.toInt() ?? 0,
              ))
          .toList(growable: false),
      subjects: (json['subjects'] as List<dynamic>? ?? const [])
          .whereType<JsonMap>()
          .map((item) => (
                subjectId: '${item['subjectId'] ?? ''}',
                minutes: (item['minutes'] as num?)?.toInt() ?? 0,
                correctRate: (item['correctRate'] as num?)?.toInt() ?? 0
              ))
          .toList(growable: false));
}

class LegalDocument {
  const LegalDocument(
      {required this.id,
      required this.title,
      required this.article,
      required this.content,
      this.effectiveFrom,
      this.effectiveTo,
      this.documentCode,
      this.sourceUrl,
      this.version,
      this.updatedAt,
      this.subjectId});
  final String id;
  final String title;
  final String article;
  final String content;
  final String? effectiveFrom;
  final String? effectiveTo;
  final String? documentCode;
  final String? sourceUrl;
  final int? version;
  final String? updatedAt;
  final String? subjectId;
  factory LegalDocument.fromJson(JsonMap json) => LegalDocument(
      id: '${json['id'] ?? ''}',
      title: '${json['title'] ?? ''}',
      article: '${json['article'] ?? ''}',
      content: '${json['content'] ?? ''}',
      effectiveFrom: json['effectiveFrom'] as String?,
      effectiveTo: json['effectiveTo'] as String?,
      documentCode: json['documentCode'] as String?,
      sourceUrl: json['sourceUrl'] as String?,
      version: (json['version'] as num?)?.toInt(),
      updatedAt: json['updatedAt'] as String?,
      subjectId: json['subjectId'] as String?);
}

/// A legal article saved by the current user.  Legal favorites are kept
/// separate from question favorites because they have their own immutable
/// document/version snapshot and can outlive a question row.
class LegalFavorite {
  const LegalFavorite({
    required this.id,
    required this.legalDocumentId,
    required this.article,
    required this.title,
    required this.content,
    required this.createdAt,
    this.subjectId,
    this.version,
    this.effectiveFrom,
  });

  final String id;
  final String legalDocumentId;
  final String article;
  final String title;
  final String content;
  final String createdAt;
  final String? subjectId;
  final int? version;
  final String? effectiveFrom;

  factory LegalFavorite.fromJson(JsonMap json) => LegalFavorite(
        id: '${json['id'] ?? ''}',
        legalDocumentId:
            '${json['legalDocumentId'] ?? json['documentId'] ?? ''}',
        article: '${json['article'] ?? ''}',
        title: '${json['title'] ?? ''}',
        content: '${json['content'] ?? ''}',
        createdAt: '${json['createdAt'] ?? ''}',
        subjectId: json['subjectId'] as String?,
        version:
            ((json['version'] ?? json['documentVersion']) as num?)?.toInt(),
        effectiveFrom: json['effectiveFrom'] as String?,
      );
}

class AppLegalSection {
  const AppLegalSection({required this.title, required this.body});
  final String title;
  final String body;

  factory AppLegalSection.fromJson(JsonMap json) => AppLegalSection(
        title: '${json['title'] ?? ''}',
        body: '${json['body'] ?? ''}',
      );
}

class AppLegalDocument {
  const AppLegalDocument({
    required this.key,
    required this.title,
    required this.version,
    required this.updatedAt,
    required this.sections,
    this.status = 'published',
  });

  final String key;
  final String title;
  final int version;
  final String updatedAt;
  final String status;
  final List<AppLegalSection> sections;

  factory AppLegalDocument.fromJson(JsonMap json) => AppLegalDocument(
        key: '${json['key'] ?? ''}',
        title: '${json['title'] ?? ''}',
        version: (json['version'] as num?)?.toInt() ?? 1,
        updatedAt: '${json['updatedAt'] ?? ''}',
        status: '${json['status'] ?? 'published'}',
        sections: (json['sections'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .map(AppLegalSection.fromJson)
            .toList(growable: false),
      );
}

class UserSettings {
  const UserSettings({
    required this.userId,
    required this.learningReminders,
    required this.courseUpdates,
    required this.orderNotifications,
    required this.updatedAt,
  });

  final String userId;
  final bool learningReminders;
  final bool courseUpdates;
  final bool orderNotifications;
  final String updatedAt;

  factory UserSettings.fromJson(JsonMap json) => UserSettings(
        userId: '${json['userId'] ?? ''}',
        learningReminders: json['learningReminders'] as bool? ?? true,
        courseUpdates: json['courseUpdates'] as bool? ?? true,
        orderNotifications: json['orderNotifications'] as bool? ?? true,
        updatedAt: '${json['updatedAt'] ?? ''}',
      );
}

/// A sign-in identity currently linked to the authenticated account.
class AccountIdentity {
  const AccountIdentity({
    required this.provider,
    this.nickname,
    required this.boundAt,
  });

  final String provider;
  final String? nickname;
  final String boundAt;

  factory AccountIdentity.fromJson(JsonMap json) => AccountIdentity(
        provider: '${json['provider'] ?? ''}',
        nickname: json['nickname'] as String?,
        boundAt: '${json['boundAt'] ?? json['createdAt'] ?? ''}',
      );
}

class UserDevice {
  const UserDevice({
    required this.id,
    required this.platform,
    required this.name,
    required this.lastSeenAt,
    this.current = false,
  });

  final String id;
  final String platform;
  final String name;
  final String lastSeenAt;
  final bool current;

  factory UserDevice.fromJson(JsonMap json) => UserDevice(
        id: '${json['id'] ?? ''}',
        platform: '${json['platform'] ?? ''}',
        name: '${json['name'] ?? ''}',
        lastSeenAt: '${json['lastSeenAt'] ?? json['last_seen_at'] ?? ''}',
        current: json['current'] == true,
      );
}

class DeviceRemovalResult {
  const DeviceRemovalResult({
    required this.removed,
    required this.revokedSessions,
  });

  final bool removed;
  final int revokedSessions;

  factory DeviceRemovalResult.fromJson(JsonMap json) => DeviceRemovalResult(
        removed: json['removed'] == true,
        revokedSessions: (json['revokedSessions'] as num?)?.toInt() ?? 0,
      );
}

class AccountDeletionStatus {
  const AccountDeletionStatus({
    required this.status,
    this.requestedAt,
    this.executeAfter,
    this.coolingOffDays,
  });

  final String status;
  final String? requestedAt;
  final String? executeAfter;
  final int? coolingOffDays;

  bool get scheduled => status == 'scheduled';

  factory AccountDeletionStatus.fromJson(JsonMap json) => AccountDeletionStatus(
        status: '${json['status'] ?? 'none'}',
        requestedAt: json['requestedAt'] as String?,
        executeAfter: json['executeAfter'] as String?,
        coolingOffDays: (json['coolingOffDays'] as num?)?.toInt(),
      );
}

class GradingSubmission {
  const GradingSubmission(
      {required this.id,
      required this.status,
      required this.createdAt,
      this.paperId,
      this.paperTitle,
      this.questionId,
      this.questionTitle,
      this.score,
      this.maxScore,
      this.feedback,
      this.latestReportId,
      this.updatedAt,
      this.answers = const []});
  final String id;
  final String status;
  final String createdAt;
  final String? paperId;
  final String? paperTitle;
  final String? questionId;
  final String? questionTitle;
  final num? score;
  final num? maxScore;
  final String? feedback;
  final String? latestReportId;
  final String? updatedAt;
  final List<JsonMap> answers;
  factory GradingSubmission.fromJson(JsonMap json) => GradingSubmission(
      id: '${json['id'] ?? ''}',
      status: '${json['status'] ?? ''}',
      createdAt: '${json['createdAt'] ?? ''}',
      paperId: json['paperId'] as String?,
      paperTitle: json['paperTitle'] as String?,
      questionId: json['questionId'] as String?,
      questionTitle: json['questionTitle'] as String?,
      score: json['score'] as num?,
      maxScore: json['maxScore'] as num?,
      feedback: json['feedback'] as String?,
      latestReportId: json['latestReportId'] as String?,
      updatedAt: json['updatedAt'] as String?,
      answers: (json['answers'] as List<dynamic>? ?? const [])
          .whereType<JsonMap>()
          .toList(growable: false));
}

class GradingReport {
  const GradingReport({
    required this.id,
    required this.submissionId,
    required this.totalScore,
    required this.maxScore,
    required this.feedback,
    required this.improvementAdvice,
    this.answers = const [],
    this.pointResults = const [],
    this.publishedAt,
  });

  final String id;
  final String submissionId;
  final num totalScore;
  final num maxScore;
  final String feedback;
  final String improvementAdvice;
  final List<JsonMap> answers;
  final List<JsonMap> pointResults;
  final String? publishedAt;

  factory GradingReport.fromJson(JsonMap json) => GradingReport(
        id: '${json['id'] ?? ''}',
        submissionId: '${json['submissionId'] ?? ''}',
        totalScore: (json['totalScore'] as num?) ?? 0,
        maxScore: (json['maxScore'] as num?) ?? 0,
        feedback: '${json['feedback'] ?? ''}',
        improvementAdvice: '${json['improvementAdvice'] ?? ''}',
        answers: (json['answers'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .toList(growable: false),
        pointResults: (json['pointResults'] as List<dynamic>? ?? const [])
            .whereType<JsonMap>()
            .toList(growable: false),
        publishedAt: json['publishedAt'] as String?,
      );
}

class MediaAvailability {
  const MediaAvailability({
    required this.available,
    required this.reason,
    this.url,
    this.expiresAt,
  });
  final bool available;
  final String reason;
  final String? url;
  final String? expiresAt;
  factory MediaAvailability.fromJson(JsonMap json) => MediaAvailability(
      available: json['available'] == true,
      reason: '${json['reason'] ?? ''}',
      url: json['url'] as String?,
      expiresAt: json['expiresAt'] as String?);
}
