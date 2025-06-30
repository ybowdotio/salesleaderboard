<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Sync Status</title>
</head>
<body>
  <h1>Last Sync Status</h1>
  <pre id="status">Loading...</pre>

  <script>
    async function fetchSyncStatus() {
      const res = await fetch('/.netlify/functions/syncStatus');
      const data = await res.json();
      document.getElementById('status').textContent = JSON.stringify(data, null, 2);
    }

    fetchSyncStatus();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  const { data, error } = await supabase
    .from('reps')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      lastSynced: data[0]?.updated_at || 'No data yet',
    }),
  };
};

  </script>
</body>
</html>

