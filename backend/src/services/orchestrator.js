/**
 * Lead Pipeline Orchestrator
 * Port from ACS_LeadGen core/orchestrator.py
 * Polls the database every 15 seconds, auto-advances leads through the pipeline.
 * Dispatch: DISCOVERED→artDirector, CURATED→copywriter, DRAFTED→reviewer, REVIEW→notify
 */
import { createClient } from '@supabase/supabase-js';
import { runArtDirector } from './agents/artDirector.js';
import { runCopywriter } from './agents/copywriter.js';
import { runReviewer } from './agents/reviewer.js';
import { STATUS } from './stateMachine.js';

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }

const POLL_INTERVAL_MS = 15_000;
const MAX_CONCURRENT   = 4;

// Track which leads are being processed (avoid re-dispatch)
const inFlight = new Set();
let pollerTimer = null;

// ── Dispatch table ────────────────────────────────────────────────────────────

const DISPATCH = {
  [STATUS.DISCOVERED]: runArtDirector,
  [STATUS.CURATED]:    runCopywriter,
  [STATUS.DRAFTED]:    runReviewer,
};

// Notification: when a lead enters REVIEW, log it (Telegram can be added here)
async function notifyReview(lead) {
  console.log(`[Orchestrator] 🔔 REVIEW: "${lead.full_name || 'Unknown'}" — ${lead.email_subject || '(no subject)'}`);
  // Optional: add Telegram notification here if TELEGRAM_BOT_TOKEN is set
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const text = [
        `🔔 *Lead ready for review*`,
        `Name: ${lead.full_name || 'Unknown'}`,
        `Title: ${lead.title || '—'}`,
        `Trigger: ${lead.trigger_summary || '—'}`,
        `Gap: ${lead.styling_gap || '—'}`,
        `Subject: ${lead.email_subject || '—'}`,
      ].join('\n');

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'Markdown',
        }),
      });
    } catch (err) {
      console.error('[Orchestrator] Telegram notify error:', err.message);
    }
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

async function poll() {
  if (inFlight.size >= MAX_CONCURRENT) return;

  const supabase = db();
  const actionableStatuses = Object.keys(DISPATCH);

  // Find one lead per actionable status that isn't already in flight
  for (const status of actionableStatuses) {
    if (inFlight.size >= MAX_CONCURRENT) break;

    const { data: leads } = await supabase
      .from('leads')
      .select('id, status, full_name')
      .eq('status', status)
      .not('id', 'in', inFlight.size > 0 ? `(${[...inFlight].join(',')})` : '(00000000-0000-0000-0000-000000000000)')
      .order('updated_at', { ascending: true })
      .limit(1);

    if (!leads?.length) continue;

    const lead = leads[0];
    if (inFlight.has(lead.id)) continue;

    inFlight.add(lead.id);
    const handler = DISPATCH[status];

    console.log(`[Orchestrator] Dispatching ${status} → ${lead.full_name || lead.id}`);

    handler(lead.id)
      .then(updated => {
        console.log(`[Orchestrator] ${lead.full_name || lead.id} → ${updated?.status || 'done'}`);
        // If just entered REVIEW, send notification
        if (updated?.status === STATUS.REVIEW) {
          notifyReview(updated).catch(() => {});
        }
      })
      .catch(err => {
        console.error(`[Orchestrator] Error processing ${lead.id}:`, err.message);
      })
      .finally(() => {
        inFlight.delete(lead.id);
      });
  }
}

// ── Catchup (on startup) ──────────────────────────────────────────────────────

async function catchup() {
  const supabase = db();
  const actionableStatuses = Object.keys(DISPATCH);

  const { data: stuckLeads } = await supabase
    .from('leads')
    .select('id, status, full_name')
    .in('status', actionableStatuses)
    .order('updated_at', { ascending: true })
    .limit(20);

  if (stuckLeads?.length) {
    console.log(`[Orchestrator] Catchup: found ${stuckLeads.length} stuck lead(s)`);
  }
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

export function startOrchestrator() {
  if (pollerTimer) return;
  console.log('[Orchestrator] Starting — polling every 15s');

  // Run catchup immediately, then start polling
  catchup().catch(err => console.error('[Orchestrator] Catchup error:', err.message));
  pollerTimer = setInterval(() => {
    poll().catch(err => console.error('[Orchestrator] Poll error:', err.message));
  }, POLL_INTERVAL_MS);
}

export function stopOrchestrator() {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
    console.log('[Orchestrator] Stopped');
  }
}

/**
 * Run the full pipeline on a single lead immediately (bypasses orchestrator queue).
 */
export async function runFullPipeline(leadId) {
  const supabase = db();
  const { data: lead } = await supabase.from('leads').select('id, status').eq('id', leadId).single();
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  let current = lead;

  // Run each stage in sequence if applicable
  if (current.status === STATUS.DISCOVERED) {
    current = await runArtDirector(leadId);
  }
  if (current.status === STATUS.CURATED) {
    current = await runCopywriter(leadId);
  }
  if (current.status === STATUS.DRAFTED) {
    current = await runReviewer(leadId);
  }
  if (current.status === STATUS.REVIEW) {
    await notifyReview(current);
  }

  return current;
}
