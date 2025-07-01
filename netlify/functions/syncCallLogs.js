const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Env vars (confirmed by you)
const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// HubSpot API setup
const hubspot = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: {
    Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

exports.handler = async function () {
  try {
    console.info('Fetching contacts from HubSpot...');
    const contactRes = await hubspot.get('/crm/v3/objects/contacts?limit=100&properties=firstname,lastname');
    const contacts = contactRes.data.results;

    console.info(`Fetched ${contacts.length} contacts`);

    // Build a map of contactId -> "Full Name"
    const contactMap = {};
    contacts.forEach(contact => {
      const id = contact.id;
      const props = contact.properties || {};
      contactMap[id] = [props.firstname, props.lastname].filter(Boolean).join(' ').trim();
    });

    const allCalls = [];

    for (const contact of contacts) {
      const contactId = contact.id;
      console.info(`Fetching engagements for contact ${contactId}...`);

      const callsRes = await hubspot.get(`/engagements/v1/engagements/associated/contact/${contactId}/paged?limit=100`);
      const calls = callsRes.data.results.filter(e => e.engagement.type === 'CALL');
      console.info(`Contact ${contactId} has ${calls.length} call(s)`);

      for (const call of calls) {
        const engagement = call.engagement;
        const metadata = call.metadata || {};

        const callId = engagement.id;
        const ownerId = engagement.ownerId;
        const timestamp = engagement.timestamp;
        const durationMs = metadata.durationMilliseconds || 0;
        const direction = metadata.fromNumber ? 'outbound' : 'inbound';

        // Optionally fetch owner name from Supabase (you could cache this if needed)
        let ownerName = null;
        if (ownerId) {
          const { data: ownerData } = await supabase
            .from('owners')
            .select('name')
            .eq('owner_id', ownerId)
            .single();
          ownerName = ownerData?.name || null;
        }

        allCalls.push({
          call_id: callId,
          contact_id: contactId,
          contact_name: contactMap[contactId] || null,
          owner_id: ownerId || null,
          owner_name: ownerName,
          timestamp: timestamp || null,
          timestamp_iso: new Date(timestamp).toISOString(),
          call_date: new Date(timestamp).toISOString().split('T')[0],
          duration_seconds: Math.round(durationMs / 1000),
          direction
        });
      }
    }

    console.info(`Upserting ${allCalls.length} call record(s) into Supabase...`);

    const { error } = await supabase.from('calls').upsert(allCalls, { onConflict: ['call_id'] });

    if (error) {
      console.error('Supabase upsert error:', error);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to upsert call logs' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ inserted: allCalls.length })
    };
  } catch (err) {
    console.error('Error during sync:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
