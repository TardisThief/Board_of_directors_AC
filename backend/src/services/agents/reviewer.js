/**
 * Reviewer Agent
 * Port from ACS_LeadGen agents/reviewer/agent.py + tools/
 * Runs deterministic checks, jargon check, and LLM holistic review on drafted emails.
 * Transitions: DRAFTED → REVIEW | REJECTED
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startRun, completeRun, failRun } from '../agentRunner.js';
import { transition, STATUS } from '../stateMachine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH    = join(__dirname, '../../../config/prompts/reviewer.txt');
const FORBIDDEN_PATH = join(__dirname, '../../../config/brand_voice/forbidden_phrases.txt');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const WORD_TARGET   = 180;
const WORD_HARD_CAP = 220;
const SUBJECT_MAX   = 60;

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }

// ── Deterministic checks (port of quality_checks.py) ──────────────────────────

function runDeterministicChecks(subject, body) {
  const flags = [];

  // Body present
  if (!body || body.trim().length < 50) {
    flags.push({ severity: 'CRITICAL', message: 'Email body is missing or too short to be a real draft.' });
  }

  // Subject
  if (!subject?.trim()) {
    flags.push({ severity: 'CRITICAL', message: 'Subject line is missing.' });
  } else if (subject.length > SUBJECT_MAX) {
    flags.push({ severity: 'SOFT', message: `Subject is ${subject.length} chars — over the ${SUBJECT_MAX}-char guideline.` });
  }

  // Word count
  const wc = (body || '').split(/\s+/).filter(Boolean).length;
  if (wc > WORD_HARD_CAP) {
    flags.push({ severity: 'CRITICAL', message: `Email body is ${wc} words — over the ${WORD_HARD_CAP}-word hard cap.` });
  } else if (wc > WORD_TARGET) {
    flags.push({ severity: 'SOFT', message: `Email body is ${wc} words — over the ${WORD_TARGET}-word target. Consider trimming.` });
  }

  // Sign-off
  if (body && !body.toLowerCase().includes('alejandra')) {
    flags.push({ severity: 'SOFT', message: "Sign-off does not include 'Alejandra' — verify the closing is in her voice." });
  }

  return flags;
}

// ── Jargon check (port of jargon_checker.py) ─────────────────────────────────

function runJargonCheck(subject, body) {
  let forbidden = [];
  try {
    forbidden = readFileSync(FORBIDDEN_PATH, 'utf-8')
      .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } catch { return []; }

  const text = `${subject || ''} ${body || ''}`.toLowerCase();
  const violations = forbidden.filter(phrase => text.includes(phrase.toLowerCase()));
  return violations.map(v => ({ severity: 'SOFT', message: `Forbidden phrase detected: "${v}"` }));
}

// ── LLM holistic review ───────────────────────────────────────────────────────

async function llmReview(lead, subject, body) {
  let systemPrompt = '';
  try {
    systemPrompt = readFileSync(PROMPT_PATH, 'utf-8');
  } catch {
    systemPrompt = `You are a quality reviewer for AC Styling email outreach.
Check the draft email for: gap reference, trigger reference, tone, personalization.
Return a JSON array of flags: [{"severity": "CRITICAL|SOFT", "message": "..."}]
Return [] if the email is good.`;
  }

  const userMessage = [
    '## Lead Brief',
    `Name: ${lead.full_name}`,
    `Title: ${lead.title || 'Unknown'}`,
    `Trigger event: ${lead.trigger_summary || 'Unknown'}`,
    `Styling gap: ${lead.styling_gap || 'Unknown'}`,
    '',
    '## Draft Email',
    `Subject: ${subject}`,
    '',
    body,
    '',
    '---',
    'Return your review flags as a JSON array now.',
  ].join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0].text.trim();
  const tokens = response.usage.input_tokens + response.usage.output_tokens;
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { flags: [], tokens };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const flags = parsed
      .filter(f => f.severity && f.message)
      .map(f => ({ severity: f.severity.toUpperCase(), message: f.message }));
    return { flags, tokens };
  } catch {
    return { flags: [], tokens };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runReviewer(leadId) {
  const supabase = db();
  const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single();
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  console.log(`[Reviewer] Starting for ${lead.full_name || leadId}`);
  const t0 = Date.now();

  const subject = lead.email_subject || '';
  const body    = lead.email_body_text || '';

  const run = await startRun('reviewer', leadId, {
    full_name: lead.full_name,
    email_subject: subject,
    word_count: body.split(/\s+/).filter(Boolean).length,
  });

  try {
    // 1. Deterministic checks
    const deterministicFlags = runDeterministicChecks(subject, body);

    // 2. Jargon check
    const jargonFlags = runJargonCheck(subject, body);

    // 3. LLM holistic review (only if body is present)
    let llmFlags = [];
    let llmTokens = 0;
    if (body.trim()) {
      const result = await llmReview(lead, subject, body);
      llmFlags = result.flags;
      llmTokens = result.tokens;
    }

    const allFlags = [...deterministicFlags, ...jargonFlags, ...llmFlags];
    const hasCritical = allFlags.some(f => f.severity === 'CRITICAL');
    const softCount = allFlags.filter(f => f.severity === 'SOFT').length;

    await supabase.from('leads').update({
      review_flags: allFlags.length ? allFlags : null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', leadId);

    await completeRun(run.id, {
      outputSnapshot: {
        critical: allFlags.filter(f => f.severity === 'CRITICAL').length,
        soft: softCount,
        flags: allFlags,
      },
      tokensUsed: llmTokens,
      durationMs: Date.now() - t0,
    });

    if (hasCritical) {
      const criticalMsgs = allFlags.filter(f => f.severity === 'CRITICAL').map(f => f.message);
      const reason = 'Reviewer: critical quality issues — ' + criticalMsgs.join('; ');
      await supabase.from('leads').update({ rejection_reason: reason, rejected_by: 'reviewer_agent' }).eq('id', leadId);
      return transition(leadId, STATUS.REJECTED, 'reviewer', reason.slice(0, 300));
    }

    const reason = softCount
      ? `Passed review with ${softCount} advisory note(s)`
      : 'Passed review — no flags';
    return transition(leadId, STATUS.REVIEW, 'reviewer', reason);
  } catch (err) {
    await failRun(run.id, { errorMessage: err.message, durationMs: Date.now() - t0 });
    throw err;
  }
}
