const BASE = process.env.LEAD_GEN_URL || 'http://localhost:8000';
const TIMEOUT = 4000;

async function fetchLG(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`LG ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getStatus() {
  try {
    const data = await fetchLG('/leads?status=REVIEW');
    const inReview = Array.isArray(data) ? data.length : (data?.leads?.length ?? 0);
    return { online: true, inReview };
  } catch {
    return { online: false, inReview: 0 };
  }
}

async function getLeadsByStatus(status) {
  try {
    const data = await fetchLG(`/leads?status=${status}`);
    return Array.isArray(data) ? data : (data?.leads ?? []);
  } catch {
    return [];
  }
}

export async function getCSOContext() {
  try {
    const [review, sent] = await Promise.all([
      getLeadsByStatus('REVIEW'),
      getLeadsByStatus('SENT'),
    ]);

    if (!review.length && !sent.length) return null;

    const lines = ['## Live Lead Generation Pipeline'];
    lines.push(`\n- **Leads awaiting review:** ${review.length}`);
    lines.push(`- **Leads sent (total):** ${sent.length}`);

    if (review.length) {
      lines.push('\n### Leads Pending Approval');
      review.slice(0, 5).forEach(l => {
        const name = l.name || l.company || l.email || 'Unknown lead';
        lines.push(`- ${name}`);
      });
      if (review.length > 5) lines.push(`  …and ${review.length - 5} more`);
    }

    return lines.join('\n');
  } catch {
    return null;
  }
}
