const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

exports.handler = async function (event) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !HUBSPOT_PRIVATE_APP_TOKEN) {
    console.error('❌ Missing env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing environment variables' }),
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const todayDate = dayjs().tz('America/Chicago').format('YYYY-MM-DD');
  const callProperties = [
    'hs_timestamp',
    'hs_createdate',
    'hubspot_owner_id',
    'hs_call_title',
    'hs_call_body',
    'hs_call_duration',
    'hs_call_from_number',
    'hs_call_to_number',
    'hs_call_disposition',
  ];

  const force = event.queryStringParameters?.force === 'true';

  let lastCursor = null;

  // Fetch the last cursor unless force=true
  if (!force) {
    const { data, error } = await supabase
      .from('sync_cursors')
      .select('last_cursor')
      .eq('id', 'calls')
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('❌ Failed to fetch cursor:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load sync cursor' }),
      };
    }

    if (data?.last_cursor) {
      lastCursor = data.last_cursor;
    }
  }

  try {
    const url = new URL('https://api.hubapi.com/crm/v3/objects/calls');
    url.searchParams.append('limit', '30');
    url.searchParams.append('properties', callProperties.join(','));
    url.searchParams.append('archived', 'false');
    if (lastCursor) url.searchParams.append('after', lastCursor);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HubSpot API error: ${response.status}`);
    }

    const json = await response.json();
    const results = json.results || [];
    const newCursor = json?.paging?.next?.after || null;

    const callsToInsert = results
      .map((call) => {
        const props = call.properties || {};
        const hsDate = props.hs_timestamp || props.hs_createdate;
        if (!hsDate) return null;

        const localDate = dayjs(hsDate).tz('America/Chicago').format('YYYY-MM-DD');
        if (localDate !== todayDate) return null;

        return {
          call_id: call.id,
          timestamp_iso: hsDate,
          owner_id: props.hubspot_owner_id,
          title: props.hs_call_title,
          duration_seconds: props.hs_call_duration ? parseInt(props.hs_call_duration) : null,
          from_number: props.hs_call_from_number,
          to_number: props.hs_call_to_number,
          disposition: props.hs_call_disposition,
          body: props.hs_call_body,
        };
      })
      .filter(Boolean);

    if (callsToInsert.length > 0) {
      const { error } = await supabase.from('calls').upsert(callsToInsert, { onConflict: ['call_id'] });

      if (error) {
        console.error('❌ Insert error:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: error.message }),
        };
      }
    }

    // Save new cursor
    const { error: cursorErr } = await supabase
      .from('sync_cursors')
      .upsert({
        id: 'calls',
        last_cursor: newCursor,
        last_synced: new Date().toISOString(),
      });

    if (cursorErr) {
      console.error('❌ Failed to save cursor:', cursorErr.message);
    }

    await supabase.from('sync_logs').insert({
      function_name: 'syncCallLogs',
      status: 'success',
      message: `Synced ${callsToInsert.length} calls from batch.`,
    });

    console.log(`✅ Synced ${callsToInsert.length} call(s). New cursor: ${newCursor || 'none'}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        inserted: callsToInsert.length,
        cursor: newCursor,
        complete: !newCursor,
      }),
    };
  } catch (err) {
    console.error('❌ Fatal error during syncCallLogs:', err);
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
