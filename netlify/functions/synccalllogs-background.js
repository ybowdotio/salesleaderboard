const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// Initialize dayjs with necessary plugins
dayjs.extend(utc);
dayjs.extend(timezone);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  try {
    const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    const now = dayjs().tz('America/Chicago');
    const startOfMonth = now.startOf('month').toISOString();
    
    let allCalls = [];
    let after = null;
    let hasMore = true;

    console.log('🚀 Starting HubSpot call sync...');

    // Loop to handle HubSpot API pagination
    do {
      const response = await fetch('https://api.hubapi.com/crm/v3/objects/calls/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [
              { propertyName: 'hs_timestamp', operator: 'GTE', value: startOfMonth }
            ]
          }],
          sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
          properties: ['hs_timestamp', 'hubspot_owner_id', 'hs_call_duration'],
          limit: 100,
          after: after // This tells HubSpot which page to get
        })
      });

      if (!response.ok) {
        throw new Error(`HubSpot API Error: ${await response.text()}`);
      }

      const json = await response.json();
      const callsOnPage = json.results || [];
      allCalls = allCalls.concat(callsOnPage);

      // Check for the next page using HubSpot's paging object
      if (json.paging && json.paging.next) {
        hasMore = true;
        after = json.paging.next.after;
      } else {
        hasMore = false;
      }

    } while (hasMore);

    console.log(`✅ Fetched a total of ${allCalls.length} calls from HubSpot for the month.`);

    if (allCalls.length > 0) {
      // Clear the table before inserting fresh data
      console.log('Clearing old calls from Supabase table...');
      const { error: deleteError } = await supabase.from('calls').delete().gte('timestamp_iso', startOfMonth);
      if (deleteError) throw deleteError;
      console.log('✅ Monthly call data cleared.');

      const rows = allCalls.map(call => ({
        call_id: call.id,
        timestamp_iso: call.properties.hs_timestamp,
        rep_id: call.properties.hubspot_owner_id || null,
        duration_seconds: Math.round(parseInt(call.properties.hs_call_duration || '0', 10) / 1000)
      }));

      const { error: insertError } = await supabase.from('calls').upsert(rows, { onConflict: 'call_id' });
      if (insertError) throw insertError;
      
      console.log(`✅ Synced ${rows.length} calls to Supabase.`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: `Sync complete. Processed ${allCalls.length} calls.` }),
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Function failed: ${err.message}` }),
    };
  }
};
