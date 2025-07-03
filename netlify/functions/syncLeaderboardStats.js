import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// This is the standard, correct handler signature and return format for Netlify.
export const handler = async (event, context) => {
  console.log('📊 Triggering Supabase function to sync leaderboard stats...');

  try {
    const { error } = await supabase.rpc('sync_today_leaderboard_stats');

    if (error) {
      console.error('❌ Error calling Supabase function:', error);
      // CORRECT: Return a status code and a JSON string in the body.
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      };
    }

    console.log('✅ Supabase function executed successfully.');
    // CORRECT: Return a 200 status and a success message.
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
