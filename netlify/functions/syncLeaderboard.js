const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const getTodayISOString = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0); // midnight UTC
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

    while (hasMore) {
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
          console.log(`📅 Call timestamp: ${callDate.toISOString()} vs today: ${todayISO}`);

          if (callDate.toISOString() >= todayISO) {
            console.log(`✅ Call matched for today`);
            const repId = ownerId || 'unknown';
            console.log(`👤 Owner ${repId}, duration: ${durationMilliseconds}`);

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
      if (pagesChecked >= maxPages) {
        console.warn(`⛔ Reached maxPages limit of ${maxPages}. Stopping pagination.`);
        break;
      }
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
      const { data: upsertResult, error: upsertError } = await supabase
        .from('leaderboard')
        .upsert(upsertData, {
          onConflict: ['rep_id', 'date']
        });

      if (upsertError) {
        console.error('❌ Supabase upsert error:', upsertError);
      } else {
        console.log('✅ Supabase upsert result:', upsertResult);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Leaderboard synced successfully' })
    };
  } catch (err) {
    console.error('🔥 Sync error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to sync leaderboard', details: err.message })
    };
  }
};
