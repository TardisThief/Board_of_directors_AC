import { Router } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); }

const CATEGORIES = {
  income: ['Services', 'Products', 'Referral', 'Other Income'],
  expense: ['Marketing', 'Meals', 'Clothes', 'Equipment', 'Software', 'Travel', 'Samples', 'Tax', 'Other'],
};

// GET /api/finance/entries
router.get('/entries', async (req, res) => {
  const { type, category, from, to, limit = 100 } = req.query;
  let query = db().from('financial_entries')
    .select('*, financial_attachments(id, filename, public_url, ai_summary)')
    .order('date', { ascending: false })
    .limit(Number(limit));

  if (type) query = query.eq('type', type);
  if (category) query = query.eq('category', category);
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /api/finance/summary
router.get('/summary', async (req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];

  const { data: entries } = await db()
    .from('financial_entries')
    .select('type, amount, category, date')
    .gte('date', yearStart);

  const all = entries || [];
  const mtd = all.filter(e => e.date >= monthStart);

  const sum = (arr, type) => arr.filter(e => e.type === type).reduce((s, e) => s + Number(e.amount), 0);

  const byCategory = (arr) => {
    const map = {};
    arr.forEach(e => {
      map[e.category] = (map[e.category] || 0) + Number(e.amount);
    });
    return Object.entries(map).map(([category, amount]) => ({ category, amount }));
  };

  res.json({
    mtd: {
      income: sum(mtd, 'income'),
      expenses: sum(mtd, 'expense'),
      net: sum(mtd, 'income') - sum(mtd, 'expense'),
    },
    ytd: {
      income: sum(all, 'income'),
      expenses: sum(all, 'expense'),
      net: sum(all, 'income') - sum(all, 'expense'),
    },
    categories: {
      income: byCategory(all.filter(e => e.type === 'income')),
      expense: byCategory(all.filter(e => e.type === 'expense')),
    },
    categories_meta: CATEGORIES,
  });
});

// POST /api/finance/entries
router.post('/entries', async (req, res) => {
  const { type, amount, currency, category, description, date, vendor, client, notes } = req.body;
  if (!type || !amount || !category) return res.status(400).json({ error: 'type, amount, category required' });

  const { data, error } = await db().from('financial_entries').insert({
    type, amount: Number(amount), currency: currency || 'USD',
    category, description, date: date || new Date().toISOString().split('T')[0],
    vendor, client, notes,
  }).select('*').single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT /api/finance/entries/:id
router.put('/entries/:id', async (req, res) => {
  const { data, error } = await db().from('financial_entries')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/finance/entries/:id
router.delete('/entries/:id', async (req, res) => {
  const { error } = await db().from('financial_entries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/finance/entries/:id/attachments — upload receipt
router.post('/entries/:id/attachments', upload.single('file'), async (req, res) => {
  const { id } = req.params;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const supabase = db();
  const storagePath = `receipts/${id}/${Date.now()}-${file.originalname}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('receipts')
    .upload(storagePath, file.buffer, { contentType: file.mimetype });

  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(storagePath);

  // AI extraction from receipt image
  let aiSummary = null;
  if (file.mimetype.startsWith('image/')) {
    try {
      const base64 = file.buffer.toString('base64');
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: file.mimetype, data: base64 } },
            { type: 'text', text: 'Extract key financial data from this receipt: total amount, vendor/merchant name, date, and item categories. Return as a brief summary (2-3 sentences).' },
          ],
        }],
      });
      aiSummary = response.content[0].text;
    } catch { /* non-critical */ }
  }

  const { data, error } = await supabase.from('financial_attachments').insert({
    entry_id: id,
    filename: file.originalname,
    storage_path: storagePath,
    public_url: urlData.publicUrl,
    file_type: file.mimetype,
    ai_summary: aiSummary,
  }).select('*').single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/finance/receipt-scan — scan receipt to create entry
router.post('/receipt-scan', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  if (!file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Image files only' });

  try {
    const base64 = file.buffer.toString('base64');
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: file.mimetype, data: base64 } },
          { type: 'text', text: `Extract financial entry data from this receipt for AC Styling business records.

Return JSON:
{
  "type": "expense",
  "amount": 0.00,
  "currency": "USD",
  "category": "one of: Marketing, Meals, Clothes, Equipment, Software, Travel, Samples, Tax, Other",
  "description": "brief description",
  "date": "YYYY-MM-DD",
  "vendor": "merchant/vendor name",
  "notes": "any other relevant details"
}

Use today's date (${new Date().toISOString().split('T')[0]}) if date is unclear.` },
        ],
      }],
    });

    const text = response.content[0].text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    const extracted = JSON.parse(text);
    res.json({ extracted, filename: file.originalname });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
