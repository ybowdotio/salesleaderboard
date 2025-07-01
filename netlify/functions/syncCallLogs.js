const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Environment variables
const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async function () {
  try {
    console.log("HubSpot token exists?", !!HUBSPOT_PRIVATE_APP_TOKEN);
    console.log("Supabase URL exists?", !!SUPABASE_URL);
    console.log("Supabase key exists?", !!SUPABASE_SERVICE_ROLE_KEY);

    if (!HUBSPOT_PRIVATE_APP_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing required environment variables." }),
      };
    }

    console.log("Fetching contacts from HubSpot...");
    const contactsResp = await axios.get(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=10&properties=firstname,lastname,hubspot_owner_id",
      { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } }
    );

    const contacts = contactsResp.data.results;
    console.log("Fetched", contacts.length, "contacts");

    const allCalls = [];

    for (const contact of contacts) {
      const contactId = contact.id;
      const ownerId = contact.properties?.hubspot_owner_id || null;

      console.log(`Fetching engagements for contact ${contactId}...`);

      const engagementResp = await axios.get(
        `https://api.hubapi.com/engagements/v1/engagements/associated/contact/${contactId}/paged`,
        { headers: { Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}` } }
      );

      const calls = (engagementResp.data.results || []).filter(
        (e) => e.engagement?.type === "CALL"
      );

      console.log(`Contact ${contactId} has ${calls.length} call(s)`);

      for (const call of calls) {
        allCalls.push({
          call_id: call.engagement.id,
          contact_id: contactId,
          owner_id: ownerId,
          timestamp: call.engagement.timestamp,
          duration_ms: call.engagement.metadata?.durationMilliseconds || 0,
          direction: call.engagement.metadata?.fromNumber ? 'outbound' : 'inbound',
        });
      }
    }

    console.log(`Upserting ${allCalls.length} call record(s) into Supabase...`);
    console.log("Preparing to upsert these call records:", allCalls);

    const { data, error } = await supabase
      .from('calls')
      .upsert(allCalls, { onConflict: ['call_id'] });

    if (error) {
      console.error("Supabase upsert error:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message || error }),
      };
    }

    console.log(`Successfully upserted ${allCalls.length} call(s).`);

    return {
      statusCode: 200,
      body: JSON.stringify({ inserted: allCalls.length }),
    };

  } catch (err) {
    console.error("Error during sync:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Unknown error" }),
    };
  }
};
