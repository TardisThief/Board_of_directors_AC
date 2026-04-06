import { Router } from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { ingestMultiple } from '../../services/assetIngest.js';
import { refreshTrends, getActiveTrends } from '../../services/trendScraper.js';
import { generateProposals, swapProposalAsset, getProposalsWithDetails } from '../../services/matchmaker.js';
import { generateCaptions, getBrandVoice, updateBrandVoice, learnBrandVoice } from '../../services/captionGenerator.js';
import { buildStoryboardTimeline } from '../../services/videoOrchestrator.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }

// ── Assets ─────────────────────────────────────────────────────────────────

router.get('/assets', async (req, res) => {
  const { type, search, vibes, limit = 60, offset = 0 } = req.query;
  let query = db().from('assets')
    .select('id, filename, public_url, type, ai_description, vibes, garments, tags, transcription, created_at')
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);
  if (type) query = query.eq('type', type);
  if (search) query = query.ilike('ai_description', `%${search}%`);
  if (vibes) {
    const vibeArr = vibes.split(',').map(v => v.trim()).filter(Boolean);
    if (vibeArr.length) query = query.contains('vibes', vibeArr);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/assets/ingest', upload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files provided' });

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

router.patch('/assets/:id', async (req, res) => {
  const allowed = ['vibes', 'garments', 'ai_description', 'tags'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const { data, error } = await db().from('assets').update(updates).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/assets/:id', async (req, res) => {
  const { data: asset } = await db().from('assets').select('storage_path').eq('id', req.params.id).single();
  if (asset?.storage_path) await db().storage.from('assets').remove([asset.storage_path]);
  await db().from('assets').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ── Trends ─────────────────────────────────────────────────────────────────

router.get('/trends', async (_req, res) => {
  res.json(await getActiveTrends());
});

router.post('/trends/refresh', async (req, res) => {
  try {
    const result = await refreshTrends(req.body.mode || 'b-roll');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Proposals ──────────────────────────────────────────────────────────────

router.get('/proposals', async (req, res) => {
  try {
    const proposals = await getProposalsWithDetails(req.query.status || 'pending', Number(req.query.limit) || 20);
    res.json(proposals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/proposals', async (req, res) => {
  const { mode = 'b-roll', max = 5 } = req.body;
  try {
    const result = await generateProposals(Number(max), mode);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/proposals/:id/caption', async (req, res) => {
  const { caption } = req.body;
  const { data, error } = await db().from('proposals')
    .update({ caption })
    .eq('id', req.params.id)
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/proposals/:id/status', async (req, res) => {
  const { data, error } = await db().from('proposals')
    .update({ status: req.body.status })
    .eq('id', req.params.id)
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/proposals/:id/swap', async (req, res) => {
  const { slot_label } = req.body;
  if (!slot_label) return res.status(400).json({ error: 'slot_label required' });
  const result = await swapProposalAsset(req.params.id, slot_label);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post('/proposals/:id/captions', async (req, res) => {
  try {
    // Fetch proposal with trend + assets
    const { data: proposal } = await db().from('proposals').select('*, trends(*)').eq('id', req.params.id).single();
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

    const matchedAssets = proposal.matched_assets || [];
    const assetIds = matchedAssets.map(m => m.asset_id).filter(Boolean);
    let assets = [];
    if (assetIds.length) {
      const { data } = await db().from('assets').select('*').in('id', assetIds);
      assets = data || [];
    }
    const populatedAssets = matchedAssets.map(ma => ({
      ...ma,
      asset: assets.find(a => a.id === ma.asset_id) || null,
    }));

    const result = await generateCaptions(proposal.trends, populatedAssets);

    // Save the caption variants back
    await db().from('proposals').update({ caption_variants: result.captions, caption: result.captions[0] }).eq('id', req.params.id);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/proposals/:id/storyboard', async (req, res) => {
  const { data: proposal } = await db().from('proposals').select('*, trends(*)').eq('id', req.params.id).single();
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

  const matchedAssets = proposal.matched_assets || [];
  const assetIds = matchedAssets.map(m => m.asset_id).filter(Boolean);
  let assets = [];
  if (assetIds.length) {
    const { data } = await db().from('assets').select('*').in('id', assetIds);
    assets = data || [];
  }

  const populatedProposal = {
    ...proposal,
    trend: proposal.trends || null,
    matched_assets: matchedAssets.map(ma => ({
      ...ma,
      asset: assets.find(a => a.id === ma.asset_id) || null,
    })),
  };

  res.json(buildStoryboardTimeline(populatedProposal));
});

// ── Content Schedule ────────────────────────────────────────────────────────

router.get('/schedule', async (req, res) => {
  const { from, to, status } = req.query;
  let query = db().from('content_schedule').select('*').order('scheduled_at', { ascending: true });
  if (from) query = query.gte('scheduled_at', from);
  if (to) query = query.lte('scheduled_at', to);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/schedule', async (req, res) => {
  const { data, error } = await db().from('content_schedule')
    .insert({ ...req.body, updated_at: new Date().toISOString() }).select('*').single();
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
  await db().from('content_schedule').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ── Brand Voice ─────────────────────────────────────────────────────────────

router.get('/voice', async (_req, res) => {
  const voice = await getBrandVoice();
  res.json(voice || {});
});

router.put('/voice', async (req, res) => {
  const { voice_description, sample_captions = [] } = req.body;
  const ok = await updateBrandVoice(voice_description, sample_captions);
  if (!ok) return res.status(500).json({ error: 'Failed to update brand voice' });
  res.json({ success: true });
});

router.post('/voice/learn', async (_req, res) => {
  try {
    const learnedStyle = await learnBrandVoice();
    if (!learnedStyle) return res.status(400).json({ error: 'Not enough assets to learn from' });
    res.json({ learned_style: learnedStyle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
