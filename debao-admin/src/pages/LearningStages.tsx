import {DeleteOutlined, EditOutlined, PlusOutlined, SettingOutlined} from '@ant-design/icons';
import {Button, Card, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Tag, Typography, message} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {createLearningStage, deleteLearningStage, getLearningClassTypes, getLearningDiagnosticDimensions, getLearningStages, getLearningTeachers, updateLearningStage, type AdminLearningClassType, type AdminLearningDiagnosticDimension, type AdminLearningStage, type AdminLearningStageCondition, type AdminLearningTeacher} from '@/services/api';

type Values = {code?: string; name: string; description?: string; sortOrder: number; teacherIds?: string[]};
type MatchValues = {conditions: Array<{dimension: string; operator: AdminLearningStageCondition['operator']; value: number; upperValue?: number}>};
const operatorOptions = [{value: 'gte', label: '大于等于'}, {value: 'lte', label: '小于等于'}, {value: 'between', label: '介于'}];

export default function LearningStages() {
  const navigate = useNavigate();
  const {classTypeId = ''} = useParams<{classTypeId: string}>();
  const [classType, setClassType] = useState<AdminLearningClassType>();
  const [items, setItems] = useState<AdminLearningStage[]>([]);
  const [dimensions, setDimensions] = useState<AdminLearningDiagnosticDimension[]>([]);
  const [teachers, setTeachers] = useState<AdminLearningTeacher[]>([]);
  const [editing, setEditing] = useState<AdminLearningStage | null>(null);
  const [matchingStage, setMatchingStage] = useState<AdminLearningStage | null>(null);
  const [open, setOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [form] = Form.useForm<Values>();
  const [matchForm] = Form.useForm<MatchValues>();

  const load = useCallback(async () => {
    try {
      const [classResult, stageResult, dimensionResult, teacherResult] = await Promise.all([getLearningClassTypes(), getLearningStages(classTypeId), getLearningDiagnosticDimensions(), getLearningTeachers({status: 'active'})]);
      setClassType(classResult.items.find(item => item.id === classTypeId));
      setItems(stageResult.items);
      setDimensions(dimensionResult.items);
      setTeachers(teacherResult.items);
    } catch (error) { message.error(error instanceof Error ? error.message : '阶段加载失败'); }
  }, [classTypeId]);
  useEffect(() => { void load(); }, [load]);

  const save = async (values: Values) => {
    try {
      if (editing) await updateLearningStage(editing.id, values);
      else await createLearningStage({...values, classTypeId, code: values.code ?? '', conditions: []});
      message.success(editing ? '阶段已更新' : '阶段已创建'); setOpen(false); setEditing(null); form.resetFields(); await load();
    } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); }
  };
  const remove = async (item: AdminLearningStage) => {
    try { await deleteLearningStage(item.id); message.success('阶段已删除'); await load(); }
    catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); }
  };
  const openMatcher = (item: AdminLearningStage) => {
    setMatchingStage(item);
    matchForm.setFieldsValue({conditions: item.conditions.map(condition => ({...condition}))});
    setMatchOpen(true);
  };
  const saveMatcher = async (values: MatchValues) => {
    if (!matchingStage) return;
    try {
      const conditions = (values.conditions ?? []).filter(condition => condition.dimension && condition.operator).map(condition => ({dimension: condition.dimension, operator: condition.operator, value: Number(condition.value ?? 0), ...(condition.operator === 'between' ? {upperValue: Number(condition.upperValue ?? condition.value ?? 0)} : {})}));
      await updateLearningStage(matchingStage.id, {conditions});
      message.success(conditions.length ? '画像匹配规则已保存' : '已清空画像匹配规则，该阶段暂不自动匹配');
      setMatchOpen(false); setMatchingStage(null); matchForm.resetFields(); await load();
    } catch (error) { message.error(error instanceof Error ? error.message : '画像匹配规则保存失败'); }
  };
  const teachersBySubject = teachers.reduce<Record<string, AdminLearningTeacher[]>>((groups, teacher) => { (groups[teacher.subject] ??= []).push(teacher); return groups; }, {});

  return <Space direction="vertical" size={20} style={{display: 'flex'}}>
    <div><Typography.Title level={3} style={{margin: 0}}>{classType?.name ?? '班型'} · 编辑阶段</Typography.Title><Typography.Text type="secondary">只管理当前班型的阶段。学习内容、师资和画像匹配规则分别配置。</Typography.Text></div>
    <Card title="阶段列表" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => {setEditing(null); form.resetFields(); form.setFieldsValue({sortOrder: (items.length + 1) * 10}); setOpen(true);}}>新建阶段</Button>}>
      <Table rowKey="id" pagination={false} dataSource={items} columns={[
        {title: '阶段名称', render: (_: unknown, item: AdminLearningStage) => <Space direction="vertical" size={0}><Typography.Text strong>{item.name}</Typography.Text><Typography.Text type="secondary">{item.code}</Typography.Text></Space>},
        {title: '阶段说明', dataIndex: 'description', render: (value?: string) => value ?? '-'},
        {title: '画像匹配', render: (_: unknown, item: AdminLearningStage) => item.conditions.length ? <Tag color="green">{item.conditions.length} 条规则</Tag> : <Tag color="orange">未配置</Tag>},
        {title: '师资数', dataIndex: 'teacherCount'},
        {title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'active' ? 'success' : 'default'}>{value === 'active' ? '启用' : '停用'}</Tag>},
        {title: '操作', render: (_: unknown, item: AdminLearningStage) => <Space wrap><Button type="link" icon={<SettingOutlined />} onClick={() => openMatcher(item)}>画像匹配</Button><Button type="link" onClick={() => navigate(`/learning-admin/stages/${item.id}/teachers`)}>编辑师资</Button><Button type="link" onClick={() => navigate(`/learning-admin/classes/${classTypeId}/stages/${item.id}/plan`)}>学习计划</Button><Button type="link" icon={<EditOutlined />} onClick={() => {setEditing(item); form.setFieldsValue(item); setOpen(true);}}>编辑阶段</Button><Popconfirm title="删除这个阶段？" onConfirm={() => void remove(item)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space>},
      ]} />
    </Card>
    <Drawer title={editing ? '编辑阶段' : '新建阶段'} open={open} width={520} onClose={() => setOpen(false)} destroyOnClose><Form form={form} layout="vertical" onFinish={save}><Form.Item name="code" label="阶段编码" rules={[{required: !editing, pattern: /^[a-z][a-z0-9_-]{1,79}$/, message: '请输入小写编码'}]}><Input disabled={Boolean(editing)} placeholder="例如：foundation" /></Form.Item><Form.Item name="name" label="阶段名称" rules={[{required: true, min: 2, max: 80}]}><Input placeholder="例如：入门期" /></Form.Item><Form.Item name="description" label="阶段说明"><Input.TextArea rows={3} maxLength={240} showCount /></Form.Item><Form.Item name="teacherIds" label="阶段老师"><Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="按科目选择老师">{Object.entries(teachersBySubject).map(([subject, subjectTeachers]) => <Select.OptGroup key={subject} label={subject}>{subjectTeachers.map(teacher => <Select.Option key={teacher.id} value={teacher.id} label={`${teacher.name} · ${teacher.subject}`}>{teacher.name} · {teacher.specialty}</Select.Option>)}</Select.OptGroup>)}</Select></Form.Item><Form.Item name="sortOrder" label="排序" rules={[{required: true}]}><InputNumber min={0} max={9999} precision={0} style={{width: '100%'}} /></Form.Item><Button type="primary" htmlType="submit" block>保存阶段</Button></Form></Drawer>
    <Drawer title={`${matchingStage?.name ?? '阶段'} · 画像匹配规则`} open={matchOpen} width={700} onClose={() => {setMatchOpen(false); setMatchingStage(null);}} extra={<Button type="primary" onClick={() => matchForm.submit()}>保存规则</Button>}><Typography.Paragraph type="secondary">诊断提交后，系统会把用户画像分数与这里的规则匹配，命中后进入当前阶段并从当前阶段师资中自动分配老师。多个条件同时满足才算命中。</Typography.Paragraph><Form form={matchForm} layout="vertical" onFinish={saveMatcher}><Form.List name="conditions">{(fields, {add, remove}) => <Space direction="vertical" style={{display: 'flex'}}>{fields.map(({key, name, ...restField}) => <Space key={key} align="start" style={{display: 'flex'}}><Form.Item {...restField} name={[name, 'dimension']} label="画像维度" rules={[{required: true, message: '请选择维度'}]}><Select style={{width: 170}} options={dimensions.map(item => ({value: item.code, label: item.label}))} /></Form.Item><Form.Item {...restField} name={[name, 'operator']} label="条件" rules={[{required: true}]}><Select style={{width: 120}} options={operatorOptions} /></Form.Item><Form.Item {...restField} name={[name, 'value']} label="分数" rules={[{required: true}]}><InputNumber min={0} max={100} style={{width: 90}} /></Form.Item><Form.Item {...restField} name={[name, 'upperValue']} label="上限（介于）"><InputNumber min={0} max={100} style={{width: 90}} /></Form.Item><Button danger type="link" onClick={() => remove(name)}>删除</Button></Space>)}<Button type="dashed" onClick={() => add({operator: 'gte', value: 60})} block>+ 添加匹配条件</Button></Space>}</Form.List></Form></Drawer>
  </Space>;
}
