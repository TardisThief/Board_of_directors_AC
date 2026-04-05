import Anthropic from '@anthropic-ai/sdk';
import { assembleAgentContext } from '../vault/reader.js';
import { buildAgentPrompt, AGENTS } from './prompts.js';
import { supabase } from '../db/supabase.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ROUTING_PROMPT = `You are Morgan, the COO and boardroom facilitator for AC Styling's Board of Directors.

A message has arrived for the full board. Your job is to decide which executive(s) to consult, then synthesize a unified response.

Available agents:
- coo (you, Morgan): Operations, client experience, cross-functional coordination
- cmo (Isabelle): Marketing, Instagram/TikTok, content, brand
- cso (Dominique): Sales, pipeline, discovery calls, packages
- cfo (Rémy): Pricing, profitability, tax, invoicing
- cto (Soren): Website, tools, booking, AI integrations

Respond with ONLY valid JSON in this format:
{
  "agents": ["coo", "cmo"],
  "reason": "one sentence explaining why these agents"
}

Choose 2-4 agents most relevant to the message. Always include coo.`;

async function routeMessage(message) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: ROUTING_PROMPT,
    messages: [{ role: 'user', content: message }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code fences if present
  const json = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(json);
}

async function callAgent(agentId, message, history, vaultContext, ceoBrief) {
  const systemPrompt = buildAgentPrompt(agentId, vaultContext, ceoBrief);
  const agent = AGENTS[agentId];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      ...(history || []).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ],
  });

  return {
    agentId,
    name: agent.name,
    content: response.content[0].text,
  };
}

async function synthesize(message, agentResponses, vaultContext, ceoBrief) {
  const agentSummaries = agentResponses
    .map(r => `**${r.name}:** ${r.content}`)
    .join('\n\n');

  const synthesisPrompt = buildAgentPrompt('coo', vaultContext, ceoBrief);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1536,
    system:
      synthesisPrompt +
      '\n\nYou are now in boardroom synthesis mode. Your colleagues have responded. Synthesize their perspectives into a clear, unified executive recommendation. Acknowledge key contributions, resolve tensions, and give Manuel one clear path forward.',
    messages: [
      {
        role: 'user',
        content: `Original question: ${message}\n\nBoard responses:\n${agentSummaries}`,
      },
    ],
  });

  return response.content[0].text;
}

export async function runBoardroom(message, conversationId) {
  // Get or create conversation
  let convId = conversationId;
  if (!convId) {
    const { data } = await supabase
      .from('conversations')
      .insert({ agent_id: 'boardroom' })
      .select()
      .single();
    convId = data.id;
  }

  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true });

  const vaultContext = assembleAgentContext();
  const { data: briefData } = await supabase
    .from('ceo_brief')
    .select('content')
    .eq('id', 1)
    .single();
  const ceoBrief = briefData?.content;

  // Save user message
  await supabase.from('messages').insert({
    conversation_id: convId,
    role: 'user',
    content: message,
    agent_id: 'boardroom',
  });

  // Route to relevant agents
  const routing = await routeMessage(message);
  const selectedAgents = [...new Set(['coo', ...routing.agents])];

  // Call all selected agents in parallel
  const agentResponses = await Promise.all(
    selectedAgents.map(agentId =>
      callAgent(agentId, message, history, vaultContext, ceoBrief)
    )
  );

  // Synthesize
  const synthesis = await synthesize(message, agentResponses, vaultContext, ceoBrief);

  // Save synthesis as assistant message
  await supabase.from('messages').insert({
    conversation_id: convId,
    role: 'assistant',
    content: synthesis,
    agent_id: 'boardroom',
  });

  return {
    conversationId: convId,
    routing,
    agentResponses,
    synthesis,
  };
}
