/**
 * Scout Agent
 * Discovers leads via DuckDuckGo Lite + Google News RSS (free, no API key required).
 * Port from ACS_LeadGen agents/scout/agent.py
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '../../../config/prompts/scout.txt');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }

// ── DuckDuckGo Lite (more reliable than HTML endpoint, no JS required) ─────────

async function ddgLite(query, maxResults = 6) {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encoded}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://lite.duckduckgo.com/',
      },
    });
    if (!res.ok) {
      console.warn(`[Scout] DDG lite returned ${res.status} for query: ${query.slice(0, 60)}`);
      return [];
    }
    const html = await res.text();

    const results = [];

    // DDG lite: <a class="result-link" href="URL">Title</a>
    // followed shortly by: <td class="result-snippet">Snippet</td>
    const linkRe   = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snipRe   = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;

    const links = [];
    let m;
    while ((m = linkRe.exec(html)) !== null && links.length < maxResults) {
      const url   = m[1].trim();
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      if (url.startsWith('http')) links.push({ url, title });
    }

    const snippets = [];
    while ((m = snipRe.exec(html)) !== null && snippets.length < maxResults) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
    }

    for (let i = 0; i < links.length; i++) {
      results.push({
        title:   links[i].title,
        url:     links[i].url,
        snippet: snippets[i] || '',
      });
    }

    console.log(`[Scout] DDG lite: ${results.length} results for "${query.slice(0, 50)}"`);
    return results;
  } catch (err) {
    console.error('[Scout] DDG lite error:', err.message);
    return [];
  }
}

// ── Google News RSS (reliable, free) ─────────────────────────────────────────

async function googleNewsRSS(query, maxResults = 6) {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(xml)) !== null && items.length < maxResults) {
      const block = m[1];
      const title   = (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/) || block.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim() || '';
      const link    = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1]?.trim() || '';
      const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]?.trim() || '';
      const desc    = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/) || block.match(/<description>([\s\S]*?)<\/description>/) || [])[1]
                        ?.replace(/<[^>]+>/g, '').trim() || '';
      if (title && link) items.push({ title, url: link, snippet: desc, date: pubDate });
    }
    console.log(`[Scout] Google News: ${items.length} results for "${query.slice(0, 50)}"`);
    return items;
  } catch (err) {
    console.error('[Scout] Google News RSS error:', err.message);
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
    const { data } = await supabase.from('leads').select('id').ilike('full_name', `%${personName}%`).limit(1);
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
    systemPrompt = `You are a scout for AC Styling, a personal fashion styling service for high-achieving women.
Evaluate whether this trigger event represents a potential high-value client who recently had a life change (promotion, new home, business launch, press feature).
Return ONLY valid JSON: {"qualified": true/false, "person_name": "Full Name or null", "first_name": "First Name or null", "trigger_summary": "one sentence", "linkedin_url": "url or null", "reason": "brief reason"}
Qualify if: there is a named real person with a clear trigger event. Reject if: no specific person named, or it's a company/brand announcement without a person.`;
  }

  const signalText = [
    `Source type: ${event.trigger_type || 'unknown'}`,
    `URL: ${event.url || ''}`,
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
    if (!jsonMatch) {
      console.warn('[Scout] qualify: no JSON in response:', raw.slice(0, 100));
      return { qualified: false, extraction: { reason: 'No JSON in response' }, tokensUsed };
    }
    const extraction = JSON.parse(jsonMatch[0]);
    console.log(`[Scout] qualify: ${extraction.qualified ? 'QUALIFIED' : 'rejected'} — ${extraction.person_name || '(no name)'} — ${extraction.reason}`);
    return { qualified: Boolean(extraction.qualified), extraction, tokensUsed };
  } catch (err) {
    console.error('[Scout] qualify error:', err.message);
    return { qualified: false, extraction: { reason: err.message }, tokensUsed: 0 };
  }
}

// ── Source fetching ───────────────────────────────────────────────────────────

async function fetchSource(sourceType, config) {
  // Support both formats:
  //   - Seeded sources: config.search_queries (array)
  //   - UI-created sources: config.query (string)
  const queries = config.search_queries
    || (config.query ? [config.query] : []);

  if (!queries.length) {
    console.warn('[Scout] Source has no queries in config:', JSON.stringify(config));
    return [];
  }

  const triggerType = config.trigger_type || (
    sourceType === 'zillow'           ? 'NEW_HOME' :
    sourceType === 'linkedin_google'  ? 'PROMOTION' :
    'PRESS_MENTION'
  );

  const results = [];

  for (const query of queries.slice(0, 5)) {
    let hits = [];

    if (sourceType === 'google_news') {
      hits = await googleNewsRSS(query, 6);
    } else {
      // linkedin_google, zillow — use DDG Lite
      hits = await ddgLite(query, 6);
    }

    results.push(...hits.map(h => ({ ...h, source_url: h.url, trigger_type: triggerType })));

    // Be polite — 1.5s between requests
    await new Promise(r => setTimeout(r, 1500));
  }

  return results;
}

// ── Lead creation ─────────────────────────────────────────────────────────────

async function createLead(event, extraction) {
  const { data, error } = await db().from('leads').insert({
    status: 'DISCOVERED',
    trigger_type:       event.trigger_type || 'PRESS_MENTION',
    trigger_source_url: event.source_url || event.url || null,
    trigger_summary:    extraction.trigger_summary || event.title || null,
    trigger_raw_data:   { title: event.title, snippet: event.snippet, date: event.date || null },
    full_name:          extraction.person_name || null,
    first_name:         extraction.first_name  || null,
    linkedin_url:       extraction.linkedin_url || null,
    instagram_url:      extraction.instagram_url || null,
    website_url:        extraction.website_url || null,
    priority:           5,
  }).select('id').single();

  if (error) {
    console.error('[Scout] Lead insert error:', error.message, '| fields:', JSON.stringify({
      trigger_type: event.trigger_type,
      trigger_source_url: event.source_url,
      full_name: extraction.person_name,
    }));
    return null;
  }
  return data.id;
}

// ── Default sources (used when DB has none) ───────────────────────────────────

const DEFAULT_SOURCES = [
  {
    name: 'Google News — Miami Women Leaders',
    source_type: 'google_news',
    config: {
      trigger_type: 'PRESS_MENTION',
      search_queries: [
        '"women who mean business" OR "women of influence" Miami 2025 OR 2026',
        '"40 under 40" OR "power women" Miami executive featured',
        'Miami Herald "women" executive named featured business 2026',
      ],
    },
  },
  {
    name: 'LinkedIn — Miami Executive Promotions',
    source_type: 'linkedin_google',
    config: {
      trigger_type: 'PROMOTION',
      search_queries: [
        'site:linkedin.com/in "promoted to" "vice president" OR "director" Miami 2026',
        'site:linkedin.com/in "excited to announce" "managing director" OR "chief" Miami 2026',
      ],
    },
  },
  {
    name: 'Google News — Miami Business Launches',
    source_type: 'google_news',
    config: {
      trigger_type: 'BRAND_LAUNCH',
      search_queries: [
        'launches boutique OR firm Miami luxury 2026',
        '"new venture" OR "new firm" executive Brickell OR "Coral Gables" 2026',
      ],
    },
  },
];

// ── Main exports ──────────────────────────────────────────────────────────────

export async function runScout() {
  const supabase = db();
  const t0 = Date.now();

  // Try to start a tracking run — but don't fail if agent_runs table missing
  let runId = null;
  try {
    const { data } = await supabase.from('agent_runs').insert({
      agent_name: 'scout',
      lead_id: null,
      run_status: 'running',
      input_snapshot: {},
      started_at: new Date().toISOString(),
    }).select('id').single();
    runId = data?.id;
  } catch { /* agent_runs table may not exist yet */ }

  try {
    // Load active sources from DB; fall back to defaults if none configured
    let sources = [];
    try {
      const { data, error } = await supabase
        .from('discovery_sources')
        .select('*')
        .eq('is_active', true);
      if (error) throw error;
      sources = data || [];
    } catch (err) {
      console.warn('[Scout] Could not load discovery_sources (table may not exist yet), using defaults:', err.message);
      sources = DEFAULT_SOURCES;
    }

    if (!sources.length) {
      console.warn('[Scout] No active discovery sources found — using built-in defaults');
      sources = DEFAULT_SOURCES;
    }

    console.log(`[Scout] Running ${sources.length} source(s)…`);

    const savedIds = [];
    let totalTokens = 0;

    for (const source of sources) {
      console.log(`[Scout] → Source: ${source.name}`);
      const events = await fetchSource(source.source_type, source.config || {});
      console.log(`[Scout]   fetched ${events.length} events`);

      for (const event of events) {
        // Skip if URL already in DB
        if (event.source_url && await isDuplicate(event.source_url, null)) {
          console.log(`[Scout]   skip (dup URL): ${event.source_url?.slice(0, 60)}`);
          continue;
        }

        const { qualified, extraction, tokensUsed } = await qualify(event);
        totalTokens += tokensUsed;
        if (!qualified) continue;

        // Skip if person name already in DB
        if (extraction.person_name && await isDuplicate(null, extraction.person_name)) {
          console.log(`[Scout]   skip (dup name): ${extraction.person_name}`);
          continue;
        }

        const leadId = await createLead(event, extraction);
        if (leadId) {
          savedIds.push(leadId);
          console.log(`[Scout]   ✓ Lead created: ${extraction.person_name || 'Unknown'} (${leadId})`);
        }
      }

      // Update last_run_at if source has an id (not a default fallback)
      if (source.id) {
        await supabase.from('discovery_sources')
          .update({ last_run_at: new Date().toISOString() })
          .eq('id', source.id);
      }
    }

    console.log(`[Scout] Done — ${savedIds.length} lead(s) created in ${Date.now() - t0}ms`);

    if (runId) {
      await supabase.from('agent_runs').update({
        run_status: 'completed',
        completed_at: new Date().toISOString(),
        output_snapshot: { leads_created: savedIds.length },
        tokens_used: totalTokens,
        duration_ms: Date.now() - t0,
      }).eq('id', runId);
    }

    return savedIds;
  } catch (err) {
    console.error('[Scout] Fatal error:', err.message);
    if (runId) {
      await supabase.from('agent_runs').update({
        run_status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: err.message,
        duration_ms: Date.now() - t0,
      }).eq('id', runId);
    }
    throw err;
  }
}

