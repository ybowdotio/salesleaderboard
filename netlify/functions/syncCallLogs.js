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
    const msg = 'Missing required environment variables';
    console.error(msg);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: msg }),
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const yesterdayDate = dayjs().tz('America/Chicago').subtract(1, 'day').format('YYYY-MM-DD');

  const callProperties = [
    'hs_call_title',
    'hs_call_duration',
    'hs_call_from_number',
    'hs_call_to_number',
    'hubspot_owner_id',
    'hs_timestamp',
    'hs_call_disposition',
    'hs_call_body',
  ];

  const url = `https://api.hubapi.com/crm/v3/objects/calls?limit=30&properties=${callProperties.join(',')}&archived=false`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    const results = response.data.results || [];

    const callsToInsert = results
      .map((call) => {
        const props = call.properties || {};
        const timestamp = props.hs_timestamp;

        if (!timestamp) return null;

        const localDate = dayjs(timestamp).tz('America/Chicago').format('YYYY-MM-DD');
        if (localDate !== yesterdayDate) {
          console.info(`Skipping call outside yesterday: ${timestamp}`);
          return null;
        }

        return {
          id: call.id,
          owner_id: props.hubspot_owner_id,
          title: props.hs_call_title,
          duration_seconds: parseInt(props.hs_call_duration || '0', 10),
          from_number: props.hs_call_from_number,
          to_number: props.hs_call_to_number,
          disposition: props.hs_call_disposition,
          body: props.hs_call_body,
          timestamp: props.hs_timestamp, // direct ISO 8601 passthrough to timestamptz column
        };
      })
      .filter(Boolean);

    if (callsToInsert.length === 0) {
      console.log('No call logs to insert for yesterday.');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No calls to insert.' }),
      };
    }

    const { error } = await supabase.from('calls').upsert(callsToInsert, { onConflict: ['id'] });

    if (error) {
      console.error('Error inserting calls:', error);
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

    console.log(`✅ Inserted ${callsToInsert.length} calls into Supabase.`);

    await supabase.from('sync_logs').insert({
      function_name: 'syncCallLogs',
      status: 'success',
      message: `Inserted ${callsToInsert.length} calls for ${yesterdayDate}.`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Unexpected error during call sync:', err);

    await supabase.from('sync_logs').insert({
      function_name: 'syncCallLogs',
      status: 'error',
      message: err.message || 'Unexpected error',
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Unexpected error',
        message: err.message,
      }),
    };
  }
};
