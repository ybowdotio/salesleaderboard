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

    const enrichedCalls = await Promise.all(
      calls.map(async (call) => {
        const props = call.properties;
        const call_id = call.id;

        // Convert timestamp to date formats
        const timestamp_ms = parseInt(props.hs_timestamp || '0');
        const timestamp_iso = new Date(timestamp_ms).toISOString();
        const call_date = timestamp_iso.slice(0, 10);

        // Get contact name (via association)
        let contact_name = null;
        try {
          const associations = await hubspot.get(`/crm/v4/objects/calls/${call_id}/associations/contacts`);
          const contactId = associations?.data?.results?.[0]?.id;
          if (contactId) {
            const contact = await hubspot.get(`/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname`);
            const cp = contact.data.properties;
            contact_name = [cp.firstname, cp.lastname].filter(Boolean).join(' ');
          }
        } catch (_) {}

        // Get owner name
        let owner_name = null;
        try {
          const ownerId = props.hubspot_owner_id;
          if (ownerId) {
            const owner = await hubspot.get(`/crm/v3/owners/${ownerId}`);
            owner_name = owner.data.firstName + ' ' + owner.data.lastName;
          }
        } catch (_) {}

        return {
          call_id,
          contact_id: contact_name ? null : null, // You can populate if needed
          owner_id: props.hubspot_owner_id || null,
          direction: props.hs_call_direction || null,
          duration_seconds: parseInt(props.hs_call_duration || '0'),
          timestamp: timestamp_ms,
          timestamp_iso,
          call_date,
          contact_name,
          owner_name,
        };
      })
    );

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
