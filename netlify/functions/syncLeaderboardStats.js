import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event, context) => {
  // This function is designed to be triggered by the scheduler or manually.
  // The scheduler sends a POST request, while a browser visit is a GET request.
  // We will allow both methods to proceed.
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };
  }

  console.log(`🚀 Function triggered by a ${event.httpMethod} request. Starting sync...`);

  try {
    const { data, error } = await supabase.rpc('sync_daily_stats_debug'); console.log('--- DEBUG OUTPUT ---'); console.log(data); console.log('--- END DEBUG ---');

    if (error) {
      console.error('❌ Error calling Supabase function:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      };
    }

    console.log('✅ Supabase function executed successfully.');
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Leaderboard stats sync complete." }),
    };
  } catch (err) {
    console.error('🔥 Unexpected error in trigger function:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected server error.' }),
    };
  }
};
