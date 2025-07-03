const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

exports.handler = async function () {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const msg = 'Missing Supabase environment variables';
    console.error(msg);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: msg }),
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const todayDate = dayjs().tz('America/Chicago').format('YYYY-MM-DD');

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
      timezone('America/Chicago', c.timestamp)::date as log_date,
      c.owner_id as rep_id,
      r.name as rep_name,
      count(*) as total_outbound_calls,
      sum(c.duration_seconds) as total_call_time,
      avg(c.duration_seconds)::int as avg_call_time
    from calls c
    join reps r on c.owner_id = r.id
    where timezone('America/Chicago', c.timestamp)::date = current_date at time zone 'America/Chicago'
    group by log_date, rep_id, rep_name
    on conflict (log_date, rep_id)
    do update set
      rep_name = excluded.rep_name,
      total_outbound_calls = excluded.total_outbound_calls,
      total_call_time = excluded.total_call_time,
      avg_call_time = excluded.avg_call_time;
  `;

  try {
    console.info('📊 About to send raw SQL to Supabase...');
    const { error } = await supabase.rpc('execute_raw_sql', { sql: rawSQL });

    if (error) {
      console.error('❌ Leaderboard stats sync failed:', error);
      await supabase.from('sync_logs').insert({
        function_name: 'syncLeaderboardStats',
        status: 'error',
        message: error.message || JSON.stringify(error),
      });

      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      };
    }

    console.log('✅ Leaderboard stats synced for today.');
    await supabase.from('sync_logs').insert({
      function_name: 'syncLeaderboardStats',
      status: 'success',
      message: `Leaderboard stats synced for ${todayDate}`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('❌ Unexpected error during leaderboard sync:', err);
    await supabase.from('sync_logs').insert({
      function_name: 'syncLeaderboardStats',
      status: 'error',
      message: err.message || 'Unexpected error',
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Unexpected error',
        message: err.message,
      }),
    };
  }
};
