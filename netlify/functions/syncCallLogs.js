const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_API_KEY = process.env.HUBSPOT_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
console.log('HubSpot token exists?', !!process.env.HUBSPOT_APP_TOKEN);

exports.handler = async function () {
  try {
    const contactsResp = await axios.get(
      `https://api.hubapi.com/crm/v3/objects/contacts?limit=10&properties=firstname,lastname,hubspot_owner_id`,
      { headers: { Authorization: `Bearer ${HUBSPOT_API_KEY}` } }
    );

    const contacts = contactsResp.data.results;
    console.log(`Fetched ${contacts.length} contacts.`);

    const allCallRecords = [];

    for (const contact of contacts) {
      const contactId = contact.id;
      const ownerId = contact.properties?.hubspot_owner_id || null;

      const engagementsResp = await axios.get(
        `https://api.hubapi.com/engagements/v1/engagements/associated/contact/${contactId}/paged`,
        { headers: { Authorization: `Bearer ${HUBSPOT_API_KEY}` } }
      );

      const calls = (engagementsResp.data.results || []).filter(
        (e) => e.engagement?.type === 'CALL'
      );

      console.log(`Contact ${contactId} has ${calls.length} calls.`);

      const cleaned = calls.map((call) => ({
        contact_id: contactId,
        owner_id: ownerId,
        call_id: call.engagement.id,
        timestamp: call.engagement.timestamp,
        duration_ms: call.engagement.metadata?.durationMilliseconds || 0,
        direction: call.engagement.metadata?.fromNumber ? 'outbound' : 'inbound',
      }));

      allCallRecords.push(...cleaned);
    }

    console.log(`Total call records: ${allCallRecords.length}`);

    if (allCallRecords.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No call data found for these contacts.' }),
      };
    }

    const { data, error } = await supabase
      .from('calls')
      .upsert(allCallRecords, { onConflict: ['call_id'] });

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ inserted: data.length }),
    };
  } catch (err) {
    console.error('Error syncing call logs:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