/**
 * Run a single source by ID.
 */
export async function runSourceById(sourceId) {
  const supabase = db();
  const { data: source, error } = await supabase.from('discovery_sources').select('*').eq('id', sourceId).single();
  if (error || !source) throw new Error(`Source ${sourceId} not found`);

  const t0 = Date.now();
  const savedIds = [];

  const events = await fetchSource(source.source_type, source.config || {});
  console.log(`[Scout] runSourceById: ${events.length} events from "${source.name}"`);

  for (const event of events) {
    if (event.source_url && await isDuplicate(event.source_url, null)) continue;
    const { qualified, extraction } = await qualify(event);
    if (!qualified) continue;
    if (extraction.person_name && await isDuplicate(null, extraction.person_name)) continue;
    const leadId = await createLead(event, extraction);
    if (leadId) {
      savedIds.push(leadId);
      console.log(`[Scout] Lead created: ${extraction.person_name || 'Unknown'}`);
    }
  }

  await supabase.from('discovery_sources')
    .update({ last_run_at: new Date().toISOString() })
    .eq('id', sourceId);

  return savedIds;
}

/**
 * Preview a query without creating leads.
 */
export async function previewQuery(sourceType, query, triggerType = 'PRESS_MENTION') {
  const config = { search_queries: [query], trigger_type: triggerType };
  const events = await fetchSource(sourceType, config);
  const results = [];
  for (const event of events) {
    const dup = event.source_url ? await isDuplicate(event.source_url, null) : false;
    const { qualified, extraction } = await qualify(event);
    results.push({
      title:     event.title,
      url:       event.source_url || event.url,
      snippet:   event.snippet,
      date:      event.date || '',
      duplicate: dup,
      qualified: qualified && !dup,
      person:    extraction.person_name || '',
      reason:    extraction.reason || '',
      trigger:   extraction.trigger_summary || '',
    });
  }
  return { results, qualified: results.filter(r => r.qualified) };
}
