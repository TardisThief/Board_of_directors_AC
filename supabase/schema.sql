-- Board of Directors — Supabase Schema
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/tdsfmqocpacfcgqfxuqb/sql

-- Conversations: one per agent session or boardroom session
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,        -- 'coo', 'cmo', 'cso', 'cfo', 'cto', or 'boardroom'
  created_at timestamptz default now()
);

-- Messages: individual turns within a conversation
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  agent_id text,                 -- which agent spoke (useful in boardroom mode)
  created_at timestamptz default now()
);

-- CEO Brief: single shared context document injected into every agent session
create table if not exists ceo_brief (
  id int primary key default 1,
  content text not null default '',
  updated_at timestamptz default now()
);

-- Seed the CEO Brief row so GET always returns something
insert into ceo_brief (id, content) values (1, '')
  on conflict (id) do nothing;

-- Indexes for common query patterns
create index if not exists messages_conversation_id_idx on messages(conversation_id);
create index if not exists messages_created_at_idx on messages(created_at);
create index if not exists conversations_agent_id_idx on conversations(agent_id);
