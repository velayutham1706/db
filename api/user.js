// Reserved for future user data endpoints
// e.g. server-side playlist ops, user preferences, etc.
export default function handler(req, res) {
  res.status(404).json({ error: 'Not implemented' });
}