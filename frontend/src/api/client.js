const BASE = import.meta.env.VITE_API_URL || '';

// --- Chat (streaming) ---

export async function streamChat({ agentId, message, conversationId, onConversationId, onToken }) {
  const res = await fetch(`${BASE}/api/chat/${agentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;

      try {
        const json = JSON.parse(raw);
        if (json.conversationId) onConversationId(json.conversationId);
        if (json.text) onToken(json.text);
        if (json.error) throw new Error(json.error);
      } catch (e) {
        if (e.message !== 'Unexpected token' && !e.message.includes('JSON')) throw e;
      }
    }
  }
}

// --- Boardroom (non-streaming) ---

export async function callBoardroom({ message, conversationId }) {
  const res = await fetch(`${BASE}/api/boardroom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }

  return res.json();
}

// --- CEO Brief ---

export async function getBrief() {
  const res = await fetch(`${BASE}/api/brief`);
  if (!res.ok) throw new Error('Failed to load brief');
  return res.json();
}

export async function saveBrief(content) {
  const res = await fetch(`${BASE}/api/brief`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to save brief');
  return res.json();
}
