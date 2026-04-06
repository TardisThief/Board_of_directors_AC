/**
 * Recipe Builder Service
 * Full port from ACS_ContentEngine recipe-builder.ts
 * Uses Claude to convert raw trend data into structured video recipes.
 */
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Build a structured recipe from raw trend data using Claude.
 * @param {object} trend - { name, hashtag, category, description, source_url }
 * @param {'b-roll'|'storytime'} mode
 * @returns {Promise<object>} TrendRecipe
 */
export async function buildRecipe(trend, mode = 'b-roll') {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are a social media content strategist specializing in fashion and styling content for TikTok and Instagram Reels.

Given this trending topic/hashtag, create a structured "recipe" for a short-form video that a personal stylist brand could use.

TREND: ${trend.name}
${trend.hashtag ? `HASHTAG: #${trend.hashtag}` : ''}
${trend.category ? `CATEGORY: ${trend.category}` : ''}
${trend.description ? `CONTEXT: ${trend.description}` : ''}

Create a recipe with these exact JSON fields. Respond ONLY with valid JSON, no other text:
{
  "template": "<template name like 'before-after', 'outfit-montage', 'get-ready-with-me', 'closet-tour', 'style-tips', 'transformation', 'rapid-outfits'>",
  "workflow_mode": "${mode}",
  "audio_mix": "${mode === 'storytime' ? 'preserve' : 'mute'}",
  "hook_duration_sec": <1-3>,
  "total_duration_sec": <10-30>,
  "audio_suggestion": "<trending song name or audio style suggestion or null>",
  "slots": [
    {
      "type": "image",
      "label": "<descriptive label like 'before', 'outfit-1', 'hero-shot'>",
      "vibes": ["<vibe1>", "<vibe2>", "<vibe3>"],
      "duration_sec": <2-8>
    }
  ],
  "text_overlays": [
    {
      "text": "<on-screen text>",
      "appear_at_sec": <number>,
      "duration_sec": <2-5>,
      "style": "bold-serif",
      "position": "bottom"
    }
  ],
  "transition": "<flash-cut|crossfade|slide|zoom>"
}

Requirements:
- Include 2-5 slots appropriate for a styling/fashion brand
- Vibes should be descriptive moods a stylist would understand
- Text overlays should be engaging and social-media-friendly
- Keep total duration between 10-30 seconds
- Make it feel authentic to the fashion/styling niche`,
    }],
  });

  const text = response.content[0]?.text || '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeRecipe(parsed, mode, trend.name);
  } catch {
    return getDefaultRecipe(trend.name, mode);
  }
}

function normalizeRecipe(parsed, mode, trendName) {
  const VALID_TRANSITIONS = ['flash-cut', 'crossfade', 'slide', 'zoom', 'none'];
  return {
    template: parsed.template || 'general',
    workflow_mode: parsed.workflow_mode || mode,
    audio_mix: parsed.audio_mix || (mode === 'storytime' ? 'preserve' : 'mute'),
    hook_duration_sec: Math.max(1, Math.min(5, parsed.hook_duration_sec || 3)),
    total_duration_sec: Math.max(5, Math.min(60, parsed.total_duration_sec || 15)),
    audio_suggestion: parsed.audio_suggestion || null,
    slots: (parsed.slots || []).map(s => ({
      type: s.type || 'image',
      label: s.label || 'shot',
      vibes: Array.isArray(s.vibes) ? s.vibes : [],
      duration_sec: Math.max(1, Math.min(15, s.duration_sec || 3)),
    })),
    text_overlays: (parsed.text_overlays || []).map(t => ({
      text: t.text || '',
      appear_at_sec: t.appear_at_sec || 0,
      duration_sec: t.duration_sec || 3,
      style: t.style || 'bold-serif',
      position: t.position || 'bottom',
    })),
    transition: VALID_TRANSITIONS.includes(parsed.transition) ? parsed.transition : 'crossfade',
  };
}

function getDefaultRecipe(trendName, mode) {
  return {
    template: 'general',
    workflow_mode: mode,
    audio_mix: mode === 'storytime' ? 'preserve' : 'mute',
    hook_duration_sec: 3,
    total_duration_sec: 15,
    audio_suggestion: null,
    slots: [
      { type: 'image', label: 'hook', vibes: ['eye-catching', 'professional', 'styled'], duration_sec: 3 },
      { type: 'image', label: 'main', vibes: ['fashionable', 'polished', 'elegant'], duration_sec: 5 },
      { type: 'image', label: 'close', vibes: ['aspirational', 'confident', 'stylish'], duration_sec: 4 },
    ],
    text_overlays: [
      { text: trendName, appear_at_sec: 0, duration_sec: 3, style: 'bold-serif', position: 'center' },
    ],
    transition: 'crossfade',
  };
}
