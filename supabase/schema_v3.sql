-- AC Styling Command Center — Schema v3
-- Full integration of ACS_ContentEngine + ACS_LeadGen schemas
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/tdsfmqocpacfcgqfxuqb/sql
-- Safe to run on existing DB — all operations are idempotent

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: pgvector extension (required for asset embeddings)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Assets table — add missing columns + indexes
-- ─────────────────────────────────────────────────────────────────────────────
-- These columns exist in ContentEngine but may be missing in Board Supabase

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS width         int;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS height        int;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS duration_sec  float;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS tags          jsonb    DEFAULT '[]'::jsonb;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS garments      text[]   DEFAULT '{}';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS transcription text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS embedding     extensions.vector(1024);

-- HNSW index for cosine similarity search (required for match_assets RPC)
CREATE INDEX IF NOT EXISTS idx_assets_embedding
  ON public.assets USING hnsw (embedding extensions.vector_cosine_ops);

-- GIN indexes for array containment queries
CREATE INDEX IF NOT EXISTS idx_assets_vibes
  ON public.assets USING gin (vibes);

CREATE INDEX IF NOT EXISTS idx_assets_garments
  ON public.assets USING gin (garments);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: match_assets RPC function
-- Ranked cosine similarity search with optional vibe filter
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.match_assets(extensions.vector, float, int, text[]);
DROP FUNCTION IF EXISTS public.match_assets(vector, float, int, text[]);
CREATE OR REPLACE FUNCTION public.match_assets(
  query_embedding extensions.vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count     int   DEFAULT 10,
  vibe_filter     text[] DEFAULT '{}'
)
RETURNS TABLE (
  id            uuid,
  filename      text,
  storage_path  text,
  public_url    text,
  type          text,
  ai_description text,
  vibes         text[],
  garments      text[],
  tags          jsonb,
  transcription text,
  similarity    float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    a.id,
    a.filename,
    a.storage_path,
    a.public_url,
    a.type,
    a.ai_description,
    a.vibes,
    a.garments,
    a.tags,
    a.transcription,
    (1 - (a.embedding <=> query_embedding))::float AS similarity
  FROM public.assets a
  WHERE a.embedding IS NOT NULL
    AND (1 - (a.embedding <=> query_embedding)) > match_threshold
    AND (
      array_length(vibe_filter, 1) IS NULL
      OR a.vibes && vibe_filter
    )
  ORDER BY a.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: Proposals table — add missing columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS matched_assets   jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS caption_variants jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS text_overlays    jsonb DEFAULT '[]'::jsonb;

-- Rename trends FK if it was named differently
-- (proposals.trend_id should already reference trends.id)

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: Brand voice table — add learned_style column
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_voice (
  id                uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_description text,
  sample_captions   text[]     DEFAULT '{}',
  learned_style     jsonb,
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE public.brand_voice ADD COLUMN IF NOT EXISTS learned_style jsonb;

-- RLS
ALTER TABLE public.brand_voice ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on brand_voice" ON public.brand_voice;
CREATE POLICY "Allow all on brand_voice" ON public.brand_voice FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: Lead events table (immutable audit log)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  actor       text        NOT NULL,
  event_type  text        NOT NULL DEFAULT 'status_transition',
  from_status text,
  to_status   text,
  reason      text,
  metadata    jsonb
);

CREATE INDEX IF NOT EXISTS lead_events_lead_id_idx ON public.lead_events(lead_id);
CREATE INDEX IF NOT EXISTS lead_events_created_idx ON public.lead_events(created_at DESC);

ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on lead_events" ON public.lead_events;
CREATE POLICY "Allow all on lead_events" ON public.lead_events FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: Agent runs table (observability)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  agent_name      text        NOT NULL,
  lead_id         uuid        REFERENCES public.leads(id) ON DELETE SET NULL,
  run_status      text        NOT NULL DEFAULT 'running',
  input_snapshot  jsonb,
  output_snapshot jsonb,
  reasoning_trace text,
  error_message   text,
  tokens_used     integer,
  tools_called    jsonb,
  duration_ms     integer
);

CREATE INDEX IF NOT EXISTS agent_runs_lead_id_idx ON public.agent_runs(lead_id);
CREATE INDEX IF NOT EXISTS agent_runs_agent_idx   ON public.agent_runs(agent_name);
CREATE INDEX IF NOT EXISTS agent_runs_started_idx ON public.agent_runs(started_at DESC);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on agent_runs" ON public.agent_runs;
CREATE POLICY "Allow all on agent_runs" ON public.agent_runs FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8: Discovery sources table (Scout configuration)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.discovery_sources (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  name        text        NOT NULL,
  source_type text        NOT NULL DEFAULT 'google_news',
  category    text        NOT NULL DEFAULT 'General',
  config      jsonb       NOT NULL DEFAULT '{}',
  is_active   boolean     NOT NULL DEFAULT true,
  last_run_at timestamptz
);

ALTER TABLE public.discovery_sources ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'google_news';
ALTER TABLE public.discovery_sources ADD COLUMN IF NOT EXISTS category    text NOT NULL DEFAULT 'General';
ALTER TABLE public.discovery_sources ADD COLUMN IF NOT EXISTS config      jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.discovery_sources ADD COLUMN IF NOT EXISTS last_run_at timestamptz;

