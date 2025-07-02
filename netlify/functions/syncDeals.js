const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function logSync({ type, status, message }) {
  try {
    await supabase.from('sync_logs').insert([{ type, status, message }]);
  } catch (err) {
    console.error('❌ Failed to log to sync_logs:', err.message);
  }
}

exports.handler = async () => {
  try {
    console.log('🧪 syncDeals started');

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const isoStart = startOfMonth.toISOString();
    const now = new Date().toISOString();

    const HUBSPOT_API = 'https://api.hubapi.com';
    const HUBSPOT_HEADERS = {
      Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
      'Content-Type': 'application/json'
    };

    let after = undefined;
    let hasMore = true;
    let upserted = 0;

    while (hasMore) {
      console.log('📡 Fetching deals from HubSpot...');
      const response = await axios.post(
        `${HUBSPOT_API}/crm/v3/objects/deals/search`,
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
          properties: ['dealname', 'amount', 'pipeline', 'dealstage', 'closedate'],
          sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
          limit: 100,
          after
        },
        { headers: HUBSPOT_HEADERS }
      );

      const deals = response.data.results;
      after = response.data.paging?.next?.after;
      hasMore = !!after;

      console.log(`📥 Retrieved ${deals.length} deals from HubSpot`);

      for (const deal of deals) {
        try {
          const { id, properties } = deal;

          const dealRecord = {
            hubspot_id: id,
            dealname: properties.dealname || '',
            amount: parseFloat(properties.amount || 0),
            pipeline: properties.pipeline || '',
            dealstage: properties.dealstage || '',
            closedate: properties.closedate ? new Date(properties.closedate) : null,
            synced_to_hubspot: false,
            last_synced_at: now
          };

          const { error } = await supabase
            .from('deals')
            .upsert(dealRecord, { onConflict: ['hubspot_id'] });

          if (error) {
            console.error(`❌ Upsert error on deal ${id}:`, error.message);
          } else {
            upserted++;
          }
        } catch (innerErr) {
          console.error('❌ Error processing individual deal:', innerErr.message);
        }
      }
    }

    await logSync({
      type: 'pull',
      status: 'success',
      message: `Synced ${upserted} deals`
    });

    console.log(`✅ Sync complete. Upserted ${upserted} deals.`);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: `✅ Synced ${upserted} deals.`, timestamp: now })
    };
  } catch (err) {
    console.error('❌ syncDeals failed (outer catch):', err.message);

    await logSync({
      type: 'pull',
      status: 'error',
      message: err.message
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
