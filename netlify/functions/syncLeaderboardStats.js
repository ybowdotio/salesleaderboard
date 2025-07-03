import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.info('📊 Starting leaderboard sync...');

  try {
    const { error } = await supabase.rpc('sync_today_leaderboard');

    if (error) {
      console.error('❌ Error syncing leaderboard stats:', error);
      return res.status(500).json({ error: error.message });
    }

    console.info('✅ Leaderboard stats synced successfully.');
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('🔥 Unexpected error:', err);
    return res.status(500).json({ error: 'Unexpected server error.' });
  }
}
