const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async () => {
  console.info('🟡 Starting call log sync...');
  if (!HUBSPOT_PRIVATE_APP_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing environment variables');
    return { statusCode: 500, body: 'Missing environment variables' };
  }

  try {
    const now = new Date();
    const todayISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      .toISOString()
      .split('T')[0];

    const callsResponse = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/calls/search',
      {
        limit: 50,
        sorts: ['-hs_timestamp'],
        properties: [
          'hs_timestamp',
          'hs_createdate',
          'direction',
          'hs_call_duration',
          'hubspot_owner_id'
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const calls = callsResponse.data.results || [];
    console.info(`📞 Pulled ${calls.length} calls from HubSpot`);
    const allCalls = [];

    for (const call of calls) {
      const props = call.properties || {};
      let rawTimestamp = props.hs_timestamp || props.hs_createdate || call.createdAt;

      if (!rawTimestamp) {
        console.warn(`⚠️ Skipping call with no timestamp. Call ID: ${call.id}`);
        continue;
      }

      const timestamp = new Date(rawTimestamp);
      if (isNaN(timestamp)) {
        console.warn(`⚠️ Skipping call with invalid timestamp: ${rawTimestamp}`);
        continue;
      }

      const timestampISO = timestamp.toISOString();
      const timestampDate = timestampISO.split('T')[0];
      const timestampYear = timestamp.getUTCFullYear();

      if (timestampDate !== todayISO) {
        console.info(`⏩ Skipping call outside today (${timestampDate} !== ${todayISO}). Call ID: ${call.id}`);
        continue;
      }

      // Fetch contact
      let contactId = null;
      try {
        const assocRes = await axios.get(
          `https://api.hubapi.com/crm/v4/objects/calls/${call.id}/associations/contacts`,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`
            }
          }
        );
        contactId = assocRes.data?.results?.[0]?.toObjectId;
      } catch {
        console.warn(`⚠️ Failed to fetch contact association. Call ID: ${call.id}`);
      }

      if (!contactId) continue;

      // Contact name
      let contactName = null;
      try {
        const res = await axios.get(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname`,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`
            }
          }
        );
        const cp = res.data.properties;
        contactName = `${cp.firstname || ''} ${cp.lastname || ''}`.trim();
      } catch {}

      // Owner name
      let ownerName = null;
      if (props.hubspot_owner_id) {
        try {
          const res = await axios.get(
            `https://api.hubapi.com/crm/v3/owners/${props.hubspot_owner_id}`,
            {
              headers: {
                Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`
              }
            }
          );
          ownerName = res.data.fullName;
        } catch {}
      }

      allCalls.push({
        call_id: call.id,
        contact_id: contactId,
        owner_id: props.hubspot_owner_id || null,
        duration_seconds: props.hs_call_duration ? parseInt(props.hs_call_duration) : null,
        direction: props.direction || null,
        contact_name: contactName || null,
        owner_name: ownerName || null,
        timestamp_iso: timestampISO,
        timestamp_date: timestampDate,
        timestamp_year: timestampYear
      });
    }

    if (allCalls.length === 0) {
      console.info('⚪ No call records to sync.');
      return { statusCode: 200, body: 'No call records to sync.' };
    }

    const { error } = await supabase.from('calls').upsert(allCalls, { onConflict: ['call_id'] });

    if (error) {
      console.error('❌ Upsert error:', error);
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    console.info(`✅ Synced ${allCalls.length} calls.`);
    return { statusCode: 200, body: `✅ Synced ${allCalls.length} calls.` };
  } catch (err) {
    console.error('❌ Error during sync:', err);
    return { statusCode: 500, body: err.toString() };
  }
};
