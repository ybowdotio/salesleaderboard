const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const getTodayISOString = () => {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0); // Ensures midnight UTC
  return now.toISOString();
};

exports.handler = async function () {
  try {
    const todayISO = getTodayISOString();
    const todayDate = todayISO.slice(0, 10);

    // Get current sync offset
    const { data: trackerData, error: trackerError } = await supabase
      .from('sync_tracker')
      .select('*')
      .eq('date', todayDate)
      .single();

    if (trackerError && trackerError.code !== 'PGRST116') {
      throw trackerError;
    }

    const currentOffset = trackerData?.offset || 0;
    const callMap = new Map();

    console.log(`🔄 Pulling 100 engagements at offset ${currentOffset}`);
    const { data } = await axios.get('https://api.hubapi.com/engagements/v1/engagements/paged', {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
      params: {
        limit: 100,
        offset: currentOffset,
      },
    });

    console.log(`📦 Returned ${data.results.length} engagements`);

    for (const engagement of data.results) {
      const { type, timestamp, ownerId, durationMilliseconds } = engagement.engagement;

      console.log(`🔍 Type: ${type}`);
      console.log(`🕓 Timestamp: ${new Date(timestamp).toISOString()}`);
      console.log(`👤 Owner: ${ownerId}`);
      console.log(`⏱️ Duration: ${durationMilliseconds}`);

      if (type?.toUpperCase() === 'CALL') {
        const callDate = new Date(timestamp);
        if (callDate.toISOString() >= todayISO) {
          const repId = ownerId || 'unknown';

          if (!callMap.has(repId)) {
            callMap.set(repId, {
              callCount: 0,
              totalDuration: 0,
            });
          }

          const entry = callMap.get(repId);
          entry.callCount++;
          entry.totalDuration += durationMilliseconds || 0;
        }
      }
    }

    const upsertData = Array.from(callMap.entries()).map(([repId, { callCount, totalDuration }]) => ({
      rep_id: repId,
      date: todayDate,
      call_count: callCount,
      total_duration: totalDuration,
    }));

    console.log("📝 Upsert payload:", upsertData);

    if (upsertData.length > 0) {
      await supabase.from('leaderboard').upsert(upsertData, {
        onConflict: ['rep_id', 'date'],
      });
    }

    // Track sync progress
    const nextOffset = data.offset || 0;
    const completed = !data.hasMore;

    await supabase.from('sync_tracker').upsert({
      date: todayDate,
      offset: nextOffset,
      completed,
    }, {
      onConflict: ['date'],
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Sync completed', nextOffset, completed }),
    };

  } catch (err) {
    console.error('❌ Sync error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to sync leaderboard', details: err.message }),
    };
  }
};
