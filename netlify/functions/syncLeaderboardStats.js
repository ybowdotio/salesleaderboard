const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  try {
    // Get yesterday's date in ISO format (local time)
    const yesterday = new Date(Date.now() - 86400000);
    const log_date = yesterday.toISOString().slice(0, 10);

    console.info(`📊 Using log_date: ${log_date}`);

    // SQL to get daily stats with rep names, ignoring calls with null owner_id
    const sql = `
      SELECT
        c.owner_id AS rep_id,
        COALESCE(r.name, 'Unknown Rep') AS rep_name,
        COUNT(*) AS total_calls,
        AVG(c.duration_seconds)::int AS avg_call_time,
        SUM(c.duration_seconds)::int AS total_call_time,
        c.timestamp_date AS log_date
      FROM calls c
      LEFT JOIN reps r ON c.owner_id = r.id
      WHERE c.timestamp_date = $1
        AND c.owner_id IS NOT NULL
      GROUP BY c.owner_id, r.name, c.timestamp_date
      ORDER BY total_calls DESC;
    `;

    const { data, error } = await supabase.rpc('execute_sql', {
      query_text: sql,
      params: [log_date]
    });

    if (error) {
      console.error('❌ Error running SQL:', error);
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    console.info(`🛠️ Preparing ${data.length} leaderboard rows`);

    // Upsert into today_leaderboard_stats
    const leaderboardRows = data.map(row => ({
      log_date: row.log_date,
      rep_id: row.rep_id,
      rep_name: row.rep_name,
      total_outbound_calls: row.total_calls,
      avg_call_time: row.avg_call_time,
      total_call_time: row.total_call_time,
    }));

    const { error: upsertError } = await supabase
      .from('today_leaderboard_stats')
      .upsert(leaderboardRows, { onConflict: ['log_date', 'rep_id'] });

    if (upsertError) {
      console.error('❌ Upsert error:', upsertError);
      return { statusCode: 500, body: JSON.stringify(upsertError) };
    }

    console.info('✅ Leaderboard sync complete.');
    return { statusCode: 200, body: `Synced ${leaderboardRows.length} leaderboard rows for ${log_date}` };
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return { statusCode: 500, body: err.toString() };
  }
};
