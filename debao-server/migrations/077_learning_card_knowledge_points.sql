alter table learning_cards
  add column if not exists knowledge_point_ids jsonb not null default '[]'::jsonb;

create index if not exists learning_cards_knowledge_point_ids_gin_idx
  on learning_cards using gin (knowledge_point_ids);
