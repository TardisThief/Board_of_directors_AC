const BASE = process.env.CONTENT_ENGINE_URL || 'http://localhost:3002';
const TIMEOUT = 4000;

async function fetchCE(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`CE ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getStatus() {
  try {
    const [trends, proposals] = await Promise.all([
      fetchCE('/api/trends'),
      fetchCE('/api/proposals'),
    ]);
    const trendCount = Array.isArray(trends) ? trends.length : (trends?.data?.length ?? 0);
    const proposalCount = Array.isArray(proposals) ? proposals.length : (proposals?.data?.length ?? 0);
    return {
      online: true,
      trends: trendCount,
      pendingProposals: proposalCount,
    };
  } catch {
    return { online: false, trends: 0, pendingProposals: 0 };
  }
}

export async function getTrends() {
  try {
    const data = await fetchCE('/api/trends');
    const trends = Array.isArray(data) ? data : (data?.data ?? []);
    return trends.slice(0, 5).map(t => ({
      topic: t.topic || t.name || t.title || 'Unknown',
      heat: t.heat_score ?? t.heat ?? null,
      mode: t.mode || null,
    }));
  } catch {
    return [];
  }
}

export async function getPendingProposals() {
  try {
    const data = await fetchCE('/api/proposals');
    const proposals = Array.isArray(data) ? data : (data?.data ?? []);
    return proposals.slice(0, 5).map(p => ({
      id: p.id,
      topic: p.topic || p.title || 'Untitled',
      mode: p.mode || null,
      hasCaption: !!p.caption,
    }));
  } catch {
    return [];
  }
}

// Forward a file upload to the ContentEngine vault
export async function ingestToVault(fileBuffer, filename, mimetype) {
  try {
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimetype });
    formData.append('file', blob, filename);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${BASE}/api/vault/ingest`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export async function getCMOContext() {
  const [trends, proposals] = await Promise.all([getTrends(), getPendingProposals()]);
  if (!trends.length && !proposals.length) return null;

  const lines = ['## Live Content Engine Data'];
  if (trends.length) {
    lines.push('\n### Active Trends');
    trends.forEach(t => {
      lines.push(`- **${t.topic}**${t.heat != null ? ` (heat: ${t.heat})` : ''}${t.mode ? ` [${t.mode}]` : ''}`);
    });
  }
  if (proposals.length) {
    lines.push('\n### Pending Content Proposals');
    proposals.forEach(p => {
      lines.push(`- ${p.topic}${p.mode ? ` [${p.mode}]` : ''}${p.hasCaption ? ' ✓ captioned' : ' — needs caption'}`);
    });
  }
  return lines.join('\n');
}
