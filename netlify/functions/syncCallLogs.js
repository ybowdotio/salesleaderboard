const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const hubspot = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: {
    Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

const BATCH_SIZE = 3;
const MAX_CALLS = 100;

exports.handler = async function () {
  try {
    const contactRes = await hubspot.get('/crm/v3/objects/contacts?limit=100&properties=firstname,lastname');
    const contacts = contactRes.data.results;

    // Build contact map
    const contactMap = {};
    contacts.forEach(c => {
      const props = c.properties || {};
      contactMap[c.id] = [props.firstname, props.lastname].filter(Boolean).join(' ');
    });

    let totalInserted = 0;

    // Break into batches
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      const callRecords = [];

      for (const contact of batch) {
        const callsRes = await hubspot.get(`/engagements/v1/engagements/associated/contact/${contact.id}/paged?limit=100`);
        const calls = callsRes.data.results.filter(e => e.engagement.type === 'CALL');

        for (const call of calls) {
          const { engagement, metadata } = call;
          const timestamp = engagement.timestamp;
          const durationMs = metadata.durationMilliseconds || 0;
          const direction = metadata.fromNumber ? 'outbound' : 'inbound';

          let ownerName = null;
          if (engagement.ownerId) {
            const { data: ownerData } = await supabase
              .from('owners')
              .select('name')
              .eq('owner_id', engagement.ownerId)
              .single();
            ownerName = ownerData?.name || null;
          }

          callRecords.push({
            call_id: engagement.id,
            contact_id: contact.id,
            contact_name: contactMap[contact.id] || null,
            owner_id: engagement.ownerId || null,
            owner_name: ownerName,
            timestamp,
            timestamp_iso: new Date(timestamp).toISOString(),
            call_date: new Date(timestamp).toISOString().split('T')[0],
            duration_seconds: Math.round(durationMs / 1000),
            direction
          });
        }
      }

      if (callRecords.length > 0) {
        const { error } = await supabase.from('calls').upsert(callRecords, { onConflict: ['call_id'] });
        if (error) {
          console.error('Upsert error:', error);
          return { statusCode: 500, body: JSON.stringify({ error: 'Upsert failed' }) };
        }
        totalInserted += callRecords.length;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ inserted: totalInserted })
    };
  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
