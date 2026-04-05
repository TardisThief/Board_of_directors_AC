/**
 * Trend Scraper Service
 * Ported from ACS_ContentEngine — scrapes TikTok/Instagram trends via Puppeteer
 * then uses Claude to structure them into recipe format
 */
import puppeteer from 'puppeteer';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

async function scrapeWithBrowser(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    );
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body.innerText);
    return text.slice(0, 6000);
  } finally {
    await browser.close();
  }
}

async function structureTrend(rawText, platform, sourceUrl) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are analyzing social media content for a fashion stylist (AC Styling). Extract styling/fashion trends from this raw page text.

Platform: ${platform}
Source: ${sourceUrl}

Raw text:
${rawText}

Return a JSON array of trends (max 5):
[{
  "name": "trend name",
  "category": "styling category",
  "heat_score": 1-100,
  "trending_hashtags": ["#tag1", "#tag2"],
  "recipe": {
    "slots": [{"label": "Opening hook", "duration_sec": 2}, {"label": "Main look", "duration_sec": 5}],
    "total_duration_sec": 15,
    "transition": "cut",
    "audio_mix": "trending",
    "audio_suggestion": "describe ideal audio vibe",
    "text_overlays": [{"text": "example overlay", "appear_at_sec": 0}]
  }
}]

Only include fashion/styling relevant trends. Return empty array if none found.`,
    }],
  });

  try {
    const text = response.content[0].text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

const TREND_SOURCES = [
  { url: 'https://www.tiktok.com/tag/outfitinspo', platform: 'tiktok', category: 'outfit' },
  { url: 'https://www.tiktok.com/tag/stylingtips', platform: 'tiktok', category: 'styling' },
  { url: 'https://www.tiktok.com/tag/fashiontrends', platform: 'tiktok', category: 'trends' },
];

export async function refreshTrends(mode = 'b-roll') {
  const db = supabase();
  const results = [];

  // Deactivate expired trends
  await db.from('trends')
    .update({ is_active: false })
    .lt('expires_at', new Date().toISOString());

  for (const source of TREND_SOURCES) {
    try {
      const raw = await scrapeWithBrowser(source.url);
      const trends = await structureTrend(raw, source.platform, source.url);

      for (const trend of trends) {
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data } = await db.from('trends').insert({
          name: trend.name,
          platform: source.platform,
          source_url: source.url,
          category: trend.category || source.category,
          heat_score: trend.heat_score || 50,
          recipe: trend.recipe || {},
          trending_hashtags: trend.trending_hashtags || [],
          expires_at: expiresAt,
          is_active: true,
        }).select('id').single();

        if (data) results.push({ ...trend, id: data.id });
      }
    } catch (err) {
      console.error(`Trend scrape failed for ${source.url}:`, err.message);
    }
  }

  return results;
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
