const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

exports.handler = async function () {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !HUBSPOT_PRIVATE_APP_TOKEN) {
    const msg = '❌ Missing required environment variables';
    console.error(msg);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: msg }),
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const todayDate = dayjs().tz('America/Chicago').format('YYYY-MM-DD');

  const callProperties = [
    'hs_call_title',
    'hs_call_duration',
    'hs_call_from_number',
    'hs_call_to_number',
    'hubspot_owner_id',
    'hs_timestamp',
    'hs_call_disposition',
    'hs_call_body'
  ];

  let after = undefined;
  let totalInserted = 0;

  try {
    while (true) {
      const url = new URL('https://api.hubapi.com/crm/v3/objects/calls');
      url.searchParams.append('limit', 30);
      url.searchParams.append('properties', callProperties.join(','));
      url.searchParams.append('archived', 'false');
      if (after) {
        url.searchParams.append('after', after);
      }

      const response = await axios.get(url.toString(), {
        headers: {
          Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });

      const results = response.data.results || [];

      const callsToInsert = results.map((call) => {
        const props = call.properties || {};
        const timestamp = props.hs_timestamp;

        if (!timestamp) return null;

        const localDate = dayjs(timestamp).tz('America/Chicago').format('YYYY-MM-DD');
        if (localDate !== todayDate) return null;

        return {
          call_id: call.id,
          owner_id: props.hubspot_owner_id || null,
          owner_name: null, // populated later by leaderboard sync
          title: props.hs_call_title || null,
          duration_seconds: props.hs_call_duration ? Math.floor(parseInt(props.hs_call_duration, 10) / 1000) : 0,
          from_number: props.hs_call_from_number || null,
          to_number: props.hs_call_to_number || null,
          disposition: props.hs_call_disposition || null,
          body: props.hs_call_body || null,
          timestamp_iso: props.hs_timestamp || null
        };
      }).filter(Boolean);

      if (callsToInsert.length > 0) {
        const { error } = await supabase
          .from('calls')
          .upsert(callsToInsert, { onConflict: ['call_id'] });

        if (error) {
          console.error('❌ Error inserting calls:', error);
          await supabase.from('sync_logs').insert({
            function_name: 'syncCallLogs',
            status: 'error',
            message: error.message || JSON.stringify(error),
          });
          return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
          };
        }

        totalInserted += callsToInsert.length;
      }

      after = response.data?.paging?.next?.after;
      if (!after) break;
    }

    await supabase.from('sync_logs').insert({
      function_name: 'syncCallLogs',
      status: 'success',
      message: `Inserted ${totalInserted} calls for ${todayDate}.`,
    });

    console.log(`✅ Inserted ${totalInserted} calls into Supabase for ${todayDate}.`);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, inserted: totalInserted }),
    };
  } catch (err) {
    console.error('🔥 Unexpected error during call sync:', err);
    await supabase.from('sync_logs').insert({
      function_name: 'syncCallLogs',
      status: 'error',
      message: err.message || 'Unexpected error',
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', message: err.message }),
    };
  }
};
