const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const getToday = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString().slice(0, 10);
};

exports.handler = async function () {
  try {
    const today = getToday();

    // Load or initialize sync tracker
    let { data: trackerRow, error: trackerErr } = await supabase
      .from('sync_tracker')
      .select('*')
      .eq('date', today)
      .single();

    if (!trackerRow) {
      const insertResult = await supabase.from('sync_tracker').insert([
        { date: today, offset: 0, completed: false }
      ]).select().single();

      if (insertResult.error) {
        throw new Error('Failed to create sync_tracker row: ' + insertResult.error.message);
      }

      trackerRow = insertResult.data;
    }

    if (!trackerRow) {
      throw new Error('sync_tracker row missing or failed to create');
    }

    if (trackerRow.completed) {
      console.log(`✅ Sync already completed for today.`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Already synced for today' })
      };
    }

    const limit = 100;
    const offset = trackerRow.offset || 0;
    const todayISO = new Date(today).toISOString();
    const callMap = new Map();

    console.log(`🔄 Pulling 100 engagements at offset ${offset}`);

    const { data } = await axios.get(`https://api.hubapi.com/engagements/v1/engagements/paged`, {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
      params: { limit, offset }
    });

    console.log(`📦 Returned ${data.results.length} engagements`);

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
      console.log(`✅ Upserted ${upsertData.length} rows to leaderboard`);
    }

    // Update sync_tracker offset and completion
    const newOffset = data.offset || 0;
    const syncComplete = !data.hasMore;

    await supabase.from('sync_tracker').update({
      offset: newOffset,
      completed: syncComplete
    }).eq('date', today);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Sync completed', nextOffset: newOffset, completed: syncComplete })
    };

  } catch (err) {
    console.error('❌ Sync error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to sync leaderboard', details: err.message })
    };
  }
};
