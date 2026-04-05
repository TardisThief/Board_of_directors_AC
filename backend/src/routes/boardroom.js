import { Router } from 'express';
import { runBoardroom } from '../agents/orchestrator.js';

const router = Router();

router.post('/', async (req, res) => {
  const { message, conversationId } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const result = await runBoardroom(message, conversationId);
    res.json(result);
  } catch (err) {
    console.error('Boardroom error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
