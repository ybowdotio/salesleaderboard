const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  const startedAt = new Date().toISOString();
  console.log(`🔄 Sync started at ${startedAt}`);

  try {
    const res = await fetch('https://api.hubapi.com/crm/v3/owners/', {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();
    console.log('📦 Raw HubSpot response:', JSON.stringify(data, null, 2));

    if (!Array.isArray(data.results)) {
      throw new Error('HubSpot response malformed: owners is not an array');
    }

    const owners = data.results;

    for (const owner of owners) {
      await supabase.from('reps').upsert({
        hubspot_owner_id: owner.id,
        name: `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim(),
        email: owner.email,
        avatar_url: owner.user?.avatarUrl || null,
      });
    }

    console.log(`✅ Finished syncing ${owners.length} reps`);

    await supabase.from('sync_logs').insert([
      {
        last_synced_at: startedAt,
        status: 'OK',
      },
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'OK',
        synced: owners.length,
        lastSyncedAt: startedAt,
      }),
    };
  } catch (err) {
    console.error('❌ Sync failed:', err.message);

    await supabase.from('sync_logs').insert([
      {
        last_synced_at: startedAt,
        status: 'FAILED',
        error: err.message,
      },
    ]);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Sync failed',
        details: err.message,
        lastSyncedAt: startedAt,
      }),
    };
  }
};
