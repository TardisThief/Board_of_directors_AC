/**
 * Lead State Machine
 * Port from ACS_LeadGen core/state_machine.py
 * Enforces valid status transitions and writes immutable audit log to lead_events.
 */
import { createClient } from '@supabase/supabase-js';

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

// ── Status constants ───────────────────────────────────────────────────────────

export const STATUS = {
  DISCOVERED: 'DISCOVERED',
  PROFILING:  'PROFILING',
  CURATED:    'CURATED',
  DRAFTED:    'DRAFTED',
  REVIEW:     'REVIEW',
  SENT:       'SENT',
  REPLIED:    'REPLIED',
  CONVERTED:  'CONVERTED',
  REJECTED:   'REJECTED',
  PAUSED:     'PAUSED',
};

// ── Valid transitions ─────────────────────────────────────────────────────────

const VALID_TRANSITIONS = {
  DISCOVERED: ['PROFILING', 'REJECTED', 'PAUSED'],
  PROFILING:  ['CURATED',   'REJECTED', 'PAUSED'],
  CURATED:    ['DRAFTED',   'REJECTED', 'PAUSED'],
  DRAFTED:    ['REVIEW',    'REJECTED', 'PAUSED'],
  REVIEW:     ['SENT',      'REJECTED', 'PAUSED'],
  SENT:       ['REPLIED',   'PAUSED'],
  REPLIED:    ['CONVERTED', 'PAUSED'],
  CONVERTED:  [],
  REJECTED:   [],
  PAUSED:     Object.values(STATUS), // can resume to any non-terminal status
};

// ── Transition function ───────────────────────────────────────────────────────

/**
 * Transition a lead to a new status.
 * Validates the transition, updates the DB, and writes to lead_events.
 *
 * @param {string} leadId
 * @param {string} toStatus
 * @param {string} actor - agent name or 'human'
 * @param {string} reason - human-readable reason
 * @returns {Promise<object>} updated lead
 */
export async function transition(leadId, toStatus, actor, reason = '') {
  const supabase = db();

  // Fetch current lead
  const { data: lead, error: fetchErr } = await supabase
    .from('leads')
    .select('id, status, paused_from_status')
    .eq('id', leadId)
    .single();

  if (fetchErr || !lead) throw new Error(`Lead ${leadId} not found: ${fetchErr?.message}`);

  const fromStatus = lead.status;

  // Validate transition
  const allowed = VALID_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new Error(`Invalid transition ${fromStatus} → ${toStatus} for lead ${leadId}`);
  }

  const now = new Date().toISOString();
  const updates = { status: toStatus, updated_at: now };

  // Track paused status
  if (toStatus === STATUS.PAUSED) {
    updates.paused_from_status = fromStatus;
  } else if (fromStatus === STATUS.PAUSED) {
    updates.paused_from_status = null;
  }

  // Update lead status
  const { data: updated, error: updateErr } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', leadId)
    .select('*')
    .single();

  if (updateErr) throw new Error(`Status update failed: ${updateErr.message}`);

  // Write immutable audit log
  await supabase.from('lead_events').insert({
    lead_id: leadId,
    actor,
    event_type: 'status_transition',
    from_status: fromStatus,
    to_status: toStatus,
    reason: reason.slice(0, 500),
    metadata: { timestamp: now },
  });

  return updated;
}

/**
 * Pause a lead, preserving the current status for resumption.
 */
export async function pauseLead(leadId, actor = 'human', reason = 'Paused by user') {
  return transition(leadId, STATUS.PAUSED, actor, reason);
}

/**
 * Resume a paused lead back to its previous status.
 */
export async function resumeLead(leadId, actor = 'human', reason = 'Resumed') {
  const supabase = db();
  const { data: lead } = await supabase
    .from('leads')
    .select('status, paused_from_status')
    .eq('id', leadId)
    .single();

  if (lead?.status !== STATUS.PAUSED) {
    throw new Error(`Lead ${leadId} is not paused (current: ${lead?.status})`);
  }

  const resumeTo = lead.paused_from_status || STATUS.DISCOVERED;
  return transition(leadId, resumeTo, actor, reason);
}

/**
 * Get the audit log for a lead.
 */
export async function getLeadEvents(leadId) {
  const { data } = await db()
    .from('lead_events')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true });
  return data || [];
}
