const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HUBSPOT_API = 'https://api.hubapi.com';
const HUBSPOT_HEADERS = {
  Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
  'Content-Type': 'application/json'
};

exports.handler = async () => {
  try {
    let after = undefined;
    let hasMore = true;
    let upserted = 0;
    const now = new Date().toISOString();

    while (hasMore) {
      const response = await axios.get(`${HUBSPOT_API}/crm/v3/objects/deals`, {
        headers: HUBSPOT_HEADERS,
        params: {
          limit: 100,
          properties: ['dealname', 'amount', 'pipeline', 'dealstage', 'closedate'],
          after
        }
      });

      const deals = response.data.results;
      after = response.data.paging?.next?.after;
      hasMore = !!after;

      for (const deal of deals) {
        const { id, properties } = deal;
        const closedate = properties.closedate ? new Date(properties.closedate) : null;

        const dealRecord = {
          hubspot_id: id,
          dealname: properties.dealname || '',
          amount: parseFloat(properties.amount || 0),
          pipeline: properties.pipeline || '',
          dealstage: properties.dealstage || '',
          closedate,
          synced_to_hubspot: false, // <-- bidirectional flag
          last_synced_at: now
        };

        const { error } = await supabase
          .from('deals')
          .upsert(dealRecord, { onConflict: ['hubspot_id'] });

        if (error) {
          console.error(`❌ Error upserting deal ${id}:`, error.message);
        } else {
          upserted++;
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `✅ Synced ${upserted} deals.`, timestamp: now })
    };
  } catch (err) {
    console.error('❌ Deal sync failed:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