ALTER TABLE public.discovery_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on discovery_sources" ON public.discovery_sources;
CREATE POLICY "Allow all on discovery_sources" ON public.discovery_sources FOR ALL USING (true) WITH CHECK (true);

-- Unique constraint on name so ON CONFLICT (name) works for seed inserts
ALTER TABLE public.discovery_sources ADD CONSTRAINT IF NOT EXISTS discovery_sources_name_unique UNIQUE (name);

-- Seed Miami discovery sources (safe — skip if name already exists)
INSERT INTO public.discovery_sources (name, source_type, category, config) VALUES

('Miami Luxury Listings', 'zillow', 'Real Estate', '{
  "min_price_mention": "$3",
  "search_queries": [
    "new luxury listing \"Miami Beach\" OR \"Coral Gables\" OR \"Coconut Grove\" \"$\" million 2026 agent",
    "\"just listed\" Brickell OR \"Fisher Island\" OR \"Key Biscayne\" million luxury 2026",
    "luxury penthouse listed Miami Sotheby OR Compass OR \"ONE Sotheby\" million 2026"
  ]
}'),

('LinkedIn — Miami Executive Promotions', 'linkedin_google', 'Promotions', '{
  "search_queries": [
    "site:linkedin.com/in \"promoted to\" \"vice president\" OR \"director\" Miami finance OR \"real estate\" OR healthcare 2026",
    "site:linkedin.com/in \"excited to announce\" \"chief\" OR \"president\" OR \"managing director\" Miami 2026",
    "site:linkedin.com/in \"new role\" \"partner\" OR \"managing director\" Miami Brickell OR \"Coral Gables\""
  ]
}'),

('LinkedIn — Miami Business Launches', 'linkedin_google', 'Launches', '{
  "search_queries": [
    "site:linkedin.com/in \"thrilled to announce\" OR \"excited to share\" \"launched\" OR \"founded\" Miami 2026",
    "site:linkedin.com/in \"own firm\" OR \"boutique\" OR \"new practice\" Miami luxury OR finance OR law OR wellness",
    "site:linkedin.com/in \"started\" OR \"co-founded\" Miami 2026 founder"
  ]
}'),

('Google News — Miami Women Leaders', 'google_news', 'Press', '{
  "trigger_type": "PRESS_MENTION",
  "search_queries": [
    "\"women who mean business\" OR \"women of influence\" Miami 2026",
    "\"40 under 40\" OR \"power women\" OR \"most powerful\" Miami business executive 2026",
    "Miami Herald OR \"Daily Business Review\" OR \"Brickell Magazine\" women executive named featured 2026"
  ]
}'),

('Google News — Miami Conference Speakers', 'google_news', 'Speakers', '{
  "trigger_type": "SPEAKER_ANNOUNCED",
  "search_queries": [
    "keynote speaker \"Art Basel\" OR \"Miami Art Week\" executive panelist 2026",
    "\"eMerge Americas\" OR \"Miami Tech Week\" speaker executive featured 2026",
    "\"Women''s Leadership\" OR \"women in business\" conference speaker Miami 2026"
  ]
}'),

('Google News — Miami Brand Launches', 'google_news', 'Launches', '{
  "trigger_type": "BRAND_LAUNCH",
  "search_queries": [
    "launches boutique OR firm Miami luxury 2026",
    "\"new venture\" OR \"new firm\" OR \"expands to Miami\" executive Brickell OR \"Coral Gables\" 2026",
    "relocates headquarters Miami executive woman founder 2026"
  ]
}')
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9: Leads table — add all missing columns from full schema
-- ─────────────────────────────────────────────────────────────────────────────
-- Status values used by new system:
-- DISCOVERED, PROFILING, CURATED, DRAFTED, REVIEW, SENT, REPLIED, CONVERTED, REJECTED, PAUSED
-- (old: PROFILED→PROFILING, DRAFT→DRAFTED, added: CURATED, REPLIED, CONVERTED, PAUSED)

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS paused_from_status   text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS draft_created_at     timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS reviewed_at          timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS sources              jsonb;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS tone_notes           text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS replied_at           timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS reply_summary        text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS converted_at         timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS conversion_notes     text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS followup_draft_subject text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS followup_draft_body    text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS followup_sent_at       timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS trigger_event_date     date;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS trigger_raw_data       jsonb;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS trigger_source_url     text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_name             text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS email                  text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS title                  text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company                text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS website_url            text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS email_body_html        text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS style_observations     text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS rejection_reason       text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS rejected_by            text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS sent_from_email        text;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 10: Storage buckets (run manually if not yet created)
-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT INTO storage.buckets (id, name, public) VALUES ('assets', 'assets', true) ON CONFLICT DO NOTHING;
-- INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false) ON CONFLICT DO NOTHING;
-- INSERT INTO storage.buckets (id, name, public) VALUES ('renders', 'renders', true) ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Done. Verify with:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'assets';
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'leads';
--   SELECT * FROM discovery_sources;
-- ─────────────────────────────────────────────────────────────────────────────
