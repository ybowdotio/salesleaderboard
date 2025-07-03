const { createClient } = require('@supabase/supabase-js');

exports.handler = async function () {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const msg = 'Missing Supabase environment variables';
    console.error(msg);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: msg }),
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const testSQL = `select now() as server_time`;

  try {
    const { data, error } = await supabase.rpc('execute_raw_sql', {
      sql: testSQL,
    });

    if (error) {
      console.error('Supabase RPC returned error:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        result: data,
      }),
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Unexpected error',
        message: err.message,
        stack: err.stack,
      }),
    };
  }
};
