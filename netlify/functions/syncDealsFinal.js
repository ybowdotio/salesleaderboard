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
    
    let allDeals = [];
    let after = null;
    let hasMore = false;
    let totalFetched = 0;

    console.log('🚀 Starting HubSpot deal sync...');

    // --- ADDED: Loop to handle HubSpot API pagination ---
    do {
      const response = await axios.post(
        'https://api.hubapi.com/crm/v3/objects/deals/search',
        {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'closedate', // Correctly filter by the date a deal was closed
                  operator: 'GTE',
                  value: isoStart
                }
              ]
            }
          ],
          properties: ['dealname', 'amount', 'pipeline', 'dealstage', 'closedate', 'hubspot_owner_id'],
          limit: 100,
          after: after // This tells HubSpot which page to get
        },
        { headers: HUBSPOT_HEADERS }
      );

      const dealsOnPage = response.data.results || [];
      allDeals = allDeals.concat(dealsOnPage);
      totalFetched += dealsOnPage.length;

      // Check if there is a next page
      if (response.data.paging && response.data.paging.next) {
        hasMore = true;
        after = response.data.paging.next.after;
      } else {
        hasMore = false;
      }

    } while (hasMore);

    console.log(`✅ Fetched a total of ${totalFetched} deals from HubSpot.`);

    let upserted = 0;

    for (const deal of allDeals) {
      const { id, properties } = deal;

      const dealRecord = {
        hubspot_id: id,
        hubspot_owner_id: properties.hubspot_owner_id || null,
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
        .upsert(dealRecord, { onConflict: 'hubspot_id' });

      if (!error) {
        upserted++;
      } else {
        console.error(`❌ Upsert error for deal ${id}:`, error.message);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `✅ Synced ${upserted} of ${totalFetched} deals to Supabase.`,
        timestamp: now
      })
    };
  } catch (err) {
    // Log the full error from HubSpot if available
    if (err.response) {
      console.error('HubSpot API Error:', err.response.data);
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `❌ Sync failed: ${err.message}` })
    };
  }
};
