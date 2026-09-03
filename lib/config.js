// Single app config. No .env is required for the team to run the panel.
//
// googleClientId is a public OAuth Web client id (not a secret).
// Paste it once so every teammate can click "Entrar com Google".

module.exports = {
  googleClientId: '',
  billingProject: 'loft-dl-marketplace',
  cacheDataset: 'painel_sites',
  cacheTable: 'dashboard_cache',
  allowedEmails: [
    'gabriel.oliveira@vistasoft.com.br',
    'elias.bernardi@loft.com.br',
    'bruno.bertozzo@loft.com.br',
    'luiza.pais@loft.com.br',
  ],
};
