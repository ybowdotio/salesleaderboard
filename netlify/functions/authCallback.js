const axios = require('axios');
const querystring = require('querystring');

exports.handler = async (event) => {
  const params = event.queryStringParameters;
  const code = params.code;

  if (!code) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing authorization code' }),
    };
  }

  const client_id = process.env.HUBSPOT_CLIENT_ID;
  const client_secret = process.env.HUBSPOT_CLIENT_SECRET;
  const redirect_uri = 'https://salesleaderboard.netlify.app/.netlify/functions/authCallback'; // must match your app's redirect URI

  try {
    const response = await axios.post(
      'https://api.hubapi.com/oauth/v1/token',
      querystring.stringify({
        grant_type: 'authorization_code',
        client_id,
        client_secret,
        redirect_uri,
        code,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    // For now, just return them (you should securely store them in Supabase or encrypted env)
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Authorization successful',
        access_token,
        refresh_token,
        expires_in,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
