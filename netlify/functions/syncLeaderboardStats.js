import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };
  }

  console.log(`🚀 Function triggered by a ${event.httpMethod} request. Starting leaderboard calculation...`);

  try {
    // This now calls the new, unique function name
    const { error } = await supabase.rpc('calculate_leaderboard_v2');

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
      body: JSON.stringify({ success: true, message: "Leaderboard stats calculation complete." }),
    };
  } catch (err) {
    console.error('🔥 Unexpected error in trigger function:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected server error.' }),
    };
  }
};
