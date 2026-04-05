/**
 * Asset Ingest Service
 * Pipeline: Upload → Supabase Storage → Claude Vision → Whisper (video) → Voyage Embed → DB
 * Ported from ACS_ContentEngine TypeScript
 */
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import VoyageAI from 'voyageai';

function getClients() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const voyage = new VoyageAI({ apiKey: process.env.VOYAGE_API_KEY });
  return { supabase, anthropic, openai, voyage };
}

async function analyzeImage(anthropic, base64, mediaType) {
  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const safeType = validTypes.includes(mediaType) ? mediaType : 'image/jpeg';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: safeType, data: base64 } },
        { type: 'text', text: `Analyze this styling/fashion asset. Return JSON:
{
  "description": "detailed description",
  "vibes": ["elegant", "casual", ...],
  "garments": ["blazer", "trousers", ...],
  "colors": ["ivory", "gold", ...],
  "setting": "studio/outdoor/etc",
  "action": "walking/posing/etc"
}` },
      ],
    }],
  });

  try {
    const text = response.content[0].text;
    const json = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    return JSON.parse(json);
  } catch {
    return { description: response.content[0].text, vibes: [], garments: [], colors: [], setting: null, action: null };
  }
}

async function transcribeAudio(openai, buffer, filename) {
  try {
    const file = new File([buffer], filename, { type: 'video/mp4' });
    const result = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });
    return result.text || '';
  } catch {
    return '';
  }
}

async function generateEmbedding(voyage, text) {
  try {
    const result = await voyage.embed({ input: [text], model: 'voyage-2' });
    return result.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}

export async function ingestAsset(fileBuffer, filename, mimeType, onProgress) {
  const { supabase, anthropic, openai, voyage } = getClients();
  const storagePath = `uploads/${Date.now()}-${filename}`;
  const isVideo = mimeType.startsWith('video/');
  const isImage = mimeType.startsWith('image/');

  onProgress?.('Uploading to storage…');

  // 1. Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('assets')
    .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from('assets').getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;

  // 2. Claude Vision (images and video thumbnails)
  let parsed = { description: '', vibes: [], garments: [], colors: [], setting: null, action: null };
  if (isImage || isVideo) {
    onProgress?.('Analyzing with AI…');
    const base64 = fileBuffer.toString('base64');
    parsed = await analyzeImage(anthropic, base64, isVideo ? 'image/jpeg' : mimeType);
  }

  // 3. Whisper transcription (video)
  let transcription = '';
  if (isVideo) {
    onProgress?.('Transcribing audio…');
    transcription = await transcribeAudio(openai, fileBuffer, filename);
  }

  // 4. Voyage embedding
  onProgress?.('Generating embedding…');
  const embeddingText = [parsed.description, transcription, ...parsed.vibes, ...parsed.garments].join(' ');
  const embedding = await generateEmbedding(voyage, embeddingText);

  // 5. Store in DB
  onProgress?.('Saving to database…');
  const tags = [
    ...parsed.garments.map(g => ({ tag: g.toLowerCase(), category: 'garment', confidence: 0.9 })),
    ...parsed.vibes.map(v => ({ tag: v.toLowerCase(), category: 'vibe', confidence: 0.85 })),
    ...parsed.colors.map(c => ({ tag: c.toLowerCase(), category: 'color', confidence: 0.9 })),
  ];
  if (parsed.setting) tags.push({ tag: parsed.setting.toLowerCase(), category: 'setting', confidence: 0.8 });
  if (parsed.action) tags.push({ tag: parsed.action.toLowerCase(), category: 'action', confidence: 0.8 });

  const { data, error: insertError } = await supabase.from('assets').insert({
    filename,
    storage_path: storagePath,
    public_url: publicUrl,
    type: isVideo ? 'video' : 'image',
    ai_description: parsed.description,
    transcription: transcription || null,
    tags: JSON.stringify(tags),
    vibes: parsed.vibes.map(v => v.toLowerCase()),
    garments: parsed.garments.map(g => g.toLowerCase()),
    embedding: embedding ? JSON.stringify(embedding) : null,
  }).select('id').single();

  if (insertError) throw new Error(`DB insert failed: ${insertError.message}`);

  return {
    asset_id: data.id,
    filename,
    public_url: publicUrl,
    ai_description: parsed.description,
    transcription: transcription || null,
    vibes: parsed.vibes,
    garments: parsed.garments,
    success: true,
  };
}

export async function ingestMultiple(files, onProgress) {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const { buffer, filename, mimeType } = files[i];
    onProgress?.({ total: files.length, processed: i, current: filename });
    try {
      const result = await ingestAsset(buffer, filename, mimeType,
        msg => onProgress?.({ total: files.length, processed: i, current: filename, step: msg })
      );
      results.push(result);
    } catch (err) {
      results.push({ filename, success: false, error: err.message });
    }
  }
  onProgress?.({ total: files.length, processed: files.length, current: 'complete' });
  return results;
}
