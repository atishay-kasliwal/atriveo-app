/** Proxy only fixed private crawler endpoints; the sidecar's existing authentication runs first. */
export async function handleStaffing(req, res, url, { base = process.env.STAFFING_SERVICE_URL || 'http://atriveo-staffing:8791', token = process.env.TAILOR_TOKEN || '', fetcher = fetch } = {}) {
  if (!url.pathname.startsWith('/staffing/')) return false;
  const routes = { 'GET /staffing/status': '/status', 'GET /staffing/jobs': '/jobs', 'POST /staffing/run': '/run', 'POST /staffing/source': '/source' };
  const target = routes[`${req.method} ${url.pathname}`];
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (!target) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'Not found' })); return true; }
  try {
    let body;
    if (req.method === 'POST') {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 10000) throw new Error('Request too large'); chunks.push(chunk); }
      body = Buffer.concat(chunks).toString() || '{}';
      JSON.parse(body);
    }
    const response = await fetcher(`${base}${target}`, { method: req.method, body, headers: { 'Content-Type': 'application/json', 'X-Tailor-Token': token }, signal: AbortSignal.timeout(15000) });
    res.writeHead(response.status);
    res.end(await response.text());
  } catch { res.writeHead(503); res.end(JSON.stringify({ ok: false, error: 'Staffing crawler unavailable. Try again shortly.' })); }
  return true;
}
