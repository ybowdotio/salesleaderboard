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
    // Fetch contacts
    const contactsResponse = await axios.get('https://api.hubapi.com/crm/v3/objects/contacts?limit=10', {
      headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` }
    });

    const contacts = contactsResponse.data.results;
    console.info(`Fetched ${contacts.length} contacts`);

    let allCalls = [];

    for (const contact of contacts) {
      const contactId = contact.id;
      const contactName = contact.properties.firstname + ' ' + contact.properties.lastname;

      const engagementsResponse = await axios.get(`https://api.hubapi.com/engagements/v1/engagements/associated/contact/${contactId}/paged?limit=100`, {
        headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` }
      });

      const engagements = engagementsResponse.data.results;
      const calls = engagements.filter(e => e.engagement.type === 'CALL');

      for (const call of calls) {
        const engagement = call.engagement;
        const metadata = call.metadata || {};

        const resolvedContactId = engagement.contactId || contactId;

        if (!resolvedContactId) {
          console.warn(`Skipping call with missing contactId. Call ID: ${engagement.id}`);
          continue;
        }

        const timestampISO = metadata.timestamp
          ? new Date(metadata.timestamp).toISOString()
          : null;

        if (!timestampISO) {
          console.warn(`Skipping call with invalid timestamp. Call ID: ${engagement.id}`);
          continue;
        }

        allCalls.push({
          call_id: engagement.id,
          contact_id: resolvedContactId,
          owner_id: engagement.ownerId,
          duration_seconds: metadata.durationMilliseconds ? Math.floor(metadata.durationMilliseconds / 1000) : null,
          direction: metadata.fromNumber ? 'OUTBOUND' : 'INBOUND',
          contact_name: contactName,
          owner_name: engagement.ownerId, // Replace with actual lookup if needed
          timestamp_iso: timestampISO,
          timestamp_date: timestampISO.split('T')[0],
          timestamp_year: new Date(timestampISO).getFullYear()
        });
      }
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
