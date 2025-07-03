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

    const urlBase = 'https://api.hubapi.com/crm/v3/objects/calls';
    let after = undefined;
    let todayCalls = [];
    let scanned = 0;

    while (true) {
      const url = new URL(urlBase);
      url.searchParams.set('limit', '100');
      url.searchParams.set('properties', [
        'hs_timestamp',
        'hs_createdate',
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
      scanned += results.length;

      const todays = results.filter(c => {
        const props = c.properties || {};
        const date = props.hs_timestamp || props.hs_createdate;
        return date && date.startsWith(todayISO);
      });

      todayCalls.push(...todays);

      if (!data.paging?.next || todayCalls.length >= 300) break;
      after = data.paging.next.after;
    }

    console.info(`Scanned ${scanned} calls, ${todayCalls.length} matched today (${todayISO})`);

    let inserted = 0;

    for (const call of todayCalls) {
      const props = call.properties;

      const { error } = await supabase.from('calls').upsert({
        call_id: call.id,
        timestamp_iso: props.hs_timestamp || props.hs_createdate,
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
        inserted++;
        console.info(`✅ Saved call ${call.id}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, inserted }),
    };
  } catch (e) {
    console.error('Fatal error in syncCallLogs', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
