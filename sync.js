// Shared storage for the Coleto outage log. Uses an Upstash Redis database
// connected through the Vercel Marketplace (env vars are added automatically).
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CODE = process.env.ACCESS_CODE || '';
const HASH = 'coleto:progress';
const CREWS = 'coleto:crews';

async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'Database not connected' });
  if (CODE && req.headers['x-code'] !== CODE) return res.status(401).json({ error: 'Wrong access code' });
  try {
    if (req.method === 'GET') {
      const [h, c] = await redis([['HGETALL', HASH], ['GET', CREWS]]);
      const flat = h.result || [];
      const progress = {};
      for (let i = 0; i < flat.length; i += 2) { try { progress[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) {} }
      let crews = null; try { crews = c.result ? JSON.parse(c.result) : null; } catch (e) {}
      return res.status(200).json({ progress, crews });
    }
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      if (b.type === 'progress' && b.key && b.data) {
        const cur = await redis([['HGET', HASH, b.key]]);
        let old = null; try { old = cur[0].result ? JSON.parse(cur[0].result) : null; } catch (e) {}
        if (old && old.u && b.data.u && old.u > b.data.u) return res.status(200).json({ ok: true, skipped: true });
        await redis([['HSET', HASH, b.key, JSON.stringify(b.data)]]);
        return res.status(200).json({ ok: true });
      }
      if (b.type === 'crews' && b.data) {
        await redis([['SET', CREWS, JSON.stringify(b.data)]]);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Bad request' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
