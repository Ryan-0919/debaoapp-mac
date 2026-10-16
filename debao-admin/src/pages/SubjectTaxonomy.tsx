import {ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined} from '@ant-design/icons';
import {Alert, Button, Empty, Form, Input, List, Modal, Popconfirm, Skeleton, Space, Table, Tag, Typography, message} from 'antd';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useNavigate, useParams, useSearchParams} from 'react-router-dom';
import {
  createAdminChapter,
  createAdminPoint,
  deleteAdminChapter,
  deleteAdminPoint,
  getAdminSubjects,
  updateAdminChapter,
  updateAdminPoint,
  type AdminSubject,
} from '@/services/api';

type Chapter = NonNullable<AdminSubject['chapters']>[number];
type Point = NonNullable<Chapter['points']>[number];
type QuestionCategory = 'objective' | 'subjective';
type DialogState =
  | {kind: 'createChapter'}
  | {kind: 'createPoint'; chapterId: string}
  | {kind: 'editChapter'; item: Chapter}
  | {kind: 'editPoint'; chapterId: string; item: Point};

const typeLabels: Record<QuestionCategory, string> = {
  objective: '客观题',
  subjective: '主观题',
};

export default function SubjectTaxonomy() {
  const navigate = useNavigate();
  const {subjectId = ''} = useParams();
  const [searchParams] = useSearchParams();
  const type: QuestionCategory = searchParams.get('type') === 'subjective' ? 'subjective' : 'objective';
  const [subject, setSubject] = useState<AdminSubject>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selectedChapterId, setSelectedChapterId] = useState<string>();
  const [dialog, setDialog] = useState<DialogState>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{name: string}>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const subjects = await getAdminSubjects();
      const nextSubject = subjects.find(item => item.id === subjectId);
      if (!nextSubject) {
        setSubject(undefined);
        setError('未找到该科目，它可能已被删除。');
        return;
      }
      setSubject(nextSubject);
    } catch (cause) {
      setSubject(undefined);
      setError(cause instanceof Error ? cause.message : '加载章节与考点失败');
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => { void load(); }, [load]);

  const chapters = useMemo(
    () => (subject?.chapters ?? []).filter(chapter => chapter.questionType === type),
    [subject, type],
  );

  useEffect(() => {
    if (!chapters.length) {
      setSelectedChapterId(undefined);
      return;
    }
    if (!chapters.some(chapter => chapter.id === selectedChapterId)) {
      setSelectedChapterId(chapters[0].id);
    }
  }, [chapters, selectedChapterId]);

  const selectedChapter = chapters.find(chapter => chapter.id === selectedChapterId);
  const questionCount = type === 'objective'
    ? subject?.objectiveQuestionCount ?? 0
    : subject?.subjectiveQuestionCount ?? 0;
  const pointCount = chapters.reduce((sum, chapter) => sum + (chapter.points?.length ?? 0), 0);

  const openCreateChapter = () => {
    form.resetFields();
    setDialog({kind: 'createChapter'});
  };

  const openCreatePoint = () => {
    if (!selectedChapter) return;
    form.resetFields();
    setDialog({kind: 'createPoint', chapterId: selectedChapter.id});
  };

  const openEditChapter = (chapter: Chapter) => {
    form.setFieldsValue({name: chapter.name});
    setDialog({kind: 'editChapter', item: chapter});
  };

  const openEditPoint = (point: Point) => {
    if (!selectedChapter) return;
    form.setFieldsValue({name: point.name});
    setDialog({kind: 'editPoint', chapterId: selectedChapter.id, item: point});
  };

  const removeChapter = async (chapter: Chapter) => {
    try {
      await deleteAdminChapter(subjectId, chapter.id);
      message.success('章节已删除');
      await load();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '删除章节失败');
    }
  };

  const removePoint = async (point: Point) => {
    if (!selectedChapter) return;
    try {
      await deleteAdminPoint(subjectId, selectedChapter.id, point.id);
      message.success('考点已删除');
      await load();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '删除考点失败');
    }
  };

  const save = async ({name}: {name: string}) => {
    if (!dialog || !subject) return;
    setSaving(true);
    try {
      const trimmedName = name.trim();
      if (dialog.kind === 'createChapter') {
        const updated = await createAdminChapter(subject.id, {name: trimmedName, questionType: type});
        const matchingChapters = (updated.chapters ?? []).filter(chapter => chapter.questionType === type);
        const created = matchingChapters[matchingChapters.length - 1];
        if (created) setSelectedChapterId(created.id);
        message.success('章节已新增');
      } else if (dialog.kind === 'createPoint') {
        await createAdminPoint(subject.id, dialog.chapterId, {name: trimmedName});
        message.success('考点已新增');
      } else if (dialog.kind === 'editChapter') {
        await updateAdminChapter(subject.id, dialog.item.id, {name: trimmedName});
        message.success('章节名称已保存');
      } else {
        await updateAdminPoint(subject.id, dialog.chapterId, dialog.item.id, {name: trimmedName});
        message.success('考点名称已保存');
      }
      setDialog(undefined);
      await load();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '提交失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const dialogTitle = dialog?.kind === 'createChapter'
    ? `新增${typeLabels[type]}章节`
    : dialog?.kind === 'createPoint'
      ? `在“${selectedChapter?.name ?? ''}”下新增考点`
      : dialog?.kind === 'editChapter'
        ? '编辑章节名称'
        : '编辑考点名称';

  if (loading && !subject) {
    return <Skeleton active paragraph={{rows: 8}} />;
  }

  if (!subject) {
    return (
      <Space direction="vertical" size={16} style={{display: 'flex'}}>
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/content/subjects?type=${type}`)}>返回科目列表</Button>
        <Alert
          type="error"
          showIcon
          message="无法打开科目目录"
          description={error ?? '科目数据暂时不可用。'}
          action={<Button icon={<ReloadOutlined />} onClick={() => void load()}>重试</Button>}
        />
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={18} style={{display: 'flex'}}>
      <div>
        <Button type="link" icon={<ArrowLeftOutlined />} style={{paddingInline: 0}} onClick={() => navigate(`/content/subjects?type=${type}`)}>
          返回科目列表
        </Button>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap'}}>
          <div>
            <Space size={10} wrap>
              <Typography.Title level={4} style={{margin: 0}}>{subject.name} · 章节与考点</Typography.Title>
              <Tag color={type === 'objective' ? 'blue' : 'purple'}>{typeLabels[type]}</Tag>
            </Space>
            <Typography.Text type="secondary">选择章节后，在右侧维护该章节下的考点。</Typography.Text>
          </div>
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateChapter}>新增章节</Button>
          </Space>
        </div>
      </div>

      {error && <Alert type="error" showIcon message="目录刷新失败" description={error} />}

      <Space size={[8, 8]} wrap>
        <Tag>{questionCount} 道{typeLabels[type]}</Tag>
        <Tag>{chapters.length} 个章节</Tag>
        <Tag>{pointCount} 个考点</Tag>
      </Space>

      <div style={{display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)', gap: 16, alignItems: 'start'}}>
        <div style={{background: '#fff', border: '1px solid #e8e9ef', borderRadius: 8, overflow: 'hidden'}}>
          <div style={{padding: '14px 16px', borderBottom: '1px solid #eef0f4'}}>
            <Typography.Text strong>章节</Typography.Text>
          </div>
          <List
            dataSource={chapters}
            locale={{emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无章节，请先新增章节" />}}
            renderItem={(chapter, index) => {
              const selected = chapter.id === selectedChapterId;
              return (
                <List.Item
                  onClick={() => setSelectedChapterId(chapter.id)}
                  style={{
                    padding: '12px 16px',
                    cursor: 'pointer',
                    background: selected ? '#f0f0ff' : '#fff',
                  }}
                  actions={[
                    <Button
                      key="edit"
                      type="text"
                      size="small"
                      aria-label={`编辑${chapter.name}`}
                      icon={<EditOutlined />}
                      onClick={event => { event.stopPropagation(); openEditChapter(chapter); }}
                    />,
                    <Popconfirm
                      key="delete"
                      title={`确定删除“${chapter.name}”？`}
                      description="章节下不能有已关联题目。"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{danger: true}}
                      onConfirm={() => void removeChapter(chapter)}
                    >
                      <Button
                        type="text"
                        danger
                        size="small"
                        aria-label={`删除${chapter.name}`}
                        icon={<DeleteOutlined />}
                        onClick={event => event.stopPropagation()}
                      />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={<Typography.Text strong={selected}>{index + 1}. {chapter.name}</Typography.Text>}
                    description={`${chapter.points?.length ?? 0} 个考点`}
                  />
                </List.Item>
              );
            }}
          />
        </div>

        <div style={{background: '#fff', border: '1px solid #e8e9ef', borderRadius: 8, minWidth: 0}}>
          <div style={{padding: '14px 16px', borderBottom: '1px solid #eef0f4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12}}>
            <div>
              <Typography.Text strong>{selectedChapter?.name ?? '考点'}</Typography.Text>
              {selectedChapter && <Typography.Text type="secondary"> · {selectedChapter.points?.length ?? 0} 个考点</Typography.Text>}
            </div>
            <Button type="primary" icon={<PlusOutlined />} disabled={!selectedChapter} onClick={openCreatePoint}>新增考点</Button>
          </div>
          <Table
            size="middle"
            rowKey="id"
            pagination={false}
            dataSource={selectedChapter?.points ?? []}
            locale={{emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={selectedChapter ? '该章节暂无考点' : '请先选择章节'} />}}
            columns={[
              {title: '序号', width: 80, render: (_: unknown, __: Point, index: number) => index + 1},
              {title: '考点名称', dataIndex: 'name'},
              {
                title: '操作',
                width: 100,
                render: (_: unknown, point: Point) => (
                  <Space size={0}>
                    <Button type="link" icon={<EditOutlined />} onClick={() => openEditPoint(point)}>编辑</Button>
                    <Popconfirm
                      title={`确定删除“${point.name}”？`}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{danger: true}}
                      onConfirm={() => void removePoint(point)}
                    >
                      <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </div>

      <Modal
        title={dialogTitle}
        open={Boolean(dialog)}
        onCancel={() => { if (!saving) setDialog(undefined); }}
        onOk={() => form.submit()}
        okText={dialog?.kind === 'createChapter' || dialog?.kind === 'createPoint' ? '确认新增' : '保存'}
        cancelText="取消"
        confirmLoading={saving}
        cancelButtonProps={{disabled: saving}}
        maskClosable={!saving}
        keyboard={!saving}
        destroyOnClose
        afterClose={() => form.resetFields()}
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item
            name="name"
            label={dialog?.kind === 'createChapter' || dialog?.kind === 'editChapter' ? '章节名称' : '考点名称'}
            rules={[{required: true, whitespace: true, message: '请输入名称'}]}
          >
            <Input autoFocus maxLength={50} showCount placeholder="请输入名称" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
