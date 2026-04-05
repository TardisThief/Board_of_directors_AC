import { Router } from 'express';
import { getAllToolStatuses } from '../tools/index.js';

const router = Router();

router.get('/status', async (_req, res) => {
  try {
    const statuses = await getAllToolStatuses();
    res.json(statuses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
