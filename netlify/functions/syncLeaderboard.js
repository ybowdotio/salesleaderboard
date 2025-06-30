const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const getTodayDateOnly = () => {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
};

exports.handler = async function () {
  try {
    const todayISO = getTodayDateOnly();
    let after = null;
    let hasMore = true;
    const callMap = new Map();
    const todayDateStr = todayISO.slice(0, 10);

    while (hasMore) {
      const params = {
        limit: 100,
        ...(after && { after }),
      };

      const { data } = await axios.get(
        'https://api.hubapi.com/engagements/v1/engagements/paged',
        {
          headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
          params,
        }
      );

      console.log(`📦 Fetched ${data.results.length} engagements`);

      for (const engagement of data.results) {
        const { type, timestamp, ownerId, durationMilliseconds } = engagement.engagement;

        if (type === 'CALL') {
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

      hasMore = data['paging'] && data.paging.next && data.paging.next.after;
      after = hasMore ? data.paging.next.after : null;

      console.log(`➡️ Next after: ${after} | Has more: ${hasMore}`);
    }

    const upsertData = Array.from(callMap.entries()).map(([repId, { callCount, totalDuration }]) => ({
      rep_id: repId,
      date: todayDateStr,
      call_count: callCount,
      total_duration: totalDuration,
    }));

    console.log('🔄 Upserting call data:', upsertData);

    if (upsertData.length > 0) {
      await supabase.from('leaderboard').upsert(upsertData, {
        onConflict: ['rep_id', 'date'],
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: '✅ Sync completed using cursor-based pagination',
        totalReps: upsertData.length,
      }),
    };
  } catch (err) {
    console.error('❌ Sync error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to sync leaderboard',
        details: err.message,
      }),
    };
  }
};
