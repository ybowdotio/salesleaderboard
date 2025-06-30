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
    let hasMore = true;
    let offset = 0;
    const limit = 100;
    const callMap = new Map();
    let pagesChecked = 0;
    const maxPages = 3;

    while (hasMore && pagesChecked < maxPages) {
      console.log(`📦 Fetching page with offset ${offset}`);

      const { data } = await axios.get(`https://api.hubapi.com/engagements/v1/engagements/paged`, {
        headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
        params: { limit, offset }
      });

      console.log(`🔎 Returned ${data.results.length} engagements`);

      for (const engagement of data.results) {
        const { type, timestamp, ownerId, durationMilliseconds } = engagement.engagement;

        console.log(`➡️ Engagement type: ${type}`);

        if (type === 'CALL') {
          const callDate = new Date(timestamp);
          console.log(`📅 Checking call timestamp: ${callDate.toISOString()} vs today: ${todayISO}`);

          if (callDate.toISOString() >= todayISO) {
            console.log(`✅ Call matched for today`);
            const repId = ownerId || 'unknown';
            console.log(`🎯 Matched call by owner ${repId} - duration: ${durationMilliseconds}`);

            if (!durationMilliseconds) {
              console.warn(`⚠️ Call has no duration:`, engagement);
            }

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

      hasMore = data.hasMore;
      offset = data.offset || 0;
      pagesChecked++;
    }

    console.log("📊 Final callMap entries:");
    console.log(Array.from(callMap.entries()));

    const upsertData = Array.from(callMap.entries()).map(([repId, { callCount, totalDuration }]) => ({
      rep_id: repId,
      date: todayISO.slice(0, 10),
      call_count: callCount,
      total_duration: totalDuration
    }));

    console.log("📤 Upsert payload:", upsertData);

    if (upsertData.length > 0) {
      const { error } = await supabase.from('leaderboard').upsert(upsertData, {
        onConflict: ['rep_id', 'date']
      });

      if (error) {
        console.error("❌ Supabase error during upsert:", error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Supabase upsert failed', details: error.message })
        };
      }

      console.log("✅ Supabase upsert result: Success");
    } else {
      console.log("ℹ️ No upsert performed – no call data found for today.");
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Leaderboard synced successfully' })
    };
  } catch (err) {
    console.error('❌ Sync error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to sync leaderboard', details: err.message })
    };
  }
};
