// netlify/functions/syncLeaderboardStats.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  console.info('📊 Starting syncLeaderboardStats...');

  // Calculate yesterday date in Chicago timezone for log_date
  const now = new Date();
  const chicagoOffsetHours = 5; // adjust to 6 if DST applies
  const utcMillis = now.getTime();
  const chicagoMillis = utcMillis - chicagoOffsetHours * 60 * 60 * 1000;
  const chicagoDate = new Date(chicagoMillis);
  chicagoDate.setHours(0, 0, 0, 0);
  const log_date = chicagoDate.toISOString().split('T')[0];
  console.info(`🗓️ Using log_date: ${log_date}`);

  try {
    // Step 1: Query aggregated call data from 'calls' table for log_date
    const { data: aggregatedCalls, error: selectError } = await supabase
      .from('calls')
      .select(`
        owner_id,
        owner_name,
        total_calls:count,
        avg_call_time:avg(duration_seconds),
        total_call_time:sum(duration_seconds)
      `)
      .eq('timestamp_date', log_date)
      .group('owner_id,owner_name')
      .order('total_calls', { ascending: false });

    if (selectError) {
      console.error('❌ Error fetching aggregated calls:', selectError);
      return { statusCode: 500, body: JSON.stringify(selectError) };
    }

    console.info(`📞 Aggregated ${aggregatedCalls.length} reps with calls`);

    // Step 2: Map results to insertable/updatable rows for leaderboard table
    const rowsToUpsert = aggregatedCalls.map((row) => ({
      log_date,
      rep_id: row.owner_id,
      rep_name: row.owner_name || 'Unknown Rep',
      total_outbound_calls: row.total_calls,
      avg_call_time: Math.round(row.avg_call_time || 0),
      total_call_time: row.total_call_time || 0,
    }));

    if (rowsToUpsert.length === 0) {
      console.info('🚫 No leaderboard rows to upsert');
      return { statusCode: 200, body: 'No leaderboard rows to upsert' };
    }

    // Step 3: Upsert leaderboard rows into 'today_leaderboard_stats' table
    const { error: upsertError } = await supabase
      .from('today_leaderboard_stats')
      .upsert(rowsToUpsert, {
        onConflict: ['log_date', 'rep_id'],
      });

    if (upsertError) {
      console.error('❌ Error upserting leaderboard rows:', upsertError);
      return { statusCode: 500, body: JSON.stringify(upsertError) };
    }

    console.info(`✅ Synced ${rowsToUpsert.length} leaderboard rows for ${log_date}`);
    return { statusCode: 200, body: `Synced ${rowsToUpsert.length} leaderboard rows for ${log_date}` };
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return { statusCode: 500, body: err.toString() };
  }
};
