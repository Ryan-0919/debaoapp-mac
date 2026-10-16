-- Global teacher directory. Existing stage-bound teachers remain valid for
-- historical assignments; stage_id is nullable for teachers managed here.
alter table learning_teachers alter column stage_id drop not null;

alter table learning_stages
  add column if not exists teacher_ids jsonb not null default '[]'::jsonb;

create index if not exists learning_teachers_subject_idx
  on learning_teachers (subject, status, sort_order, created_at);

-- Backfill the new stage selection from the legacy stage relationship.
update learning_stages s
set teacher_ids = coalesce((
  select jsonb_agg(t.id order by t.sort_order, t.id)
  from learning_teachers t
  where t.stage_id = s.id and t.status = 'active'
), '[]'::jsonb)
where s.teacher_ids = '[]'::jsonb;
