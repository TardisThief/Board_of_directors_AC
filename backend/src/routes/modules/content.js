import { Router } from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { ingestMultiple } from '../../services/assetIngest.js';
import { refreshTrends, getActiveTrends } from '../../services/trendScraper.js';
import { generateProposals, getProposals, updateProposalCaption, updateProposalStatus } from '../../services/proposalEngine.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }

// ── Assets ────────────────────────────────────────────────────────────────

router.get('/assets', async (req, res) => {
  const { type, limit = 50, offset = 0 } = req.query;
  let query = db().from('assets').select('id, filename, public_url, type, ai_description, vibes, garments, tags, created_at')
    .order('created_at', { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);
  if (type) query = query.eq('type', type);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/assets/ingest', upload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files provided' });

  // Stream progress via SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const files = req.files.map(f => ({ buffer: f.buffer, filename: f.originalname, mimeType: f.mimetype }));

  const results = await ingestMultiple(files, progress => {
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
  });

  res.write(`data: ${JSON.stringify({ done: true, results })}\n\n`);
  res.end();
});

router.delete('/assets/:id', async (req, res) => {
  const { data: asset } = await db().from('assets').select('storage_path').eq('id', req.params.id).single();
  if (asset?.storage_path) {
    await db().storage.from('assets').remove([asset.storage_path]);
  }
  await db().from('assets').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ── Trends ────────────────────────────────────────────────────────────────

router.get('/trends', async (_req, res) => {
  const trends = await getActiveTrends();
  res.json(trends);
});

router.post('/trends/refresh', async (req, res) => {
  try {
    const trends = await refreshTrends(req.body.mode || 'b-roll');
    res.json({ refreshed: trends.length, trends });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Proposals ─────────────────────────────────────────────────────────────

router.get('/proposals', async (req, res) => {
  const proposals = await getProposals(req.query.status || null);
  res.json(proposals);
});

router.post('/proposals', async (req, res) => {
  const { trend_ids, mode = 'b-roll' } = req.body;
  if (!trend_ids?.length) return res.status(400).json({ error: 'trend_ids required' });
  try {
    const proposals = await generateProposals(trend_ids, mode);
    res.json(proposals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/proposals/:id/caption', async (req, res) => {
  const data = await updateProposalCaption(req.params.id, req.body.caption);
  res.json(data);
});

router.put('/proposals/:id/status', async (req, res) => {
  const data = await updateProposalStatus(req.params.id, req.body.status);
  res.json(data);
});

// ── Content Schedule ──────────────────────────────────────────────────────

router.get('/schedule', async (req, res) => {
  const { from, to, status } = req.query;
  let query = db().from('content_schedule')
    .select('*')
    .order('scheduled_at', { ascending: true });
  if (from) query = query.gte('scheduled_at', from);
  if (to) query = query.lte('scheduled_at', to);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/schedule', async (req, res) => {
  const { data, error } = await db().from('content_schedule').insert({
    ...req.body,
    updated_at: new Date().toISOString(),
  }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/schedule/:id', async (req, res) => {
  const { data, error } = await db().from('content_schedule')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/schedule/:id', async (req, res) => {
  const { error } = await db().from('content_schedule').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Brand Voice ───────────────────────────────────────────────────────────

router.get('/voice', async (_req, res) => {
  const { data } = await db().from('brand_voice').select('*').single();
  res.json(data || {});
});

router.put('/voice', async (req, res) => {
  const existing = await db().from('brand_voice').select('id').single();
  let result;
  if (existing.data) {
    result = await db().from('brand_voice').update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', existing.data.id).select('*').single();
  } else {
    result = await db().from('brand_voice').insert(req.body).select('*').single();
  }
  res.json(result.data);
});

export default router;
