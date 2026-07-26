insert into public.departments (id, code, name, sort_order) values
  ('10000000-0000-4000-8000-000000000001', 'product_operations', '产品与运营', 10),
  ('10000000-0000-4000-8000-000000000002', 'technology', '技术研发', 20),
  ('10000000-0000-4000-8000-000000000003', 'business', '业务团队', 30),
  ('10000000-0000-4000-8000-000000000004', 'other', '其他', 999);

insert into public.positions (id, code, name, sort_order) values
  ('20000000-0000-4000-8000-000000000001', 'product_manager', '产品经理', 10),
  ('20000000-0000-4000-8000-000000000002', 'engineer', '研发工程师', 20),
  ('20000000-0000-4000-8000-000000000003', 'operations', '运营', 30),
  ('20000000-0000-4000-8000-000000000004', 'sales', '销售', 40),
  ('20000000-0000-4000-8000-000000000005', 'other', '其他', 999);

insert into public.ai_tool_options (id, code, name, sort_order) values
  ('30000000-0000-4000-8000-000000000001', 'chatgpt', 'ChatGPT', 10),
  ('30000000-0000-4000-8000-000000000002', 'deepseek', 'DeepSeek', 20),
  ('30000000-0000-4000-8000-000000000003', 'doubao', '豆包', 30),
  ('30000000-0000-4000-8000-000000000004', 'kimi', 'Kimi', 40),
  ('30000000-0000-4000-8000-000000000005', 'other', '其他', 999);

insert into public.survey_versions (id, survey_type, version_key, status, published_at) values
  ('40000000-0000-4000-8000-000000000001', 'employee', 'employee_v1', 'active', now()),
  ('40000000-0000-4000-8000-000000000002', 'position', 'position_v1', 'active', now());

insert into public.survey_batches (
  id,
  name,
  status,
  employee_survey_version_id,
  position_survey_version_id,
  starts_at
) values (
  '50000000-0000-4000-8000-000000000001',
  'M1 开发调研批次',
  'draft',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  null
);
