const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// HubSpot
const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const HUBSPOT_SEARCH_URL = 'https://api.hubapi.com/crm/v3/objects/calls/search';

exports.handler = async function () {
  const start = Date.now();

  const todayChicago = dayjs().tz('America/Chicago').startOf('day');
  const tomorrowChicago = todayChicago.add(1, 'day');

  const body = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'hs_timestamp',
            operator: 'BETWEEN',
            value: todayChicago.toISOString(),
            highValue: tomorrowChicago.toISOString()
          }
        ]
      }
    ],
    properties: [
      'hs_call_title',
      'hs_call_body',
      'hs_call_duration',
      'hs_call_disposition',
      'hs_call_from_number',
      'hs_call_to_number',
      'hs_timestamp',
      'hubspot_owner_id'
    ],
    limit: 100
  };

  try {
    const response = await fetch(HUBSPOT_SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('HubSpot search error:', errorText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch calls from HubSpot' })
      };
    }

    const result = await response.json();
    const calls = result.results;

    console.info(`✅ Retrieved ${calls.length} calls from HubSpot`);

    const formatted = calls.map(call => {
      const props = call.properties || {};

      return {
        call_id: call.id,
        contact_id: null,
        owner_id: props.hubspot_owner_id || null,
        title: props.hs_call_title || null,
        body: props.hs_call_body || null,
        duration_seconds: props.hs_call_duration
          ? parseInt(props.hs_call_duration)
          : 0,
        disposition: props.hs_call_disposition || null,
        from_number: props.hs_call_from_number || null,
        to_number: props.hs_call_to_number || null,
        timestamp_iso: props.hs_timestamp || null,
        call_date: props.hs_timestamp
          ? dayjs(props.hs_timestamp).tz('America/Chicago').format('YYYY-MM-DD')
          : null
      };
    });

    const { error } = await supabase.from('calls').upsert(formatted, {
      onConflict: ['call_id']
    });

    if (error) {
      console.error('Supabase upsert error:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to upsert calls into Supabase' })
      };
    }

    const duration = (Date.now() - start) / 1000;
    console.info(`✅ Sync complete: ${formatted.length} calls in ${duration}s`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Call logs synced successfully',
        count: formatted.length,
        duration: `${duration}s`
      })
    };
  } catch (err) {
    console.error('Unhandled error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Function failed' })
    };
  }
};
