-- Server-side chat history: one thread per conversation, per user and project.
-- Kept 90 days after the last message (purged by the daily cron); the user can delete one chat or all chats any time.
-- Reads and writes go through the user's own session, so RLS owner policies are the access control.
-- Rows are never logged or sent anywhere except back to their owner.

create table if not exists public.chat_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  title      text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.chat_threads(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (char_length(content) <= 8000),
  tools_used jsonb not null default '[]',
  looked_at  jsonb not null default '[]',
  created_at timestamptz default now()
);

create index if not exists chat_threads_user_project_updated_idx on public.chat_threads (user_id, project_id, updated_at desc);
create index if not exists chat_messages_thread_created_idx on public.chat_messages (thread_id, created_at);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

create policy chat_threads_select_own on public.chat_threads for select using (user_id = (select auth.uid()));
create policy chat_threads_insert_own on public.chat_threads for insert with check (user_id = (select auth.uid()));
create policy chat_threads_update_own on public.chat_threads for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy chat_threads_delete_own on public.chat_threads for delete using (user_id = (select auth.uid()));

create policy chat_messages_select_own on public.chat_messages for select using (user_id = (select auth.uid()));
create policy chat_messages_insert_own on public.chat_messages for insert with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.chat_threads t where t.id = thread_id and t.user_id = (select auth.uid()))
);
create policy chat_messages_update_own on public.chat_messages for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy chat_messages_delete_own on public.chat_messages for delete using (user_id = (select auth.uid()));

revoke all on public.chat_threads from anon;
revoke all on public.chat_messages from anon;
