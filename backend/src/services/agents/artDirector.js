/**
 * Art Director Agent
 * Port from ACS_LeadGen agents/art_director/agent.py
 * Profiles a DISCOVERED lead: scrapes web data, analyzes images, synthesizes with Claude.
 * Transitions: DISCOVERED → PROFILING → CURATED | REJECTED
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startRun, completeRun, failRun } from '../agentRunner.js';
import { transition, STATUS } from '../stateMachine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '../../../config/prompts/art_director.txt');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }

// ── Web scraping helpers ───────────────────────────────────────────────────────

async function fetchText(url, maxLen = 3000) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Strip HTML tags, collapse whitespace
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  } catch { return null; }
}

async function googleNewsSearch(query, maxResults = 5) {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`);
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRegex.exec(xml)) !== null && items.length < maxResults) {
      const item = m[1];
      const title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
      const link = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1]?.trim() || '';
      const desc = (item.match(/<description>([\s\S]*?)<\/description>/) || [])[1]?.replace(/<!\[CDATA\[|\]\]>|<[^>]+>/g, '').trim() || '';
      items.push({ title, url: link, snippet: desc });
    }
    return items;
  } catch { return []; }
}

async function analyzeImageUrl(imageUrl) {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const mediaType = validTypes.includes(contentType) ? contentType : 'image/jpeg';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Analyze this person\'s image for a fashion styling assessment. Describe: their current style, apparent aesthetic, any visible clothing details, and what styling opportunities you observe. Keep it professional and respectful. 2-3 sentences.' },
        ],
      }],
    });
    return response.content[0].text;
  } catch { return null; }
}

// ── Data gathering ────────────────────────────────────────────────────────────

async function gatherData(lead) {
  const gathered = {};
  const toolsCalled = [];

  async function call(toolName, fn) {
    const t = Date.now();
    try {
      const result = await fn();
      toolsCalled.push({ tool: toolName, duration_ms: Date.now() - t, success: !!result });
      return result;
    } catch (err) {
      toolsCalled.push({ tool: toolName, duration_ms: Date.now() - t, success: false, error: err.message });
      return null;
    }
  }

  const name = lead.full_name || lead.first_name || '';

  // LinkedIn profile page (direct scrape)
  if (lead.linkedin_url) {
    gathered.linkedin_text = await call('linkedin_scrape', () => fetchText(lead.linkedin_url, 2000));
  }

  // Trigger source page
  if (lead.trigger_source_url) {
    gathered.trigger_source = await call('trigger_source', () => fetchText(lead.trigger_source_url, 2000));
  }

  // Personal website
  if (lead.website_url) {
    gathered.website = await call('website', () => fetchText(lead.website_url, 2000));
  }

  // Google News search
  if (name) {
    gathered.news = await call('google_news', () => googleNewsSearch(`"${name}"`, 5));
  }

  // Image analysis
  if (lead.instagram_url) {
    // Extract profile pic from og:image if possible
    const igText = await fetchText(lead.instagram_url, 5000);
    if (igText) {
      const imgMatch = igText.match(/og:image.*?content="([^"]+)"/);
      if (imgMatch) {
        gathered.image_analysis = await call('image_analyzer', () => analyzeImageUrl(imgMatch[1]));
      }
    }
  }

  return { gathered, toolsCalled };
}

// ── LLM synthesis ─────────────────────────────────────────────────────────────

async function synthesize(lead, gathered) {
  let systemPrompt = '';
  try {
    systemPrompt = readFileSync(PROMPT_PATH, 'utf-8');
  } catch {
    systemPrompt = `You are an expert Art Director for AC Styling, a high-end personal fashion styling service.
Profile this lead and identify the styling gap. Return JSON with all fields:
{
  "full_name": "...", "first_name": "...", "title": "...", "company": "...", "location": "...",
  "linkedin_url": "...", "email": "...", "digital_footprint_summary": "...",
  "style_observations": "...", "styling_gap": "...",
  "styling_gap_confidence": "HIGH|MEDIUM|LOW",
  "sources": [{"url": "...", "summary": "..."}],
  "rejection_reason": "... (only if confidence is LOW)"
}`;
  }

  const userMessage = [
    '## Trigger Event',
    `Type: ${lead.trigger_type || 'PRESS_MENTION'}`,
    `Source URL: ${lead.trigger_source_url || 'Unknown'}`,
    `Summary: ${lead.trigger_summary || 'Unknown'}`,
    '',
    '## Known Identity',
    `Name: ${lead.full_name || 'Unknown'}`,
    `LinkedIn: ${lead.linkedin_url || 'Unknown'}`,
    `Instagram: ${lead.instagram_url || 'Unknown'}`,
    `Website: ${lead.website_url || 'Unknown'}`,
    '',
    '## Gathered Research',
    JSON.stringify(gathered, null, 2).slice(0, 4000),
    '',
    '---',
    'Produce your JSON output now.',
  ].join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0].text.trim();
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
  const jsonMatch = raw.match(/\{[\s\S]+\}/);
  if (!jsonMatch) throw new Error('Art Director response had no valid JSON');
  return { output: JSON.parse(jsonMatch[0]), reasoningTrace: raw, tokensUsed };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runArtDirector(leadId) {
  const supabase = db();
  const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single();
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  console.log(`[ArtDirector] Starting for ${lead.full_name || leadId}`);
  const t0 = Date.now();

  const run = await startRun('art_director', leadId, {
    trigger_type: lead.trigger_type,
    trigger_summary: lead.trigger_summary,
    full_name: lead.full_name,
  });

  // Transition to PROFILING
  await transition(leadId, STATUS.PROFILING, 'art_director', 'Starting profile research');

  try {
    const { gathered, toolsCalled } = await gatherData(lead);
    const { output, reasoningTrace, tokensUsed } = await synthesize(lead, gathered);

    const confidence = (output.styling_gap_confidence || 'LOW').toUpperCase();

    // Build profile updates
    const profileFields = {
      full_name: output.full_name,
      first_name: output.first_name,
      title: output.title,
      company: output.company,
      location: output.location,
      linkedin_url: output.linkedin_url,
      email: output.email,
      website_url: output.website_url,
      digital_footprint_summary: output.digital_footprint_summary,
      style_observations: output.style_observations,
      styling_gap: output.styling_gap,
      styling_gap_confidence: confidence,
      sources: output.sources || [],
      profile_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Strip nulls
    const cleanFields = Object.fromEntries(Object.entries(profileFields).filter(([, v]) => v != null));
    await supabase.from('leads').update(cleanFields).eq('id', leadId);

    await completeRun(run.id, {
      outputSnapshot: { confidence, styling_gap: output.styling_gap },
      reasoningTrace,
      tokensUsed,
      toolsCalled,
      durationMs: Date.now() - t0,
    });

    if (confidence === 'LOW') {
      const reason = output.rejection_reason || 'Low confidence styling gap — insufficient evidence.';
      await supabase.from('leads').update({ rejection_reason: reason, rejected_by: 'art_director' }).eq('id', leadId);
      return transition(leadId, STATUS.REJECTED, 'art_director', reason);
    }

    return transition(leadId, STATUS.CURATED, 'art_director',
      `${confidence} confidence gap: ${(output.styling_gap || '').slice(0, 120)}`);
  } catch (err) {
    await failRun(run.id, { errorMessage: err.message, durationMs: Date.now() - t0 });
    throw err;
  }
}
