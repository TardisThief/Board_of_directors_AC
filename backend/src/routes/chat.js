import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db/supabase.js';
import { assembleAgentContext } from '../vault/reader.js';
import { buildAgentPrompt, AGENTS } from '../agents/prompts.js';
import { getToolContextForAgent } from '../tools/index.js';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID_AGENTS = Object.keys(AGENTS);

router.post('/:agentId', async (req, res) => {
  const { agentId } = req.params;

  if (!VALID_AGENTS.includes(agentId)) {
    return res.status(400).json({ error: `Unknown agent: ${agentId}` });
  }

  const { message, conversationId, fileContext } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  // Get or create conversation
  let convId = conversationId;
  if (!convId) {
    const { data, error } = await supabase
      .from('conversations')
      .insert({ agent_id: agentId })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    convId = data.id;
  }

  // Load message history
  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true });

  // Load vault context, CEO brief, and live tool data in parallel
  const [vaultContext, briefData, toolContext] = await Promise.all([
    Promise.resolve(assembleAgentContext()),
    supabase.from('ceo_brief').select('content').eq('id', 1).single(),
    getToolContextForAgent(agentId),
  ]);

  const systemPrompt = buildAgentPrompt(agentId, vaultContext, briefData?.data?.content, toolContext);

  // Persist user message
  await supabase.from('messages').insert({
    conversation_id: convId,
    role: 'user',
    content: message,
    agent_id: agentId,
  });

  // Stream response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send conversation ID first so client can persist it
  res.write(`data: ${JSON.stringify({ conversationId: convId })}\n\n`);

  let fullResponse = '';

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        ...(history || []).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: fileContext ? `${message}\n\n---\n**Attached files:**\n${fileContext}` : message },
      ],
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        const text = chunk.delta.text;
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    // Persist assistant message
    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: fullResponse,
      agent_id: agentId,
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
