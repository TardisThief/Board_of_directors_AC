/**
 * Caption Generator Service
 * Full port from ACS_ContentEngine caption-generator.ts
 * Generates on-brand captions using Claude + stored brand voice config.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

// ── Brand voice ───────────────────────────────────────────────────────────────

export async function getBrandVoice() {
  const { data } = await supabase().from('brand_voice').select('*').limit(1).single();
  return data || null;
}

export async function updateBrandVoice(voiceDescription, sampleCaptions) {
  const db = supabase();
  const { data: existing } = await db.from('brand_voice').select('id').limit(1).single();

  if (existing) {
    const { error } = await db.from('brand_voice')
      .update({ voice_description: voiceDescription, sample_captions: sampleCaptions, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    return !error;
  }

  const { error } = await db.from('brand_voice').insert({
    voice_description: voiceDescription,
    sample_captions: sampleCaptions,
  });
  return !error;
}

export async function learnBrandVoice() {
  const db = supabase();
  const { data: assets } = await db
    .from('assets')
    .select('ai_description, vibes, garments')
    .not('ai_description', 'is', null)
    .limit(50);

  if (!assets?.length) return null;

  const descriptions = assets.map(a => a.ai_description).filter(Boolean).join('\n---\n');
  const vibeSet = new Set(assets.flatMap(a => a.vibes || []));
  const garmentSet = new Set(assets.flatMap(a => a.garments || []));

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Analyze this fashion brand's content library and extract the brand voice/style patterns.

ASSET DESCRIPTIONS:
${descriptions}

COMMON VIBES: ${[...vibeSet].join(', ')}
COMMON GARMENTS: ${[...garmentSet].join(', ')}

Respond with ONLY this JSON format:
{
  "tone": ["adjective1", "adjective2", "adjective3"],
  "vocabulary": ["frequently used word1", "word2"],
  "emoji_usage": "heavy|moderate|minimal",
  "hashtag_style": "description of hashtag preferences",
  "sentence_length": "short|medium|long",
  "personality_traits": ["trait1", "trait2", "trait3"]
}`,
    }],
  });

  const text = response.content[0]?.text || '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const learnedStyle = JSON.parse(jsonMatch[0]);

    const { data: existing } = await db.from('brand_voice').select('id').limit(1).single();
    if (existing) {
      await db.from('brand_voice')
        .update({ learned_style: learnedStyle, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await db.from('brand_voice').insert({ learned_style: learnedStyle });
    }
    return learnedStyle;
  } catch {
    return null;
  }
}

// ── Caption generation ────────────────────────────────────────────────────────

export async function generateCaptions(trend, matchedAssets) {
  const brandVoice = await getBrandVoice();

  const assetDescriptions = matchedAssets
    .map(ma => `- ${ma.slot_label}: ${ma.asset?.ai_description || 'styled fashion photo'}`)
    .join('\n');

  const voiceGuidelines = brandVoice ? `
BRAND VOICE GUIDELINES:
- Tone: ${brandVoice.learned_style?.tone?.join(', ') || 'warm, empowering, professional'}
- Personality: ${brandVoice.learned_style?.personality_traits?.join(', ') || 'confident, approachable, aspirational'}
- Emoji usage: ${brandVoice.learned_style?.emoji_usage || 'moderate'}
- Voice description: ${brandVoice.voice_description || 'A warm, empowering personal stylist who makes fashion accessible'}
${brandVoice.sample_captions?.length ? `- Example captions:\n${brandVoice.sample_captions.map(c => `  "${c}"`).join('\n')}` : ''}
` : `
BRAND VOICE GUIDELINES:
- Tone: warm, empowering, professional but approachable
- Personality: confident stylist who makes fashion accessible
- Emoji usage: moderate (✨, 💫, 🔥, 👗)
- Style: Short, punchy sentences. Speaks directly to the viewer.
`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are a social media caption writer for a personal styling brand.

TREND: ${trend.name}
HASHTAGS: ${trend.trending_hashtags?.join(' ') || ''}
TEMPLATE: ${trend.recipe?.template || 'general'}

ASSETS BEING USED:
${assetDescriptions}

${voiceGuidelines}

Generate exactly 3 caption variants and 2 text overlay suggestions.
Keep captions under 150 characters. Include relevant hashtags.
Text overlays should be very short (under 8 words) for on-screen display.

Respond with ONLY this JSON format:
{
  "captions": ["caption1", "caption2", "caption3"],
  "text_overlays": ["overlay1", "overlay2"]
}`,
    }],
  });

  const text = response.content[0]?.text || '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { captions: parsed.captions || [], textOverlays: parsed.text_overlays || [] };
    }
  } catch { /* fallback below */ }

  return {
    captions: [
      `${trend.name} ✨ ${trend.trending_hashtags?.[0] || ''}`,
      `Your style upgrade starts here 💫`,
      `POV: You hired a stylist 🔥`,
    ],
    textOverlays: [trend.name, 'Style transformed ✨'],
  };
}
