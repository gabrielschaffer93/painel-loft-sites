const { BigQuery } = require('@google-cloud/bigquery');
const { GoogleAuth } = require('google-auth-library');
const config = require('./config');

const BILLING_PROJECT = config.billingProject;

function getGoogleAuth() {
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (credentialsJson) {
    let credentials;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch (err) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON.');
    }

    return new GoogleAuth({
      credentials,
      projectId: BILLING_PROJECT,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  return new GoogleAuth({
    projectId: BILLING_PROJECT,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
}

async function getBigQuery() {
  const auth = getGoogleAuth();
  const authClient = await auth.getClient();
  return new BigQuery({
    projectId: BILLING_PROJECT,
    authClient,
  });
}

module.exports = { BILLING_PROJECT, getGoogleAuth, getBigQuery };
