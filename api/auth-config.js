const config = require('../lib/config');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  res.status(200).json({
    googleClientId: config.googleClientId || '',
    allowedEmails: config.allowedEmails,
  });
};
