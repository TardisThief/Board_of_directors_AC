/**
 * Scout Agent
 * Port from ACS_LeadGen agents/scout/agent.py
 * Discovers leads via DuckDuckGo search (free, no API key) from configured discovery sources.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startRun, completeRun, failRun } from '../agentRunner.js';
import { transition, STATUS } from '../stateMachine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '../../../config/prompts/scout.txt');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }

// ── DuckDuckGo search (free, no API key) ─────────────────────────────────────

async function ddgText(query, maxResults = 5) {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();

    const results = [];
    const linkRegex = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const titles = [];
    const urls = [];
    const snippets = [];

    let m;
    while ((m = linkRegex.exec(html)) !== null && titles.length < maxResults) {
      const rawUrl = m[1];
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      // DuckDuckGo wraps URLs — extract actual URL from uddg param
      const uddg = rawUrl.match(/uddg=([^&]+)/);
      const url = uddg ? decodeURIComponent(uddg[1]) : rawUrl;
      if (url.startsWith('http')) {
        titles.push(title);
        urls.push(url);
      }
    }
    while ((m = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
    }

    for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
      results.push({ title: titles[i] || '', url: urls[i] || '', snippet: snippets[i] || '' });
    }
    return results;
  } catch (err) {
    console.error('[Scout] DDG text search error:', err.message);
    return [];
  }
}

async function ddgNews(query, maxResults = 5) {
  // Use Google News RSS as a reliable free news source
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRegex.exec(xml)) !== null && items.length < maxResults) {
      const item = m[1];
      const title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
      const link = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1]?.trim() || '';
      const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]?.trim() || '';
      const desc = (item.match(/<description>([\s\S]*?)<\/description>/) || [])[1]?.replace(/<!\[CDATA\[|\]\]>|<[^>]+>/g, '').trim() || '';
      items.push({ title, url: link, snippet: desc, date: pubDate, source: 'google_news' });
    }
    return items;
  } catch (err) {
    console.error('[Scout] News search error:', err.message);
    return [];
  }
}

// ── Deduplication ─────────────────────────────────────────────────────────────

async function isDuplicate(url, personName) {
  const supabase = db();
  if (url) {
    const { data } = await supabase.from('leads').select('id').eq('trigger_source_url', url).limit(1);
    if (data?.length) return true;
  }
  if (personName) {
    const { data } = await supabase.from('leads')
      .select('id')
      .ilike('full_name', personName)
      .limit(1);
    if (data?.length) return true;
  }
  return false;
}

// ── LLM qualification ─────────────────────────────────────────────────────────

async function qualify(event) {
  let systemPrompt = '';
  try {
    systemPrompt = readFileSync(PROMPT_PATH, 'utf-8');
  } catch {
    systemPrompt = `You are a scout for AC Styling, a personal fashion styling service.
Evaluate whether this trigger event represents a potential high-value client.
Return JSON: {"qualified": bool, "person_name": "...", "first_name": "...", "trigger_summary": "...", "linkedin_url": "...", "reason": "..."}`;
  }

  const signalText = [
    `Source type: ${event.trigger_type || 'unknown'}`,
    `URL: ${event.source_url || ''}`,
    `Title: ${event.title || ''}`,
    `Snippet: ${event.snippet || ''}`,
    `Date: ${event.date || ''}`,
  ].join('\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: signalText }],
    });
    const raw = response.content[0].text.trim();
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
    const jsonMatch = raw.match(/\{[\s\S]+\}/);
    if (!jsonMatch) return { qualified: false, extraction: { reason: 'No JSON in response' }, tokensUsed };
    const extraction = JSON.parse(jsonMatch[0]);
    return { qualified: Boolean(extraction.qualified), extraction, tokensUsed };
  } catch (err) {
    return { qualified: false, extraction: { reason: err.message }, tokensUsed: 0 };
  }
}

// ── Source fetching ───────────────────────────────────────────────────────────

async function fetchSource(sourceType, config) {
  const queries = config.search_queries || [];
  const results = [];

  for (const query of queries.slice(0, 5)) {
    let hits = [];
    if (sourceType === 'zillow') {
      hits = await ddgText(query, 5);
      hits = hits.map(h => ({ ...h, trigger_type: 'BRAND_LAUNCH', source_url: h.url }));
    } else if (sourceType === 'linkedin_google') {
      hits = await ddgText(query, 5);
      hits = hits.map(h => ({ ...h, trigger_type: 'PROMOTION', source_url: h.url }));
    } else if (sourceType === 'google_news') {
      hits = await ddgNews(query, 5);
      hits = hits.map(h => ({ ...h, trigger_type: config.trigger_type || 'PRESS_MENTION', source_url: h.url }));
    }
    results.push(...hits);
    // Rate limit
    await new Promise(r => setTimeout(r, 1200));
  }

  return results;
}

// ── Lead creation ─────────────────────────────────────────────────────────────

async function createLead(event, extraction) {
  const { data, error } = await db().from('leads').insert({
    status: STATUS.DISCOVERED,
    trigger_type: event.trigger_type || 'PRESS_MENTION',
    trigger_source_url: event.source_url || null,
    trigger_summary: extraction.trigger_summary || event.title || null,
    trigger_raw_data: { title: event.title, snippet: event.snippet, date: event.date },
    full_name: extraction.person_name || null,
    first_name: extraction.first_name || null,
    linkedin_url: extraction.linkedin_url || null,
    instagram_url: extraction.instagram_url || null,
    website_url: extraction.website_url || null,
    priority: 5,
  }).select('id').single();

  if (error) {
    console.error('[Scout] Lead insert error:', error.message);
    return null;
  }
  return data.id;
}

// ── Main exports ──────────────────────────────────────────────────────────────

export async function runScout() {
  const supabase = db();
  const t0 = Date.now();
  const run = await startRun('scout', null, {});

  try {
    const { data: sources } = await supabase
      .from('discovery_sources')
      .select('*')
      .eq('is_active', true);

    if (!sources?.length) {
      await completeRun(run.id, { outputSnapshot: { leads_created: 0 }, durationMs: Date.now() - t0 });
      return [];
    }

    const savedIds = [];
    let totalTokens = 0;

    for (const source of sources) {
      console.log(`[Scout] Running source: ${source.name}`);
      const events = await fetchSource(source.source_type, source.config || {});

      for (const event of events) {
        const dup = await isDuplicate(event.source_url, null);
        if (dup) continue;

        const { qualified, extraction, tokensUsed } = await qualify(event);
        totalTokens += tokensUsed;
        if (!qualified) continue;

        const dup2 = await isDuplicate(null, extraction.person_name);
        if (dup2) continue;

        const leadId = await createLead(event, extraction);
        if (leadId) {
          savedIds.push(leadId);
          console.log(`[Scout] Lead created: ${extraction.person_name || 'Unknown'}`);
        }
      }

      // Mark source as run
      await supabase.from('discovery_sources')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', source.id);
    }

    await completeRun(run.id, {
      outputSnapshot: { leads_created: savedIds.length },
      tokensUsed: totalTokens,
      durationMs: Date.now() - t0,
    });

    return savedIds;
  } catch (err) {
    await failRun(run.id, { errorMessage: err.message, durationMs: Date.now() - t0 });
    throw err;
  }
}

/**
 * Run a single source by ID. Returns lead IDs created.
 */
