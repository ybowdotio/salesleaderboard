import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('name, call_count, avg_call_length, total_call_time, sales_mtd')
      .order('sales_mtd', { ascending: false });

    if (error) throw error;

    return res.status(200).json(data);
  } catch (err) {
    console.error('Error loading leaderboard:', err);
    return res.status(500).json({ error: err.message });
  }
};
