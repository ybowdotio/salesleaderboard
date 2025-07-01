const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Environment variables
const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  console.log('Starting call sync...');
  if (!HUBSPOT_PRIVATE_APP_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing env vars');
    return { statusCode: 500, body: 'Missing environment variables.' };
  }

  const offset = parseInt(event.queryStringParameters?.offset || '0');
  const limit = 10;

  try {
    // 1. Get Contacts
    const contactsResponse = await axios.get(
      `https://api.hubapi.com/crm/v3/objects/contacts?limit=${limit}&archived=false&properties=firstname,lastname,hubspot_owner_id&after=${offset}`,
      { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } }
    );

    const contacts = contactsResponse.data.results;
    const contactMap = {};
    const ownerSet = new Set();

    contacts.forEach((contact) => {
      const id = contact.id;
      const name = `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim();
      const ownerId = contact.properties.hubspot_owner_id;
      contactMap[id] = { name, ownerId };
      if (ownerId) ownerSet.add(ownerId);
    });

    // 2. Fetch owner info
    const ownerMap = {};
    if (ownerSet.size > 0) {
      const ownerResponse = await axios.get('https://api.hubapi.com/crm/v3/owners/', {
        headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` },
      });
      ownerResponse.data.results.forEach((owner) => {
        ownerMap[owner.id] = `${owner.firstName || ''} ${owner.lastName || ''}`.trim();
      });
    }

    const allCalls = [];

    for (const contact of contacts) {
      const contactId = contact.id;
      const engagementResponse = await axios.get(
        `https://api.hubapi.com/engagements/v1/engagements/associated/contact/${contactId}/paged?limit=100`,
        { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } }
      );

      const calls = engagementResponse.data.results
        .filter((e) => e.engagement.type === 'CALL')
        .map((e) => {
          const engagement = e.engagement;
          return {
            call_id: engagement.id.toString(),
            contact_id: contactId,
            owner_id: engagement.ownerId?.toString() || null,
            timestamp: engagement.timestamp || null,
            duration_seconds: engagement.metadata?.durationMilliseconds
              ? Math.floor(engagement.metadata.durationMilliseconds / 1000)
              : 0,
            direction: engagement.metadata?.fromNumber ? 'outbound' : 'inbound',
            contact_name: contactMap[contactId]?.name || null,
            owner_name: ownerMap[contactMap[contactId]?.ownerId] || null,
            timestamp_iso: engagement.timestamp ? new Date(engagement.timestamp).toISOString() : null,
            call_date: engagement.timestamp ? new Date(engagement.timestamp).toISOString().split('T')[0] : null,
          };
        });

      allCalls.push(...calls);
    }

    // 3. Upsert
    const { data, error } = await supabase.from('calls').upsert(allCalls, { onConflict: ['call_id'] });

    if (error) {
      console.error('Upsert error:', error);
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    console.log(`Inserted/updated ${allCalls.length} calls.`);
    return { statusCode: 200, body: JSON.stringify({ inserted: allCalls.length, nextOffset: offset + limit }) };
  } catch (err) {
    console.error('Fatal sync error:', err.message || err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) };
  }
};
