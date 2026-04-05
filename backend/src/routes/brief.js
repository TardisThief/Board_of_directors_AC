import { Router } from 'express';
import { supabase } from '../db/supabase.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('ceo_brief')
    .select('content, updated_at')
    .eq('id', 1)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/', async (req, res) => {
  const { content } = req.body;

  if (content === undefined) {
    return res.status(400).json({ error: 'content is required' });
  }

  const { data, error } = await supabase
    .from('ceo_brief')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
