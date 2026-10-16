import { defineConfig } from "@umijs/max";

export default defineConfig({
  antd: {},
  access: {},
  model: {},
  initialState: {},
  request: {},
  hash: true,
  history: { type: "browser" },
  routes: [
    { path: "/login", component: "@/pages/Login" },
    { path: "/grader/login", component: "@/pages/GraderLogin" },
    { path: "/grader/workbench", component: "@/pages/GraderWorkbench" },
    { path: "/grading-admin/login", component: "@/pages/GradingAdminLogin" },
    {
      path: "/grading-admin",
      component: "@/layouts/GradingAdminLayout",
      routes: [
        { path: "/grading-admin", redirect: "/grading-admin/queue" },
        { path: "/grading-admin/queue", component: "@/pages/Grading" },
        {
          path: "/grading-admin/accounts",
          component: "@/pages/GraderAccounts",
        },
      ],
    },
    { path: "/learning-admin/login", component: "@/pages/LearningAdminLogin" },
    {
      path: "/learning-admin",
      component: "@/layouts/LearningAdminLayout",
      routes: [
        { path: "/learning-admin", redirect: "/learning-admin/classes" },
        {
          path: "/learning-admin/diagnostics",
          redirect: "/learning-admin/diagnostics/questions",
        },
        {
          path: "/learning-admin/diagnostics/form",
          component: "@/pages/LearningDiagnosticQuestions",
        },
        {
          path: "/learning-admin/diagnostics/dimensions",
          component: "@/pages/LearningDiagnosticQuestions",
        },
        {
          path: "/learning-admin/diagnostics/questions",
          component: "@/pages/LearningDiagnosticQuestions",
        },
        {
          path: "/learning-admin/diagnostics/results",
          component: "@/pages/LearningDiagnosticResults",
        },
        {
          path: "/learning-admin/question-bank",
          redirect: "/learning-admin/question-bank/objective/subjects",
        },
        {
          path: "/learning-admin/question-bank/objective/questions",
          redirect: "/learning-admin/question-bank/objective/subjects",
        },
        {
          path: "/learning-admin/question-bank/objective/subjects",
          component: "@/pages/LearningQuestionTaxonomy",
        },
        {
          path: "/learning-admin/question-bank/objective/chapters",
          component: "@/pages/LearningQuestionTaxonomy",
        },
        {
          path: "/learning-admin/question-bank/objective/points",
          component: "@/pages/LearningQuestionTaxonomy",
        },
        {
          path: "/learning-admin/question-bank/objective/subpoints",
          component: "@/pages/LearningQuestionTaxonomy",
        },
        {
          path: "/learning-admin/question-bank/subjective/questions",
          redirect: "/learning-admin/question-bank/subjective/subjects",
        },
        {
          path: "/learning-admin/question-bank/subjective/subjects",
          component: "@/pages/LearningQuestionTaxonomy",
        },
        {
          path: "/learning-admin/question-bank/subjective/chapters",
          component: "@/pages/LearningQuestionTaxonomy",
        },
        {
          path: "/learning-admin/question-bank/subjective/points",
          component: "@/pages/LearningQuestionTaxonomy",
        },
        {
          path: "/learning-admin/question-bank/subjective/subpoints",
          component: "@/pages/LearningQuestionTaxonomy",
        },
        { path: "/learning-admin/cards", component: "@/pages/LearningCards" },
        { path: "/learning-admin/inquiries", component: "@/pages/LearningInquiries" },
        { path: "/learning-admin/assessment-papers", component: "@/pages/LearningAssessmentPapers" },
        { path: "/learning-admin/early-access", component: "@/pages/LearningEarlyAccess" },
        {
          path: "/learning-admin/classes",
          component: "@/pages/LearningClassTypes",
        },
        {
          path: "/learning-admin/classes/:classTypeId/stages",
          component: "@/pages/LearningStages",
        },
        {
          path: "/learning-admin/classes/:classTypeId/stages/:stageId/plan",
          component: "@/pages/LearningStagePlan",
        },
        { path: "/learning-admin/teachers", component: "@/pages/LearningTeachers" },
        { path: "/learning-admin/stages", redirect: "/learning-admin/classes" },
        {
          path: "/learning-admin/stages/:stageId/teachers",
          component: "@/pages/LearningStageTeachers",
        },
      ],
    },
    {
      path: "/",
      component: "@/layouts/BasicLayout",
      routes: [
        { path: "/", redirect: "/dashboard" },
        { path: "/dashboard", component: "@/pages/Dashboard" },
        { path: "/learning/inquiries", component: "@/pages/LearningInquiries" },
        { path: "/users", component: "@/pages/Users", name: "用户与权益" },
        {
          path: "/content/questions",
          component: "@/pages/Questions",
          name: "题目管理",
        },
        {
          path: "/content/subjects",
          component: "@/pages/Subjects",
          name: "科目章节",
        },
        {
          path: "/content/subjects/:subjectId",
          component: "@/pages/SubjectTaxonomy",
          name: "章节考点",
        },
        {
          path: "/content/papers",
          component: "@/pages/Papers",
          name: "试卷管理",
        },
        {
          path: "/content/imports",
          component: "@/pages/Imports",
          name: "题库批量导入",
        },
        { path: "/content/laws", component: "@/pages/Laws", name: "法条管理" },
        { path: "/courses", component: "@/pages/Courses", name: "课程管理" },
        {
          path: "/courses/audio",
          component: "@/pages/Courses",
          name: "音频课程库",
        },
        {
          path: "/courses/video",
          component: "@/pages/Courses",
          name: "视频课程库",
        },
        { path: "/courses/mixed", redirect: "/courses" },
        {
          path: "/courses/:courseId/edit",
          component: "@/pages/CourseEditor",
          name: "课程编辑",
        },
        {
          path: "/courses/:courseId/sections/:sectionId/edit",
          component: "@/pages/ChapterEditor",
          name: "章节素材上传",
        },
        {
          path: "/courses/live-sessions",
          component: "@/pages/LiveSessions",
          name: "直播排期",
        },
        {
          path: "/learning/records",
          component: "@/pages/LearningRecords",
          name: "学习记录",
        },
        {
          path: "/learning/plans",
          component: "@/pages/LearningPlans",
          name: "学习计划",
        },
        { path: "/grading", component: "@/pages/Grading", name: "批改队列" },
        {
          path: "/grading/accounts",
          component: "@/pages/GraderAccounts",
          name: "批改老师账号",
        },
        {
          path: "/commerce/products",
          component: "@/pages/Products",
          name: "商品管理",
        },
        {
          path: "/commerce/orders",
          component: "@/pages/Orders",
          name: "订单管理",
        },
        {
          path: "/commerce/refunds",
          component: "@/pages/Refunds",
          name: "退款售后",
        },
        {
          path: "/commerce/entitlements",
          component: "@/pages/Entitlements",
          name: "权益记录",
        },
        {
          path: "/community/posts",
          component: "@/pages/CommunityPosts",
          name: "帖子管理",
        },
        {
          path: "/community/comments",
          component: "@/pages/CommunityComments",
          name: "评论管理",
        },
        {
          path: "/community/reports",
          component: "@/pages/CommunityReports",
          name: "举报审核",
        },
        {
          path: "/community/rules",
          component: "@/pages/CommunityRules",
          name: "社区规则",
        },
        {
          path: "/operations/banners",
          component: "@/pages/Banners",
          name: "Banner 管理",
        },
        {
          path: "/operations/announcements",
          component: "@/pages/Announcements",
          name: "公告管理",
        },
        {
          path: "/operations/templates",
          component: "@/pages/Templates",
          name: "消息模板",
        },
        {
          path: "/operations/push-jobs",
          component: "@/pages/PushJobs",
          name: "推送任务",
        },
        { path: "/ai/quotas", component: "@/pages/AIQuotas", name: "AI 配额" },
        {
          path: "/ai/flags",
          component: "@/pages/AIRiskFlags",
          name: "AI 风险记录",
        },
        { path: "/ai/usage", component: "@/pages/AIUsage", name: "AI 用量" },
        {
          path: "/analytics",
          component: "@/pages/Analytics",
          name: "数据分析",
        },
        {
          path: "/system/admins",
          component: "@/pages/SystemAdmins",
          name: "管理员",
        },
        {
          path: "/system/audit-logs",
          component: "@/pages/AuditLogs",
          name: "审计日志",
        },
        {
          path: "/system/settings",
          component: "@/pages/SystemSettings",
          name: "系统配置",
        },
        {
          path: "/system/health",
          component: "@/pages/SystemHealth",
          name: "服务状态",
        },
        { path: "/403", component: "@/pages/403" },
        { path: "*", component: "@/pages/404" },
      ],
    },
  ],
  npmClient: "pnpm",
  title: "得宝运营后台",
  esbuildMinifyIIFE: true,
  proxy: {
    "/v1": { target: "http://127.0.0.1:4000", changeOrigin: true },
  },
});
