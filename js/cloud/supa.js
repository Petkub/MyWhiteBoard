// Shared Supabase client for cloud sync (auth + storage). CDN-lazy like the
// realtime SDK — the core app never touches the network until sync is used.
// The client persists its session in localStorage, so login survives reloads.
// Kept separate from quiz/live/net.js: realtime manages its own client.

import { SUPABASE_URL, SUPABASE_ANON_KEY, configured } from '../quiz/live/config.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let clientP = null;
export function supa() {
  if (!clientP) clientP = import(SDK).then((m) => m.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  return clientP;
}

export { configured };
