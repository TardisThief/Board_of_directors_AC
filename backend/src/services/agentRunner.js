/**
 * Agent Run Tracking
 * Port from ACS_LeadGen db/repositories/agent_runs.py
 * Records all agent executions in agent_runs table for observability.
 */
import { createClient } from '@supabase/supabase-js';

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

/**
 * Start an agent run record.
 * @returns {Promise<{id: string}>}
 */
export async function startRun(agentName, leadId, inputSnapshot = {}) {
  const { data, error } = await db().from('agent_runs').insert({
    agent_name: agentName,
    lead_id: leadId || null,
    run_status: 'running',
    input_snapshot: inputSnapshot,
    started_at: new Date().toISOString(),
  }).select('id').single();

  if (error) {
    console.error(`[AgentRunner] Failed to start run for ${agentName}:`, error.message);
    return { id: null };
  }
  return data;
}

/**
 * Complete an agent run record.
 */
export async function completeRun(runId, { outputSnapshot, reasoningTrace, tokensUsed, toolsCalled, durationMs } = {}) {
  if (!runId) return;
  await db().from('agent_runs').update({
    run_status: 'completed',
    completed_at: new Date().toISOString(),
    output_snapshot: outputSnapshot || null,
    reasoning_trace: reasoningTrace || null,
    tokens_used: tokensUsed || null,
    tools_called: toolsCalled || null,
    duration_ms: durationMs || null,
  }).eq('id', runId);
}

/**
 * Fail an agent run record.
 */
export async function failRun(runId, { errorMessage, durationMs } = {}) {
  if (!runId) return;
  await db().from('agent_runs').update({
    run_status: 'failed',
    completed_at: new Date().toISOString(),
    error_message: errorMessage || null,
    duration_ms: durationMs || null,
  }).eq('id', runId);
}

/**
 * Get agent runs for a lead.
 */
export async function getRunsForLead(leadId) {
  const { data } = await db()
    .from('agent_runs')
    .select('*')
    .eq('lead_id', leadId)
    .order('started_at', { ascending: false });
  return data || [];
}

/**
 * Wrap an async agent function with automatic run tracking.
 * Usage: await withTracking('art_director', leadId, async () => { ... });
 */
export async function withTracking(agentName, leadId, fn, inputSnapshot = {}) {
  const t0 = Date.now();
  const run = await startRun(agentName, leadId, inputSnapshot);

  try {
    const result = await fn();
    await completeRun(run.id, {
      outputSnapshot: result?.output || null,
      tokensUsed: result?.tokensUsed || null,
      toolsCalled: result?.toolsCalled || null,
      durationMs: Date.now() - t0,
    });
    return result;
  } catch (err) {
    await failRun(run.id, { errorMessage: err.message, durationMs: Date.now() - t0 });
    throw err;
  }
}
