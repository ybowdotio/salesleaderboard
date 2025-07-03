// netlify/functions/syncLeaderboardStats.js
const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async () => {
  console.info('📊 Starting leaderboard stat sync...');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing Supabase env vars');
    return { statusCode: 500, body: 'Missing env vars' };
  }

  // 🕒 TEMPORARY: Use YESTERDAY'S DATE (local time) to avoid missing early-morning calls
  // ❗ Change `.minus({ days: 1 })` back to `.now()` when ready to resume daily sync
  const logDate = DateTime.now().setZone('America/Chicago').minus({ days: 1 }).toISODate();

  // Pull all calls from yesterday
  const { data: calls, error: callErr } = await supabase
    .from('calls')
    .select('*')
    .eq('timestamp_date', logDate);

  if (callErr) {
    console.error('❌ Error fetching calls:', callErr);
    return { statusCode: 500, body: JSON.stringify(callErr) };
  }

  if (!calls || calls.length === 0) {
    console.info('📭 No call data for leaderboard. Skipping update.');
    return { statusCode: 200, body: 'No call data for yesterday.' };
  }

  // Group calls by rep_id
  const statsMap = new Map();

  for (const call of calls) {
    const id = call.owner_id;
    if (!id) continue;

    if (!statsMap.has(id)) {
      statsMap.set(id, []);
    }
    statsMap.get(id).push(call);
  }

  const rows = [];

  for (const [rep_id, callsForRep] of statsMap.entries()) {
    const total = callsForRep.length;
    const totalSecs = callsForRep.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
    const outbound = callsForRep.filter(c => c.direction === 'OUTGOING').length;
    const avgSecs = total > 0 ? Math.round(totalSecs / total) : 0;

    // Lookup rep name from reps table
    const { data: rep, error: repErr } = await supabase
      .from('reps')
      .select('name')
      .eq('id', rep_id)
      .maybeSingle();

    if (repErr) {
      console.warn(`⚠️ Could not lookup name for rep ${rep_id}`);
    }

    rows.push({
      rep_id,
      rep_name: rep?.name || 'Unknown',
      total_outbound_calls: outbound,
      avg_call_time: avgSecs,
      total_call_time: totalSecs,
      log_date: logDate
    });
  }

  // Upsert stats
  const { error: upErr } = await supabase.from('today_leaderboard_stats').upsert(rows, {
    onConflict: ['rep_id', 'log_date']
  });

  if (upErr) {
    console.error('❌ Failed to upsert stats:', upErr);
    return { statusCode: 500, body: JSON.stringify(upErr) };
  }

  console.info(`✅ Synced ${rows.length} leaderboard rows.`);
  return {
    statusCode: 200,
    body: `Synced ${rows.length} leaderboard rows for ${logDate}`
  };
};
