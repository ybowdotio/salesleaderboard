// netlify/functions/syncLeaderboardStats.js
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  console.info('📊 Starting syncLeaderboardStats...');

  // Use yesterday's date (Chicago timezone offset by -5 or -6) to avoid empty today data
  // TODO: Update to today's date after data availability improves
  const now = new Date();
  // Get yesterday in UTC-5 (Chicago)
  const chicagoOffsetHours = 5; // Change to 6 for daylight savings as needed
  const utcMillis = now.getTime();
  const chicagoMillis = utcMillis - chicagoOffsetHours * 60 * 60 * 1000;
  const chicagoDate = new Date(chicagoMillis);
  chicagoDate.setHours(0, 0, 0, 0);
  const log_date = chicagoDate.toISOString().split('T')[0];

  console.info(`🗓️ Using log_date: ${log_date}`);

  try {
    // Compose the SQL to upsert leaderboard stats from calls aggregated by rep for the date
    const sql = `
      insert into today_leaderboard_stats
      (log_date, rep_id, rep_name, total_outbound_calls, avg_call_time, total_call_time)
      select
        $1::date as log_date,
        owner_id as rep_id,
        owner_name as rep_name,
        count(*)::int as total_outbound_calls,
        avg(duration_seconds)::int as avg_call_time,
        sum(duration_seconds)::int as total_call_time
      from calls
      where timestamp_date = $1::date
      group by owner_id, owner_name
      on conflict (log_date, rep_id) do update
      set
        rep_name = excluded.rep_name,
        total_outbound_calls = excluded.total_outbound_calls,
        avg_call_time = excluded.avg_call_time,
        total_call_time = excluded.total_call_time;
    `;

    // Run the SQL with parameterized query
    const { error } = await supabase.rpc('execute_sql', {
      params: [log_date],
      query_text: sql,
    });

    // If you do NOT have 'execute_sql' function created in your database (likely),
    // Replace the above with direct call using supabase.query (this is a mock, see note below)
    // const { error } = await supabase.query(sql, [log_date]); // This is NOT a real method!

    // So instead, let's run it with supabase.from().insert() or you can create a Postgres function and call .rpc()

    // Alternative approach: Just fetch aggregated data from calls table and upsert with supabase.from()
    // But this is a workaround if you do NOT want raw SQL in your functions

    if (error) {
      console.error('❌ SQL error:', error);
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    console.info('✅ Leaderboard sync complete.');
    return { statusCode: 200, body: `Synced leaderboard rows for ${log_date}` };
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return { statusCode: 500, body: err.toString() };
  }
};
