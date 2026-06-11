// Modern promise-based dialogs replacing native prompt/confirm/alert.
// One reusable backdrop; Esc cancels, Enter confirms, click-outside cancels.

import { BACKGROUNDS } from '../config.js';

let backdrop = null;

function ensure() {
  if (backdrop) return;
  backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.hidden = true;
  document.body.appendChild(backdrop);
}

function open(buildBody) {
  ensure();
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    let settled = false;
    const close = (val) => {
      if (settled) return;
      settled = true;
      backdrop.hidden = true;
      backdrop.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(cancelVal); }
      else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); onEnter(); }
    };
    let cancelVal = null;
    let onEnter = () => {};
    const api = {
      close,
      setCancelValue: (v) => { cancelVal = v; },
      setEnter: (fn) => { onEnter = fn; },
    };
    buildBody(dialog, api);
    backdrop.innerHTML = '';
    backdrop.appendChild(dialog);
    backdrop.hidden = false;
    backdrop.onclick = (e) => { if (e.target === backdrop) close(cancelVal); };
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      const f = dialog.querySelector('input, textarea, button.modal-confirm');
      if (f) f.focus();
      if (f && f.select) f.select();
    });
  });
}

const h = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

const WARN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

export function modalPrompt({ title, label = '', value = '', placeholder = '', confirmText = 'OK' } = {}) {
  return open((dialog, api) => {
    dialog.innerHTML = `
      <div class="modal-title">${h(title)}</div>
      ${label ? `<div class="modal-label">${h(label)}</div>` : ''}
      <input class="modal-input" type="text" value="${h(value)}" placeholder="${h(placeholder)}">
      <div class="modal-actions">
        <button class="modal-btn modal-cancel">Cancel</button>
        <button class="modal-btn modal-confirm">${h(confirmText)}</button>
      </div>`;
    const input = dialog.querySelector('.modal-input');
    const submit = () => api.close(input.value);
    api.setEnter(submit);
    dialog.querySelector('.modal-confirm').onclick = submit;
    dialog.querySelector('.modal-cancel').onclick = () => api.close(null);
  });
}

export function modalConfirm({ title, message = '', confirmText = 'Confirm', danger = false } = {}) {
  return open((dialog, api) => {
    api.setCancelValue(false);
    if (danger) dialog.classList.add('modal-danger');
    dialog.innerHTML = `
      <div class="modal-title">${danger ? WARN_ICON : ''}${h(title)}</div>
      ${message ? `<div class="modal-msg">${h(message)}</div>` : ''}
      <div class="modal-actions">
        <button class="modal-btn modal-cancel">Cancel</button>
        <button class="modal-btn modal-confirm ${danger ? 'danger' : ''}">${h(confirmText)}</button>
      </div>`;
    api.setEnter(() => api.close(true));
    dialog.querySelector('.modal-confirm').onclick = () => api.close(true);
    dialog.querySelector('.modal-cancel').onclick = () => api.close(false);
  });
}

export function modalAlert({ title = 'Notice', message = '' } = {}) {
  return open((dialog, api) => {
    dialog.innerHTML = `
      <div class="modal-title">${h(title)}</div>
      ${message ? `<div class="modal-msg">${h(message)}</div>` : ''}
      <div class="modal-actions">
        <button class="modal-btn modal-confirm">OK</button>
      </div>`;
    api.setEnter(() => api.close());
    dialog.querySelector('.modal-confirm').onclick = () => api.close();
  });
}

// New-notebook dialog: title + paper pattern + page size.
// Resolves { title, bg, ph } (ph null = infinite) or null on cancel.
const PAGE_SIZES = [
  ['∞ scroll', 0], ['A4', 1123], ['1:1', 794], ['16:9', 447],
];
export function modalNewNotebook({ value = 'Untitled' } = {}) {
  return open((dialog, api) => {
    dialog.innerHTML = `
      <div class="modal-title">New notebook</div>
      <div class="modal-label">Title</div>
      <input class="modal-input" type="text" value="${h(value)}">
      <div class="modal-label">Paper</div>
      <div class="tb-bgpick modal-bgpick">
        ${BACKGROUNDS.map((b) => `<button type="button" class="tb-bgtile" data-bg="${b}" title="${b}"></button>`).join('')}
      </div>
      <div class="modal-label">Page size</div>
      <div class="modal-sizes">
        ${PAGE_SIZES.map(([label, ph]) => `<button type="button" class="modal-size" data-ph="${ph}">${label}</button>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="modal-btn modal-cancel">Cancel</button>
        <button class="modal-btn modal-confirm">Create</button>
      </div>`;
    const input = dialog.querySelector('.modal-input');
    let bg = 'grid', ph = 0;
    const sync = () => {
      dialog.querySelectorAll('.tb-bgtile').forEach((b) => b.classList.toggle('active', b.dataset.bg === bg));
      dialog.querySelectorAll('.modal-size').forEach((b) => b.classList.toggle('active', Number(b.dataset.ph) === ph));
    };
    dialog.querySelectorAll('.tb-bgtile').forEach((b) => b.onclick = () => { bg = b.dataset.bg; sync(); });
    dialog.querySelectorAll('.modal-size').forEach((b) => b.onclick = () => { ph = Number(b.dataset.ph); sync(); });
    sync();
    const submit = () => api.close({ title: input.value, bg, ph: ph || null });
    api.setEnter(submit);
    dialog.querySelector('.modal-confirm').onclick = submit;
    dialog.querySelector('.modal-cancel').onclick = () => api.close(null);
  });
}

// options: [{ label, value }]. Resolves to chosen value, or null on cancel.
export function modalChoose({ title, options = [] } = {}) {
  return open((dialog, api) => {
    api.setCancelValue(undefined); // distinct from an option whose value is null
    dialog.innerHTML = `
      <div class="modal-title">${h(title)}</div>
      <div class="modal-list">
        ${options.map((o, i) => `<button class="modal-opt" data-i="${i}">${h(o.label)}</button>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="modal-btn modal-cancel">Cancel</button>
      </div>`;
    dialog.querySelectorAll('.modal-opt').forEach((b) =>
      b.onclick = () => api.close(options[Number(b.dataset.i)].value));
    dialog.querySelector('.modal-cancel').onclick = () => api.close(undefined);
  });
}
