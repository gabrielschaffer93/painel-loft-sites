const narratives = require('../lib/narratives');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const data = await narratives.readAll();
    res.status(200).json(data);
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const data = await narratives.save(body.key, body.html, body.email);
      res.status(200).json(data);
    } catch (err) {
      const status = err && err.statusCode ? err.statusCode : 500;
      res.status(status).json({ error: err && err.message ? err.message : 'Não foi possível salvar.' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed.' });
};
