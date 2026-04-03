// api/telegram.js — Vercel Node.js Serverless Function
// Secure proxy between the dashboard and Telegram Bot API

const ALLOWED_METHODS = [
  'getMe',
  'getUpdates',
  'sendMessage',
  'setMessageReaction',
  'getChat',
  'getChatMember',
  'getChatMemberCount',
  'forwardMessage',
  'copyMessage',
  'joinChat',
  'leaveChat',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, description: 'Method not allowed' });

  const { token, method, params } = req.body || {};

  if (!token || !method) return res.status(400).json({ ok: false, description: 'token and method are required' });
  if (!/^\d{8,12}:[A-Za-z0-9_\-]{35}$/.test(token)) return res.status(400).json({ ok: false, description: 'Invalid token format' });
  if (!ALLOWED_METHODS.includes(method)) return res.status(403).json({ ok: false, description: `Method '${method}' is not permitted` });

  try {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({ ok: false, description: `Proxy error: ${err.message}` });
  }
}
