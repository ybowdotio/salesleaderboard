const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Environment variables
const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Init Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async () => {
  try {
    console.log('HubSpot token exists?', !!HUBSPOT_PRIVATE_APP_TOKEN);
    console.log('Supabase URL exists?', !!SUPABASE_URL);
    console.log('Supabase key exists?', !!SUPABASE_SERVICE_ROLE_KEY);

    console.log('Fetching contacts from HubSpot...');
    const contactsResp = await axios.get(
      'https://api.hubapi.com/crm/v3/objects/contacts?limit=10&properties=firstname,lastname,hubspot_owner_id',
      { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } }
    );

    const contacts = contactsResp.data.results;
    console.log(`Fetched ${contacts.length} contacts`);

    const allCallRecords = [];

    // Helper to fetch contact name
    async function getContactName(contactId) {
      try {
        const res = await axios.get(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname`,
          { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } }
        );
        const { firstname, lastname } = res.data.properties;
        return `${firstname ?? ''} ${lastname ?? ''}`.trim();
      } catch (err) {
        console.error(`Error fetching contact name for ${contactId}`, err.response?.data || err.message);
        return null;
      }
    }

    // Helper to fetch owner name
    async function getOwnerName(ownerId) {
      if (!ownerId) return null;
      try {
        const res = await axios.get(
          `https://api.hubapi.com/crm/v3/owners/${ownerId}`,
          { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } }
        );
        return `${res.data.firstName ?? ''} ${res.data.lastName ?? ''}`.trim();
      } catch (err) {
        console.error(`Error fetching owner name for ${ownerId}`, err.response?.data || err.message);
        return null;
      }
    }

    for (const contact of contacts) {
      const contactId = contact.id;
      const ownerId = contact.properties?.hubspot_owner_id || null;

      console.log(`Fetching engagements for contact ${contactId}...`);

      const engagementsResp = await axios.get(
        `https://api.hubapi.com/engagements/v1/engagements/associated/contact/${contactId}/paged`,
        { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } }
      );

      const calls = (engagementsResp.data.results || []).filter(
        (e) => e.engagement?.type === 'CALL'
      );

      console.log(`Contact ${contactId} has ${calls.length} call(s)`);

      const contactName = await getContactName(contactId);
      const ownerName = await getOwnerName(ownerId);

      for (const call of calls) {
        const engagement = call.engagement;
        const metadata = engagement.metadata || {};

        allCallRecords.push({
          call_id: engagement.id,
          contact_id: contactId,
          contact_name: contactName,
          owner_id: ownerId,
          owner_name: ownerName,
          timestamp: engagement.timestamp,
          duration_ms: metadata.durationMilliseconds || 0,
          direction: metadata.fromNumber ? 'outbound' : 'inbound',
        });
      }
    }

    console.log(`Upserting ${allCallRecords.length} call record(s) into Supabase...`);
    const { data, error } = await supabase
      .from('calls')
      .upsert(allCallRecords, { onConflict: ['call_id'] });

    if (error) {
      console.error('Supabase upsert error:', error);
      throw error;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ inserted: data?.length || 0 }),
    };
  } catch (err) {
    console.error('Error during sync:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Unknown error' }),
    };
  }
};
