/**
 * Copywriter Agent
 * Port from ACS_LeadGen agents/copywriter/agent.py
 * Drafts personalized outreach emails with brand voice enforcement.
 * Transitions: CURATED → DRAFTED
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startRun, completeRun, failRun } from '../agentRunner.js';
import { transition, STATUS } from '../stateMachine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH       = join(__dirname, '../../../config/prompts/copywriter.txt');
const FORBIDDEN_PATH    = join(__dirname, '../../../config/brand_voice/forbidden_phrases.txt');
const EXAMPLES_PATH     = join(__dirname, '../../../config/brand_voice/approved_emails.json');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_WORDS = 180;
const MAX_RETRIES = 1;

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }

// ── Brand voice helpers ────────────────────────────────────────────────────────

function loadForbiddenPhrases() {
  try {
    return readFileSync(FORBIDDEN_PATH, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch { return []; }
}

function loadApprovedExamples() {
  try {
    return JSON.parse(readFileSync(EXAMPLES_PATH, 'utf-8'));
  } catch { return []; }
}

function checkForbidden(text, forbiddenPhrases) {
  const lower = text.toLowerCase();
  return forbiddenPhrases.filter(phrase => lower.includes(phrase.toLowerCase()));
}

function formatExamplesForPrompt(examples) {
  if (!examples?.length) return '';
  return examples.map(ex => [
    `Example (${ex.trigger_type || 'example'}):`,
    `Subject: ${ex.subject || ''}`,
    `---`,
    ex.body_text || ex.body || '',
    '---',
  ].join('\n')).join('\n\n');
}

function formatLeadBrief(lead) {
  return [
    `Name: ${lead.full_name || 'Unknown'}`,
    `First name: ${lead.first_name || (lead.full_name?.split(' ')[0]) || 'there'}`,
    `Title: ${lead.title || 'Unknown'}`,
    `Company: ${lead.company || 'Unknown'}`,
    `Location: ${lead.location || 'Unknown'}`,
    `Trigger event: ${lead.trigger_summary || 'Unknown'}`,
    `Digital footprint: ${lead.digital_footprint_summary || 'Not available'}`,
    `Style observations: ${lead.style_observations || 'Not available'}`,
    `Styling gap: ${lead.styling_gap || 'Unknown'}`,
    `Styling gap confidence: ${lead.styling_gap_confidence || 'Unknown'}`,
  ].join('\n');
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runCopywriter(leadId) {
  const supabase = db();
  const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single();
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const missing = ['styling_gap', 'trigger_summary', 'digital_footprint_summary']
    .filter(f => !lead[f]);
  if (missing.length) throw new Error(`Lead missing required fields: ${missing.join(', ')}`);

  console.log(`[Copywriter] Starting for ${lead.full_name || leadId}`);
  const t0 = Date.now();

  const run = await startRun('copywriter', leadId, {
    full_name: lead.full_name,
    trigger_type: lead.trigger_type,
    styling_gap: lead.styling_gap,
  });

  try {
    // Load brand voice config
    const forbidden = loadForbiddenPhrases();
    const examples = loadApprovedExamples();
    const profileBrief = formatLeadBrief(lead);

    // Build system prompt
    let systemPrompt = '';
    try {
      systemPrompt = readFileSync(PROMPT_PATH, 'utf-8');
    } catch {
      systemPrompt = `You are a copywriter for AC Styling, a high-end personal styling service.
Draft a warm, personalized cold email. Respond with JSON:
{"subject": "...", "body_text": "...", "tone_notes": "..."}`;
    }

    const forbiddenBlock = forbidden.map(p => `- ${p}`).join('\n');
    const examplesBlock = formatExamplesForPrompt(examples);
    systemPrompt = systemPrompt
      .replace('{forbidden_phrases}', forbiddenBlock)
      .replace('{approved_examples}', examplesBlock);

    // Draft with retry
    let output = {};
    let lastRaw = '';
    let totalTokens = 0;
    let violations = [];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let retryNote = '';
      if (attempt > 0 && violations.length) {
        retryNote = `\n\nIMPORTANT — your previous draft used forbidden phrases. Rewrite without: ${violations.join(', ')}. Avoid synonyms too.`;
      }

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `## Lead Brief\n\n${profileBrief}${retryNote}\n\n---\nWrite the email now.`,
        }],
      });

      const raw = response.content[0].text.trim();
      totalTokens += response.usage.input_tokens + response.usage.output_tokens;
      lastRaw = raw;

      const jsonMatch = raw.match(/\{[\s\S]+\}/);
      if (!jsonMatch) throw new Error('Copywriter response had no valid JSON');
      output = JSON.parse(jsonMatch[0]);

      violations = checkForbidden(
        `${output.body_text || ''} ${output.subject || ''}`,
        forbidden
      );

      if (!violations.length) break;

      console.warn(`[Copywriter] Forbidden phrases on attempt ${attempt + 1}:`, violations);
      if (attempt === MAX_RETRIES) {
        // Advisory note after failed retry
        const existing = output.tone_notes || '';
        output.tone_notes = `${existing} [Advisory: forbidden phrases after ${MAX_RETRIES + 1} attempts — ${violations.join(', ')}. Review before sending.]`.trim();
      }
    }

    // Word count check
    const wordCount = (output.body_text || '').split(/\s+/).length;
    if (wordCount > MAX_WORDS) {
      const existing = output.tone_notes || '';
      output.tone_notes = `${existing} [Advisory: ${wordCount} words — over ${MAX_WORDS}-word limit. Trim before sending.]`.trim();
    }

    // Derive HTML from plain text
    const paragraphs = (output.body_text || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const bodyHtml = paragraphs.map(p => `<p>${p}</p>`).join('\n');

    await supabase.from('leads').update({
      email_subject: output.subject,
      email_body_text: output.body_text,
      email_body_html: bodyHtml,
      tone_notes: output.tone_notes || null,
      draft_created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', leadId);

    await completeRun(run.id, {
      outputSnapshot: { subject: output.subject, word_count: wordCount },
      reasoningTrace: lastRaw,
      tokensUsed: totalTokens,
      durationMs: Date.now() - t0,
    });

    return transition(leadId, STATUS.DRAFTED, 'copywriter', 'Email draft created');
  } catch (err) {
    await failRun(run.id, { errorMessage: err.message, durationMs: Date.now() - t0 });
    throw err;
  }
}
