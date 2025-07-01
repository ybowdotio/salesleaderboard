const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// ✅ New environment variable name to avoid Netlify tree-shaking
const HUBSPOT_APP_TOKEN = process.env.HUBSPOT_APP_TOKEN;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async function () {
  try {
    if (!HUBSPOT_APP_TOKEN) {
      throw new Error('Missing HubSpot token. Check environment variables.');
    }

    // Step 1: Fetch contacts (limit 10 for testing)
    const contactsResp = await axios.get(
      'https://api.hubapi.com/crm/v3/objects/contacts?limit=10&properties=firstname,lastname,hubspot_owner_id',
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_APP_TOKEN}`,
        },
      }
    );

    const contacts = contactsResp.data.results;
    const allCallRecords = [];

    // Step 2: For each contact, fetch associated engagements
    for (const contact of contacts) {
      const contactId = contact.id;
      const ownerId = contact.properties?.hubspot_owner_id || null;

      const engagementsResp = await axios.get(
        `https://api.hubapi.com/engagements/v1/engagements/associated/contact/${contactId}/paged`,
        {
          headers: {
            Authorization: `Bearer ${HUBSPOT_APP_TOKEN}`,
          },
        }
      );

      const calls = (engagementsResp.data.results || []).filter(
        (e) => e.engagement?.type === 'CALL'
      );

      const cleanedCalls = calls.map((call) => ({
        contact_id: contactId,
        owner_id: ownerId,
        call_id: call.engagement.id,
        timestamp: call.engagement.timestamp,
        duration_ms: call.engagement.metadata?.durationMilliseconds || 0,
        direction: call.engagement.metadata?.fromNumber ? 'outbound' : 'inbound',
      }));

      allCallRecords.push(...cleanedCalls);
    }

    // Step 3: Upsert into Supabase
    const { data, error } = await supabase
      .from('calls')
      .upsert(allCallRecords, { onConflict: ['call_id'] });

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ inserted: data.length }),
    };
  } catch (err) {
    console.error('Error syncing call logs:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
