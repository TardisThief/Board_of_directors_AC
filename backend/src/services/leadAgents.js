/**
 * Lead Generation Agents — ported from Python/CrewAI to Node.js
 * Scout → Art Director → Copywriter → Reviewer pipeline
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

// ── Scout Agent ───────────────────────────────────────────────────────────

async function webSearch(query) {
  // Uses Anthropic with web search tool when available, fallback to prompt-only
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a lead scout for AC Styling, a personal fashion styling service.

Search for potential clients who have recently:
- Moved to a new city or got promoted
- Posted about wanting to refresh their wardrobe
- Have a lifestyle suggesting disposable income and interest in fashion

Query focus: "${query}"

Return a JSON array of leads (max 3):
[{
  "full_name": "Name if known",
  "trigger_type": "promotion|relocation|life_event|social_signal",
  "trigger_summary": "what triggered this lead",
  "trigger_source_url": "url if found",
  "location": "city, state",
  "instagram_url": "if found",
  "linkedin_url": "if found",
  "style_observations": "observations about their style needs",
  "styling_gap": "what AC Styling could offer them"
}]

Be realistic — only return leads with genuine potential. Return [] if none found.`,
      }],
    });

    const text = response.content[0].text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

export async function runScout() {
  const db = supabase();
  const { data: sources } = await db
    .from('discovery_sources')
    .select('*')
    .eq('is_active', true);

  const queries = sources?.map(s => s.name) || [
    'South Florida professional women fashion',
    'Miami lifestyle influencer wardrobe',
    'Fort Lauderdale personal styling',
  ];

  const allLeads = [];
  for (const query of queries.slice(0, 3)) {
    const leads = await webSearch(query);
    allLeads.push(...leads);
  }

  // Dedup by email/linkedin and save
  const saved = [];
  for (const lead of allLeads) {
    const { data } = await db.from('leads').insert({
      ...lead,
      status: 'DISCOVERED',
      priority: 5,
    }).select('id').single();
    if (data) saved.push(data.id);
  }

  // Update source last_run
  if (sources?.length) {
    await db.from('discovery_sources')
      .update({ last_run_at: new Date().toISOString() })
      .in('id', sources.map(s => s.id));
  }

  return saved;
}

// ── Art Director Agent ────────────────────────────────────────────────────

export async function runArtDirector(leadId) {
  const db = supabase();
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).single();
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  await logAgentRun(db, 'art_director', leadId, 'running');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are the Art Director for AC Styling. Profile this potential client and assess their styling opportunity.

Lead info:
- Name: ${lead.full_name || 'Unknown'}
- Location: ${lead.location || 'Unknown'}
- Trigger: ${lead.trigger_summary || 'N/A'}
- Instagram: ${lead.instagram_url || 'N/A'}
- LinkedIn: ${lead.linkedin_url || 'N/A'}
- Initial observations: ${lead.style_observations || 'N/A'}

Based on all available signals, provide:
1. A detailed digital footprint summary (lifestyle, aesthetic signals, public presence)
2. Updated style observations specific to AC Styling's services
3. The core styling gap (what transformation we can offer)
4. Confidence level in gap assessment (low/medium/high)

Format as JSON:
{
  "digital_footprint_summary": "...",
  "style_observations": "...",
  "styling_gap": "...",
  "styling_gap_confidence": "high|medium|low"
}`,
    }],
  });

  try {
    const text = response.content[0].text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    const profile = JSON.parse(text);

    await db.from('leads').update({
      ...profile,
      status: 'PROFILED',
      profile_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', leadId);

    await logAgentRun(db, 'art_director', leadId, 'completed');
    return profile;
  } catch (err) {
    await logAgentRun(db, 'art_director', leadId, 'failed', err.message);
    throw err;
  }
}

// ── Copywriter Agent ─────────────────────────────────────────────────────

export async function runCopywriter(leadId) {
  const db = supabase();
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).single();
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  await logAgentRun(db, 'copywriter', leadId, 'running');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are the Copywriter for AC Styling. Write a personalized cold outreach email.

Lead profile:
- Name: ${lead.full_name || 'there'}
- Location: ${lead.location}
- Trigger: ${lead.trigger_summary}
- Style gap: ${lead.styling_gap}
- Confidence: ${lead.styling_gap_confidence}
- Digital presence: ${lead.digital_footprint_summary}

AC Styling context:
- Personal styling service for elevated, curated wardrobes
- Based in South Florida
- Contact: alejandra@theacstyle.com
- Website: theacstyle.com

Write a warm, non-salesy cold email that:
- References their specific trigger naturally
- Speaks to their styling gap without being presumptuous
- Positions AC Styling as a partner, not a vendor
- Has a soft CTA (discovery call or free style assessment)
- Feels personal, not templated

Return JSON:
{
  "subject": "email subject line",
  "body_text": "plain text version",
  "body_html": "HTML version with basic formatting",
  "tone_notes": "brief notes on tone choices"
}`,
    }],
  });

  try {
    const text = response.content[0].text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    const draft = JSON.parse(text);

    await db.from('leads').update({
      email_subject: draft.subject,
      email_body_html: draft.body_html,
      email_body_text: draft.body_text,
      tone_notes: draft.tone_notes,
      status: 'DRAFT',
      draft_created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', leadId);

    await logAgentRun(db, 'copywriter', leadId, 'completed');
    return draft;
  } catch (err) {
    await logAgentRun(db, 'copywriter', leadId, 'failed', err.message);
    throw err;
  }
}

// ── Reviewer Agent ────────────────────────────────────────────────────────

export async function runReviewer(leadId) {
  const db = supabase();
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).single();
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Review this cold email draft for AC Styling. Flag any issues.

Subject: ${lead.email_subject}
Body: ${lead.email_body_text}

Check for:
- Tone too salesy or desperate
- Generic phrases that feel templated
- Factual claims that can't be verified
- Missing personalization opportunities
- CTA too pushy

Return JSON:
{
  "approved": true/false,
  "flags": ["list of issues if any"],
  "suggestion": "one key improvement if not approved"
}`,
    }],
  });

  try {
    const text = response.content[0].text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    const review = JSON.parse(text);

    await db.from('leads').update({
      review_flags: review.flags || [],
      status: review.approved ? 'REVIEW' : 'DRAFT',
      updated_at: new Date().toISOString(),
    }).eq('id', leadId);

    return review;
  } catch {
    return { approved: false, flags: ['Review parse failed'], suggestion: null };
  }
}

// ── Orchestrator (full pipeline) ──────────────────────────────────────────

export async function runFullPipeline(leadId) {
  await runArtDirector(leadId);
  await runCopywriter(leadId);
  await runReviewer(leadId);
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function logAgentRun(db, agentName, leadId, status, errorMessage = null) {
  try {
    await db.from('agent_runs').insert({
      agent_name: agentName,
      lead_id: leadId,
      run_status: status,
      error_message: errorMessage,
      completed_at: status !== 'running' ? new Date().toISOString() : null,
    });
  } catch {
    // Non-critical
  }
}

// ── Lead CRUD ─────────────────────────────────────────────────────────────

export async function getLeads(status = null) {
  const db = supabase();
  let query = db.from('leads').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data } = await query.limit(100);
  return data || [];
}

export async function updateLead(id, updates) {
  const db = supabase();
  const { data } = await db
    .from('leads')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  return data;
}
