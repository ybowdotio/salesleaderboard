// utils/goals.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const loadGoals = async (userId) => {
  const { data, error } = await supabase
    .from('daily_goals')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) console.error('Error loading goals:', error);
  return data;
};

export const saveGoals = async (userId, goalsData) => {
  const payload = { ...goalsData, user_id: userId, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('daily_goals').upsert(payload);
  if (error) console.error('Error saving goals:', error);
};

export const resetGoals = async (userId) => {
  await supabase.from('daily_goals').delete().eq('user_id', userId);
};
