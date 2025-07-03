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

  // ✅ Test query to verify RPC works
  const rawSQL = `
    select now() as server_time;
  `;

  try {
    console.log('📤 Sending test SQL to Supabase...');

    let result;
    try {
      result = await supabase.rpc('execute_raw_sql', { sql: rawSQL });
    } catch (sqlError) {
      console.error('❌ RPC call threw:', sqlError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Supabase RPC failed', details: sqlError.message }),
      };
    }

    if (result.error) {
      console.error('⛔ RPC returned error:', result.error);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'RPC returned error',
          details: result.error.message,
        }),
      };
    }

    console.log('✅ SQL executed successfully:', result.data);

    await supabase.from('sync_logs').insert({
      function_name: 'syncLeaderboardStats',
      status: 'success',
      message: 'Test SQL executed successfully.',
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        result: result.data,
      }),
    };

  } catch (err) {
    console.error('🔥 Unexpected function error:', err);
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
