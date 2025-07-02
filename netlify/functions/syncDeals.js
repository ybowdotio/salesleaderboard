const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  try {
    console.log('🧪 Starting basic test...');

    // Write test log to sync_logs
    const { error } = await supabase.from('sync_logs').insert([
      {
        type: 'pull',
        status: 'success',
        message: 'Basic log test'
      }
    ]);

    if (error) throw new Error(error.message);

    console.log('✅ Successfully inserted test log.');

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Test completed.' })
    };
  } catch (err) {
    console.error('❌ Basic test failed:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
