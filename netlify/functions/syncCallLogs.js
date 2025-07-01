const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Environment variables
const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Get start of the current month in ISO string
const getStartOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
};

exports.handler = async function () {
  try {
    console.info("HubSpot token exists?", !!HUBSPOT_PRIVATE_APP_TOKEN);
    console.info("Supabase URL exists?", !!SUPABASE_URL);
    console.info("Supabase key exists?", !!SUPABASE_SERVICE_ROLE_KEY);

    if (!HUBSPOT_PRIVATE_APP_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, body: "Missing environment variables" };
    }

    const headers = {
      Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
      "Content-Type": "application/json",
    };

    // Step 1: Fetch contacts
    const contactsResponse = await axios.get(
      `https://api.hubapi.com/crm/v3/objects/contacts?limit=10&properties=firstname,lastname`,
      { headers }
    );

    const contacts = contactsResponse.data.results || [];
    console.info(`Fetched ${contacts.length} contacts`);

    // Map contactId -> contactName
    const contactMap = {};
    contacts.forEach(contact => {
      const props = contact.properties || {};
      const fullName = [props.firstname, props.lastname].filter(Boolean).join(" ");
      contactMap[contact.id] = fullName || null;
    });

    const startOfMonth = getStartOfMonth();
    const calls = [];

    for (const contact of contacts) {
      const contactId = contact.id;

      // Step 2: Fetch calls for each contact
      const callsResponse = await axios.get(
        `https://api.hubapi.com/engagements/v1/engagements/associated/contact/${contactId}/paged?limit=100`,
        { headers }
      );

      const contactCalls = callsResponse.data.results || [];

      for (const call of contactCalls) {
        const engagement = call.engagement;
        const metadata = call.metadata;

        if (engagement.type !== "CALL") continue;

        const timestamp = new Date(engagement.timestamp);
        if (timestamp.toISOString() < startOfMonth) continue;

        const ownerId = engagement.ownerId;
        const ownerResponse = await axios.get(
          `https://api.hubapi.com/crm/v3/owners/${ownerId}`,
          { headers }
        );
        const ownerName = ownerResponse.data.fullName || null;

        calls.push({
          call_id: engagement.id,
          contact_id: contactId,
          contact_name: contactMap[contactId] || null,
          owner_id: ownerId || null,
          owner_name: ownerName,
          direction: metadata?.fromNumber ? "OUTBOUND" : "INBOUND",
          duration_seconds: metadata.durationMilliseconds
            ? Math.floor(metadata.durationMilliseconds / 1000)
            : 0,
          timestamp: timestamp.toISOString(),
          date_only: timestamp.toISOString().split("T")[0],
        });
      }
    }

    console.info(`Upserting ${calls.length} call(s) into Supabase...`);

    const { error } = await supabase.from("calls").upsert(calls, {
      onConflict: ["call_id"],
    });

    if (error) {
      console.error("Upsert error:", error);
      return { statusCode: 500, body: "Failed to upsert call logs" };
    }

    return {
      statusCode: 200,
      body: `Successfully synced ${calls.length} call logs for current month`,
    };
  } catch (error) {
    console.error("Error during sync:", error);
    return { statusCode: 500, body: "Error syncing call logs" };
  }
};
