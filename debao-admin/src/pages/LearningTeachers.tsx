import {DeleteOutlined, EditOutlined, PlusOutlined} from '@ant-design/icons';
import {Button, Card, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Tag, Typography, message} from 'antd';
import {useCallback, useEffect, useState} from 'react';
import {createLearningTeacher, deleteLearningTeacher, getLearningTeachers, updateLearningTeacher, type AdminLearningTeacher} from '@/services/api';

type Values = Pick<AdminLearningTeacher, 'name' | 'subject' | 'specialty' | 'sortOrder'>;

export default function LearningTeachers() {
  const [items, setItems] = useState<AdminLearningTeacher[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subject, setSubject] = useState<string>();
  const [editing, setEditing] = useState<AdminLearningTeacher | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<Values>();
  const load = useCallback(async () => { try { const result = await getLearningTeachers({subject, status: 'active'}); setItems(result.items); setSubjects(result.subjects); } catch (error) { message.error(error instanceof Error ? error.message : '师资加载失败'); } }, [subject]);
  useEffect(() => { void load(); }, [load]);
  const save = async (values: Values) => { try { if (editing) await updateLearningTeacher(editing.id, values); else await createLearningTeacher(values); message.success(editing ? '老师已更新' : '老师已创建'); setOpen(false); setEditing(null); form.resetFields(); await load(); } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); } };
  const remove = async (teacher: AdminLearningTeacher) => { try { await deleteLearningTeacher(teacher.id); message.success('老师已删除'); await load(); } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); } };
  return <Space direction="vertical" size={20} style={{display: 'flex'}}>
    <div><Typography.Title level={3} style={{margin: 0}}>师资表</Typography.Title><Typography.Paragraph type="secondary" style={{margin: '6px 0 0'}}>按科目维护全局老师目录，编辑阶段时可直接多选绑定。</Typography.Paragraph></div>
    <Card title="全局师资目录" extra={<Space><Select allowClear placeholder="全部科目" value={subject} onChange={setSubject} style={{width: 160}} options={subjects.map(item => ({value: item, label: item}))} /><Button type="primary" icon={<PlusOutlined />} onClick={() => {setEditing(null); form.resetFields(); form.setFieldsValue({sortOrder: (items.length + 1) * 10}); setOpen(true);}}>新增老师</Button></Space>}>
      <Table rowKey="id" pagination={false} dataSource={items} columns={[{title: '姓名', dataIndex: 'name', render: (value: string) => <Typography.Text strong>{value}</Typography.Text>}, {title: '科目', dataIndex: 'subject', render: (value: string) => <Tag color="blue">{value}</Tag>}, {title: '擅长简介', dataIndex: 'specialty'}, {title: '排序', dataIndex: 'sortOrder'}, {title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'active' ? 'success' : 'default'}>{value === 'active' ? '启用' : '停用'}</Tag>}, {title: '操作', render: (_: unknown, item: AdminLearningTeacher) => <Space><Button type="link" icon={<EditOutlined />} onClick={() => {setEditing(item); form.setFieldsValue(item); setOpen(true);}}>编辑</Button><Popconfirm title="删除这位老师？" onConfirm={() => void remove(item)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space>}]} />
    </Card>
    <Drawer title={editing ? '编辑老师' : '新增老师'} open={open} width={520} onClose={() => setOpen(false)} extra={<Button type="primary" onClick={() => form.submit()}>保存</Button>}>
      <Form form={form} layout="vertical" onFinish={save} requiredMark="optional"><Form.Item name="name" label="姓名" rules={[{required: true, min: 2, max: 80}]}><Input placeholder="例如：张老师" /></Form.Item><Form.Item name="subject" label="科目" rules={[{required: true, max: 120}]}><Input placeholder="例如：民法、刑法、综合" /></Form.Item><Form.Item name="specialty" label="擅长简介" rules={[{required: true, min: 2, max: 500}]}><Input.TextArea rows={5} maxLength={500} showCount /></Form.Item><Form.Item name="sortOrder" label="排序" rules={[{required: true}]}><InputNumber min={0} max={9999} precision={0} style={{width: '100%'}} /></Form.Item></Form>
    </Drawer>
  </Space>;
}
