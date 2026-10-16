import {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Button, Card, Drawer, Empty, Form, Input, InputNumber, message, Select, Space, Table, Tag, Typography} from 'antd';
import {PlusOutlined} from '@ant-design/icons';
import {createLearningAssessmentPaper, getLearningAssessmentPapers, getLearningQuestionBank, getLearningQuestionTaxonomy, publishLearningAssessmentPaper, type AdminLearningQuestion, type AdminLearningTaxonomyNode, type LearningAssessmentPaper} from '@/services/api';

type PaperFormValues = Pick<LearningAssessmentPaper, 'title' | 'subjectId' | 'questionIds' | 'durationMinutes'>;

export default function LearningAssessmentPapers() {
  const [items, setItems] = useState<LearningAssessmentPaper[]>([]);
  const [questions, setQuestions] = useState<AdminLearningQuestion[]>([]);
  const [subjects, setSubjects] = useState<AdminLearningTaxonomyNode[]>([]);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<PaperFormValues>();
  const subjectId = Form.useWatch('subjectId', form);
  const questionIds = Form.useWatch('questionIds', form) ?? [];

  const load = useCallback(async () => {
    try {
      const [papers, bank, taxonomy] = await Promise.all([
        getLearningAssessmentPapers(),
        getLearningQuestionBank({category: 'objective', status: 'published'}),
        getLearningQuestionTaxonomy({category: 'objective', type: 'subject'}),
      ]);
      setItems(papers.items);
      setQuestions(bank.items ?? []);
      setSubjects(taxonomy.items.filter(item => item.status === 'active'));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const availableQuestions = useMemo(
    () => questions.filter(question => !subjectId || question.subjectId === subjectId),
    [questions, subjectId],
  );

  // 切换科目时清理上一科目已选题目，避免提交跨科目题目。
  useEffect(() => {
    if (!subjectId || !questionIds.length) return;
    const allowed = new Set(availableQuestions.map(question => question.id));
    const next = questionIds.filter(id => allowed.has(id));
    if (next.length !== questionIds.length) form.setFieldValue('questionIds', next);
  }, [availableQuestions, form, questionIds, subjectId]);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({durationMinutes: 60, questionIds: []});
    setOpen(true);
  };

  const closeCreate = () => {
    if (!loading) {
      setOpen(false);
      form.resetFields();
    }
  };

  const save = async (values: PaperFormValues) => {
    setLoading(true);
    try {
      await createLearningAssessmentPaper({...values, questionIds: values.questionIds ?? []});
      message.success('学习中心试卷已创建为草稿');
      setOpen(false);
      form.resetFields();
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const subjectName = (id: string) => subjects.find(subject => subject.id === id)?.name ?? id;

  return <Space direction="vertical" size={18} style={{display: 'flex'}}>
    <Card title="学习中心单科测试试卷" extra={<Space><Tag color="blue">独立于普通内容试卷</Tag><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建试卷</Button></Space>}>
      {error && <Alert type="error" message={error} showIcon />}
      <Typography.Paragraph type="secondary" style={{margin: 0}}>先创建试卷名称和科目，再从该科目的已发布客观题库中选择题目。保存后为草稿，确认无误后再发布给学习中心用户。</Typography.Paragraph>
    </Card>

    <Card title="已创建的学习中心试卷">
      <Table rowKey="id" dataSource={items} locale={{emptyText: '暂无单科测试试卷'}} columns={[
        {title: '名称', dataIndex: 'title'},
        {title: '科目', dataIndex: 'subjectId', render: (value: string) => subjectName(value)},
        {title: '题数', render: (_: unknown, item: LearningAssessmentPaper) => item.questionIds.length},
        {title: '时长', render: (_: unknown, item: LearningAssessmentPaper) => `${item.durationMinutes} 分钟`},
        {title: '状态', render: (_: unknown, item: LearningAssessmentPaper) => <Tag color={item.status === 'published' ? 'green' : item.status === 'archived' ? 'default' : 'orange'}>{item.status === 'published' ? '已发布' : item.status === 'archived' ? '已归档' : '草稿'}</Tag>},
        {title: '操作', render: (_: unknown, item: LearningAssessmentPaper) => item.status === 'draft' ? <Button type="link" onClick={async () => { try { await publishLearningAssessmentPaper(item.id); message.success('已发布'); await load(); } catch (e) { message.error(e instanceof Error ? e.message : '发布失败'); } }}>发布</Button> : '—'},
      ]} />
    </Card>

    <Drawer title="新建单科测试试卷" open={open} width={620} destroyOnClose onClose={closeCreate} extra={<Button type="primary" loading={loading} onClick={() => form.submit()}>保存草稿</Button>}>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="title" label="试卷名称" rules={[{required: true, min: 2, max: 160, message: '请输入 2 至 160 个字符的试卷名称'}]}>
          <Input placeholder="例如：民法阶段单科测试（一）" maxLength={160} showCount />
        </Form.Item>
        <Form.Item name="subjectId" label="选择科目" rules={[{required: true, message: '请选择科目'}]}>
          <Select allowClear showSearch optionFilterProp="label" placeholder="请选择试卷所属科目" options={subjects.map(subject => ({value: subject.id, label: subject.name}))} />
        </Form.Item>
        <Form.Item name="durationMinutes" label="考试时长" initialValue={60} rules={[{required: true, message: '请填写考试时长'}]}>
          <InputNumber min={1} max={300} addonAfter="分钟" style={{width: '100%'}} />
        </Form.Item>
        <Form.Item name="questionIds" label={`从题库选择题目${subjectId ? `（${subjectName(subjectId)}）` : ''}`} rules={[{required: true, type: 'array', min: 1, message: '请选择至少一道题目'}]}>
          <Select mode="multiple" showSearch optionFilterProp="label" maxTagCount="responsive" disabled={!subjectId} placeholder={subjectId ? '请选择该科目下已发布的客观题' : '请先选择科目'} options={availableQuestions.map(question => ({value: question.id, label: `${question.stem}（${question.questionType === 'single' ? '单选' : question.questionType === 'multiple' ? '多选' : question.questionType === 'true_false' ? '判断' : '不定项'}）`}))} notFoundContent={subjectId ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该科目暂无已发布题目" /> : undefined} />
        </Form.Item>
        {subjectId && !availableQuestions.length ? <Alert type="warning" showIcon message="该科目暂无已发布客观题，请先在学习中心题库发布题目。" /> : null}
      </Form>
    </Drawer>
  </Space>;
}
