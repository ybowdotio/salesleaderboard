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
    const contactsStartDate = dayjs().tz('America/Chicago').subtract(60, 'days').toISOString();
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

    } while (hasMoreDeals);

    console.log(`✅ Fetched ${totalDealsFetched} deals from HubSpot.`);

    // CONTACTS SYNC
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

    } while (hasMoreContacts);

    console.log(`✅ Fetched ${totalContactsFetched} contacts from HubSpot.`);

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

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `✅ Synced ${dealsUpserted}/${totalDealsFetched} deals and ${contactsUpserted}/${totalContactsFetched} contacts to Supabase.`,
        timestamp: now,
        deals_synced: dealsUpserted,
        contacts_synced: contactsUpserted
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
