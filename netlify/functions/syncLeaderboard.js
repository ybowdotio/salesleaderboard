const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const getTodayDate = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
};

exports.handler = async function () {
  try {
    const todayDate = getTodayDate();
    const syncName = 'calls';

    // 🔍 Get sync state for today + name
    const { data: syncState, error: syncFetchError } = await supabase
      .from('sync_tracker')
      .select('*')
      .eq('date', todayDate)
      .eq('name', syncName)
      .single();

    if (syncFetchError && syncFetchError.code !== 'PGRST116') {
      throw new Error(`Failed to fetch sync tracker: ${syncFetchError.message}`);
    }

    const offset = syncState?.offset || 0;
    const completed = syncState?.completed || false;

    if (completed) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Sync already completed' })
      };
    }

    // 📥 Pull a single batch of 100 engagements
    console.log(`🔄 Pulling 100 engagements at offset ${offset}`);
    const { data: response } = await axios.get('https://api.hubapi.com/engagements/v1/engagements/paged', {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
      params: { limit: 100, offset }
    });

    console.log(`📦 Returned ${response.results.length} engagements`);

    const callMap = new Map();
    const todayISO = new Date(todayDate).toISOString();

    for (const engagement of response.results) {
      const { type, timestamp, ownerId, durationMilliseconds } = engagement.engagement;

      if (type === 'CALL') {
        const callDate = new Date(timestamp).toISOString();
        if (callDate >= todayISO) {
          const repId = ownerId || 'unknown';
          if (!callMap.has(repId)) {
            callMap.set(repId, { callCount: 0, totalDuration: 0 });
          }
          const entry = callMap.get(repId);
          entry.callCount += 1;
          entry.totalDuration += durationMilliseconds || 0;
        }
      }
    }

    const upsertData = Array.from(callMap.entries()).map(([repId, { callCount, totalDuration }]) => ({
      rep_id: repId,
      date: todayDate,
      call_count: callCount,
      total_duration: totalDuration
    }));

    if (upsertData.length > 0) {
      await supabase.from('leaderboard').upsert(upsertData, {
        onConflict: ['rep_id', 'date']
      });
    }

    // Update sync_tracker with new offset + completion
    const nextOffset = response.offset || 0;
    const done = !response.hasMore;

    await supabase.from('sync_tracker').upsert({
      date: todayDate,
      name: syncName,
      offset: nextOffset,
      completed: done
    }, {
      onConflict: ['date', 'name']
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Sync completed',
        nextOffset,
        completed: done
      })
    };

  } catch (err) {
    console.error('❌ Sync error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to sync leaderboard', details: err.message })
    };
  }
};
