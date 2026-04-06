import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { runScout, runSourceById, previewQuery } from '../../services/agents/scout.js';
import { runFullPipeline } from '../../services/orchestrator.js';
import { pauseLead, resumeLead, getLeadEvents } from '../../services/stateMachine.js';
import { getRunsForLead } from '../../services/agentRunner.js';

const router = Router();

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }

// ── Leads CRUD ────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { status, limit = 100 } = req.query;
  let query = db().from('leads').select('*').order('created_at', { ascending: false }).limit(Number(limit));
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.get('/:id', async (req, res) => {
  const { data, error } = await db().from('leads').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Lead not found' });
  res.json(data);
});

router.put('/:id', async (req, res) => {
  const { data, error } = await db().from('leads')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Lead actions ──────────────────────────────────────────────────────────────

router.post('/scout', async (req, res) => {
  try {
    const ids = await runScout();
    res.json({ discovered: ids.length, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/run-pipeline', async (req, res) => {
  try {
    const result = await runFullPipeline(req.params.id);
    res.json({ success: true, status: result?.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/approve', async (req, res) => {
  const { data, error } = await db().from('leads').update({
    status: 'SENT',
    sent_at: new Date().toISOString(),
    sent_from_email: req.body.from_email || 'alejandra@theacstyle.com',
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });

  // Write audit log
  await db().from('lead_events').insert({
    lead_id: req.params.id,
    actor: 'human',
    event_type: 'status_transition',
    from_status: 'REVIEW',
    to_status: 'SENT',
    reason: 'Approved and sent by user',
  });

  res.json(data);
});

router.put('/:id/reject', async (req, res) => {
  const { data, error } = await db().from('leads').update({
    status: 'REJECTED',
    rejection_reason: req.body.reason || 'Rejected by user',
    rejected_by: 'human',
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });

  await db().from('lead_events').insert({
    lead_id: req.params.id,
    actor: 'human',
    event_type: 'status_transition',
    from_status: 'REVIEW',
    to_status: 'REJECTED',
    reason: req.body.reason || 'Rejected by user',
  });

  res.json(data);
});

router.put('/:id/pause', async (req, res) => {
  try {
    const lead = await pauseLead(req.params.id, 'human', req.body.reason || 'Paused by user');
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/resume', async (req, res) => {
  try {
    const lead = await resumeLead(req.params.id, 'human', req.body.reason || 'Resumed by user');
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/draft', async (req, res) => {
  const { email_subject, email_body_text, human_notes } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (email_subject  !== undefined) updates.email_subject  = email_subject;
  if (email_body_text !== undefined) updates.email_body_text = email_body_text;
  if (human_notes    !== undefined) updates.human_notes    = human_notes;

  const { data, error } = await db().from('leads').update(updates).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Audit log + agent runs ────────────────────────────────────────────────────

router.get('/:id/events', async (req, res) => {
  const events = await getLeadEvents(req.params.id);
  res.json(events);
});

router.get('/:id/runs', async (req, res) => {
  const runs = await getRunsForLead(req.params.id);
  res.json(runs);
});

// ── Discovery sources CRUD ────────────────────────────────────────────────────

router.get('/sources/list', async (_req, res) => {
  const { data, error } = await db().from('discovery_sources').select('*').order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/sources', async (req, res) => {
  const { name, source_type, category, config } = req.body;
  if (!name || !source_type) return res.status(400).json({ error: 'name and source_type required' });
  const { data, error } = await db().from('discovery_sources')
    .insert({ name, source_type, category: category || 'General', config: config || {}, is_active: true })
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/sources/:id', async (req, res) => {
  const allowed = ['name', 'source_type', 'category', 'config', 'is_active'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const { data, error } = await db().from('discovery_sources').update(updates).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/sources/:id', async (req, res) => {
  await db().from('discovery_sources').delete().eq('id', req.params.id);
  res.json({ success: true });
});

router.post('/sources/:id/run', async (req, res) => {
  try {
    const ids = await runSourceById(req.params.id);
    res.json({ discovered: ids.length, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sources/preview', async (req, res) => {
  const { source_type, query, trigger_type } = req.body;
  if (!source_type || !query) return res.status(400).json({ error: 'source_type and query required' });
  try {
    const result = await previewQuery(source_type, query, trigger_type);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
