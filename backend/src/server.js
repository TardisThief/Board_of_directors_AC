import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';

// Legacy routes (kept for backward compat)
import briefRouter from './routes/brief.js';
import uploadRouter from './routes/upload.js';

// Module routes
import commandRouter from './routes/modules/command.js';
import financeRouter from './routes/modules/finance.js';
import contentRouter from './routes/modules/content.js';
import leadsRouter from './routes/modules/leads.js';
import operationsRouter from './routes/modules/operations.js';

// Lead pipeline
import { runScout } from './services/agents/scout.js';
import { startOrchestrator } from './services/orchestrator.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

// ── Module routes ─────────────────────────────────────────────────────────
app.use('/api/command', commandRouter);
app.use('/api/finance', financeRouter);
app.use('/api/content', contentRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/operations', operationsRouter);

// ── Shared routes ─────────────────────────────────────────────────────────
app.use('/api/brief', briefRouter);
app.use('/api/upload', uploadRouter);

app.get('/api/health', async (_req, res) => {
  const env_vars = {
    ANTHROPIC_API_KEY:             !!process.env.ANTHROPIC_API_KEY,
    SUPABASE_URL:                  !!process.env.SUPABASE_URL,
    SUPABASE_KEY:                  !!process.env.SUPABASE_KEY,
    OPENAI_API_KEY:                !!process.env.OPENAI_API_KEY,
    VOYAGE_API_KEY:                !!process.env.VOYAGE_API_KEY,
    AC_LAB_SUPABASE_URL:           !!process.env.AC_LAB_SUPABASE_URL,
    AC_LAB_SUPABASE_SERVICE_KEY:   !!process.env.AC_LAB_SUPABASE_SERVICE_KEY,
  };

  const apis = [
    { name: 'Anthropic Claude',  model: 'claude-sonnet-4-6',   configured: env_vars.ANTHROPIC_API_KEY },
    { name: 'OpenAI Whisper',    model: 'whisper-1',           configured: env_vars.OPENAI_API_KEY },
    { name: 'Voyage AI',         model: 'voyage-2',            configured: env_vars.VOYAGE_API_KEY },
  ];

  // Quick Supabase ping
  const services = [];
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const start = Date.now();
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    await sb.from('conversations').select('id').limit(1);
    services.push({ name: 'Board Supabase', status: 'ok', latency_ms: Date.now() - start });
  } catch (e) {
    services.push({ name: 'Board Supabase', status: 'error', note: e.message });
  }

  try {
    if (process.env.AC_LAB_SUPABASE_URL && process.env.AC_LAB_SUPABASE_SERVICE_KEY) {
      const { createClient } = await import('@supabase/supabase-js');
      const start = Date.now();
      const sb = createClient(process.env.AC_LAB_SUPABASE_URL, process.env.AC_LAB_SUPABASE_SERVICE_KEY);
      await sb.from('profiles').select('id').limit(1);
      services.push({ name: 'AC Lab Supabase', status: 'ok', latency_ms: Date.now() - start });
    } else {
      services.push({ name: 'AC Lab Supabase', status: 'error', note: 'Not configured' });
    }
  } catch (e) {
    services.push({ name: 'AC Lab Supabase', status: 'degraded', note: e.message });
  }

  const anyError = services.some(s => s.status === 'error');
  const anyDegraded = services.some(s => s.status === 'degraded');
  const overallStatus = anyError ? 'degraded' : anyDegraded ? 'degraded' : 'ok';

  res.json({ status: overallStatus, version: '2.0.0', services, apis, env_vars });
});

// ── Background jobs ───────────────────────────────────────────────────────
// Scout runs every 4 hours (matches original Lead Gen schedule)
cron.schedule('0 */4 * * *', async () => {
  console.log('[CRON] Running lead scout…');
  try {
    const ids = await runScout();
    console.log(`[CRON] Scout found ${ids.length} leads`);
  } catch (err) {
    console.error('[CRON] Scout failed:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`AC Styling Command Center backend v2.0 — http://localhost:${PORT}`);
  console.log(`Lead scout scheduled every 4 hours`);
  // Start the lead pipeline orchestrator (polls every 15s)
  startOrchestrator();
});
