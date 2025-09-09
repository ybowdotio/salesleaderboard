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
    
    // For initial load: fetch 60 days of contacts
    // For ongoing sync: only fetch contacts modified in last 24 hours
    
    // Check contact count to determine if we need full resync
    const { data: contactCount } = await supabase
      .from('b_contacts')
      .select('count(*)', { count: 'exact' });
    
    // Force initial load if we have suspiciously few contacts (like 300)
    const forceInitialLoad = (contactCount?.[0]?.count || 0) < 1000;
    
    const { data: lastSync } = await supabase
      .from('b_sync_logs')
      .select('created_at')
      .eq('function_name', 'syncDealsFinal')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    const isInitialLoad = !lastSync || forceInitialLoad;
    const contactsStartDate = isInitialLoad 
      ? dayjs().tz('America/Chicago').subtract(60, 'days').toISOString()
      : dayjs().tz('America/Chicago').subtract(24, 'hours').toISOString();
    
    console.log(`📋 Contact sync mode: ${isInitialLoad ? 'INITIAL (60 days)' : 'INCREMENTAL (24 hours)'} ${forceInitialLoad ? '[FORCED]' : ''}`);
    
    const now = new Date().toISOString();

    const HUBSPOT_HEADERS = {
      Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
      'Content-Type': 'application/json'
    };
    
    let allDeals = [];
    let allContacts = [];
    let dealAfter = null;
    let contactAfter = null;
    let hasMoreDeals = false;
    let hasMoreContacts = false;
    let totalDealsFetched = 0;
    let totalContactsFetched = 0;

    console.log(`🚀 Starting HubSpot sync for deals and contacts...`);

    // Helper function to add delay between API calls
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // DEALS SYNC
    do {
      const dealsResponse = await axios.post(
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
          after: dealAfter
        },
        { headers: HUBSPOT_HEADERS }
      );

      const dealsOnPage = dealsResponse.data.results || [];
      allDeals = allDeals.concat(dealsOnPage);
      totalDealsFetched += dealsOnPage.length;

      if (dealsResponse.data.paging && dealsResponse.data.paging.next) {
        hasMoreDeals = true;
        dealAfter = dealsResponse.data.paging.next.after;
      } else {
        hasMoreDeals = false;
      }

      // Add delay to avoid rate limits
      if (hasMoreDeals) {
        await delay(200); // 200ms delay between paginated deal requests
      }

    } while (hasMoreDeals);

    console.log(`✅ Fetched ${totalDealsFetched} deals from HubSpot.`);

    // Add delay before starting contacts sync to avoid rate limits
    await delay(1000);

    // CONTACTS SYNC - Use date windowing to bypass 300 result API limit
    console.log(`📅 Starting contact sync with ${isInitialLoad ? '7-day' : '24-hour'} windows...`);
    
    if (isInitialLoad) {
      // For initial load: fetch in 7-day windows to get all 60 days
      const startDate = dayjs(contactsStartDate);
      const endDate = dayjs();
      let currentWindowStart = startDate;
      
      while (currentWindowStart.isBefore(endDate)) {
        const windowEnd = currentWindowStart.add(7, 'days');
        const windowEndCapped = windowEnd.isAfter(endDate) ? endDate : windowEnd;
        
        console.log(`📋 Fetching contacts: ${currentWindowStart.format('YYYY-MM-DD')} to ${windowEndCapped.format('YYYY-MM-DD')}`);
        
        // Fetch contacts for this 7-day window
        contactAfter = null;
        hasMoreContacts = false;
        
        do {
          const contactsResponse = await axios.post(
            'https://api.hubapi.com/crm/v3/objects/contacts/search',
            {
              filterGroups: [
                {
                  filters: [
                    {
                      propertyName: 'createdate',
                      operator: 'GTE',
                      value: currentWindowStart.toISOString()
                    },
                    {
                      propertyName: 'createdate',
                      operator: 'LTE',
                      value: windowEndCapped.toISOString()
                    },
                    {
                      propertyName: 'invalid_lead',
                      operator: 'NOT_HAS_PROPERTY'
                    }
                  ]
                }
              ],
              properties: [
                'firstname', 'lastname', 'email', 'phone', 'hubspot_owner_id',
                'createdate', 'hs_lead_status', 'lifecyclestage', 'hs_analytics_source',
                'hubspot_owner_assigneddate'
              ],
              limit: 100,
              after: contactAfter
            },
            { headers: HUBSPOT_HEADERS }
          );

          const contactsOnPage = contactsResponse.data.results || [];
          allContacts = allContacts.concat(contactsOnPage);
          totalContactsFetched += contactsOnPage.length;

          if (contactsResponse.data.paging && contactsResponse.data.paging.next) {
            hasMoreContacts = true;
            contactAfter = contactsResponse.data.paging.next.after;
          } else {
            hasMoreContacts = false;
          }

          // Add delay between pagination requests
          if (hasMoreContacts) {
            await delay(300);
          }

        } while (hasMoreContacts);
        
        // Move to next 7-day window
        currentWindowStart = windowEnd;
        
        // Add delay between date windows
        await delay(500);
      }
      
    } else {
      // For incremental sync: simple 24-hour window (should be <300 results)
      do {
        const contactsResponse = await axios.post(
          'https://api.hubapi.com/crm/v3/objects/contacts/search',
          {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'lastmodifieddate',
                    operator: 'GTE',
                    value: contactsStartDate
                  },
                  {
                    propertyName: 'invalid_lead',
                    operator: 'NOT_HAS_PROPERTY'
                  }
                ]
              }
            ],
            properties: [
              'firstname', 'lastname', 'email', 'phone', 'hubspot_owner_id',
              'createdate', 'hs_lead_status', 'lifecyclestage', 'hs_analytics_source',
              'hubspot_owner_assigneddate'
            ],
            limit: 100,
            after: contactAfter
          },
          { headers: HUBSPOT_HEADERS }
        );

        const contactsOnPage = contactsResponse.data.results || [];
        allContacts = allContacts.concat(contactsOnPage);
        totalContactsFetched += contactsOnPage.length;

        if (contactsResponse.data.paging && contactsResponse.data.paging.next) {
          hasMoreContacts = true;
          contactAfter = contactsResponse.data.paging.next.after;
        } else {
          hasMoreContacts = false;
        }

        // Add delay between contact pagination requests
        if (hasMoreContacts) {
          await delay(300);
        }

      } while (hasMoreContacts);
    }

    console.log(`✅ Fetched ${totalContactsFetched} contacts from HubSpot using windowed approach.`);

    // SYNC DEALS TO SUPABASE
    let dealsUpserted = 0;

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
        dealsUpserted++;
      } else {
        console.error(`❌ Deal upsert error for ${id}:`, error.message);
      }
    }

    // SYNC CONTACTS TO SUPABASE
    let contactsUpserted = 0;
    for (const contact of allContacts) {
      const { id, properties } = contact;

      const contactRecord = {
        hubspot_id: id,
        firstname: properties.firstname || '',
        lastname: properties.lastname || '',
        email: properties.email || '',
        phone: properties.phone || '',
        owner_id: properties.hubspot_owner_id || null,
        hubspot_created_date: properties.createdate ? new Date(properties.createdate) : null,
        owner_assigned_date: properties.hubspot_owner_assigneddate ? new Date(properties.hubspot_owner_assigneddate) : null,
        lead_status: properties.hs_lead_status || '',
        lifecycle_stage: properties.lifecyclestage || '',
        synced_to_hubspot: false,
        last_synced_at: now
      };

      const { error } = await supabase
        .from('contacts')
        .upsert(contactRecord, { onConflict: 'hubspot_id' });

      if (!error) {
        contactsUpserted++;
      } else {
        console.error(`❌ Contact upsert error for ${id}:`, error.message);
      }
    }

    // Log successful sync
    const successMessage = `✅ Synced ${dealsUpserted}/${totalDealsFetched} deals and ${contactsUpserted}/${totalContactsFetched} contacts to Supabase.`;
    
    await supabase.from('b_sync_logs').insert({
      id: require('crypto').randomUUID(),
      function_name: 'syncDealsFinal',
      status: 'success',
      message: successMessage,
      created_at: now
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: successMessage,
        timestamp: now,
        deals_synced: dealsUpserted,
        contacts_synced: contactsUpserted,
        sync_mode: isInitialLoad ? 'initial' : 'incremental'
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
