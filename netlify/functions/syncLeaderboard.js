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
    console.log('🔗 Fetching HubSpot owners...');
    const ownersRes = await fetch('https://api.hubapi.com/crm/v3/owners/', {
      headers: HUBSPOT_HEADERS,
    });
    const ownersJson = await ownersRes.json();
    const owners = ownersJson.results || [];

    console.log(`👥 Found ${owners.length} owners`);

    const { start, end } = getTodayDateRange();
    const monthStart = getMonthStartDate();

    for (const owner of owners) {
      const ownerId = owner.id;
      const name = `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim();
      const email = owner.email;
      const avatar_url = owner.user?.avatarUrl || null;

      console.log(`📞 Fetching calls for ${name} (ID ${ownerId})...`);

      const engagementsRes = await fetch(
        `https://api.hubapi.com/engagements/v1/engagements/associated/OWNER/${ownerId}/paged?limit=100`,
        { headers: HUBSPOT_HEADERS }
      );
      const engagements = await engagementsRes.json();

      const callsToday = (engagements.results || []).filter((e) => {
        const ts = new Date(e.engagement.timestamp).toISOString();
        return e.engagement.type === 'CALL' && ts >= start && ts <= end;
      });

      const call_count = callsToday.length;
      const total_call_time_seconds = callsToday.reduce((sum, call) => {
        return sum + (call.engagement.durationMilliseconds || 0) / 1000;
      }, 0);

      const avg_call_length_seconds = call_count
        ? Math.round(total_call_time_seconds / call_count)
        : 0;

      console.log(`✅ ${call_count} calls today, avg length ${avg_call_length_seconds}s`);

      // Fetch MTD sales
      console.log(`💰 Fetching MTD sales for ${name}...`);
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

      console.log(`💵 MTD Sales: $${sales_mtd}`);

      // Upsert to Supabase
      const { error } = await supabase.from('leaderboard').upsert({
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

      if (error) {
        console.error(`❌ Supabase upsert error for ${name}:`, error.message);
      } else {
        console.log(`✅ Synced ${name} to leaderboard.`);
      }
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
