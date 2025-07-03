// netlify/functions/syncReps.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async () => {
  console.info('👥 Starting reps sync...');

  if (!HUBSPOT_PRIVATE_APP_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing environment variables');
    return { statusCode: 500, body: 'Missing environment variables' };
  }

  try {
    const ownersResponse = await axios.get(
      'https://api.hubapi.com/crm/v3/owners/',
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const owners = ownersResponse.data.results || [];

    console.info(`📥 Pulled ${owners.length} HubSpot owner(s)`);

    const reps = owners.map(o => ({
      id: o.id,
      name: o.fullName || null,
      email: o.email || null,
      created_at: new Date().toISOString()
    }));

    const { error } = await supabase.from('reps').upsert(reps, { onConflict: ['id'] });

    if (error) {
      console.error('❌ Supabase upsert error:', error);
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    console.info(`✅ Synced ${reps.length} reps`);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: `✅ Synced ${reps.length} reps`, sample: reps.slice(0, 2) })
    };
  } catch (err) {
    console.error('❌ Unexpected error during reps sync:', err);
    return { statusCode: 500, body: err.toString() };
  }
};
