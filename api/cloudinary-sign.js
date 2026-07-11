import crypto from 'crypto';

export default function handler(req, res) {
  const origin = req.headers.origin;
  const allowed = [
    'https://db-hifi.vercel.app',
    'http://localhost:3000'
  ];

  if (origin && !allowed.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return res.status(500).json({ error: 'Cloudinary env vars not configured' });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'db-hifi/tracks';

  const paramsToSign = { folder, timestamp };
  const toSign = Object.keys(paramsToSign)
    .sort()
    .map(k => `${k}=${paramsToSign[k]}`)
    .join('&');

  const signature = crypto
    .createHash('sha1')
    .update(toSign + CLOUDINARY_API_SECRET)
    .digest('hex');

  res.json({
    signature,
    timestamp,
    folder,
    apiKey: CLOUDINARY_API_KEY,
    cloudName: CLOUDINARY_CLOUD_NAME
  });
}
