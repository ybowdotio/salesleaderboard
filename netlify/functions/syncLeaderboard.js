const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const getTodayKey = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString().slice(0, 10);
};

exports.handler = async function () {
  try {
    const today = getTodayKey();

    // 1. Get or create tracker row
    let { data: trackerRow } = await supabase
      .from('sync_tracker')
      .select('*')
      .eq('date', today)
      .single();

    if (!trackerRow) {
      const { data, error } = await supabase.from('sync_tracker').insert([
        { date: today, offset: 0, completed: false }
      ]);
      trackerRow = data?.[0];
    }

    if (trackerRow.completed) {
      console.log('✅ Sync already completed today.');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Sync already complete' })
      };
    }

    const limit = 100;
    const offset = trackerRow.offset || 0;

    // 2. Fetch page of engagements from HubSpot
    const { data } = await axios.get(
      'https://api.hubapi.com/engagements/v1/engagements/paged',
      {
        headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
        params: { limit, offset }
      }
    );

    console.log(`🔄 Pulled ${data.results.length} engagements at offset ${offset}`);

    const callMap = new Map();

    const todayISO = new Date(today).toISOString();

    for (const engagement of data.results) {
      const { type, timestamp, ownerId, durationMilliseconds } = engagement.engagement;

      if (type === 'CALL') {
        const callDate = new Date(timestamp);
        if (callDate.toISOString() >= todayISO) {
          const repId = ownerId || 'unknown';
          if (!callMap.has(repId)) {
            callMap.set(repId, { callCount: 0, totalDuration: 0 });
          }
          const entry = callMap.get(repId);
          entry.callCount++;
          entry.totalDuration += durationMilliseconds || 0;
        }
      }
    }

    // 3. Upsert call stats to leaderboard
    const upsertData = Array.from(callMap.entries()).map(([repId, { callCount, totalDuration }]) => ({
      rep_id: repId,
      date: today,
      call_count: callCount,
      total_duration: totalDuration
    }));

    if (upsertData.length > 0) {
      await supabase.from('leaderboard').upsert(upsertData, {
        onConflict: ['rep_id', 'date']
      });
    }

    // 4. Update sync_tracker offset or mark as complete
    const nextOffset = data.offset || 0;
    const completed = !data.hasMore;

    await supabase.from('sync_tracker').update({
      offset: nextOffset,
      completed
    }).eq('date', today);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Sync step completed',
        nextOffset,
        completed
      })
    };
  } catch (err) {
    console.error('❌ Sync error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed sync step', details: err.message })
    };
  }
};
