// Supabase project credentials for live multiplayer quiz.
// The anon key is PUBLIC BY DESIGN (it ships in every Supabase web app);
// we use Realtime broadcast/presence only — no tables, nothing to leak.
// Fill these from: supabase.com -> your project -> Settings -> API.

export const SUPABASE_URL = 'https://mybhminpizsudvemfdwv.supabase.co'; // bare project URL — SDK appends /realtime/v1 etc.
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15YmhtaW5waXpzdWR2ZW1mZHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNjA2MjIsImV4cCI6MjA5NjczNjYyMn0.fqGWXstIWfGN3mK-hh9sh3pmtddKQCq_oYP2Df8V7Vs';

export const MAX_PLAYERS = 30; // + 1 host = 31 connections

export const configured = () =>
  SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 40;
