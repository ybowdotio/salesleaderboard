// Using CommonJS 'require' syntax for consistency with our other function
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// A simplified handler for a scheduled function
exports.handler = async () => {
  console.log('📊 Triggering Supabase function to sync leaderboard stats...');

  try {
    // THE FIX: Corrected the function name to match the one in your database
    const { error } = await supabase.rpc('sync_today_leaderboard_stats');

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
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('🔥 Unexpected error in trigger function:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected server error.' }),
    };
  }
};
