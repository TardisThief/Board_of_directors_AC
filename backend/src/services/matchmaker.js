/**
 * Matchmaker Service
 * Full port from ACS_ContentEngine matchmaker.ts
 * Pairs active trends with vault assets using vector similarity (pgvector).
 */
import { createClient } from '@supabase/supabase-js';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3';

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

// ── Voyage embeddings ─────────────────────────────────────────────────────────

async function generateBatchQueryEmbeddings(queries) {
  if (!process.env.VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY not set');

  // Batch in chunks of 128
  const batches = [];
  for (let i = 0; i < queries.length; i += 128) batches.push(queries.slice(i, i + 128));

  const allEmbeddings = [];
  for (const batch of batches) {
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}` },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: batch, input_type: 'query' }),
    });
    if (!res.ok) throw new Error(`Voyage AI error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    allEmbeddings.push(...data.data.sort((a, b) => a.index - b.index).map(d => d.embedding));
  }
  return allEmbeddings;
}

// ── Main: generate proposals ──────────────────────────────────────────────────

export async function generateProposals(maxProposals = 5, mode) {
  const db = supabase();

  let query = db.from('trends').select('*').eq('is_active', true).order('heat_score', { ascending: false });
  const { data: trends, error } = await query.limit(maxProposals * 2);

  if (error || !trends?.length) {
    console.warn('[Matchmaker] No active trends:', error?.message);
    return { proposals: [], generated: 0 };
  }

  // Check asset count
  const { count: assetCount } = await db.from('assets').select('*', { count: 'exact', head: true });
  if (!assetCount) {
    console.warn('[Matchmaker] No assets in vault');
    return { proposals: [], generated: 0 };
  }

  // Collect all slot queries for a single Voyage batch call
  const allSlotQueries = [];
  const trendSlotMap = new Map();

  for (const trend of trends) {
    if (trendSlotMap.size >= maxProposals) break;
    const recipe = trend.recipe;
    if (!recipe?.slots?.length) continue;

    const startIndex = allSlotQueries.length;
    allSlotQueries.push(...recipe.slots.map(slot => {
      if (recipe.workflow_mode === 'storytime') {
        return `${trend.name} vlog style speaking about ${slot.vibes.join(' ')}`;
      }
      return `${slot.vibes.join(' ')} ${slot.label} fashion styling`;
    }));
    trendSlotMap.set(trend.id, { start: startIndex, length: recipe.slots.length });
  }

  if (!allSlotQueries.length) return { proposals: [], generated: 0 };

  let globalEmbeddings = [];
  try {
    globalEmbeddings = await generateBatchQueryEmbeddings(allSlotQueries);
  } catch (err) {
    console.error('[Matchmaker] Embedding batch failed:', err.message);
    return { proposals: [], generated: 0 };
  }

  // Match assets for each trend
  const proposals = [];
  for (const trend of trends) {
    const slotMapping = trendSlotMap.get(trend.id);
    if (!slotMapping) continue;

    const recipe = trend.recipe;
    const matchedAssets = [];
    let allSlotsMatched = true;

    for (let idx = 0; idx < recipe.slots.length; idx++) {
      const slot = recipe.slots[idx];
      const embedding = globalEmbeddings[slotMapping.start + idx];

      // Try with vibe filter first, then fallback without
      let matches = null;
      const { data: primary } = await db.rpc('match_assets', {
        query_embedding: JSON.stringify(embedding),
        match_threshold: 0.2,
        match_count: 5,
        vibe_filter: slot.vibes?.length ? slot.vibes : [],
      });

      if (primary?.length) {
        matches = primary;
      } else {
        const { data: fallback } = await db.rpc('match_assets', {
          query_embedding: JSON.stringify(embedding),
          match_threshold: 0.1,
          match_count: 5,
          vibe_filter: [],
        });
        matches = fallback;
      }

      if (!matches?.length) {
        allSlotsMatched = false;
        break;
      }

      matchedAssets.push({
        slot_label: slot.label,
        asset_id: matches[0].id,
        confidence: matches[0].similarity || 0.5,
        alternatives: matches.slice(1, 4).map(m => m.id),
      });
    }

    if (!allSlotsMatched || !matchedAssets.length) continue;

    const captionVariants = generateBasicCaptions(trend, matchedAssets);
    const { data: proposal, error: propErr } = await db.from('proposals').insert({
      trend_id: trend.id,
      matched_assets: matchedAssets,
      caption: captionVariants[0] || '',
      caption_variants: captionVariants,
      text_overlays: recipe.text_overlays || [],
      status: 'pending',
    }).select('*').single();

    if (!propErr && proposal) {
      proposals.push({ ...proposal, trend, matched_assets: matchedAssets });
    }
  }

  return { proposals, generated: proposals.length };
}

/**
 * Swap a proposal slot to its next best alternative asset.
 */
export async function swapProposalAsset(proposalId, slotLabel) {
  const db = supabase();
  const { data: proposal, error } = await db.from('proposals').select('*').eq('id', proposalId).single();
  if (error || !proposal) return { success: false, error: 'Proposal not found' };

  const matchedAssets = proposal.matched_assets || [];
  const slotIdx = matchedAssets.findIndex(m => m.slot_label === slotLabel);
  if (slotIdx === -1) return { success: false, error: `Slot "${slotLabel}" not found` };

  const slot = matchedAssets[slotIdx];
  if (!slot.alternatives?.length) return { success: false, error: 'No alternatives available' };

  const newAssetId = slot.alternatives[0];
  const newAlternatives = [...slot.alternatives.slice(1), slot.asset_id];
  matchedAssets[slotIdx] = { ...slot, asset_id: newAssetId, alternatives: newAlternatives };

  const { error: updErr } = await db.from('proposals').update({ matched_assets: matchedAssets }).eq('id', proposalId);
  if (updErr) return { success: false, error: updErr.message };

  return { success: true, newAssetId };
}

/**
 * Get proposals with trend details and populated asset objects.
 */
export async function getProposalsWithDetails(status = 'pending', limit = 20) {
  const db = supabase();
  const { data: proposals } = await db
    .from('proposals')
    .select('*, trends(*)')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!proposals?.length) return [];

  const enriched = [];
  for (const p of proposals) {
    const matchedAssets = p.matched_assets || [];
    const assetIds = matchedAssets.map(m => m.asset_id).filter(Boolean);

    let assets = [];
    if (assetIds.length) {
      const { data } = await db.from('assets').select('*').in('id', assetIds);
      assets = data || [];
    }

    enriched.push({
      ...p,
      trend: p.trends || null,
      matched_assets: matchedAssets.map(ma => ({
        ...ma,
        asset: assets.find(a => a.id === ma.asset_id) || null,
      })),
    });
  }
  return enriched;
}

function generateBasicCaptions(trend, _matches) {
  const hashtags = trend.trending_hashtags?.join(' ') || '';
  return [
    `${trend.recipe?.text_overlays?.[0]?.text || trend.name} ✨ ${hashtags}`,
    `POV: When your stylist gets it right 💫 ${hashtags}`,
    `The transformation you didn't know you needed 🔥 ${hashtags}`,
  ];
}
