const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async function () {
  try {
    console.info('Starting syncCallLogs...');

    const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    const todayISO = new Date().toISOString().split('T')[0];

    let calls = [];
    let after = undefined;
    let more = true;

    // Fetch up to 30 calls from HubSpot
    while (more && calls.length < 30) {
      const url = new URL('https://api.hubapi.com/crm/v3/objects/calls');
      url.searchParams.set('limit', '30');
      url.searchParams.set('properties', [
        'hs_timestamp',
        'hubspot_owner_id',
        'hs_call_title',
        'hs_call_body',
        'hs_call_duration',
        'hs_call_from_number',
        'hs_call_to_number',
        'hs_call_disposition',
      ].join(','));
      if (after) url.searchParams.set('after', after);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HubSpot API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const results = data.results || [];

      calls.push(...results);

      if (data.paging && data.paging.next) {
        after = data.paging.next.after;
      } else {
        more = false;
      }
    }

    const callsToday = calls.filter(c =>
      c.properties?.hs_timestamp?.startsWith(todayISO)
    );

    console.info(`Fetched ${calls.length} calls, ${callsToday.length} match today's date.`);

    for (const call of callsToday) {
      const props = call.properties;

      const { data, error } = await supabase.from('calls').upsert({
        call_id: call.id,
        timestamp_iso: props.hs_timestamp,
        owner_id: props.hubspot_owner_id,
        title: props.hs_call_title,
        body: props.hs_call_body,
        duration_seconds: props.hs_call_duration ? parseInt(props.hs_call_duration) : null,
        from_number: props.hs_call_from_number,
        to_number: props.hs_call_to_number,
        disposition: props.hs_call_disposition,
        created_at: new Date().toISOString(),
      });

      if (error) {
        console.error(`❌ Error saving call ${call.id}`, error.message);
      } else {
        console.info(`✅ Saved call ${call.id}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        inserted: callsToday.length,
      }),
    };
  } catch (e) {
    console.error('Fatal error in syncCallLogs', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
