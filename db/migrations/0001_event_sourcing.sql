-- 0001_event_sourcing.sql
-- Convert the pixel store to an event-sourced model.
-- The existing `pixels` table stays as the current-state projection;
-- two new tables capture the immutable event log:
--   - drawings:   one row per tool call (a logical "drawing")
--   - placements: append-only log of every pixel placed (one row per pixel)
-- Each pixels row points at the drawing currently visible at (x, y) so a
-- click on the canvas can resolve to the metadata of whichever drawing owns
-- that cell right now.

create table if not exists drawings (
  id          bigserial primary key,
  user_name   text,
  model_name  text,
  tool_name   text not null,
  pixel_count integer not null,
  created_at  timestamptz not null default now()
);

create index if not exists drawings_created_at_idx on drawings (created_at desc);

create table if not exists placements (
  id         bigserial primary key,
  drawing_id bigint not null references drawings(id) on delete cascade,
  x          smallint not null,
  y          smallint not null,
  color      smallint not null,
  placed_at  timestamptz not null default now()
);

create index if not exists placements_drawing_idx on placements (drawing_id);
create index if not exists placements_xy_idx      on placements (x, y);

-- Augment the projection. drawing_id points at the most recent drawing whose
-- placement at (x, y) is currently visible.
alter table pixels
  add column if not exists drawing_id bigint references drawings(id) on delete set null;

create index if not exists pixels_drawing_idx on pixels (drawing_id);

-- v1 uses the anon key from both server and widget (per SPEC). Anon needs
-- read access on both new tables (so the widget can fetch metadata on click),
-- and insert access (so the server can append events).
alter table drawings   enable row level security;
alter table placements enable row level security;

drop policy if exists drawings_anon_select   on drawings;
drop policy if exists drawings_anon_insert   on drawings;
drop policy if exists placements_anon_select on placements;
drop policy if exists placements_anon_insert on placements;

create policy drawings_anon_select   on drawings   for select to anon using (true);
create policy drawings_anon_insert   on drawings   for insert to anon with check (true);
create policy placements_anon_select on placements for select to anon using (true);
create policy placements_anon_insert on placements for insert to anon with check (true);
