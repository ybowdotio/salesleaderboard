const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HUBSPOT_HEADERS = {
  Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
  'Content-Type': 'application/json',
};

function getTodayDateRange() {
  const now = new Date();
  const start = new Date(now.setHours(0, 0, 0, 0)).toISOString();
  const end = new Date().toISOString();
  return { start, end };
}

function getMonthStartDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

exports.handler = async () => {
  const startedAt = new Date().toISOString();
  console.log(`📊 Leaderboard sync started at ${startedAt}`);

  try {
    const ownersRes = await fetch('https://api.hubapi.com/crm/v3/owners/', {
      headers: HUBSPOT_HEADERS,
    });
    const ownersJson = await ownersRes.json();
    const owners = ownersJson.results || [];

    const { start, end } = getTodayDateRange();
    const monthStart = getMonthStartDate();

    for (const owner of owners) {
      const ownerId = owner.id;
      const name = `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim();
      const email = owner.email;
      const avatar_url = owner.user?.avatarUrl || null;

      // 1. Get today's calls using v3 search
      const callsRes = await fetch(
        'https://api.hubapi.com/crm/v3/objects/calls/search',
        {
          method: 'POST',
          headers: HUBSPOT_HEADERS,
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'hs_timestamp',
                    operator: 'BETWEEN',
                    value: new Date(start).getTime(),
                    highValue: new Date(end).getTime(),
                  },
                  {
                    propertyName: 'hubspot_owner_id',
                    operator: 'EQ',
                    value: ownerId,
                  },
                ],
              },
            ],
            properties: ['hs_call_duration'],
            limit: 100,
          }),
        }
      );

      const callsJson = await callsRes.json();
      const callsToday = callsJson.results || [];

      const call_count = callsToday.length;
      const total_call_time_seconds = callsToday.reduce((sum, call) => {
        return sum + Number(call.properties.hs_call_duration || 0);
      }, 0);

      const avg_call_length_seconds = call_count
        ? Math.round(total_call_time_seconds / call_count)
        : 0;

      // 2. Get MTD sales
      const dealsRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/deals/search`,
        {
          method: 'POST',
          headers: HUBSPOT_HEADERS,
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'closedate',
                    operator: 'GTE',
                    value: monthStart,
                  },
                  {
                    propertyName: 'hubspot_owner_id',
                    operator: 'EQ',
                    value: ownerId,
                  },
                  {
                    propertyName: 'dealstage',
                    operator: 'EQ',
                    value: 'closedwon',
                  },
                ],
              },
            ],
            properties: ['amount'],
            limit: 100,
          }),
        }
      );

      const dealsData = await dealsRes.json();
      const sales_mtd = (dealsData.results || []).reduce((sum, deal) => {
        return sum + Number(deal.properties.amount || 0);
      }, 0);

      // 3. Upsert to Supabase leaderboard table
      await supabase.from('leaderboard').upsert({
        hubspot_owner_id: ownerId,
        name,
        email,
        avatar_url,
        call_count,
        avg_call_length_seconds,
        total_call_time_seconds: Math.round(total_call_time_seconds),
        sales_mtd,
        last_updated_at: new Date().toISOString(),
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Leaderboard synced successfully' }),
    };
  } catch (error) {
    console.error('❌ Leaderboard sync failed:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
