// syncCallLogs.js (v3 API version)
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async function () {
  const headers = {
    Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  let after = undefined;
  let insertedCount = 0;

  try {
    while (true) {
      const params = {
        limit: 100,
        properties: [
          'hs_call_title',
          'hs_call_duration',
          'hs_timestamp',
          'hubspot_owner_id',
          'hs_call_direction',
          'hs_call_status'
        ]
      };
      if (after) params.after = after;

      const { data } = await axios.get('https://api.hubapi.com/crm/v3/objects/calls', { headers, params });

      for (const call of data.results) {
        const callId = call.id;
        const props = call.properties || {};
        const timestamp = new Date(props.hs_timestamp);

        if (timestamp < startOfMonth) continue;

        // Get associated contact
        const assocRes = await axios.get(
          `https://api.hubapi.com/crm/v3/objects/calls/${callId}/associations/contact`,
          { headers }
        );

        const contactId = assocRes.data.results?.[0]?.id;
        if (!contactId) continue;

        const contactRes = await axios.get(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
          { headers, params: { properties: ['firstname', 'lastname'] } }
        );
        const contact = contactRes.data.properties;
        const contactName = `${contact.firstname || ''} ${contact.lastname || ''}`.trim();

        // Get owner name
        const ownerId = props.hubspot_owner_id;
        let ownerName = null;
        if (ownerId) {
          const ownerRes = await axios.get(`https://api.hubapi.com/crm/v3/owners/${ownerId}`, { headers });
          ownerName = ownerRes.data.fullName || null;
        }

        const callData = {
          call_id: callId,
          contact_id: contactId,
          contact_name: contactName,
          owner_id: ownerId,
          owner_name: ownerName,
          direction: props.hs_call_direction || null,
          duration_seconds: parseInt(props.hs_call_duration) || 0,
          timestamp_iso: timestamp.toISOString(),
          call_date: timestamp.toISOString().split('T')[0]
        };

        await supabase.from('calls').upsert(callData, { onConflict: ['call_id'] });
        insertedCount++;
      }

      if (!data.paging || !data.paging.next) break;
      after = data.paging.next.after;
    }

    return {
      statusCode: 200,
      body: `Successfully synced ${insertedCount} call logs for current month`
    };
  } catch (error) {
    console.error('Error during sync:', error.message, error.response?.data || error);
    return {
      statusCode: 500,
      body: `Error: ${error.message}`
    };
  }
};
