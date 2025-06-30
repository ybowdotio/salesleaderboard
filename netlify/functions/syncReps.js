const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  const startedAt = new Date().toISOString();
  console.log(`Sync started at ${startedAt}`);

  try {
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

    // ✅ Log success
    await supabase
      .from('sync_logs')
      .insert({
        status: 'OK',
        message: `Synced ${owners.length} reps at ${startedAt}`,
      });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Reps synced successfully' }),
    };

  } catch (error) {
    console.error('Sync failed', error);

    // ❌ Log failure
    await supabase
      .from('sync_logs')
      .insert({
        status: 'ERROR',
        message: error.message,
      });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Sync failed', details: error.message }),
    };
  }
};
