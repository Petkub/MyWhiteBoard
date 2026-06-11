// Supabase Realtime wrapper — one broadcast+presence channel per game room.
// SDK is CDN-lazy (like KaTeX/jsPDF): core app never touches the network.

import { SUPABASE_URL, SUPABASE_ANON_KEY, configured } from './config.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let clientP = null;
function client() {
  if (!clientP) {
    clientP = import(SDK).then((m) =>
      m.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        realtime: { params: { eventsPerSecond: 20 } },
      }));
  }
  return clientP;
}

export { configured };

// Join room channel `quiz:<code>`.
//   key:      presence key (playerId or 'host')
//   meta:     presence payload ({ role, nick })
//   onMessage(payload), onPresence(stateObj), onStatus(status)
// Returns { send, leave, state, track }.
export async function openChannel(code, { key, meta, onMessage, onPresence, onStatus }) {
  const sb = await client();
  const ch = sb.channel('quiz:' + code, {
    config: { broadcast: { self: false }, presence: { key } },
  });
  ch.on('broadcast', { event: 'msg' }, ({ payload }) => onMessage?.(payload));
  ch.on('presence', { event: 'sync' }, () => onPresence?.(ch.presenceState()));

  await new Promise((resolve, reject) => {
    let settled = false;
    ch.subscribe((status) => {
      onStatus?.(status);
      if (status === 'SUBSCRIBED') {
        ch.track(meta || {});
        if (!settled) { settled = true; resolve(); }
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !settled) {
        settled = true;
        reject(new Error('Realtime channel failed: ' + status));
      }
    });
  });

  return {
    send: (payload) => ch.send({ type: 'broadcast', event: 'msg', payload }),
    leave: () => sb.removeChannel(ch),
    state: () => ch.presenceState(),
    track: (m) => ch.track(m),
  };
}
