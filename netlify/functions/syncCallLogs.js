const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Environment variables
const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async () => {
  if (!HUBSPOT_PRIVATE_APP_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing environment variables.");
    return { statusCode: 500, body: 'Missing environment variables' };
  }

  const hubspot = axios.create({
    baseURL: 'https://api.hubapi.com',
    headers: {
      Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime().toString();

  const callFilter = {
    propertyName: "hs_call_direction",
    operator: "HAS_PROPERTY",
  };

  const dateFilter = {
    propertyName: "hs_timestamp",
    operator: "GTE",
    value: firstDayOfMonth,
  };

  const requestBody = {
    filterGroups: [{ filters: [callFilter, dateFilter] }],
    sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
    properties: [
      "hs_call_title",
      "hs_call_duration",
      "hs_call_direction",
      "hs_timestamp",
      "hubspot_owner_id",
      "hs_call_disposition",
      "hs_call_from_number",
      "hs_call_to_number"
    ],
    limit: 100,
  };

  try {
    const { data } = await hubspot.post('/crm/v3/objects/calls/search', requestBody);
    const calls = data.results;

const enrichedCalls = (
  await Promise.all(
    calls.map(async (call) => {
      const contactId = call.properties.hs_call_to_object_id;
      const ownerId = call.properties.hubspot_owner_id;
      const timestamp = parseInt(call.properties.hs_timestamp || "0", 10);
      const direction = call.properties.hs_call_direction || null;
      const duration = parseInt(call.properties.hs_call_duration || "0", 10);
      const callId = call.id;

      // Skip if no contactId
      if (!contactId) return null;

      // Get contact name
      const contactRes = await axios.get(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname`, {
        headers,
      });
      const cp = contactRes.data.properties;
      const contact_name = [cp.firstname, cp.lastname].filter(Boolean).join(' ') || 'Unknown';

      // Get owner name
      let owner_name = 'Unknown';
      if (ownerId) {
        const ownerRes = await axios.get(`https://api.hubapi.com/crm/v3/owners/${ownerId}`, {
          headers,
        });
        owner_name = ownerRes.data.firstName + ' ' + ownerRes.data.lastName;
      }

      const timestamp_iso = new Date(timestamp).toISOString();
      const call_date = timestamp_iso.split('T')[0];

      return {
        call_id: callId,
        contact_id: contactId,
        owner_id: ownerId || null,
        timestamp,
        direction,
        duration_seconds: duration,
        contact_name,
        owner_name,
        timestamp_iso,
        call_date,
      };
    })
  )
).filter(Boolean); // remove skipped nulls

    // Insert or update in Supabase
    const { data: upserted, error } = await supabase
      .from('calls')
      .upsert(enrichedCalls, { onConflict: ['call_id'] });

    if (error) {
      console.error('Upsert error:', error);
      return { statusCode: 500, body: 'Supabase upsert failed' };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ inserted: enrichedCalls.length }),
    };
  } catch (err) {
    console.error('Unexpected error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
