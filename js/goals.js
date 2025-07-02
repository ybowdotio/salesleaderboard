// /js/goals.js

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ✅ Replace these with your actual Supabase project values
const supabaseUrl = 'https://vmifmysnxolecfpidttr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtaWZteXNueG9sZWNmcGlkdHRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzODQ4NzksImV4cCI6MjA2Njk2MDg3OX0.3h-lHze2gA0y2Y3CCjPmAzyzI7Fe_FL3HCP0Tr4uMrU';

const supabase = createClient(supabaseUrl, supabaseKey);

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
  const payload = {
    ...goalsData,
    user_id: userId,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('daily_goals').upsert(payload);
  if (error) console.error('Error saving goals:', error);
};

export const resetGoals = async (userId) => {
  await supabase.from('daily_goals').delete().eq('user_id', userId);
};
