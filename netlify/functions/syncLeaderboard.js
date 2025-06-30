import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// HubSpot private app token
const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

exports.handler = async function () {
  try {
    let hasMore = true;
    let after = undefined;
    let totalSynced = 0;

    while (hasMore) {
      const url = new URL('https://api.hubapi.com/crm/v3/objects/calls');
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);

      const res = await fetch(url.href, {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch calls: ${res.status}`);
      }

      const data = await res.json();
      const calls = data.results;

      // Process and upsert calls
      for (const call of calls) {
        const { id, properties } = call;

        await supabase
          .from('calls')
          .upsert({
            id,
            hs_call_title: properties.hs_call_title,
            hs_call_duration: Number(properties.hs_call_duration) || 0,
            hs_call_direction: properties.hs_call_direction,
            hs_call_status: properties.hs_call_status,
            hs_timestamp: properties.hs_timestamp,
            hubspot_owner_id: properties.hubspot_owner_id,
            hs_call_from_number: properties.hs_call_from_number,
            hs_call_to_number: properties.hs_call_to_number
          });
      }

      totalSynced += calls.length;
      hasMore = !!data.paging?.next?.after;
      after = data.paging?.next?.after;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `✅ Synced ${totalSynced} calls successfully using CRM v3 API`
      })
    };
  } catch (error) {
    console.error('Sync error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
