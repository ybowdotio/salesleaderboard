const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const isoStart = startOfMonth.toISOString();
    const now = new Date().toISOString();

    const HUBSPOT_HEADERS = {
      Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
      'Content-Type': 'application/json'
    };

    const response = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/deals/search',
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'createdate',
                operator: 'GTE',
                value: isoStart
              }
            ]
          }
        ],
        // ADDED 'hubspot_owner_id' TO THIS LIST
        properties: ['dealname', 'amount', 'pipeline', 'dealstage', 'closedate', 'hubspot_owner_id'],
        limit: 100 // Increased limit to fetch more deals if needed
      },
      { headers: HUBSPOT_HEADERS }
    );

    const deals = response.data.results;
    let upserted = 0;

    for (const deal of deals) {
      const { id, properties } = deal;

      const dealRecord = {
        hubspot_id: id,
        hubspot_owner_id: properties.hubspot_owner_id || null, // ADD THIS
        dealname: properties.dealname || '',
        amount: parseFloat(properties.amount || 0),
        pipeline: properties.pipeline || '',
        dealstage: properties.dealstage || '',
        closedate: properties.closedate ? new Date(properties.closedate) : null,
        synced_to_hubspot: false, // This seems to be an internal flag, keeping as is
        last_synced_at: now
      };

      const { error } = await supabase
        .from('deals')
        .upsert(dealRecord, { onConflict: 'hubspot_id' }); // Corrected onConflict to use the column name

      if (!error) upserted++;
      else console.error(`❌ Upsert error for deal ${id}:`, error.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `✅ Synced ${upserted} deals to Supabase`,
        timestamp: now
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `❌ Sync failed: ${err.message}` })
    };
  }
};
