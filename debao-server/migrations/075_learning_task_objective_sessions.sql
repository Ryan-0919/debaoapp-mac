-- Associate objective sessions with the private-coach task that opened them.
-- This keeps private-coach statistics separate from ordinary question-bank work.
alter table objective_sessions
  add column if not exists learning_task_id text references learning_tasks(id) on delete set null;

create index if not exists objective_sessions_learning_task_idx
  on objective_sessions(user_id, learning_task_id, submitted_at desc);
