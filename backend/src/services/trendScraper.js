/**
 * Trend Scraper Service
 * Full port from ACS_ContentEngine trend-scraper.ts + recipe-builder.ts
 * Pipeline: Scrape TikTok CC → Classify (Claude) → Build Recipes → Store
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { buildRecipe } from './recipeBuilder.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

const FASHION_KEYWORDS = [
  'fashion', 'style', 'outfit', 'ootd', 'clothing', 'wardrobe',
  'closet', 'dress', 'accessories', 'beauty', 'glam', 'chic',
  'trendy', 'lookbook', 'styling', 'getreadywithme', 'grwm',
  'transformation', 'glow', 'makeover', 'aesthetic', 'capsule',
  'professional', 'workwear', 'casual', 'elegant', 'streetstyle',
  'luxury', 'designer', 'thrift', 'haul', 'tryOn', 'fitcheck',
  'fitCheck', 'fashiontiktok', 'styleinspo', 'outfitinspo',
];

// ── Scraping ──────────────────────────────────────────────────────────────────

async function scrapeHashtagTrends() {
  const trends = [];
  try {
    const url = 'https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en?countryCode=US&period=7';
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      console.warn('[TrendScraper] TikTok CC returned:', response.status);
      return [];
    }

    const html = await response.text();
    const hashtagPattern = /hashtag\/([a-zA-Z0-9_]+)\/pc/g;
    let match;
    const seen = new Set();

    while ((match = hashtagPattern.exec(html)) !== null) {
      const hashtag = match[1];
      if (!seen.has(hashtag)) {
        seen.add(hashtag);
        trends.push({
          name: hashtag.replace(/([A-Z])/g, ' $1').trim(),
          hashtag,
          category: 'general',
          source_url: `https://ads.tiktok.com/business/creativecenter/hashtag/${hashtag}/pc/en`,
        });
      }
    }
  } catch (err) {
    console.error('[TrendScraper] Scrape error:', err.message);
  }
  return trends;
}

// ── Fashion classification ────────────────────────────────────────────────────

async function classifyTrends(trends) {
  if (trends.length === 0) return [];

  // Pre-filter by keywords
  const preFiltered = trends.filter(t =>
    FASHION_KEYWORDS.some(kw => t.hashtag.toLowerCase().includes(kw))
  );
  const unclassified = trends.filter(t => !preFiltered.includes(t));

  const classified = preFiltered.map(t => ({
    ...t,
    is_fashion: true,
    fashion_description: `Fashion trend: #${t.hashtag}`,
    heat_score: 80,
  }));

  if (unclassified.length > 0) {
    const hashtagList = unclassified.map(t => `#${t.hashtag}`).join(', ');
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `You are a fashion/styling content strategist. For each hashtag below, determine if it could be relevant for a personal styling brand creating fashion content for TikTok/Reels.

Hashtags: ${hashtagList}

Respond with ONLY a JSON array. Include only fashion-relevant hashtags. Skip non-relevant ones.
[{"hashtag": "example", "description": "how a stylist could use this", "heat_score": 75}]

heat_score: 60-100 based on how well it fits fashion/styling content. Be selective.`,
        }],
      });

      const text = response.content[0]?.text || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const fashionTrends = JSON.parse(jsonMatch[0]);
        for (const ft of fashionTrends) {
          const original = unclassified.find(t => t.hashtag.toLowerCase() === ft.hashtag.toLowerCase());
          if (original) {
            classified.push({
              ...original,
              is_fashion: true,
              fashion_description: ft.description || '',
              heat_score: ft.heat_score || 70,
            });
          }
        }
      }
    } catch (err) {
      console.error('[TrendScraper] Classification error:', err.message);
    }
  }

  return classified.filter(t => t.is_fashion);
}

// ── Seed trends ───────────────────────────────────────────────────────────────

function getSeedTrends() {
  return [
    { name: 'Before After Transformation', hashtag: 'glowup', category: 'fashion',
      source_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/glowup/pc/en' },
    { name: 'Get Ready With Me', hashtag: 'grwm', category: 'fashion',
      source_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/grwm/pc/en' },
    { name: 'Outfit Of The Day', hashtag: 'ootd', category: 'fashion',
      source_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/ootd/pc/en' },
    { name: 'Closet Organization', hashtag: 'closetorganization', category: 'lifestyle',
      source_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/closetorganization/pc/en' },
    { name: 'Style Tips Professional', hashtag: 'workwear', category: 'fashion',
      source_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/workwear/pc/en' },
    { name: 'Capsule Wardrobe', hashtag: 'capsulewardrobe', category: 'fashion',
      source_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/capsulewardrobe/pc/en' },
    { name: 'Fit Check', hashtag: 'fitcheck', category: 'fashion',
      source_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/fitcheck/pc/en' },
    { name: 'Style Inspo', hashtag: 'styleinspo', category: 'fashion',
      source_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/styleinspo/pc/en' },
  ];
}

function getStorytimeSeedTrends() {
  return [
    { name: 'My Styling Journey', hashtag: 'storytime', category: 'fashion', source_url: '' },
    { name: 'Stop Wearing This Mistake', hashtag: 'styletips', category: 'fashion', source_url: '' },
    { name: 'How I Built My Wardrobe', hashtag: 'wardrobetour', category: 'fashion', source_url: '' },
    { name: 'What To Wear When You Hate Everything', hashtag: 'fashionstruggles', category: 'fashion', source_url: '' },
  ];
}

// ── Main exports ──────────────────────────────────────────────────────────────

export async function refreshTrends(mode = 'b-roll') {
  const db = supabase();
  const errors = [];

  // Deactivate expired trends
  await db.from('trends').update({ is_active: false }).lt('expires_at', new Date().toISOString());

  // Fetch raw trends
  let allTrends = [];
  if (mode === 'storytime') {
    allTrends = getStorytimeSeedTrends();
  } else {
    const scraped = await scrapeHashtagTrends();
    const seeds = getSeedTrends();
    allTrends = scraped.length >= 5 ? scraped : [...scraped, ...seeds];
  }

  // Classify for fashion relevance
  const fashionTrends = await classifyTrends(allTrends);

  let saved = 0;
  for (const trend of fashionTrends.slice(0, 10)) {
    try {
      const recipe = await buildRecipe({
        name: trend.name,
        hashtag: trend.hashtag,
        category: trend.category,
        description: trend.fashion_description || '',
        source_url: trend.source_url,
      }, mode);

      // Deactivate old versions of same trend
      await db.from('trends').update({ is_active: false }).ilike('name', `%${trend.hashtag}%`);

      const { error } = await db.from('trends').insert({
        name: trend.name || `#${trend.hashtag}`,
        platform: 'tiktok',
        source_url: trend.source_url,
        category: 'fashion',
        heat_score: trend.heat_score || 70,
        recipe,
        trending_hashtags: [`#${trend.hashtag}`],
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        is_active: true,
      });

      if (error) {
        errors.push(`Failed to save #${trend.hashtag}: ${error.message}`);
      } else {
        saved++;
      }
    } catch (err) {
      errors.push(`Recipe build failed for #${trend.hashtag}: ${err.message}`);
    }
  }

  return {
    trends_found: allTrends.length,
    fashion_relevant: fashionTrends.length,
    saved,
    errors,
  };
}

export async function getActiveTrends() {
  const db = supabase();
  const { data } = await db
    .from('trends')
    .select('*')
    .eq('is_active', true)
    .order('heat_score', { ascending: false })
    .limit(20);
  return data || [];
}
