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
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const end = new Date().toISOString();
  return { start, end };
}

function getMonthStartDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

exports.handler = async () => {
  console.log(`📊 Leaderboard sync started at ${new Date().toISOString()}`);

  try {
    const ownersRes = await fetch('https://api.hubapi.com/crm/v3/owners/', {
      headers: HUBSPOT_HEADERS,
    });
    const owners = (await ownersRes.json()).results || [];

    const { start, end } = getTodayDateRange();
    const monthStart = getMonthStartDate();

    for (const owner of owners) {
      const ownerId = owner.id;
      const name = `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim();
      const email = owner.email;
      const avatar_url = owner.user?.avatarUrl || null;

      // 📞 Fetch today's calls using `createdate`
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
                    propertyName: 'createdate',
                    operator: 'BETWEEN',
                    value: start,
                    highValue: end,
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

      const calls = (await callsRes.json()).results || [];
      const call_count = calls.length;
      const total_call_time_seconds = calls.reduce((sum, call) => {
        const duration = parseInt(call.properties.hs_call_duration || '0', 10);
        return sum + duration;
      }, 0);
      const avg_call_length_seconds = call_count
        ? Math.round(total_call_time_seconds / call_count)
        : 0;

      console.log(
        `✅ ${call_count} calls for ${name} today, total ${total_call_time_seconds}s`
      );

      // 💰 Fetch MTD Closed-Won sales
      const dealsRes = await fetch(
        'https://api.hubapi.com/crm/v3/objects/deals/search',
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

      const deals = (await dealsRes.json()).results || [];
      const sales_mtd = deals.reduce((sum, deal) => {
        const amt = parseFloat(deal.properties.amount || '0');
        return sum + (isNaN(amt) ? 0 : amt);
      }, 0);

      console.log(`💵 MTD Sales for ${name}: $${sales_mtd}`);

      // 📝 Upsert to Supabase
      const { error } = await supabase.from('leaderboard').upsert({
        hubspot_owner_id: ownerId,
        name,
        email,
        avatar_url,
        call_count,
        avg_call_length_seconds,
        total_call_time_seconds,
        sales_mtd,
        last_updated_at: new Date().toISOString(),
      });

      if (error) {
        console.error(`❌ Supabase error for ${name}:`, error.message);
      } else {
        console.log(`✅ Synced ${name}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Leaderboard synced successfully' }),
    };
  } catch (err) {
    console.error('❌ Sync failed:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
