const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Environment variables
const HUBSPOT_APP_TOKEN = process.env.HUBSPOT_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Check token existence
console.log('HubSpot token exists?', !!HUBSPOT_APP_TOKEN);
console.log('Supabase URL exists?', !!SUPABASE_URL);
console.log('Supabase key exists?', !!SUPABASE_SERVICE_ROLE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async function () {
  if (!HUBSPOT_APP_TOKEN) {
    console.error('Missing HubSpot token.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing HubSpot token. Check environment variables.' }),
    };
  }

  try {
    // Step 1: Fetch Contacts (limit 10 for now)
    console.log('Fetching contacts from HubSpot...');
    const contactsResp = await axios.get(
      `https://api.hubapi.com/crm/v3/objects/contacts?limit=10&properties=firstname,lastname,hubspot_owner_id`,
      { headers: { Authorization: `Bearer ${HUBSPOT_APP_TOKEN}` } }
    );

    const contacts = contactsResp.data.results;
    console.log(`Fetched ${contacts.length} contacts`);

    if (contacts.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No contacts found in HubSpot.' }),
      };
    }

    const allCallRecords = [];

    // Step 2: For each contact, fetch their engagements
    for (const contact of contacts) {
      const contactId = contact.id;
      const ownerId = contact.properties?.hubspot_owner_id || null;

      console.log(`Fetching engagements for contact ${contactId}...`);
      const engagementsResp = await axios.get(
        `https://api.hubapi.com/engagements/v1/engagements/associated/contact/${contactId}/paged`,
        { headers: { Authorization: `Bearer ${HUBSPOT_APP_TOKEN}` } }
      );

      const calls = (engagementsResp.data.results || []).filter(
        (e) => e.engagement?.type === 'CALL'
      );

      console.log(`Contact ${contactId} has ${calls.length} call(s)`);

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

    if (allCallRecords.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No call data found for these contacts.' }),
      };
    }

    // Step 3: Upsert into Supabase
    console.log(`Upserting ${allCallRecords.length} call record(s) into Supabase...`);
    const { data, error } = await supabase
      .from('calls')
      .upsert(allCallRecords, { onConflict: ['call_id'] });

    if (error) {
      console.error('Supabase upsert error:', error);
      throw error;
    }

    console.log(`Successfully upserted ${data.length} call(s)`);

    return {
      statusCode: 200,
      body: JSON.stringify({ inserted: data.length }),
    };
  } catch (err) {
    console.error('Error during sync:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
