// syncCallLogs.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Environment variables
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
    // Calculate current month start
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const callsResponse = await axios.get('https://api.hubapi.com/crm/v3/objects/calls?limit=10&properties=hs_timestamp,direction,hs_call_duration,hubspot_owner_id,hs_call_title', {
      headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` }
    });

    const calls = callsResponse.data.results;
    console.info(`Fetched ${calls.length} calls`);

    const allCalls = [];

    for (const call of calls) {
      const props = call.properties || {};
      const timestampRaw = props.hs_timestamp;

      if (!timestampRaw || isNaN(Number(timestampRaw))) {
        console.warn(`Skipping call with invalid timestamp. Call ID: ${call.id}`);
        continue;
      }

      const timestamp = new Date(Number(timestampRaw));
      const timestampISO = timestamp.toISOString();
      const timestampDate = timestampISO.split('T')[0];
      const timestampYear = timestamp.getFullYear();

      if (timestampISO < startOfMonth) {
        console.info(`Skipping call before start of month. Call ID: ${call.id}`);
        continue;
      }

      // Fetch contact association
      const associations = call.associations || {};
      const contactId = associations.contacts?.results?.[0]?.id;
      let contactName = null;

      if (contactId) {
        try {
          const contactRes = await axios.get(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname`, {
            headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` }
          });
          const cp = contactRes.data.properties;
          contactName = `${cp.firstname || ''} ${cp.lastname || ''}`.trim();
        } catch (err) {
          console.warn(`Failed to fetch contact name for ID: ${contactId}`);
        }
      }

      // Fetch owner
      let ownerName = null;
      if (props.hubspot_owner_id) {
        try {
          const ownerRes = await axios.get(`https://api.hubapi.com/crm/v3/owners/${props.hubspot_owner_id}`, {
            headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` }
          });
          ownerName = ownerRes.data.fullName;
        } catch (err) {
          console.warn(`Failed to fetch owner name for ID: ${props.hubspot_owner_id}`);
        }
      }

      allCalls.push({
        call_id: call.id,
        contact_id: contactId || null,
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
