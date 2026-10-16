import {
  BookOutlined,
  DatabaseOutlined,
  FormOutlined,
  IdcardOutlined,
  LogoutOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { getCurrentAdmin, logoutAdmin } from "@/services/api";

export default function LearningAdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getCurrentAdmin()
      .then((admin) => {
        if (admin.role !== "learning_admin")
          navigate("/learning-admin/login", { replace: true });
      })
      .catch(() => navigate("/learning-admin/login", { replace: true }))
      .finally(() => setChecking(false));
  }, [navigate]);

  if (checking)
    return (
      <div
        style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}
      >
        <Spin tip="正在校验学习中心管理员会话..." />
      </div>
    );

  return (
    <Layout style={{ minHeight: "100vh", background: "#f5f6fa" }}>
      <Layout.Sider
        width={224}
        theme="light"
        style={{ borderRight: "1px solid #e8e9ef" }}
      >
        <div
          style={{
            height: 60,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 22px",
            borderBottom: "1px solid #eef0f4",
          }}
        >
          <BookOutlined style={{ color: "#4C4BEA", fontSize: 21 }} />
          <Typography.Text strong style={{ fontSize: 16 }}>
            得恩私教管理端
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[
            location.pathname.startsWith("/learning-admin/diagnostics/")
              ? location.pathname
              : location.pathname.startsWith(
                    "/learning-admin/question-bank/subjective",
                  )
                ? "/learning-admin/question-bank/subjective/subjects"
                : location.pathname.startsWith(
                      "/learning-admin/question-bank/objective",
                    )
                  ? "/learning-admin/question-bank/objective/subjects"
                  : location.pathname.startsWith("/learning-admin/inquiries")
                    ? "/learning-admin/inquiries"
                  : location.pathname.startsWith("/learning-admin/teachers")
                    ? "/learning-admin/teachers"
                  : location.pathname.startsWith("/learning-admin/cards")
                    ? "/learning-admin/cards"
                    : "/learning-admin/classes",
          ]}
          defaultOpenKeys={[
            "/learning-admin/diagnostics",
            "/learning-admin/question-bank",
            "/learning-admin/content-management",
            "/learning-admin/class-management",
          ]}
          items={[
            {
              key: "/learning-admin/diagnostics",
              icon: <FormOutlined />,
              label: "首次学习诊断",
              children: [
                { key: "/learning-admin/diagnostics/form", label: "表单设置" },
                {
                  key: "/learning-admin/diagnostics/dimensions",
                  label: "画像维度",
                },
                {
                  key: "/learning-admin/diagnostics/questions",
                  label: "诊断题管理",
                },
                {
                  key: "/learning-admin/diagnostics/results",
                  label: "诊断结果",
                },
              ],
            },
            {
              key: "/learning-admin/question-bank",
              icon: <DatabaseOutlined />,
              label: "题库管理",
              children: [
                {
                  key: "/learning-admin/question-bank/objective/subjects",
                  label: "客观题知识目录",
                },
                {
                  key: "/learning-admin/question-bank/subjective/subjects",
                  label: "主观题知识目录",
                },
              ],
            },
            {
              key: "/learning-admin/content-management",
              icon: <IdcardOutlined />,
              label: "学习内容",
              children: [
                { key: "/learning-admin/cards", label: "卡片管理" },
                { key: "/learning-admin/inquiries", label: "学员错因答疑" },
                { key: "/learning-admin/assessment-papers", label: "单科测试试卷" },
                { key: "/learning-admin/early-access", label: "提前学习申请" },
              ],
            },
            {
              key: "/learning-admin/class-management",
              icon: <TeamOutlined />,
              label: "班型与师资",
              children: [
                { key: "/learning-admin/classes", label: "班型管理" },
                { key: "/learning-admin/teachers", label: "师资表" },
              ],
            },
          ]}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 0, paddingTop: 10 }}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            height: 60,
            paddingInline: 24,
            background: "#fff",
            borderBottom: "1px solid #eef0f4",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Space direction="vertical" size={0}>
            <Typography.Text strong>学习中心</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              得恩私教产品运营
            </Typography.Text>
          </Space>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={async () => {
              await logoutAdmin().catch(() => undefined);
              navigate("/learning-admin/login", { replace: true });
            }}
          >
            退出
          </Button>
        </Layout.Header>
        <Layout.Content style={{ padding: 20, width: "100%", margin: 0 }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
