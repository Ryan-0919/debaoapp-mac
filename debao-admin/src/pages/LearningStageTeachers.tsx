import {DeleteOutlined, EditOutlined, PlusOutlined} from '@ant-design/icons';
import {Button, Card, Drawer, Form, Input, InputNumber, Popconfirm, Space, Table, Tag, Typography, message} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {useParams} from 'react-router-dom';
import {createLearningStageTeacher, deleteLearningTeacher, getLearningStageTeachers, updateLearningTeacher, type AdminLearningStage, type AdminLearningTeacher} from '@/services/api';

type Values = Pick<AdminLearningTeacher, 'name' | 'subject' | 'specialty' | 'sortOrder'>;

export default function LearningStageTeachers() {
  const {stageId = ''} = useParams();
  const [stage, setStage] = useState<AdminLearningStage | null>(null);
  const [items, setItems] = useState<AdminLearningTeacher[]>([]);
  const [editing, setEditing] = useState<AdminLearningTeacher | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<Values>();
  const load = useCallback(async () => { try { const result = await getLearningStageTeachers(stageId); setStage(result.stage); setItems(result.items); } catch (error) { message.error(error instanceof Error ? error.message : '师资加载失败'); } }, [stageId]);
  useEffect(() => { void load(); }, [load]);
  const save = async (values: Values) => { try { if (editing) await updateLearningTeacher(editing.id, values); else await createLearningStageTeacher(stageId, values); message.success(editing ? '师资已更新' : '师资已创建'); setOpen(false); setEditing(null); form.resetFields(); await load(); } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); } };
  const remove = async (teacher: AdminLearningTeacher) => { try { await deleteLearningTeacher(teacher.id); message.success('师资已删除'); await load(); } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); } };
  return <Space direction="vertical" size={20} style={{display: 'flex'}}>
    <div><Typography.Title level={3} style={{margin: 0}}>{stage?.name ?? '阶段'} · 师资</Typography.Title><Typography.Paragraph type="secondary" style={{margin: '6px 0 0'}}>这里只维护当前阶段的老师，不会混入其他阶段的师资。</Typography.Paragraph></div>
    <Card title={`${stage?.name ?? '当前阶段'}师资表`} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => {setEditing(null); form.resetFields(); form.setFieldsValue({sortOrder: (items.length + 1) * 10}); setOpen(true);}}>新建师资</Button>}>
      <Table rowKey="id" pagination={false} dataSource={items} columns={[{title: '姓名', dataIndex: 'name', render: (value: string) => <Typography.Text strong>{value}</Typography.Text>}, {title: '科目', dataIndex: 'subject'}, {title: '擅长简介', dataIndex: 'specialty'}, {title: '排序', dataIndex: 'sortOrder'}, {title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'active' ? 'success' : 'default'}>{value === 'active' ? '启用' : '停用'}</Tag>}, {title: '操作', render: (_: unknown, item: AdminLearningTeacher) => <Space><Button type="link" icon={<EditOutlined />} onClick={() => {setEditing(item); form.setFieldsValue(item); setOpen(true);}}>编辑</Button><Popconfirm title="删除这位老师？" description="删除后只影响后续新用户分配，历史诊断结果不提供分配记录。" onConfirm={() => void remove(item)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space>}]} />
    </Card>
    <Drawer title={editing ? '编辑师资' : '新建师资'} open={open} width={520} onClose={() => setOpen(false)} extra={<Button type="primary" onClick={() => form.submit()}>保存</Button>}>
      <Form form={form} layout="vertical" onFinish={save} requiredMark="optional">
        <Form.Item name="name" label="姓名" rules={[{required: true, min: 2, max: 80}]}><Input placeholder="例如：张老师" /></Form.Item>
        <Form.Item name="subject" label="科目" rules={[{required: true, max: 120}]}><Input placeholder="例如：民法、刑法、综合" /></Form.Item>
        <Form.Item name="specialty" label="擅长简介" rules={[{required: true, min: 2, max: 500}]}><Input.TextArea rows={5} maxLength={500} showCount placeholder="例如：擅长基础薄弱、零基础学员的体系入门" /></Form.Item>
        <Form.Item name="sortOrder" label="排序" rules={[{required: true}]}><InputNumber min={0} max={9999} precision={0} style={{width: '100%'}} /></Form.Item>
      </Form>
    </Drawer>
  </Space>;
}
