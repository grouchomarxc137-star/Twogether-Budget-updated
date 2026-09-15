// Consolidates the toast() helper duplicated (with a differently-named timeout
// guard per copy: el._t, el._v5t, el._v18, el._v27, el._v28, el._v33) across
// app.js, workflow.js, finances.js, trip-wizard-bridge-v15.js, approved-v18.js,
// v27.js, v28.js and v33.js.

import { $ } from './dom.js';

let hideTimer = null;

export function toast(message, tone = 'ok') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show ' + tone;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}
