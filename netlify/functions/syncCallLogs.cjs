const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

exports.handler = async () => {
  const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!HUBSPOT_PRIVATE_APP_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing critical environment variables' }),
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const callProperties = [
    'hs_timestamp',
    'hubspot_owner_id',
    'hs_call_title',
    'hs_call_duration',
    'hs_call_from_number',
    'hs_call_to_number',
    'hs_call_disposition',
    'hs_call_body',
  ];

  // Define the start and end of the day in UTC for the query
  const startOfDay = dayjs().tz('America/Chicago').startOf('day').toISOString();
  const endOfDay = dayjs().tz('America/Chicago').endOf('day').toISOString();

  // Use the Search API endpoint
  const hsUrl = 'https://api.hubapi.com/crm/v3/objects/calls/search';

  const requestBody = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'hs_timestamp',
            operator: 'GTE',
            value: startOfDay
          },
          {
            propertyName: 'hs_timestamp',
            operator: 'LTE',
            value: endOfDay
          }
        ]
      }
    ],
    properties: callProperties,
    sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
    limit: 100
  };

  try {
    const response = await fetch(hsUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Log the detailed error for debugging
      console.error(`HubSpot API Error: ${errorText}`);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `HubSpot API Error: ${errorText}` }),
      };
    }

    const json = await response.json();
    const calls = json.results || [];

    if (calls.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, inserted: 0, message: 'No new calls from HubSpot to process.' }),
      };
    }

    const rows = calls.map((call) => ({
      call_id: call.id,
      timestamp_iso: call.properties.hs_timestamp,
      rep_id: call.properties.hubspot_owner_id || null,
      duration_seconds: Math.round(parseInt(call.properties.hs_call_duration || '0', 10) / 1000),
      from_number: call.properties.hs_call_from_number || null,
      to_number: call.properties.hs_call_to_number || null,
      disposition: call.properties.hs_call_disposition || null,
      body: call.properties.hs_call_body || null,
    }));

    const { error: insertError } = await supabase.from('calls').upsert(rows, {
      onConflict: 'call_id',
    });

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Supabase insert error: ${insertError.message}` }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        inserted: rows.length,
        message: `Processed and upserted ${rows.length} calls from HubSpot.`,
      }),
    };

  } catch (err) {
    console.error('Unexpected function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Unexpected function error: ${err.message}` }),
    };
  }
};
