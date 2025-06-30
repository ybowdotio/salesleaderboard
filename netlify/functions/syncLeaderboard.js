const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const getTodayISOString = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
};

exports.handler = async function () {
  try {
    const todayISO = getTodayISOString();
    const callMap = new Map();

    let hasMore = true;
    let offset = 0;
    const limit = 100;

    console.log(`🔄 Pulling ${limit} engagements at offset ${offset}`);
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
          const repId = ownerId;
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
      hubspot_owner_id: repId,
      call_count: callCount,
      total_call_time_seconds: Math.floor(totalDuration / 1000),
      avg_call_length_seconds: callCount > 0 ? Math.floor(totalDuration / callCount / 1000) : 0
    }));

    console.log("✅ Upserting this data to Supabase leaderboard:");
    console.log(upsertData);

    if (upsertData.length > 0) {
      await supabase.from('leaderboard').upsert(upsertData, {
        onConflict: ['hubspot_owner_id']
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Sync completed' })
    };
  } catch (err) {
    console.error('❌ Sync error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Sync failed', details: err.message })
    };
  }
};
