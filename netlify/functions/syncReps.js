import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// Env variables
const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export const handler = async () => {
  console.info('🔁 Starting rep sync...');

  if (!HUBSPOT_PRIVATE_APP_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing environment variables');
    return { statusCode: 500, body: 'Missing environment variables' };
  }

  try {
    const response = await axios.get('https://api.hubapi.com/crm/v3/owners/', {
      headers: {
        Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const owners = response.data.results || [];
    console.info(`📥 Pulled ${owners.length} owners from HubSpot`);

    const reps = owners.map((owner) => {
      const first = owner.firstName || '';
      const last = owner.lastName || '';
      const name = (first + ' ' + last).trim() || owner.email || 'Unknown';

      return {
        id: owner.id,
        name,
        email: owner.email || null
      };
    });

    if (reps.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: '✅ Synced 0 reps', sample: [] })
      };
    }

    const { error } = await supabase.from('reps').upsert(reps, {
      onConflict: 'id' // Correct onConflict syntax is just the column name
    });

    if (error) {
      console.error('❌ Supabase upsert error:', error);
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `✅ Synced ${reps.length} reps`, sample: reps.slice(0, 2) })
    };
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return { statusCode: 500, body: err.toString() };
  }
};
