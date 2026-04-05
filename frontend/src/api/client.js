const BASE = import.meta.env.VITE_API_URL || '';

const json = res => res.ok ? res.json() : res.json().then(e => Promise.reject(new Error(e.error || res.statusText)));

// ── Command ───────────────────────────────────────────────────────────────

export async function getKPIs() {
  return fetch(`${BASE}/api/command/kpis`).then(json);
}

export async function streamCommandChat({ message, conversationId, fileContext, onConversationId, onToken }) {
  return _stream('/api/command/chat', { message, conversationId, fileContext }, onConversationId, onToken);
}

// ── Finance ───────────────────────────────────────────────────────────────

export async function getFinanceEntries(params = {}) {
  const q = new URLSearchParams(params).toString();
  return fetch(`${BASE}/api/finance/entries${q ? '?' + q : ''}`).then(json);
}

export async function getFinanceSummary() {
  return fetch(`${BASE}/api/finance/summary`).then(json);
}

export async function createFinanceEntry(data) {
  return fetch(`${BASE}/api/finance/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json);
}

export async function updateFinanceEntry(id, data) {
  return fetch(`${BASE}/api/finance/entries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json);
}

export async function deleteFinanceEntry(id) {
  return fetch(`${BASE}/api/finance/entries/${id}`, { method: 'DELETE' }).then(json);
}

export async function uploadReceipt(entryId, file) {
  const fd = new FormData(); fd.append('file', file);
  return fetch(`${BASE}/api/finance/entries/${entryId}/attachments`, { method: 'POST', body: fd }).then(json);
}

export async function scanReceipt(file) {
  const fd = new FormData(); fd.append('file', file);
  return fetch(`${BASE}/api/finance/receipt-scan`, { method: 'POST', body: fd }).then(json);
}

// ── Content ───────────────────────────────────────────────────────────────

export async function getAssets(params = {}) {
  const q = new URLSearchParams(params).toString();
  return fetch(`${BASE}/api/content/assets${q ? '?' + q : ''}`).then(json);
}

export async function getTrends() {
  return fetch(`${BASE}/api/content/trends`).then(json);
}

export async function refreshTrends(mode = 'b-roll') {
  return fetch(`${BASE}/api/content/trends/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) }).then(json);
}

export async function getProposals(status) {
  const q = status ? `?status=${status}` : '';
  return fetch(`${BASE}/api/content/proposals${q}`).then(json);
}

export async function generateProposals(trend_ids, mode) {
  return fetch(`${BASE}/api/content/proposals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trend_ids, mode }) }).then(json);
}

export async function getSchedule(params = {}) {
  const q = new URLSearchParams(params).toString();
  return fetch(`${BASE}/api/content/schedule${q ? '?' + q : ''}`).then(json);
}

export async function createScheduleEntry(data) {
  return fetch(`${BASE}/api/content/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json);
}

export async function updateScheduleEntry(id, data) {
  return fetch(`${BASE}/api/content/schedule/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json);
}

export async function deleteScheduleEntry(id) {
  return fetch(`${BASE}/api/content/schedule/${id}`, { method: 'DELETE' }).then(json);
}

// ── Leads ─────────────────────────────────────────────────────────────────

export async function getLeads(status) {
  const q = status ? `?status=${status}` : '';
  return fetch(`${BASE}/api/leads${q}`).then(json);
}

export async function runLeadScout() {
  return fetch(`${BASE}/api/leads/scout`, { method: 'POST' }).then(json);
}

export async function runLeadPipeline(id) {
  return fetch(`${BASE}/api/leads/${id}/run-pipeline`, { method: 'POST' }).then(json);
}

export async function approveLead(id, fromEmail) {
  return fetch(`${BASE}/api/leads/${id}/approve`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from_email: fromEmail }) }).then(json);
}

export async function rejectLead(id, reason) {
  return fetch(`${BASE}/api/leads/${id}/reject`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }).then(json);
}

export async function updateLead(id, data) {
  return fetch(`${BASE}/api/leads/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json);
}

// ── Operations ────────────────────────────────────────────────────────────

export async function getLabMetrics() {
  return fetch(`${BASE}/api/operations/lab-metrics`).then(json);
}

// ── Tools / Health ─────────────────────────────────────────────────────────

export async function getHealthStatus() {
  return fetch(`${BASE}/api/health`).then(json);
}

// ── Brief ─────────────────────────────────────────────────────────────────

export async function getBrief() {
  return fetch(`${BASE}/api/brief`).then(json);
}

export async function saveBrief(content) {
  return fetch(`${BASE}/api/brief`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }).then(json);
}

// ── File upload (generic) ─────────────────────────────────────────────────

export async function uploadFiles(files, addToVault = false) {
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  fd.append('addToVault', String(addToVault));
  return fetch(`${BASE}/api/upload`, { method: 'POST', body: fd }).then(json);
}

// ── Shared streaming helper ────────────────────────────────────────────────

async function _stream(path, body, onConversationId, onToken) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.conversationId) onConversationId?.(parsed.conversationId);
        if (parsed.text) onToken?.(parsed.text);
        if (parsed.error) throw new Error(parsed.error);
      } catch (e) {
        if (!e.message?.includes('JSON')) throw e;
      }
    }
  }
}
