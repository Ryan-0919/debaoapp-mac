import {DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, RocketOutlined} from '@ant-design/icons';
import {Alert, Button, Card, Checkbox, Drawer, Form, Input, InputNumber, List, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useParams} from 'react-router-dom';
import {createLearningStagePlanItem, deleteLearningStagePlanItem, getLearningCards, getLearningQuestionTaxonomy, getLearningStagePlan, previewLearningStagePlanWeek, publishLearningStagePlan, updateLearningStagePlan, updateLearningStagePlanItem, type AdminLearningCard, type AdminLearningPlanContentType, type AdminLearningStagePlanConfig, type AdminLearningStagePlanItem, type AdminLearningStageWeeklyPreview, type AdminLearningTaxonomyNode} from '@/services/api';

type ItemValues = Pick<AdminLearningStagePlanItem, 'contentType' | 'contentId' | 'knowledgePointIds' | 'title' | 'description' | 'weekDay' | 'questionCount' | 'sortOrder' | 'required'>;
const contentLabels: Record<AdminLearningPlanContentType, string> = {course: '站外课程（回来打卡）', question: '客观题训练', subjective: '主观题训练', assessment: '单科测试（科目结束后）', card: '学习卡片', task: '其他学习任务'};
const contentHints: Record<AdminLearningPlanContentType, string> = {
  course: '站外课程不上传视频，也不关联站内课程；用户按文案完成外部课程后回到 App 打卡。',
  card: '可指定已发布卡片，也可留空按前面听课考点自动调用已绑定卡片；完成课程打卡后解锁。',
  question: '选择题库中的题目或题组，并关联前面听课覆盖的考点；留空时只从这些考点按用户画像自动抽题。',
  subjective: '填写已发布主观题题库题目 ID，并关联前面听课覆盖的考点。',
  assessment: '老师先在试卷管理中创建并发布该科目试卷，再把试卷 ID 放在这里。系统会在该科目之前的学习内容全部完成后，自动把限时单科测试提供给用户。',
  task: '用于记录其他需要用户完成的学习事项。',
};

