const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  try {
    // --- THIS IS THE LINE THAT WAS CHANGED ---
    const isoStart = dayjs().tz('America/Chicago').startOf('month').toISOString();
    const now = new Date().toISOString();

    const HUBSPOT_HEADERS = {
      Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
      'Content-Type': 'application/json'
    };
    
    let allDeals = [];
    let after = null;
    let hasMore = false;
    let totalFetched = 0;

    console.log(`🚀 Starting HubSpot deal sync for deals closed since ${isoStart}...`);

    do {
      const response = await axios.post(
        'https://api.hubapi.com/crm/v3/objects/deals/search',
        {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'closedate',
                  operator: 'GTE',
                  value: isoStart
                },
                {
                  propertyName: 'hs_deal_stage_probability',
                  operator: 'EQ',
                  value: 1 
                }
              ]
            }
          ],
          properties: ['dealname', 'amount', 'pipeline', 'dealstage', 'closedate', 'hubspot_owner_id'],
          limit: 100,
          after: after
        },
        { headers: HUBSPOT_HEADERS }
      );

      const dealsOnPage = response.data.results || [];
      allDeals = allDeals.concat(dealsOnPage);
      totalFetched += dealsOnPage.length;

      if (response.data.paging && response.data.paging.next) {
        hasMore = true;
        after = response.data.paging.next.after;
      } else {
        hasMore = false;
      }

    } while (hasMore);

    console.log(`✅ Fetched a total of ${totalFetched} "Closed Won" deals from HubSpot.`);

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
    if (err.response) {
      console.error('HubSpot API Error:', err.response.data);
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `❌ Sync failed: ${err.message}` })
    };
  }
};
