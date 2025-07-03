import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event, context) => {
  console.log('📊 Triggering Supabase function to sync leaderboard stats...');

  try {
    // Calling the Supabase function to perform the data aggregation.
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