export default function LearningStagePlan() {
  const {stageId = ''} = useParams();
  const [items, setItems] = useState<AdminLearningStagePlanItem[]>([]);
  const [stageName, setStageName] = useState('阶段');
  const [config, setConfig] = useState<AdminLearningStagePlanConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminLearningStagePlanItem | null>(null);
  const [preview, setPreview] = useState<AdminLearningStageWeeklyPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [taxonomyNodes, setTaxonomyNodes] = useState<AdminLearningTaxonomyNode[]>([]);
  const [cards, setCards] = useState<AdminLearningCard[]>([]);
  const [publishLoading, setPublishLoading] = useState(false);
  const [itemForm] = Form.useForm<ItemValues>();
  const [rulesForm] = Form.useForm<Partial<AdminLearningStagePlanConfig>>();
  const watchedContentType = Form.useWatch('contentType', itemForm) ?? 'task';

  const load = useCallback(async () => {
    try {
      const result = await getLearningStagePlan(stageId);
      const [taxonomy, cardResult] = await Promise.all([getLearningQuestionTaxonomy({category: 'objective'}), getLearningCards({status: 'published'})]);
      setItems(result.items); setStageName(result.stage.name); setConfig(result.config); setTaxonomyNodes(taxonomy.items); setCards(cardResult.items); rulesForm.setFieldsValue(result.config);
    } catch (error) { message.error(error instanceof Error ? error.message : '阶段学习内容加载失败'); }
  }, [stageId, rulesForm]);
  useEffect(() => { void load(); }, [load]);

  const saveItem = async (values: ItemValues) => {
    try {
      const input = {...values, contentId: values.contentType === 'course' ? undefined : values.contentId, questionCount: values.contentType === 'question' ? values.questionCount : undefined};
      if (editing) await updateLearningStagePlanItem(stageId, editing.id, input); else await createLearningStagePlanItem(stageId, input);
      message.success(editing ? '阶段学习内容已更新' : '阶段学习内容已添加'); setOpen(false); setEditing(null); itemForm.resetFields(); await load();
    } catch (error) { message.error(error instanceof Error ? error.message : '阶段学习内容保存失败'); }
  };
  const remove = async (item: AdminLearningStagePlanItem) => { try { await deleteLearningStagePlanItem(stageId, item.id); message.success('阶段学习内容已删除'); await load(); } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); } };
  const openCreate = () => { setEditing(null); itemForm.resetFields(); itemForm.setFieldsValue({contentType: 'course', sortOrder: (items.length + 1) * 10, required: true}); setOpen(true); };
  const openEdit = (item: AdminLearningStagePlanItem) => { setEditing(item); itemForm.setFieldsValue(item); setOpen(true); };
  const saveRules = async (values: Partial<AdminLearningStagePlanConfig>) => { if (!config) return; try { const updated = await updateLearningStagePlan(stageId, {...config, ...values}); setConfig(updated); message.success('规则已保存，发布后对新生成的一周任务生效'); } catch (error) { message.error(error instanceof Error ? error.message : '规则保存失败'); } };
  const openWeeklyPreview = async () => { setPreviewLoading(true); try { setPreview(await previewLearningStagePlanWeek(stageId)); } catch (error) { message.error(error instanceof Error ? error.message : '本周任务预览失败'); } finally { setPreviewLoading(false); } };
  const publish = async () => { setPublishLoading(true); try { const updated = await publishLearningStagePlan(stageId); setConfig(updated); message.success('一周任务模板已发布'); } catch (error) { message.error(error instanceof Error ? error.message : '发布失败'); } finally { setPublishLoading(false); } };

  return <Space direction="vertical" size={20} style={{display: 'flex'}}>
    <div><Space align="center"><Typography.Title level={3} style={{margin: 0}}>{stageName} · 阶段学习内容</Typography.Title>{config ? <Tag color={config.status === 'published' ? 'green' : 'orange'}>{config.status === 'published' ? '已发布' : '草稿'}</Tag> : null}</Space><Typography.Paragraph type="secondary" style={{margin: '6px 0 0'}}>这里维护团队给用户安排的“一周模板”。单科测试放在该科目最后一项内容之后，用户完成前置内容后系统会自动生成并展示试卷。</Typography.Paragraph></div>
    <Card title="解锁与抽题规则" extra={<Space><Button icon={<EyeOutlined />} loading={previewLoading} onClick={() => void openWeeklyPreview()}>预览本周任务</Button><Button type="primary" icon={<RocketOutlined />} loading={publishLoading} disabled={!items.length} onClick={() => void publish()}>发布模板</Button></Space>}>
      {config ? <Form form={rulesForm} layout="inline" onFinish={saveRules}><Form.Item label="卡片出现规则" name="cardUnlockRule"><Select style={{width: 190}} options={[{value: 'after_course_checkin', label: '站外课程打卡后'}, {value: 'after_previous_content', label: '上一项内容完成后'}, {value: 'immediate', label: '立即出现'}]} /></Form.Item><Form.Item label="全局题目数量" name="questionPushCount" rules={[{required: true, min: 1, max: 50}]}><InputNumber min={1} max={50} precision={0} /></Form.Item><Button type="primary" htmlType="submit">保存规则</Button></Form> : null}
      <Alert showIcon type="info" style={{marginTop: 12}} message="题目会根据首次诊断画像自动选择难度；每个题目任务可在编辑时单独覆盖题目数量。" />
    </Card>
    <Card title="一周任务模板" extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加内容</Button>}>
      <Table rowKey="id" pagination={false} dataSource={items} locale={{emptyText: '还没有配置阶段内容'}} columns={[
        {title: '顺序', dataIndex: 'sortOrder', width: 80},
        {title: '类型', dataIndex: 'contentType', width: 170, render: (value: AdminLearningPlanContentType) => <Tag color={value === 'course' ? 'blue' : value === 'card' ? 'purple' : value === 'question' ? 'gold' : 'default'}>{contentLabels[value]}</Tag>},
        {title: '内容', dataIndex: 'title', render: (value: string, item: AdminLearningStagePlanItem) => <Space direction="vertical" size={0}><Typography.Text strong>{value}</Typography.Text>{item.description ? <Typography.Text type="secondary" ellipsis={{tooltip: item.description}}>{item.description}</Typography.Text> : null}{item.contentType !== 'course' && item.contentId ? <Typography.Text type="secondary">关联内容：{item.contentId}</Typography.Text> : null}{item.knowledgePointIds?.length ? <Typography.Text type="secondary">关联听课考点：{item.knowledgePointIds.map(id => taxonomyNodes.find(node => node.id === id)?.name ?? id).join('、')}</Typography.Text> : ['course', 'card', 'question', 'subjective'].includes(item.contentType) ? <Typography.Text type="warning">未关联听课考点</Typography.Text> : null}</Space>},
        {title: '安排日', dataIndex: 'weekDay', width: 100, render: (value?: number) => value ? `第 ${value} 天` : '顺序安排'},
        {title: '题数', dataIndex: 'questionCount', width: 80, render: (value: number | undefined, item: AdminLearningStagePlanItem) => item.contentType === 'question' ? (value ?? config?.questionPushCount ?? '-') : item.contentType === 'assessment' ? '限时' : '-'},
        {title: '要求', dataIndex: 'required', width: 80, render: (value: boolean) => value ? '必修' : '选修'},
        {title: '操作', width: 130, render: (_: unknown, item: AdminLearningStagePlanItem) => <Space><Button type="link" icon={<EditOutlined />} onClick={() => openEdit(item)}>编辑</Button><Popconfirm title="删除这项学习内容？" onConfirm={() => void remove(item)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space>},
      ]} />
    </Card>
    <Drawer title={editing ? '编辑阶段学习内容' : '添加阶段学习内容'} open={open} width={520} onClose={() => setOpen(false)} extra={<Button type="primary" onClick={() => itemForm.submit()}>保存</Button>}>
      <Form form={itemForm} layout="vertical" onFinish={saveItem}><Form.Item name="contentType" label="内容类型" rules={[{required: true}]}><Select options={Object.entries(contentLabels).map(([value, label]) => ({value, label}))} /></Form.Item><Typography.Paragraph type="secondary" style={{marginTop: -8}}>{contentHints[watchedContentType]}</Typography.Paragraph>{['course', 'card', 'question', 'subjective'].includes(watchedContentType) ? <Form.Item name="knowledgePointIds" label={watchedContentType === 'course' ? '本课覆盖考点' : '关联听课考点（可选）'} rules={watchedContentType === 'card' ? [{validator: (_, value) => (value?.length || itemForm.getFieldValue('contentId')) ? Promise.resolve() : Promise.reject(new Error('请选择考点，或指定一张已绑定考点的卡片'))}] : [{required: true, type: 'array', min: 1, message: watchedContentType === 'course' ? '请选择本课覆盖的客观题考点' : '请选择前面听课覆盖的考点'}]} tooltip={watchedContentType === 'course' ? '课程覆盖的考点会用于后续自动调用卡片和题目' : watchedContentType === 'card' ? '留空时使用指定卡片自身的考点；未指定卡片时按这里的考点自动调用' : '题目必须关联前面听课覆盖的考点'}><Select mode="multiple" allowClear showSearch optionFilterProp="label" options={taxonomyNodes.filter(node => node.type === 'point' || node.type === 'subpoint').map(node => ({value: node.id, label: node.name}))} placeholder={watchedContentType === 'course' ? '选择本课讲到的考点或子考点' : '选择前面听课覆盖的考点或子考点'} /></Form.Item> : null}{watchedContentType !== 'course' ? <Form.Item name="contentId" label={watchedContentType === 'card' ? '指定学习卡片（可选）' : '关联内容 ID'} tooltip={watchedContentType === 'card' ? '不指定时，系统会按关联考点自动选择已发布卡片' : '主观题需要关联已发布题目；客观题可留空按用户画像自动抽题'}>{watchedContentType === 'card' ? <Select allowClear showSearch optionFilterProp="label" options={cards.map(card => ({value: card.id, label: `${card.title} · ${card.knowledgePointIds?.length ?? 0} 个考点`}))} placeholder="不指定，按考点自动调用卡片" /> : <Input placeholder={watchedContentType === 'task' ? '其他学习任务无需填写' : watchedContentType === 'question' ? '可留空：按课程考点自动抽题' : watchedContentType === 'subjective' ? '填写已发布的主观题题目 ID' : watchedContentType === 'assessment' ? '填写已发布的客观题试卷 ID' : '填写关联内容 ID'} />}</Form.Item> : null}{watchedContentType === 'question' ? <Form.Item name="questionCount" label="本项题目数量（可选）" tooltip="不填写时使用上方的全局题目数量"><InputNumber min={1} max={50} precision={0} style={{width: '100%'}} placeholder="沿用全局设置" /></Form.Item> : null}<Form.Item name="title" label={watchedContentType === 'course' ? '课程名称' : '学习内容名称'} rules={[{required: true, min: 2, max: 160}]}><Input placeholder={watchedContentType === 'course' ? '例如：民法第 1 讲' : undefined} /></Form.Item><Form.Item name="description" label={watchedContentType === 'course' ? '站外课程文案' : '内容说明'} rules={watchedContentType === 'course' ? [{required: true, min: 2, max: 5000, message: '请填写用户完成站外课程的说明'}] : [{max: 5000}]}><Input.TextArea rows={5} showCount maxLength={5000} placeholder={watchedContentType === 'course' ? '例如：请在外部平台完成第 1 讲，听完后回到 App 点击打卡。' : '补充这项学习内容的完成说明'} /></Form.Item><Form.Item name="weekDay" label="本周第几天（可选）" tooltip="不填写时按列表顺序从本周第 1 天开始安排"><InputNumber min={1} max={7} precision={0} style={{width: '100%'}} /></Form.Item><Form.Item name="sortOrder" label="顺序" rules={[{required: true}]}><InputNumber min={0} max={9999} precision={0} style={{width: '100%'}} /></Form.Item><Form.Item name="required" valuePropName="checked"><Checkbox>必修内容</Checkbox></Form.Item></Form>
    </Drawer>
    <Modal title="本周任务预览" open={Boolean(preview)} width={760} footer={null} onCancel={() => setPreview(null)}>{preview ? <Space direction="vertical" size={16} style={{display: 'flex'}}><Alert type="info" showIcon message={`预览周期：${preview.startDate} 至 ${preview.generatedThrough}`} description={preview.incomplete ? '模板内容超出当前 7 天窗口，后续内容将在下一周继续生成。' : '当前模板可以在 7 天内完整生成。'} /><List bordered dataSource={preview.days} renderItem={day => <List.Item><Space direction="vertical" style={{width: '100%'}}><Typography.Text strong>{day.date} · {day.items.length} 项</Typography.Text>{day.items.length ? day.items.map(item => <Space key={item.id} size={8}><Tag color={item.contentType === 'question' ? 'gold' : 'blue'}>{contentLabels[item.contentType]}</Tag><span>{item.title}</span>{item.contentType === 'question' ? <Typography.Text type="secondary">{item.questionCount ?? preview.config.questionPushCount} 题</Typography.Text> : item.contentType === 'assessment' ? <Typography.Text type="secondary">限时测验</Typography.Text> : null}</Space>) : <Typography.Text type="secondary">当天未安排模板内容</Typography.Text>}</Space></List.Item>} /></Space> : null}</Modal>
  </Space>;
}

