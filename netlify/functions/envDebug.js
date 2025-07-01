exports.handler = async function () {
    return {
      statusCode: 200,
      body: JSON.stringify({
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        HUBSPOT_PRIVATE_APP_TOKEN: !!process.env.HUBSPOT_PRIVATE_APP_TOKEN,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    };
  };
  