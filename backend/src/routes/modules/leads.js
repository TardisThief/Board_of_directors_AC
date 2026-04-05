import { Router } from 'express';
import { runScout, runFullPipeline, getLeads, updateLead } from '../../services/leadAgents.js';

const router = Router();

router.get('/', async (req, res) => {
  const leads = await getLeads(req.query.status || null);
  res.json(leads);
});

router.post('/scout', async (req, res) => {
  try {
    const ids = await runScout();
    res.json({ discovered: ids.length, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/run-pipeline', async (req, res) => {
  try {
    await runFullPipeline(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const data = await updateLead(req.params.id, req.body);
  res.json(data);
});

router.put('/:id/approve', async (req, res) => {
  const data = await updateLead(req.params.id, {
    status: 'SENT',
    sent_at: new Date().toISOString(),
    sent_from_email: req.body.from_email || 'alejandra@theacstyle.com',
  });
  res.json(data);
});

router.put('/:id/reject', async (req, res) => {
  const data = await updateLead(req.params.id, {
    status: 'REJECTED',
    rejection_reason: req.body.reason || null,
    rejected_by: 'user',
  });
  res.json(data);
});

export default router;
