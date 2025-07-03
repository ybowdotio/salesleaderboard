const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const HUBSPOT_HEADERS = {
      Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
      'Content-Type': 'application/json'
    };

    const testDate = new Date();
    testDate.setDate(1);
    const iso = testDate.toISOString();

    const testHubspot = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/deals/search',
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'createdate',
                operator: 'GTE',
                value: iso
              }
            ]
          }
        ],
        properties: ['dealname'],
        limit: 1
      },
      { headers: HUBSPOT_HEADERS }
    );

    const testDeals = testHubspot.data.results;

    return {
      statusCode: 200,
      body: JSON.stringify({ status: '✅ Axios + Supabase init okay', dealCount: testDeals.length })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `❌ Crashed at: ${err.message}` })
    };
  }
};
