const { fetch } = require('undici');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async function () {
  try {
    const todayISO = new Date().toISOString().slice(0, 10);
    const callMap = new Map();

    console.log('📅 Today ISO:', todayISO);

    // Fetch reps from Supabase
    const { data: reps, error: repsError } = await supabase.from('reps').select('hubspot_owner_id');
    if (repsError) throw repsError;

    const repIds = reps.map(rep => rep.hubspot_owner_id);
    console.log(`📋 Loaded ${repIds.length} reps`);

    let after = undefined;
    let hasMore = true;

    while (hasMore) {
      const hsUrl = new URL('https://api.hubapi.com/engagements/v1/engagements/paged');
      hsUrl.searchParams.set('limit', '100');
      if (after) hsUrl.searchParams.set('offset', after);
      hsUrl.searchParams.set('hapikey', HUBSPOT_API_KEY);

      const response = await fetch(hsUrl.toString());
      if (!response.ok) throw new Error(`Failed to fetch engagements: ${response.status}`);
      const data = await response.json();

      console.log(`📦 Fetched ${data.results.length} engagements`);

      for (const engagement of data.results) {
        const { type, timestamp, ownerId, durationMilliseconds } = engagement.engagement;

        if (type === 'CALL') {
          const callDate = new Date(timestamp);
          console.log(`📞 CALL found: ${callDate.toISOString()} — Owner: ${ownerId}, Duration: ${durationMilliseconds}`);

          if (callDate.toISOString().startsWith(todayISO)) {
            const repId = ownerId || 'unknown';

            if (!callMap.has(repId)) {
              callMap.set(repId, {
                callCount: 0,
                totalDuration: 0
              });
            }

            const repStats = callMap.get(repId);
            repStats.callCount += 1;
            repStats.totalDuration += Number(durationMilliseconds || 0);
          }
        }
      }

      after = data.offset;
      hasMore = data.hasMore;
      console.log(`➡️ Next after: ${after} | Has more: ${hasMore}`);
    }

    // Upsert aggregated call data into leaderboard table
    const rows = [];
    for (const [ownerId, stats] of callMap.entries()) {
      if (!repIds.includes(ownerId)) continue;

      rows.push({
        hubspot_owner_id: ownerId,
        call_count: stats.callCount,
        avg_call_length_seconds: stats.callCount > 0 ? Math.round(stats.totalDuration / 1000 / stats.callCount) : 0,
        total_call_time_seconds: Math.round(stats.totalDuration / 1000),
        last_updated_at: new Date().toISOString()
      });
    }

    console.log('🔄 Upserting call data:', rows);

    const { error: upsertError } = await supabase.from('leaderboard').upsert(rows, {
      onConflict: ['hubspot_owner_id']
    });

    if (upsertError) throw upsertError;

    return {
      statusCode: 200,
      body: JSON.stringify({ message: '✅ Sync completed using cursor-based pagination', totalReps: rows.length })
    };
  } catch (err) {
    console.error('❌ Sync error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
