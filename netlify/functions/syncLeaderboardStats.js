const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

exports.handler = async function () {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const todayDate = dayjs().tz('America/Chicago').format('YYYY-MM-DD');

  try {
    console.info('📬 About to send raw SQL to Supabase...');

    const { data, error } = await supabase.rpc('sync_leaderboard_stats', {
      log_date_input: todayDate
    });

    if (error) {
      console.error('Error syncing leaderboard stats:', error);
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

    console.info('✅ Leaderboard stats synced for today.');
    await supabase.from('sync_logs').insert({
      function_name: 'syncLeaderboardStats',
      status: 'success',
      message: `Leaderboard stats synced for ${todayDate}.`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    await supabase.from('sync_logs').insert({
      function_name: 'syncLeaderboardStats',
      status: 'error',
      message: err.message,
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
