const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  console.log(`Sync started at ${new Date().toISOString()}`);

  const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
  const res = await fetch(`https://api.hubapi.com/owners/v2/owners?hapikey=${HUBSPOT_API_KEY}`);
  const owners = await res.json();

  console.log(`Fetched ${owners.length} owners from HubSpot`);

  for (const owner of owners) {
    await supabase
      .from('reps')
      .upsert({
        hubspot_owner_id: owner.ownerId,
        name: `${owner.firstName} ${owner.lastName}`,
        email: owner.email,
        avatar_url: owner.avatarUrl || null,
      });
  }

  console.log(`Finished syncing ${owners.length} reps`);

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Reps synced successfully' }),
  };
};
