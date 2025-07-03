const { createClient } = require('@supabase/supabase-js');

exports.handler = async function () {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing Supabase env vars' }),
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Define raw SQL that aggregates yesterday's leaderboard stats
  const rawSQL = `
    insert into today_leaderboard_stats (
      log_date,
      rep_id,
      rep_name,
      total_outbound_calls,
      total_call_time,
      avg_call_time
    )
    select
      timezone('America/Chicago', c.hs_timestamp)::date as log_date,
      c.owner_id as rep_id,
      r.name as rep_name,
      count(*) as total_outbound_calls,
      sum(c.duration_seconds) as total_call_time,
      avg(c.duration_seconds)::int as avg_call_time
    from calls c
    join reps r on c.owner_id = r.id
    where timezone('America/Chicago', c.hs_timestamp)::date = (current_date at time zone 'America/Chicago') - interval '1 day'
    group by log_date, rep_id, rep_name
    on conflict (log_date, rep_id)
    do update set
      rep_name = excluded.rep_name,
      total_outbound_calls = excluded.total_outbound_calls,
      total_call_time = excluded.total_call_time,
      avg_call_time = excluded.avg_call_time;
  `;

  try {
    const { error } = await supabase.rpc('execute_raw_sql', {
      sql: rawSQL,
    });

    if (error) {
      console.error('Leaderboard stats sync failed:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to sync leaderboard stats' }),
      };
    }

    console.log('✅ Leaderboard stats synced for yesterday.');
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Unexpected error during leaderboard sync:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected server error' }),
    };
  }
};
