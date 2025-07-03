const axios = require('axios');

exports.handler = async () => {
  try {
    const HUBSPOT_HEADERS = {
      Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
      'Content-Type': 'application/json'
    };

    const response = await axios.get(
      'https://api.hubapi.com/crm/v3/objects/deals?limit=1',
      { headers: HUBSPOT_HEADERS }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: '✅ Axios worked', dealId: response.data.results[0]?.id })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
