const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;

  const res = await fetch('https://api.hubapi.com/crm/v3/owners/', {
    headers: {
      Authorization: `Bearer ${HUBSPOT_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Error fetching from HubSpot:', data);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'HubSpot API error', error: data }),
    };
  }

  const owners = data.results || [];

  for (const owner of owners) {
    await supabase
      .from('reps')
      .upsert({
        hubspot_owner_id: owner.id,
        name: `${owner.firstName} ${owner.lastName}`,
        email: owner.email,
        avatar_url: owner.avatarUrl || null,
      });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Reps synced successfully' }),
  };
};
