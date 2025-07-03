import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Using the default export and (req, res) signature for HTTP compatibility
export default async function handler(req, res) {
  console.log('📊 Triggering Supabase function to sync leaderboard stats...');

  try {
    // Calling the correct Supabase function name
    const { error } = await supabase.rpc('sync_today_leaderboard_stats');

    if (error) {
      console.error('❌ Error calling Supabase function:', error);
      // Use the 'res' object to send back the error
      return res.status(500).json({ error: error.message });
    }

    console.log('✅ Supabase function executed successfully.');
    // Use the 'res' object to send back the success message
    return res.status(200).json({ success: true, message: "Leaderboard stats sync complete." });
  } catch (err) {
    console.error('🔥 Unexpected error in trigger function:', err);
    return res.status(500).json({ error: 'Unexpected server error.' });
  }
}
