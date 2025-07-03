// netlify/functions/syncLeaderboardStats.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  console.info('📊 Starting syncLeaderboardStats...');

  try {
    // ⏱️ Chicago time offset (UTC-5/6 depending on DST)
    const now = new Date();
    const offsetDate = new Date(now);
    offsetDate.setDate(now.getDate() - 1); // 🔁 Use "yesterday" for now
    const chicagoDate = offsetDate.toLocaleDateString('en-CA', {
      timeZone: 'America/Chicago'
    }); // YYYY-MM-DD

    console.info(`🗓️ Using log_date: ${chicagoDate}`);

    // 📤 Fetch reps from Supabase
    const { data: reps, error: repsError } = await supabase
      .from('reps')
      .select('id, name');

    if (repsError) {
      console.error('❌ Failed to fetch reps:', repsError);
      return { statusCode: 500, body: 'Failed to fetch reps' };
    }

    const repMap = {};
    reps.forEach((r) => (repMap[r.id] = r.name));
    console.info(`👥 Loaded ${reps.length} reps`);

    // 📞 Aggregate call data
    const { data: calls, error: callsError } = await supabase
      .from('calls')
      .select('owner_id, duration_seconds')
      .eq('timestamp_date', chicagoDate);

    if (callsError) {
      console.error('❌ Failed to fetch call logs:', callsError);
      return { statusCode: 500, body: 'Failed to fetch call logs' };
    }

    console.info(`📞 Processing ${calls.length} calls`);

    // 🧮 Group by rep_id
    const leaderboard = {};
    for (const call of calls) {
      const repId = call.owner_id;
      if (!repId) continue;

      if (!leaderboard[repId]) {
        leaderboard[repId] = {
          rep_id: repId,
          rep_name: repMap[repId] || 'Unknown Rep',
          total_outbound_calls: 0,
          total_call_time: 0,
          avg_call_time: 0,
          log_date: chicagoDate
        };
      }

      leaderboard[repId].total_outbound_calls += 1;
      leaderboard[repId].total_call_time += call.duration_seconds || 0;
    }

    // 🧠 Compute average
    for (const stat of Object.values(leaderboard)) {
      stat.avg_call_time = stat.total_outbound_calls
        ? Math.round(stat.total_call_time / stat.total_outbound_calls)
        : 0;
    }

    const leaderboardRows = Object.values(leaderboard);
    console.info(`📊 Prepared ${leaderboardRows.length} leaderboard rows`);

    // 🪄 Upsert into today_leaderboard_stats
    const { error: upsertError } = await supabase
      .from('today_leaderboard_stats')
      .upsert(leaderboardRows, {
        onConflict: ['rep_id', 'log_date']
      });

    if (upsertError) {
      console.error('❌ Upsert error:', upsertError);
      return { statusCode: 500, body: 'Upsert failed' };
    }

    console.info('✅ Leaderboard sync complete');
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Synced ${leaderboardRows.length} leaderboard rows for ${chicagoDate}`
      })
    };
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
