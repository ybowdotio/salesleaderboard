const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async () => {
  console.info('Starting sync...');

  if (!HUBSPOT_PRIVATE_APP_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing environment variables');
    return { statusCode: 500, body: 'Missing environment variables' };
  }

  try {
    const todayISO = new Date().toISOString().split('T')[0]; // e.g. '2025-07-03'
    const startOfTodayUnix = new Date(`${todayISO}T00:00:00.000Z`).getTime();

    const callsResponse = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/calls/search',
      {
        filterGroups: [{
          filters: [{
            propertyName: 'hs_timestamp',
            operator: 'GTE',
            value: startOfTodayUnix
          }]
        }],
        limit: 30,
        properties: [
          'hs_timestamp',
          'direction',
          'hs_call_duration',
          'hubspot_owner_id',
          'hs_call_title'
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const calls = callsResponse.data.results;
    console.info(`Fetched ${calls.length} calls`);
    const allCalls = [];

    for (const call of calls) {
      const props = call.properties || {};
      let timestampRaw = props.hs_timestamp;
      let timestamp = null;

      if (timestampRaw && !isNaN(Number(timestampRaw))) {
        timestamp = new Date(Number(timestampRaw));
      } else if (call.createdAt) {
        try {
          timestamp = new Date(call.createdAt);
          if (isNaN(timestamp.getTime())) throw new Error();
          console.debug(`Using fallback createdAt for call ID: ${call.id}`);
        } catch {
          console.warn(`Skipping call with invalid fallback timestamp. Call ID: ${call.id}`);
          continue;
        }
      } else {
        console.warn(`Skipping call with no usable timestamp. Call ID: ${call.id}`);
        continue;
      }

      const timestampISO = timestamp.toISOString();
      const timestampDate = timestampISO.split('T')[0];
      const timestampYear = timestamp.getFullYear();

      if (timestamp < startOfTodayUnix) {
        console.info(`Skipping call before today. Call ID: ${call.id}`);
        continue;
      }

      let contactId = null;
      try {
        const assocRes = await axios.get(
          `https://api.hubapi.com/crm/v4/objects/calls/${call.id}/associations/contacts`,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
        contactId = assocRes.data?.results?.[0]?.toObjectId;
      } catch (err) {
        console.warn(`Failed to fetch contact association for call ID: ${call.id}`);
      }

      if (!contactId) {
        console.warn(`Skipping call without contact ID. Call ID: ${call.id}`);
        continue;
      }

      let contactName = null;
      try {
        const contactRes = await axios.get(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname`,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
        const cp = contactRes.data.properties;
        contactName = `${cp.firstname || ''} ${cp.lastname || ''}`.trim();
      } catch (err) {
        console.warn(`Failed to fetch contact name for ID: ${contactId}`);
      }

      let ownerName = null;
      if (props.hubspot_owner_id) {
        try {
          const ownerRes = await axios.get(
            `https://api.hubapi.com/crm/v3/owners/${props.hubspot_owner_id}`,
            {
              headers: {
                Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
          ownerName = ownerRes.data.fullName;
        } catch (err) {
          console.warn(`Failed to fetch owner name for ID: ${props.hubspot_owner_id}`);
        }
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
      console.info('No call records to sync.');
      return { statusCode: 200, body: 'No call records to sync.' };
    }

    console.info(`Upserting ${allCalls.length} call record(s) into Supabase...`);
    const { error } = await supabase.from('calls').upsert(allCalls, { onConflict: ['call_id'] });

    if (error) {
      console.error('Upsert error:', error);
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    console.info('Sync complete.');
    return { statusCode: 200, body: 'Sync complete.' };
  } catch (error) {
    console.error('Error during sync:', error);
    return { statusCode: 500, body: error.toString() };
  }
};
