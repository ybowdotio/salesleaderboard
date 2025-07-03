const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');

const hubspotToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async () => {
  const chicagoToday = DateTime.now().setZone('America/Chicago').toISODate(); // e.g. "2025-07-03"

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

  // 1. Get last cursor
  const { data: cursorRow, error: cursorError } = await supabase
    .from('sync_cursor')
    .select('cursor')
    .eq('source', 'calls')
    .single();

  const cursor = cursorRow?.cursor || null;

  // 2. Build HubSpot request
  const hsUrl = new URL('https://api.hubapi.com/crm/v3/objects/calls');
  hsUrl.searchParams.set('limit', '100');
  hsUrl.searchParams.set('properties', callProperties.join(','));
  if (cursor) hsUrl.searchParams.set('after', cursor); // no sort param!

  const response = await fetch(hsUrl.href, {
    headers: {
      Authorization: `Bearer ${hubspotToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    return {
      statusCode: response.status,
      body: JSON.stringify({ error: await response.text() }),
    };
  }

  const json = await response.json();
  const calls = json.results || [];

  // 3. Filter for today (Chicago timezone)
  const rows = calls
    .map((c) => {
      const ts = c.properties.hs_timestamp;
      const localDate = ts
        ? DateTime.fromISO(ts, { zone: 'utc' }).setZone('America/Chicago').toISODate()
        : null;

      return {
        call_id: c.id,
        timestamp_iso: ts,
        rep_id: c.properties.hubspot_owner_id || null,
        duration_seconds: parseInt(c.properties.hs_call_duration || '0'),
        from_number: c.properties.hs_call_from_number || null,
        to_number: c.properties.hs_call_to_number || null,
        disposition: c.properties.hs_call_disposition || null,
        body: c.properties.hs_call_body || null,
        call_date: localDate,
      };
    })
    .filter((row) => row.call_date === chicagoToday);

  // 4. Insert new calls
  const { error: insertError } = await supabase.from('calls').insert(rows);
  if (insertError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: insertError.message }),
    };
  }

  // 5. Update cursor
  const nextCursor = json.paging?.next?.after || cursor;
  const { error: updateError } = await supabase
    .from('sync_cursor')
    .upsert({
      source: 'calls',
      cursor: nextCursor,
    });

  if (updateError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: updateError.message }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      inserted: rows.length,
      cursor: nextCursor,
      complete: !json.paging?.next,
    }),
  };
};