export async function runSourceById(sourceId) {
  const supabase = db();
  const { data: source } = await supabase.from('discovery_sources').select('*').eq('id', sourceId).single();
  if (!source) throw new Error('Source not found');

  const t0 = Date.now();
  const run = await startRun('scout', null, { source_id: sourceId, source_name: source.name });
  const savedIds = [];

  try {
    const events = await fetchSource(source.source_type, source.config || {});
    for (const event of events) {
      if (await isDuplicate(event.source_url, null)) continue;
      const { qualified, extraction } = await qualify(event);
      if (!qualified) continue;
      if (await isDuplicate(null, extraction.person_name)) continue;
      const leadId = await createLead(event, extraction);
      if (leadId) savedIds.push(leadId);
    }
    await supabase.from('discovery_sources').update({ last_run_at: new Date().toISOString() }).eq('id', sourceId);
    await completeRun(run.id, { outputSnapshot: { leads_created: savedIds.length }, durationMs: Date.now() - t0 });
    return savedIds;
  } catch (err) {
    await failRun(run.id, { errorMessage: err.message, durationMs: Date.now() - t0 });
    throw err;
  }
}

/**
 * Preview a query without creating leads.
 */
export async function previewQuery(sourceType, query, triggerType = 'PRESS_MENTION') {
  const config = { search_queries: [query], trigger_type: triggerType };
  const events = await fetchSource(sourceType, config);
  const results = [];
  for (const event of events) {
    const dup = await isDuplicate(event.source_url, null);
    const { qualified, extraction, tokensUsed } = await qualify(event);
    results.push({
      title: event.title,
      url: event.source_url,
      snippet: event.snippet,
      date: event.date || '',
      duplicate: dup,
      qualified: qualified && !dup,
      person: extraction.person_name || '',
      reason: extraction.reason || '',
      trigger: extraction.trigger_summary || '',
    });
  }
  return { results, qualified: results.filter(r => r.qualified) };
}
