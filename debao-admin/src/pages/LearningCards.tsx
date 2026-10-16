import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileTextOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  createLearningCard,
  deleteLearningCard,
  disableLearningCard,
  getLearningQuestionTaxonomy,
  getLearningCards,
  publishLearningCard,
  updateLearningCard,
  uploadLearningCardAsset,
  type AdminLearningCard,
  type AdminLearningCardAsset,
  type AdminLearningCardInput,
  type AdminLearningTaxonomyNode,
} from "@/services/api";

type CardForm = Omit<AdminLearningCardInput, "assets">;
const statusMeta = {
  draft: { label: "草稿", color: "gold" },
  published: { label: "已发布", color: "success" },
  disabled: { label: "已停用", color: "default" },
} as const;
const formatBytes = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;

export default function LearningCards() {
  const [form] = Form.useForm<CardForm>();
  const [items, setItems] = useState<AdminLearningCard[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    draft: 0,
    published: 0,
    disabled: 0,
  });
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>();
  const [contentType, setContentType] = useState<string>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AdminLearningCard>();
  const [assets, setAssets] = useState<AdminLearningCardAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [preview, setPreview] = useState<AdminLearningCard>();
  const [taxonomyNodes, setTaxonomyNodes] = useState<AdminLearningTaxonomyNode[]>([]);
  const watchedType = Form.useWatch("contentType", form) ?? "image_gallery";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [result, taxonomy] = await Promise.all([
        getLearningCards({ keyword, status, contentType }),
        getLearningQuestionTaxonomy({ category: "objective" }),
      ]);
      setItems(result.items);
      setStats(result.stats);
      setTaxonomyNodes(taxonomy.items);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "卡片列表加载失败",
      );
    } finally {
      setLoading(false);
    }
  }, [keyword, status, contentType]);
  useEffect(() => void load(), [load]);

  const openCreate = () => {
    setEditing(undefined);
    setAssets([]);
    setUploadProgress(0);
    form.resetFields();
    form.setFieldsValue({
      contentType: "image_gallery",
      sortOrder: (stats.total + 1) * 10,
      recallItems: [],
      knowledgePointIds: [],
    });
    setDrawerOpen(true);
  };
  const openEdit = (item: AdminLearningCard) => {
    setEditing(item);
    setAssets([...item.assets].sort((a, b) => a.sortOrder - b.sortOrder));
    setUploadProgress(0);
    form.setFieldsValue({
      title: item.title,
      description: item.description,
      contentType: item.contentType,
      sortOrder: item.sortOrder,
      recallItems: item.recallItems ?? [],
      knowledgePointIds: item.knowledgePointIds ?? [],
    });
    setDrawerOpen(true);
  };
  const uploadFiles = async (files: File[]) => {
    const limit = watchedType === "image_gallery" ? 20 : 1;
    const remaining = limit - assets.length;
    if (remaining <= 0)
      return message.warning(
        watchedType === "html"
          ? "HTML/PDF 卡片只能上传一个文件"
          : "一张卡片最多上传 20 张图片",
      );
    setUploading(true);
    try {
      const uploaded: AdminLearningCardAsset[] = [];
      for (const file of files.slice(0, remaining)) {
        const asset = await uploadLearningCardAsset(file, setUploadProgress);
        if (
          (watchedType === "html" && asset.type !== "html") ||
          (watchedType === "pdf" && asset.type !== "pdf") ||
          (watchedType === "image_gallery" && asset.type !== "image")
        )
          throw new Error("上传文件与当前卡片类型不匹配");
        uploaded.push(asset);
      }
      setAssets((current) =>
        [...current, ...uploaded].map((item, index) => ({
          ...item,
          sortOrder: index,
        })),
      );
      message.success(`已上传 ${uploaded.length} 个素材`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "素材上传失败");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };
  const moveAsset = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= assets.length) return;
    const next = [...assets];
    [next[index], next[target]] = [next[target], next[index]];
    setAssets(next.map((item, order) => ({ ...item, sortOrder: order })));
  };
  const save = async (values: CardForm) => {
    if (!assets.length)
      return message.error(
        values.contentType !== "image_gallery"
          ? `请上传 ${values.contentType === "pdf" ? "PDF" : "HTML"} 文件`
          : "请至少上传一张图片",
      );
    const input: AdminLearningCardInput = {
      ...values,
      assets: assets.map((item, index) => ({ ...item, sortOrder: index })),
      recallItems: (values.recallItems ?? []).map((item, index) => ({
        id: item.id ?? `recall-${Date.now()}-${index}`,
        prompt: item.prompt.trim(),
        answer: item.answer.trim(),
        sortOrder: index,
      })),
    };
    try {
      if (editing) await updateLearningCard(editing.id, input);
      else await createLearningCard(input);
      message.success(editing ? "卡片已更新并保存为草稿" : "卡片草稿已创建");
      setDrawerOpen(false);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "卡片保存失败");
    }
  };
  const act = async (
    item: AdminLearningCard,
    action: "publish" | "disable" | "delete",
  ) => {
    try {
      if (action === "publish") await publishLearningCard(item.id);
      if (action === "disable")
        await disableLearningCard(item.id, "学习中心管理员手动停用");
      if (action === "delete") await deleteLearningCard(item.id);
      message.success(
        action === "publish"
          ? "卡片已发布"
          : action === "disable"
            ? "卡片已停用"
            : "卡片草稿已删除",
      );
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  };

  return (
    <Space direction="vertical" size={20} style={{ display: "flex" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            卡片管理
          </Typography.Title>
          <Typography.Text type="secondary">
            管理图片、HTML 和 PDF 学习卡片，并绑定考点后自动编排进学习计划。
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建卡片
        </Button>
      </div>
      <Row gutter={12}>
        {[
          { label: "全部卡片", value: stats.total },
          { label: "草稿", value: stats.draft },
          { label: "已发布", value: stats.published },
          { label: "已停用", value: stats.disabled },
        ].map((item) => (
          <Col span={6} key={item.label}>
            <Card size="small">
              <Statistic title={item.label} value={item.value} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card>
        <Space wrap style={{ marginBottom: 18 }}>
          <Input.Search
            allowClear
            placeholder="搜索卡片标题或说明"
            style={{ width: 280 }}
            onSearch={setKeyword}
          />
          <Select
            allowClear
            placeholder="全部内容形式"
            style={{ width: 170 }}
            value={contentType}
            onChange={setContentType}
            options={[
              { value: "image_gallery", label: "图片卡片" },
              { value: "html", label: "HTML 卡片" },
            ]}
          />
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 150 }}
            value={status}
            onChange={setStatus}
            options={Object.entries(statusMeta).map(([value, meta]) => ({
              value,
              label: meta.label,
            }))}
          />
        </Space>
        {items.length ? (
          <Row gutter={[16, 16]}>
            {items.map((item) => (
              <Col xs={24} lg={12} xl={8} key={item.id}>
                <Card
                  hoverable
                  styles={{ body: { padding: 16 } }}
                  cover={
                    item.contentType === "image_gallery" && item.assets[0] ? (
                      <div
                        style={{
                          height: 168,
                          overflow: "hidden",
                          background: "#f1f2f6",
                        }}
                      >
                        <img
                          src={item.assets[0].reference}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          height: 168,
                          display: "grid",
                          placeItems: "center",
                          background: "linear-gradient(145deg,#f2f1ff,#f7f7fb)",
                        }}
                      >
                        <FileTextOutlined
                          style={{ fontSize: 42, color: "#6663e9" }}
                        />
                      </div>
                    )
                  }
                >
                  <Space
                    direction="vertical"
                    size={12}
                    style={{ display: "flex" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <Typography.Text
                          strong
                          ellipsis
                          style={{ display: "block", fontSize: 16 }}
                        >
                          {item.title}
                        </Typography.Text>
                        <Typography.Text
                          type="secondary"
                          ellipsis
                          style={{ display: "block" }}
                        >
                          {item.description || "暂无说明"}
                        </Typography.Text>
                      </div>
                      <Tag color={statusMeta[item.status].color}>
                        {statusMeta[item.status].label}
                      </Tag>
                    </div>
                    <Space size={8}>
                      <Tag
                        icon={
                          item.contentType === "html" ? (
                            <FileTextOutlined />
                          ) : (
                            <FileImageOutlined />
                          )
                        }
                      >
                        {item.contentType === "html"
                          ? "HTML"
                          : item.contentType === "pdf"
                            ? "PDF"
                            : `${item.assets.length} 张图片`}
                      </Tag>
                      {item.knowledgePointIds?.length ? (
                        <Tag color="geekblue">已绑 {item.knowledgePointIds.length} 个考点</Tag>
                      ) : (
                        <Tag color="warning">未绑考点</Tag>
                      )}
                      <Typography.Text type="secondary">
                        排序 {item.sortOrder}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        v{item.version}
                      </Typography.Text>
                    </Space>
                    <Space wrap>
                      <Button
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => setPreview(item)}
                      >
                        预览
                      </Button>
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => openEdit(item)}
                      >
                        编辑
                      </Button>
                      {item.status !== "published" && (
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => void act(item, "publish")}
                        >
                          发布
                        </Button>
                      )}
                      {item.status === "published" && (
                        <Popconfirm
                          title="停用这张卡片？"
                          onConfirm={() => void act(item, "disable")}
                        >
                          <Button size="small">停用</Button>
                        </Popconfirm>
                      )}
                      {item.status === "draft" && (
                        <Popconfirm
                          title="删除这个草稿？"
                          onConfirm={() => void act(item, "delete")}
                        >
                          <Button size="small" danger icon={<DeleteOutlined />}>
                            删除
                          </Button>
                        </Popconfirm>
                      )}
                    </Space>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={loading ? "正在加载卡片…" : "还没有符合条件的卡片"}
          />
        )}
      </Card>

      <Drawer
        width="min(760px, calc(100vw - 24px))"
        title={editing ? "编辑卡片" : "新建卡片"}
        open={drawerOpen}
        destroyOnClose
        onClose={() => !uploading && setDrawerOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)} disabled={uploading}>
              取消
            </Button>
            <Button
              type="primary"
              loading={uploading}
              onClick={() => form.submit()}
            >
              保存为草稿
            </Button>
          </Space>
        }
      >
        <Form<CardForm>
          form={form}
          layout="vertical"
          onFinish={save}
          requiredMark="optional"
        >
          {editing?.status === "published" && (
            <Alert
              showIcon
              type="warning"
              message="编辑已发布卡片后会生成新的草稿版本，需要重新发布。"
              style={{ marginBottom: 18 }}
            />
          )}
          <Form.Item
            name="title"
            label="卡片标题"
            rules={[
              {
                required: true,
                min: 2,
                max: 160,
                message: "请输入 2 到 160 个字的标题",
              },
            ]}
          >
            <Input
              showCount
              maxLength={160}
              placeholder="例如：民法核心概念速记"
            />
          </Form.Item>
          <Form.Item name="description" label="卡片说明">
            <Input.TextArea
              rows={3}
              showCount
              maxLength={1000}
              placeholder="说明这张卡片适合谁、解决什么问题"
            />
          </Form.Item>
          <Form.Item
            name="knowledgePointIds"
            label="关联考点 / 知识点"
            rules={[{ required: true, type: "array", min: 1, message: "请至少关联一个考点或知识点" }]}
            tooltip="用户完成前置课程后，系统会按这些考点自动调用已发布卡片。"
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              options={taxonomyNodes
                .filter((node) => node.type === "point" || node.type === "subpoint")
                .map((node) => ({
                  value: node.id,
                  label: node.type === "subpoint" ? `↳ ${node.name}` : node.name,
                }))}
              placeholder="选择这张卡片覆盖的考点或知识点"
            />
          </Form.Item>
          <Form.List name="recallItems">
            {(fields, { add, remove }) => (
              <Card
                size="small"
                title="主动回忆（挖空）"
                extra={
                  <Button
                    type="link"
                    icon={<PlusOutlined />}
                    disabled={fields.length >= 20}
                    onClick={() => add({ prompt: "", answer: "" })}
                  >
                    添加挖空
                  </Button>
                }
                style={{ marginBottom: 16 }}
              >
                <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
                  用户完成背诵后按顺序回忆。题干用“____”表示挖空，答案只在核对时显示；不填写则跳过主动回忆。
                </Typography.Paragraph>
                {fields.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未配置挖空" />
                ) : (
                  fields.map((field, index) => (
                    <Card key={field.key} size="small" style={{ marginBottom: 10 }}>
                      <Space align="start" style={{ display: "flex" }}>
                        <Typography.Text type="secondary" style={{ paddingTop: 6, width: 28 }}>
                          {index + 1}
                        </Typography.Text>
                        <Form.Item
                          {...field}
                          name={[field.name, "prompt"]}
                          rules={[{ required: true, min: 2, max: 1000, message: "请输入挖空题干（最多 1000 字）" }, { validator: (_, value) => typeof value === 'string' && value.split('____').length === 2 ? Promise.resolve() : Promise.reject(new Error('请用一个 ____ 标记挖空位置')) }]}
                          style={{ flex: 1, marginBottom: 0 }}
                        >
                          <Input.TextArea rows={2} maxLength={1000} placeholder="例如：物权变动应以一定方式向外界____。" />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, "answer"]}
                          rules={[{ required: true, message: "请输入答案" }]}
                          style={{ width: 180, marginBottom: 0 }}
                        >
                          <Input maxLength={300} placeholder="答案" />
                        </Form.Item>
                        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                      </Space>
                    </Card>
                  ))
                )}
              </Card>
            )}
          </Form.List>
          <Form.Item
            name="contentType"
            label="内容形式"
            rules={[{ required: true }]}
            extra={
              assets.length
                ? "如需切换内容形式，请先移除下方已上传的素材。"
                : undefined
            }
          >
            <Segmented
              block
              disabled={assets.length > 0}
              options={[
                {
                  label: "图片卡片",
                  value: "image_gallery",
                  icon: <FileImageOutlined />,
                },
                {
                  label: "HTML 卡片",
                  value: "html",
                  icon: <FileTextOutlined />,
                },
                {
                  label: "PDF 卡片",
                  value: "pdf",
                  icon: <FileTextOutlined />,
                },
              ]}
            />
          </Form.Item>
          <Alert
            showIcon
            type="info"
            message={
              watchedType === "html"
                ? "上传一个 HTML 文件，最大 10 MB。预览时会禁止脚本运行。"
                : watchedType === "pdf"
                  ? "上传一个 PDF 文件，最大 30 MB。用户可在线打开阅读。"
                : "支持 JPG、PNG、WebP、GIF；单张最大 15 MB，一张卡片最多 20 张图片。图片顺序就是用户阅读顺序。"
            }
            style={{ marginBottom: 16 }}
          />
          <Upload.Dragger
            multiple={watchedType === "image_gallery"}
            maxCount={watchedType === "image_gallery" ? 20 : 1}
            accept={
              watchedType === "html"
                ? ".html,.htm,text/html"
                : watchedType === "pdf"
                  ? ".pdf,application/pdf"
                : ".jpg,.jpeg,.png,.webp,.gif,image/*"
            }
            showUploadList={false}
            disabled={
              uploading || (watchedType !== "image_gallery" && assets.length > 0)
            }
            beforeUpload={(_, fileList) => {
              if (fileList[0] === _) void uploadFiles(fileList);
              return Upload.LIST_IGNORE;
            }}
          >
            <p className="ant-upload-drag-icon">
              <UploadOutlined />
            </p>
            <p className="ant-upload-text">
              点击选择或拖拽{watchedType === "html" ? " HTML 文件" : watchedType === "pdf" ? " PDF 文件" : "图片"}
              到这里
            </p>
            <p className="ant-upload-hint">
              文件上传完成后会出现在下方，可预览和调整顺序
            </p>
          </Upload.Dragger>
          {uploading && (
            <Progress
              percent={uploadProgress}
              status="active"
              style={{ marginTop: 12 }}
            />
          )}
          <Space
            direction="vertical"
            size={10}
            style={{ display: "flex", marginTop: 16 }}
          >
            {assets.map((asset, index) => (
              <Card
                size="small"
                key={asset.reference}
                styles={{ body: { padding: 10 } }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {asset.type === "image" ? (
                    <Image
                      src={asset.reference}
                      width={72}
                      height={52}
                      style={{ objectFit: "cover", borderRadius: 6 }}
                      preview={false}
                    />
                  ) : (
                    <div
                      style={{
                        width: 72,
                        height: 52,
                        display: "grid",
                        placeItems: "center",
                        background: "#f2f1ff",
                        borderRadius: 6,
                      }}
                    >
                      <FileTextOutlined
                        style={{ fontSize: 24, color: "#6663e9" }}
                      />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Typography.Text
                      strong
                      ellipsis
                      style={{ display: "block" }}
                    >
                      {asset.filename}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {asset.type === "image"
                        ? `第 ${index + 1} 张`
                        : asset.type === "pdf" ? "PDF 文件" : "HTML 文件"}{" "}
                      · {formatBytes(asset.sizeBytes)}
                    </Typography.Text>
                  </div>
                  {asset.type === "image" && (
                    <Space size={0}>
                      <Button
                        type="text"
                        aria-label="上移"
                        icon={<ArrowUpOutlined />}
                        disabled={index === 0}
                        onClick={() => moveAsset(index, -1)}
                      />
                      <Button
                        type="text"
                        aria-label="下移"
                        icon={<ArrowDownOutlined />}
                        disabled={index === assets.length - 1}
                        onClick={() => moveAsset(index, 1)}
                      />
                    </Space>
                  )}
                  <Button
                    type="text"
                    danger
                    aria-label="移除"
                    icon={<DeleteOutlined />}
                    onClick={() =>
                      setAssets((current) =>
                        current
                          .filter((_, i) => i !== index)
                          .map((item, order) => ({
                            ...item,
                            sortOrder: order,
                          })),
                      )
                    }
                  />
                </div>
              </Card>
            ))}
          </Space>
          <Form.Item
            name="sortOrder"
            label="排序值"
            rules={[{ required: true }]}
            style={{ marginTop: 20 }}
            extra="数字越小越靠前"
          >
            <InputNumber
              min={0}
              max={99999}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
        </Form>
      </Drawer>

      <Modal
        width="min(920px, calc(100vw - 32px))"
        title={preview?.title ?? "卡片预览"}
        open={Boolean(preview)}
        onCancel={() => setPreview(undefined)}
        footer={<Button onClick={() => setPreview(undefined)}>关闭</Button>}
        destroyOnClose
      >
        {preview?.description && (
          <Typography.Paragraph type="secondary">
            {preview.description}
          </Typography.Paragraph>
        )}
        {preview?.contentType === "image_gallery" ? (
          <Space direction="vertical" size={12} style={{ display: "flex" }}>
            {preview.assets.map((asset) => (
              <Image
                key={asset.reference}
                src={asset.reference}
                width="100%"
                style={{ borderRadius: 8 }}
              />
            ))}
          </Space>
        ) : preview?.assets[0] ? (
          <iframe
            title={preview.title}
            src={preview.assets[0].reference}
            sandbox=""
            style={{
              width: "100%",
              height: "70vh",
              border: "1px solid #e8e9ef",
              borderRadius: 8,
              background: "#fff",
            }}
          />
        ) : null}
      </Modal>
    </Space>
  );
}
