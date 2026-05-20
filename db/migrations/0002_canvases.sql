-- 0002_canvases.sql
-- Introduce multi-canvas support. Each canvas is an era of the shared board.
-- Resetting the canvas means truncating pixels and inserting a new canvases row.
-- drawings.canvas_id links every tool call to the era it was placed in.

create table if not exists canvases (
  id         bigserial primary key,
  created_at timestamptz not null default now()
);

-- Seed the first canvas so existing drawings can be backfilled.
insert into canvases default values;

-- Add canvas_id to drawings with a default of 1 so existing rows are backfilled.
alter table drawings
  add column if not exists canvas_id bigint not null default 1 references canvases(id);

create index if not exists drawings_canvas_idx on drawings (canvas_id);

-- Anon can read canvases (widget needs current canvas id).
alter table canvases enable row level security;

drop policy if exists canvases_anon_select on canvases;
create policy canvases_anon_select on canvases for select to anon using (true);
