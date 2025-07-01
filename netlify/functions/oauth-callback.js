const axios = require('axios');

exports.handler = async (event) => {
  const code = event.queryStringParameters.code;
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI;

  try {
    const response = await axios.post('https://api.hubapi.com/oauth/v1/token', new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }).toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const { access_token, refresh_token } = response.data;

    // Optional: Store token somewhere (Supabase, encrypted cookie, etc.)
    return {
      statusCode: 200,
      body: JSON.stringify({ access_token, refresh_token }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
