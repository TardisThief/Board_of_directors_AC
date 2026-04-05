-- AC Styling Command Center — Schema v2
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/tdsfmqocpacfcgqfxuqb/sql
-- Safe to run on existing DB — uses IF NOT EXISTS throughout

-- ─── Financial Management ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.financial_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL CHECK (type IN ('income', 'expense')),
  amount        numeric(10,2) NOT NULL,
  currency      text NOT NULL DEFAULT 'USD',
  category      text NOT NULL,
  description   text,
  date          date NOT NULL DEFAULT CURRENT_DATE,
  vendor        text,
  client        text,
  notes         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Predefined categories (enforced in app, not DB — keeps flexibility)
-- Income: Services, Products, Referral, Other Income
-- Expense: Marketing, Meals, Clothes, Equipment, Software, Travel, Samples, Tax, Other

CREATE TABLE IF NOT EXISTS public.financial_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id      uuid REFERENCES public.financial_entries(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  storage_path  text NOT NULL,
  public_url    text,
  file_type     text,
  ai_summary    text,   -- Claude extraction of amounts/vendors from receipts
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_entries_date_idx ON public.financial_entries(date);
CREATE INDEX IF NOT EXISTS financial_entries_type_idx ON public.financial_entries(type);
CREATE INDEX IF NOT EXISTS financial_entries_category_idx ON public.financial_entries(category);
CREATE INDEX IF NOT EXISTS financial_attachments_entry_idx ON public.financial_attachments(entry_id);

-- ─── Content Schedule ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.content_schedule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id   uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  title         text NOT NULL,
  caption       text,
  platforms     text[] DEFAULT '{}'::text[],   -- ['instagram', 'tiktok']
  scheduled_at  timestamptz,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'scheduled', 'published', 'failed')),
  published_at  timestamptz,
  asset_urls    text[] DEFAULT '{}'::text[],
  thumbnail_url text,
  notes         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_schedule_status_idx ON public.content_schedule(status);
CREATE INDEX IF NOT EXISTS content_schedule_scheduled_at_idx ON public.content_schedule(scheduled_at);

-- ─── Supabase Storage buckets (run separately if needed) ──────────────────
-- INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false) ON CONFLICT DO NOTHING;
-- INSERT INTO storage.buckets (id, name, public) VALUES ('assets', 'assets', true) ON CONFLICT DO NOTHING;

-- ─── Leads: add missing columns if not present ────────────────────────────
-- The leads table already exists from Lead Gen. These are safe additions.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'prospect';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS deal_value numeric(10,2);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_followup_at timestamptz;

-- ─── Conversations: module context ────────────────────────────────────────
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS module text DEFAULT 'command';
