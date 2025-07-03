const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
  const syncSource = 'calls_timestamp_cursor_v2';
  let totalProcessed = 0;

  try {
    const { data: cursorData, error: cursorError } = await supabase
      .from('sync_cursor')
      .select('cursor')
      .eq('source', syncSource)
      .single();

    if (cursorError && cursorError.code !== 'PGRST116') {
      throw new Error(`Failed to retrieve sync cursor: ${cursorError.message}`);
    }
    
    const now = dayjs().tz('America/Chicago');
    const startOfMonth = now.startOf('month').toISOString();
    const endOfMonth = now.endOf('month').toISOString();

    let nextCursor = cursorData?.cursor || startOfMonth;
    let lastProcessedIds = [];

    let hasMore = true;
    while(hasMore) {
      const hsUrl = 'https://api.hubapi.com/crm/v3/objects/calls/search';
      const requestBody = {
        filterGroups: [{
          filters: [
            { propertyName: 'hs_timestamp', operator: 'GTE', value: nextCursor },
            { propertyName: 'hs_timestamp', operator: 'LTE', value: endOfMonth },
            { propertyName: 'hs_object_id', operator: 'NOT_IN', values: lastProcessedIds }
          ]
        }],
        sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
        properties: [ 'hs_timestamp', 'hubspot_owner_id', 'hs_call_duration', 'hs_call_from_number', 'hs_call_to_number', 'hs_call_disposition', 'hs_call_body' ],
        limit: 100
      };

      const response = await fetch(hsUrl, { method: 'POST', headers: { 'Authorization': `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
      if (!response.ok) { throw new Error(`HubSpot API Error: ${await response.text()}`); }

      const json = await response.json();
      const calls = json.results || [];

      if (calls.length > 0) {
        const rows = calls.map(call => ({ call_id: call.id, timestamp_iso: call.properties.hs_timestamp, rep_id: call.properties.hubspot_owner_id || null, duration_seconds: Math.round(parseInt(call.properties.hs_call_duration || '0', 10) / 1000), from_number: call.properties.hs_call_from_number || null, to_number: call.properties.hs_call_to_number || null, disposition: call.properties.hs_call_disposition || null, body: call.properties.hs_call_body || null, }));
        const { error: insertError } = await supabase.from('calls').upsert(rows, { onConflict: 'call_id' });
        if (insertError) { throw new Error(`Supabase insert error on batch: ${insertError.message}`); }
        
        totalProcessed += rows.length;
        
        const newCursor = calls[calls.length - 1].properties.hs_timestamp;

        if (newCursor === nextCursor) {
            lastProcessedIds.push(...calls.map(c => c.id));
        } else {
            lastProcessedIds = calls.map(c => c.id);
        }

        nextCursor = newCursor;
        
        const { error: updateCursorError } = await supabase.from('sync_cursor').upsert( { source: syncSource, cursor: nextCursor, updated_at: new Date().toISOString() }, { onConflict: 'source' } );
        if (updateCursorError) { console.error('Failed to update sync_cursor:', updateCursorError.message); }

        if (calls.length < 100) {
          hasMore = false;
        } else {
          await sleep(1000);
        }
      } else {
        hasMore = false;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        inserted: totalProcessed,
        message: `Sync complete for ${now.format('MMMM YYYY')}. Processed ${totalProcessed} calls.`,
      }),
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Function failed: ${err.message}` }),
    };
  }
};
