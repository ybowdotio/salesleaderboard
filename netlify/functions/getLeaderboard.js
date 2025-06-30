import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const handler = async () => {
  try {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('name, call_count, avg_call_length, total_call_time, sales_mtd')
      .order('sales_mtd', { ascending: false });

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
      },
    };
  } catch (err) {
    console.error('Error loading leaderboard:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
