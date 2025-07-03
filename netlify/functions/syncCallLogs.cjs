const { createClient } = require('@supabase/supabase-js');

// Note: We don't need Day.js anymore for this more advanced method
// as we'll be using the cursor from the last sync.

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
  const syncSource = 'calls'; // To identify our cursor in the table

  try {
    // 1. Get the last known cursor from Supabase
    const { data: cursorData, error: cursorError } = await supabase
      .from('sync_cursor')
      .select('cursor')
      .eq('source', syncSource)
      .single();

    if (cursorError && cursorError.code !== 'PGRST116') {
      // PGRST116 means "No rows found", which is fine on the first run.
      // Any other error is a real problem.
      throw new Error(`Failed to retrieve sync cursor: ${cursorError.message}`);
    }

    const lastCursor = cursorData?.cursor;
    let allCalls = [];
    let nextCursor = lastCursor;

    // 2. Loop through HubSpot API pages
    do {
      const hsUrl = 'https://api.hubapi.com/crm/v3/objects/calls/search';
      const requestBody = {
        // Important: We sort by create date to ensure a stable order for paging
        sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
        properties: [
            'hs_timestamp', 'hubspot_owner_id', 'hs_call_title', 
            'hs_call_duration', 'hs_call_from_number', 'hs_call_to_number', 
            'hs_call_disposition', 'hs_call_body'
        ],
        limit: 100,
        after: nextCursor // This is the key to pagination
      };

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
        throw new Error(`HubSpot API Error: ${errorText}`);
      }

      const json = await response.json();
      if (json.results && json.results.length > 0) {
        allCalls.push(...json.results);
      }
      
      // Update cursor for the next loop iteration
      nextCursor = json.paging?.next?.after;

    } while (nextCursor); // Keep looping as long as there is a 'next' page

    if (allCalls.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, inserted: 0, message: 'No new calls from HubSpot to process.' }),
      };
    }

    // 3. Process and save the calls to the 'calls' table
    const rows = allCalls.map((call) => ({
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
      throw new Error(`Supabase insert error: ${insertError.message}`);
    }

    // 4. Update the cursor in Supabase for the next run
    const latestCursor = allCalls[allCalls.length - 1].id;
    const { error: updateCursorError } = await supabase
        .from('sync_cursor')
        .upsert({
            source: syncSource,
            cursor: latestCursor,
            updated_at: new Date().toISOString()
        }, { onConflict: 'source' });

    if(updateCursorError) {
        // This isn't a fatal error for the current run, but should be logged
        console.error('Failed to update sync_cursor:', updateCursorError.message);
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
