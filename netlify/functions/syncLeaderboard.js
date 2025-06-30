import { createClient } from '@supabase/supabase-js';
import 'undici';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  try {
    const callMap = new Map();
    const todayISO = new Date().toISOString().slice(0, 10);
    
    let after = undefined;
    let hasMore = true;

    while (hasMore) {
      const url = new URL('https://api.hubapi.com/engagements/v1/engagements/paged');
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('offset', after);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return res.status(401).json({ error: `Failed to fetch engagements: ${response.status}` });
      }

      const data = await response.json();

      for (const engagement of data.results) {
        const { type, timestamp, ownerId, durationMilliseconds } = engagement.engagement;

        if (type === 'CALL') {
          const callDate = new Date(timestamp);
          if (callDate.toISOString().startsWith(todayISO)) {
            const repId = ownerId || 'unknown';

            if (!callMap.has(repId)) {
              callMap.set(repId, { callCount: 0, totalDuration: 0 });
            }

            const stats = callMap.get(repId);
            stats.callCount += 1;
            stats.totalDuration += durationMilliseconds || 0;
          }
        }
      }

      hasMore = data.hasMore;
      after = data.offset;
    }

    // Fetch reps
    const { data: reps, error: repsError } = await supabase.from('sales_reps').select('id, hubspot_owner_id');
    if (repsError) throw new Error('Failed to fetch reps: ' + repsError.message);

    for (const rep of reps) {
      const stats = callMap.get(rep.hubspot_owner_id);
      await supabase.from('sales_leaderboard').upsert({
        rep_id: rep.id,
        call_count: stats?.callCount || 0,
        total_call_time: stats?.totalDuration || 0,
      });
    }

    return res.status(200).json({ message: '✅ Sync completed using cursor-based pagination', totalReps: reps.length });

  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: error.message || 'Unexpected error' });
  }
}
