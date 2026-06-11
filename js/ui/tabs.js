// Notebook tabs — browser-style strip of open notebooks above the toolbar.
// Open set + active id persist in localStorage so tabs survive reload.

const KEY = 'wb-tabs';
let bar = null, onSelect = () => {}, onClose = () => {};
let tabs = [];          // [{ id, title }]
let active = null;

// Stable accent stripe per notebook so open tabs are recognizable at a glance.
const ACCENTS = ['#d62828', '#1d3fb6', '#2f9e44', '#7048e8', '#e64980'];
const accentOf = (id) => {
  let h = 0;
  for (const ch of String(id)) h = (h + ch.charCodeAt(0)) % 997;
  return ACCENTS[h % ACCENTS.length];
};
const HOME_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

export function initTabs(barEl, hooks) {
  bar = barEl;
  onSelect = hooks.onSelect || (() => {});
  onClose = hooks.onClose || (() => {});
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    tabs = Array.isArray(saved.tabs) ? saved.tabs : [];
    active = saved.active || null;
  } catch { tabs = []; active = null; }
}

function save() { localStorage.setItem(KEY, JSON.stringify({ tabs, active })); }

export function getTabs() { return tabs; }

// Add (if new) + activate a notebook tab.
export function openTab(id, title) {
  const t = tabs.find((x) => x.id === id);
  if (t) t.title = title;
  else tabs.push({ id, title });
  active = id;
  save(); render();
}

export function setActiveTab(id) { active = id; save(); render(); }

export function updateTabTitle(id, title) {
  const t = tabs.find((x) => x.id === id);
  if (t && t.title !== title) { t.title = title; save(); render(); }
}

// Remove a tab; returns the remaining tabs.
export function removeTab(id) {
  tabs = tabs.filter((x) => x.id !== id);
  if (active === id) active = null;
  save(); render();
  return tabs;
}

function render() {
  if (!bar) return;
  bar.innerHTML = '';
  const home = document.createElement('button');
  home.className = 'tab-home'; home.innerHTML = HOME_ICON; home.title = 'Library';
  home.addEventListener('click', () => onSelect(null));
  bar.append(home);
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === active ? ' active' : '');
    el.style.setProperty('--tab-accent', accentOf(t.id));
    el.title = t.title || 'Untitled';
    el.addEventListener('click', () => onSelect(t.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); onClose(t.id); } });
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = t.title || 'Untitled';
    const close = document.createElement('button');
    close.className = 'tab-close'; close.textContent = '✕'; close.title = 'Close tab';
    close.addEventListener('click', (e) => { e.stopPropagation(); onClose(t.id); });
    el.append(label, close);
    bar.append(el);
  }
}
