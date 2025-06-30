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
    const json = await res.json();

    const owners = json.results;
    if (!Array.isArray(owners)) {
      throw new Error('HubSpot response malformed: owners is not an array');
    }

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

    // Log the sync in Supabase
    await supabase.from('sync_logs').insert([
      {
        function: 'syncReps',
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        status: 'OK',
        message: `Synced ${owners.length} reps`,
      }
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Reps synced successfully' }),
    };

  } catch (error) {
    console.error('Sync failed', error);

    // Log the error to Supabase
    await supabase.from('sync_logs').insert([
      {
        function: 'syncReps',
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        status: 'ERROR',
        message: error.message,
      }
    ]);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Sync failed', details: error.message }),
    };
  }
};
