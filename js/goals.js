import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://vmifmysnxolecfpidttr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtaWZteXNueG9sZWNmcGlkdHRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzODQ4NzksImV4cCI6MjA2Njk2MDg3OX0.3h-lHze2gA0y2Y3CCjPmAzyzI7Fe_FL3HCP0Tr4uMrU'
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
    .upsert(payload); // ✅ DO NOT WRAP IN []

  if (error) console.error('Error saving goals:', error);
};

export const resetGoals = async () => {
  const { error } = await supabase
    .from('daily_goals')
    .delete()
    .eq('id', GLOBAL_GOAL_ID);

  if (error) console.error('Error resetting goals:', error);
};
