import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://your-project-id.supabase.co',
  'your-anon-key-here'
);

const GOALS_ID = 'global-goals'; // any fixed value as primary key

export const loadGoals = async () => {
  const { data, error } = await supabase
    .from('daily_goals')
    .select('*')
    .eq('id', GOALS_ID)
    .maybeSingle();

  if (error) console.error('Error loading goals:', error);
  return data;
};

export const saveGoals = async (goalsData) => {
  const payload = {
    id: GOALS_ID,
    ...goalsData,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from('daily_goals').upsert(payload);
  if (error) console.error('Error saving goals:', error);
};

export const resetGoals = async () => {
  await supabase.from('daily_goals').delete().eq('id', GOALS_ID);
};
