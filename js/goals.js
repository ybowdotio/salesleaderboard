// /js/goals.js

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ✅ Replace with your actual project credentials
const supabase = createClient(
  'https://wmifmsynoxlecfpidtdtr.supabase.co',
  'your-actual-anon-key-here'
);

const GLOBAL_GOAL_ID = 'global-goals';

export const loadGoals = async () => {
  const { data, error } = await supabase
    .from('daily_goals')
    .select('*')
    .eq('id', GLOBAL_GOAL_ID)
    .maybeSingle();

  if (error) console.error('Error loading goals:', error);
  return data;
};

export const saveGoals = async (goalsData) => {
  const payload = {
    id: GLOBAL_GOAL_ID,
    ...goalsData,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('daily_goals')
    .upsert(payload);

  if (error) console.error('Error saving goals:', error);
};

export const resetGoals = async () => {
  const { error } = await supabase
    .from('daily_goals')
    .delete()
    .eq('id', GLOBAL_GOAL_ID);

  if (error) console.error('Error resetting goals:', error);
};
