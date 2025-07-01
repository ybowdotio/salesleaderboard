const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  try {
    const code = event.queryStringParameters.code;

    if (!code) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing authorization code' }),
      };
    }

    // Exchange authorization code for tokens
    const tokenRes = await axios.post('https://api.hubapi.com/oauth/v1/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET,
        redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
        code,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Upsert tokens into Supabase
    const { error } = await supabase.from('hubspot_tokens').upsert({
      id: 1,
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000,
    });

    if (error) {
      console.error('❌ Supabase upsert error:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to store tokens' }),
      };
    }

console.log('➡️ Received code:', code);
console.log('➡️ Using redirect_uri:', process.env.HUBSPOT_REDIRECT_URI);

let tokenRes;
try {
  tokenRes = await axios.post('https://api.hubapi.com/oauth/v1/token', null, {
    params: {
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
      code,
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
} catch (tokenErr) {
  console.error('❌ Token exchange error:', tokenErr.response?.data || tokenErr.message);
  return {
    statusCode: 400,
    body: JSON.stringify({
      error: 'HubSpot token exchange failed',
      details: tokenErr.response?.data || tokenErr.message,
    }),
  };
}
