const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = 'https://api.hubapi.com/engagements/v1/engagements/paged';
const today = new Date().toISOString().split('T')[0];

exports.handler = async function handler(event, context) {
  let hasMore = true;
  let offset = 0;
  const callMap = new Map();
  let fetched = 0;

  while (hasMore) {
    const res = await fetch(`${BASE_URL}?hapikey=${HUBSPOT_API_KEY}&limit=100&offset=${offset}`);
    if (!res.ok) {
      console.error('❌ HubSpot fetch failed');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch engagements from HubSpot' })
      };
    }

    const data = await res.json();
    const results = data.results || [];
    fetched += results.length;

    console.log(`📦 Fetched ${results.length} engagements`);

    // 👉 Log one sample engagement to inspect Aloware formatting
    if (results.length > 0) {
      console.log('📄 Sample engagement:\n', JSON.stringify(results[0], null, 2));
    }

    for (const item of results) {
      const engagement = item.engagement;
      const metadata = item.metadata;
      const { type, timestamp, ownerId } = engagement;

      if (type === 'CALL') {
        const callDate = new Date(timestamp);
        const callISO = callDate.toISOString();
        const todayISO = new Date().toISOString().split('T')[0];

        // durationMilliseconds might be undefined
        const duration = metadata?.durationMilliseconds;
        console.log(`📞 CALL found: ${callISO} — Owner: ${ownerId}, Duration: ${duration}`);

        if (callISO.startsWith(todayISO)) {
          const repId = ownerId || 'unknown';
          if (!callMap.has(repId)) {
            callMap.set(repId, {
              callCount: 0,
              totalDuration: 0
            });
          }
          const current = callMap.get(repId);
          current.callCount += 1;
          current.totalDuration += duration || 0;
          callMap.set(repId, current);
        }
      }
    }

    hasMore = data.hasMore;
    offset = data.offset || 0;
    console.log(`➡️ Next offset: ${offset} | Has more: ${hasMore}`);
  }

  const updates = [];
  for (const [repId, { callCount, totalDuration }] of callMap) {
    updates.push({
      hubspot_owner_id: repId,
      call_count: callCount,
      total_call_time_seconds: Math.round(totalDuration / 1000),
      avg_call_length_seconds: callCount > 0 ? Math.round(totalDuration / 1000 / callCount) : 0,
      last_updated_at: new Date().toISOString()
    });
  }

  console.log('🔄 Upserting call data:', updates);

  if (updates.length > 0) {
    const { error } = await supabase.from('leaderboard').upsert(updates, {
      onConflict: ['hubspot_owner_id']
    });

    if (error) {
      console.error('❌ Supabase upsert error:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to upsert leaderboard data' })
      };
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: '✅ Sync completed using cursor-based pagination',
      totalReps: updates.length
    })
  };
};
