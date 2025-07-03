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
      body: JSON.stringify({ error: 'Missing environment variables' }),
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

  const todayISO = dayjs().tz('America/Chicago').format('YYYY-MM-DD');

  const hsUrl = new URL('https://api.hubapi.com/crm/v3/objects/calls');
  hsUrl.searchParams.set('limit', '50');
  hsUrl.searchParams.set('sort', '-hs_timestamp');
  hsUrl.searchParams.set('properties', callProperties.join(','));

  try {
    const response = await fetch(hsUrl.href, {
      headers: {
        Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: errorText }),
      };
    }

    const json = await response.json();
    const calls = json.results || [];

    const rows = calls
      .map((call) => {
        const ts = call.properties.hs_timestamp;
        if (!ts || !ts.startsWith(todayISO)) return null;

        return {
          call_id: call.id,
          timestamp_iso: ts,
          rep_id: call.properties.hubspot_owner_id || null,
          duration_seconds: parseInt(call.properties.hs_call_duration || '0', 10),
          from_number: call.properties.hs_call_from_number || null,
          to_number: call.properties.hs_call_to_number || null,
          disposition: call.properties.hs_call_disposition || null,
          body: call.properties.hs_call_body || null,
        };
      })
      .filter(Boolean);

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('calls').upsert(rows, {
        onConflict: ['call_id'],
      });

      if (insertError) {
        console.error('Insert error:', insertError);
        await supabase.from('sync_logs').insert({
          function_name: 'syncCallLogs',
          status: 'error',
          message: insertError.message,
        });
        return {
          statusCode: 500,
          body: JSON.stringify({ error: insertError.message }),
        };
      }
    }

    await supabase.from('sync_logs').insert({
      function_name: 'syncCallLogs',
      status: 'success',
      message: `Inserted ${rows.length} calls for ${todayISO}.`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        inserted: rows.length,
        message: `Processed ${calls.length} calls from HubSpot.`,
      }),
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    await supabase.from('sync_logs').insert({
      function_name: 'syncCallLogs',
      status: 'error',
      message: err.message,
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
