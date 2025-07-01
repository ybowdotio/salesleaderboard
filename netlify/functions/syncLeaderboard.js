const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const getStoredTokens = async () => {
  const { data, error } = await supabase
    .from('hubspot_tokens')
    .select('*')
    .single();

  if (error) throw new Error('Failed to retrieve tokens');
  return data;
};

const updateTokens = async (tokens) => {
  const { error } = await supabase.from('hubspot_tokens').upsert(tokens);
  if (error) throw new Error('Failed to update tokens');
};

const refreshAccessToken = async (refreshToken) => {
  const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  const data = await response.json();

  const { access_token, refresh_token, expires_in } = data;
  await updateTokens({
    id: 1,
    access_token,
    refresh_token,
    expires_at: Date.now() + expires_in * 1000,
  });

  return access_token;
};

exports.handler = async () => {
  try {
    let { access_token, refresh_token, expires_at } = await getStoredTokens();

    if (Date.now() >= expires_at) {
      access_token = await refreshAccessToken(refresh_token);
    }

    const ownersRes = await fetch('https://api.hubapi.com/crm/v3/owners', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const ownersData = await ownersRes.json();
    const owners = ownersData.results;

    for (const owner of owners) {
      const email = owner.email;
      const id = owner.id;
      const name = `${owner.firstName || ''} ${owner.lastName || ''}`.trim();

      if (!email || !name) continue;

      await supabase.from('reps').upsert(
        {
          id,
          email,
          name,
        },
        { onConflict: ['id'] }
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Loaded ${owners.length} reps` }),
    };
  } catch (error) {
    console.error('Sync error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
