/**
 * Proposal Generation Engine
 * Ported from ACS_ContentEngine — matches assets to trends, generates captions
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import VoyageAI from 'voyageai';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

function voyage() {
  return new VoyageAI({ apiKey: process.env.VOYAGE_API_KEY });
}

async function matchAssetsToTrend(trend, assets) {
  const slots = trend.recipe?.slots || [];
  if (!slots.length || !assets.length) return [];

  // Simple matching: pick best asset per slot using description similarity
  return slots.map((slot, i) => {
    const asset = assets[i % assets.length];
    return {
      slot_label: slot.label,
      duration_sec: slot.duration_sec,
      asset: {
        id: asset.id,
        public_url: asset.public_url,
        type: asset.type,
        ai_description: asset.ai_description,
      },
    };
  });
}

async function generateCaption(trend, matchedAssets, brandVoice, mode = 'b-roll') {
  const assetDescriptions = matchedAssets
    .map(ma => ma.asset?.ai_description || '')
    .filter(Boolean)
    .join(', ');

  const voiceStyle = brandVoice?.voice_description || 'elevated, editorial, confident';
  const samples = brandVoice?.sample_captions?.slice(0, 2).join('\n') || '';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Write an Instagram/TikTok caption for AC Styling.

Trend: ${trend.name}
Mode: ${mode} (${mode === 'b-roll' ? 'short, punchy, visual' : 'storytelling, personal, narrative'})
Assets shown: ${assetDescriptions}
Brand voice: ${voiceStyle}
${samples ? `Voice examples:\n${samples}` : ''}
Hashtags to include: ${trend.trending_hashtags?.slice(0, 5).join(' ') || ''}

Return ONLY the caption text. No explanations.`,
    }],
  });

  return response.content[0].text;
}

export async function generateProposals(trendIds, mode = 'b-roll') {
  const db = supabase();

  // Load trends
  const { data: trends } = await db
    .from('trends')
    .select('*')
    .in('id', trendIds)
    .eq('is_active', true);

  if (!trends?.length) throw new Error('No active trends found for given IDs');

  // Load available assets
  const { data: assets } = await db
    .from('assets')
    .select('id, public_url, type, ai_description, vibes, garments')
    .order('created_at', { ascending: false })
    .limit(50);

  // Load brand voice
  const { data: brandVoice } = await db
    .from('brand_voice')
    .select('*')
    .single();

  const proposals = [];

  for (const trend of trends) {
    const matched = await matchAssetsToTrend(trend, assets || []);
    const caption = await generateCaption(trend, matched, brandVoice, mode);

    const { data: proposal } = await db.from('proposals').insert({
      trend_id: trend.id,
      matched_assets: matched,
      caption,
      status: 'pending',
    }).select('*').single();

    if (proposal) proposals.push({ ...proposal, trend });
  }

  return proposals;
}

export async function getProposals(status = null) {
  const db = supabase();
  let query = db
    .from('proposals')
    .select('*, trends(name, platform, heat_score, recipe, trending_hashtags)')
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data } = await query.limit(50);
  return data || [];
}

export async function updateProposalCaption(id, caption) {
  const db = supabase();
  const { data } = await db
    .from('proposals')
    .update({ caption })
    .eq('id', id)
    .select()
    .single();
  return data;
}

export async function updateProposalStatus(id, status) {
  const db = supabase();
  const { data } = await db
    .from('proposals')
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  return data;
}
