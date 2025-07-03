const axios = require('axios');

exports.handler = async () => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const isoStart = startOfMonth.toISOString();

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
        properties: ['dealname'],
        limit: 3
      },
      { headers: HUBSPOT_HEADERS }
    );

    const deals = response.data.results;

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `✅ Fetched ${deals.length} deals from HubSpot`,
        sample: deals.map(d => ({ id: d.id, name: d.properties.dealname }))
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `❌ HubSpot fetch failed: ${err.message}` })
    };
  }
};
