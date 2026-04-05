import { Router } from 'express';
import multer from 'multer';
import { readFileSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { ingestToVault } from '../tools/contentEngine.js';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Store files in memory (max 20MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

async function extractText(file) {
  const { buffer, mimetype, originalname } = file;
  const ext = originalname.split('.').pop().toLowerCase();

  // Plain text formats
  if (['txt', 'md', 'csv', 'json', 'html', 'xml', 'js', 'ts', 'py'].includes(ext)) {
    return buffer.toString('utf-8');
  }

  // PDF
  if (ext === 'pdf' || mimetype === 'application/pdf') {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const data = await pdfParse(buffer);
    return data.text;
  }

  // DOCX
  if (ext === 'docx' || mimetype.includes('wordprocessingml')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // XLSX / XLS
  if (['xlsx', 'xls'].includes(ext)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    return wb.SheetNames.map(name => {
      const sheet = wb.Sheets[name];
      return `## Sheet: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`;
    }).join('\n\n');
  }

  // Images — describe via Claude vision
  if (mimetype.startsWith('image/')) {
    const base64 = buffer.toString('base64');
    const mediaType = mimetype;
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Describe this image in detail. If it contains text, transcribe it. If it is a mood board, lookbook, or styling image, describe the style, colors, and composition.' },
        ],
      }],
    });
    return `[Image: ${originalname}]\n${response.content[0].text}`;
  }

  return `[File: ${originalname} — type not extractable]`;
}

router.post('/', upload.array('files', 10), async (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const addToVault = req.body.addToVault === 'true';

  const results = await Promise.all(
    req.files.map(async file => {
      try {
        const text = await extractText(file);

        // Optionally ingest into ContentEngine vault
        let vaultIngested = false;
        if (addToVault) {
          vaultIngested = await ingestToVault(file.buffer, file.originalname, file.mimetype);
        }

        return {
          name: file.originalname,
          size: file.size,
          type: file.mimetype,
          text: text.slice(0, 50000), // cap at 50k chars
          vaultIngested,
          error: null,
        };
      } catch (err) {
        return {
          name: file.originalname,
          text: '',
          error: err.message,
        };
      }
    })
  );

  res.json({ files: results });
});

export default router;
