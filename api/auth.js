// Reserved for future server-side auth endpoints
// e.g. verifying ID tokens, custom claims, etc.
export default function handler(req, res) {
  res.status(404).json({ error: 'Not implemented' });
}