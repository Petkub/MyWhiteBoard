// Light/dark theme. Sets data-theme on <html>; CSS vars in theme.css do the
// rest. Dark themes the app shell + desk only — the page paper stays white so
// ink stays visible and exports match. Choice persists in localStorage.

const KEY = 'wb-theme';

export function applyTheme() {
  const t = localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  return t;
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(KEY, next);
  return next;
}

export const themeLabel = () => (currentTheme() === 'dark' ? '☀ Light' : '🌙 Dark');
