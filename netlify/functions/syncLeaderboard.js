const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN; // Temporary for testing

  try {
    const ownersRes = await axios.get(
      'https://api.hubapi.com/crm/v3/owners',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const owners = ownersRes.data.results;

    // Upsert each rep
    for (const owner of owners) {
      const email = owner.email;
      const id = owner.id;
      const name = `${owner.firstName || ''} ${owner.lastName || ''}`.trim();

      if (!email || !name) continue;

      await supabase.from('reps').upsert(
        {
          id,
          email,
          name,
        },
        { onConflict: ['id'] }
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Loaded ${owners.length} reps` }),
    };
  } catch (error) {
    console.error('Sync error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
