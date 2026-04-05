/**
 * Command module — general chat with live KPI context
 * Replaces the old boardroom route with a module-aware version
 */
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { createClient as createLabClient } from '@supabase/supabase-js';
import { assembleAgentContext } from '../../vault/reader.js';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }
function labDb() {
  return createLabClient(process.env.AC_LAB_SUPABASE_URL, process.env.AC_LAB_SUPABASE_SERVICE_KEY);
}

async function getKPIs() {
  const supabase = db();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

  const [
    { data: financeEntries },
    { count: leadsInReview },
    { count: scheduledPosts },
    { data: recentAssets },
  ] = await Promise.all([
    supabase.from('financial_entries').select('type, amount').gte('date', monthStart),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'REVIEW'),
    supabase.from('content_schedule').select('id', { count: 'exact', head: true }).eq('status', 'scheduled'),
    supabase.from('assets').select('id').order('created_at', { ascending: false }).limit(1),
  ]);

  const income = (financeEntries || []).filter(e => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0);
  const expenses = (financeEntries || []).filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0);

  // AC Lab metrics (non-critical, best effort)
  let labMetrics = {};
  try {
    const lab = labDb();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: recentPurchases } = await lab.from('purchases').select('id', { count: 'exact', head: true }).gte('created_at', since7d);
    labMetrics = { recentPurchases: recentPurchases ?? 0 };
  } catch { /* Lab offline */ }

  return {
    finance: { income_mtd: income, expenses_mtd: expenses, net_mtd: income - expenses },
    leads: { in_review: leadsInReview ?? 0 },
    content: { scheduled_posts: scheduledPosts ?? 0 },
    lab: labMetrics,
  };
}

// GET /api/command/kpis
router.get('/kpis', async (_req, res) => {
  try {
    const kpis = await getKPIs();
    res.json(kpis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/command/chat — streaming command chat
router.post('/chat', async (req, res) => {
  const { message, conversationId, fileContext } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  const supabase = db();

  // Get or create conversation
  let convId = conversationId;
  if (!convId) {
    const { data } = await supabase.from('conversations').insert({ agent_id: 'command', module: 'command' }).select().single();
    convId = data?.id;
  }

  const { data: history } = await supabase.from('messages').select('role, content')
    .eq('conversation_id', convId).order('created_at', { ascending: true }).limit(20);

  const { data: briefData } = await supabase.from('ceo_brief').select('content').eq('id', 1).single();

  // Build rich context
  const [vaultContext, kpis] = await Promise.all([
    Promise.resolve(assembleAgentContext()),
    getKPIs(),
  ]);

  const kpiText = `## Live Dashboard KPIs
- Revenue MTD: $${kpis.finance.income_mtd.toFixed(2)}
- Expenses MTD: $${kpis.finance.expenses_mtd.toFixed(2)}
- Net MTD: $${kpis.finance.net_mtd.toFixed(2)}
- Leads awaiting review: ${kpis.leads.in_review}
- Scheduled posts: ${kpis.content.scheduled_posts}
${kpis.lab.recentPurchases != null ? `- AC Lab purchases (7d): ${kpis.lab.recentPurchases}` : ''}`;

  const systemPrompt = `You are the Command assistant for AC Styling's internal operations dashboard.

You have full visibility across all modules:
- **Financial Management** — ledger, expenses, income, receipts
- **Marketing & Content** — asset vault, trends, proposals, content calendar
- **Sales & Leads** — lead pipeline, outreach, discovery
- **Operations** — client services, AC Styling Lab metrics
- **Tools & Tech** — system status

Your role:
- Answer questions about the business using live data
- Help the user navigate to the right module for specific tasks
- Surface insights across modules (e.g., "your highest expense this month was X")
- Be direct, sharp, and data-driven. No filler.

${kpiText}

## Business Vault Context
${vaultContext.identity}

${vaultContext.domainState}

${briefData?.content ? `## CEO Brief\n${briefData.content}` : ''}`;

  await supabase.from('messages').insert({ conversation_id: convId, role: 'user', content: message, agent_id: 'command' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ conversationId: convId })}\n\n`);

  let fullResponse = '';
  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        ...(history || []).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: fileContext ? `${message}\n\n---\n${fileContext}` : message },
      ],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullResponse += chunk.delta.text;
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }

    await supabase.from('messages').insert({ conversation_id: convId, role: 'assistant', content: fullResponse, agent_id: 'command' });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
