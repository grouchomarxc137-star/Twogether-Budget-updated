import { actor } from '../lib/session.js';

const PANEL_ID = 'twNotificationCenter';
const BUTTON_ID = 'twNotificationButton';

const pendingSources = new Map();
let actorObserver = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
}

function currentItems() {
  const a = actor();
  return [...pendingSources.values()].flat().filter((item) => !item.actor || item.actor === a);
}

function ensureUi() {
  const top = document.querySelector('.top-actions');
  if (!top) return null;

  let button = document.getElementById(BUTTON_ID);
  if (!button) {
    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'tw-notification-button';
    button.setAttribute('aria-label', 'Open notifications');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg><span class="tw-notification-count" aria-hidden="true"></span>';
    const profileBadge = document.getElementById('loggedUserBadge');
    if (profileBadge?.parentElement === top) profileBadge.insertAdjacentElement('afterend', button);
    else top.appendChild(button);
  }

  let layer = document.getElementById(PANEL_ID);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = PANEL_ID;
    layer.className = 'tw-notification-layer';
    layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = '<div class="tw-notification-backdrop" data-tw-notification-close></div><section class="tw-notification-card" role="dialog" aria-modal="true" aria-labelledby="twNotificationTitle"><button class="tw-notification-close" type="button" data-tw-notification-close aria-label="Close notifications">×</button><div id="twNotificationBody"></div></section>';
    document.body.appendChild(layer);
  }

  return { button, layer };
}

function renderItem(item) {
  const important = item.reminders?.length
    ? '<div class="tw-notification-prep-block is-important"><b>Important reminders</b>' + item.reminders.map((text) => '<span>• ' + esc(text) + '</span>').join('') + '</div>'
    : '';
  const packing = item.packing?.length
    ? '<div class="tw-notification-prep-block"><b>Packing / checklist</b>' + item.packing.map((text) => '<span>• ' + esc(text) + '</span>').join('') + '</div>'
    : '';
  const financeActions = item.actionable
    ? '<div class="tw-notification-actions"><button type="button" data-tw-notification-action="not-yet" data-notification-id="' + esc(item.id) + '">Not yet</button><button type="button" class="is-primary" data-tw-notification-action="yes" data-notification-id="' + esc(item.id) + '">Yes</button></div>'
    : '';
  const openAction = item.openLabel
    ? '<div class="tw-notification-actions"><button type="button" class="is-primary" data-tw-notification-action="open" data-notification-id="' + esc(item.id) + '">' + esc(item.openLabel) + '</button></div>'
    : '';
  return '<article class="tw-notification-item" data-notification-id="' + esc(item.id) + '">' +
    '<div class="tw-notification-copy"><strong>' + esc(item.title || 'Reminder') + '</strong>' +
    (item.detail ? '<small>' + esc(item.detail) + '</small>' : '') +
    important + packing + '</div>' + financeActions + openAction + '</article>';
}

function render() {
  const ui = ensureUi();
  if (!ui) return;

  const a = actor();
  ui.button.hidden = !a;
  if (!a) {
    close();
    return;
  }

  const items = currentItems();
  const count = ui.button.querySelector('.tw-notification-count');
  if (count) {
    count.textContent = String(items.length);
    count.hidden = items.length === 0;
  }
  ui.button.classList.toggle('has-pending', items.length > 0);
  ui.button.setAttribute('aria-label', items.length ? 'Open notifications, ' + items.length + ' pending' : 'Open notifications');

  const body = document.getElementById('twNotificationBody');
  if (!body) return;
  body.innerHTML =
    '<span class="panel-kicker">REMINDERS</span>' +
    '<h2 id="twNotificationTitle">Notifications</h2>' +
    '<div class="tw-notification-heading"><strong>Pending</strong><span>' + items.length + '</span></div>' +
    '<div class="tw-notification-list">' +
      (items.length ? items.map(renderItem).join('') : '<div class="tw-notification-empty"><span>✓</span><strong>Nothing pending</strong></div>') +
    '</div>';
}
function open() {
  const ui = ensureUi();
  if (!ui || !actor()) return;
  render();
  ui.layer.hidden = false;
  ui.layer.setAttribute('aria-hidden', 'false');
  ui.layer.classList.add('show');
  ui.button.setAttribute('aria-expanded', 'true');
}

function close() {
  const ui = ensureUi();
  if (!ui) return;
  ui.layer.classList.remove('show');
  ui.layer.setAttribute('aria-hidden', 'true');
  ui.layer.hidden = true;
  ui.button.setAttribute('aria-expanded', 'false');
}

function setPending(items = [], source = 'default') {
  const normalized = Array.isArray(items) ? items.map((item) => ({
    id: String(item?.id || ''),
    actor: String(item?.actor || ''),
    title: String(item?.title || ''),
    detail: String(item?.detail || ''),
    actionable: item?.actionable === true,
    kind: String(item?.kind || ''),
    openLabel: String(item?.openLabel || ''),
    reminders: Array.isArray(item?.reminders) ? item.reminders.map((text) => String(text || '')).filter(Boolean).slice(0, 8) : [],
    packing: Array.isArray(item?.packing) ? item.packing.map((text) => String(text || '')).filter(Boolean).slice(0, 8) : [],
  })).filter((item) => item.id && item.title) : [];
  pendingSources.set(String(source || 'default'), normalized);
  render();
}
export function initNotifications() {
  const ui = ensureUi();
  if (!ui) return;

  ui.button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    ui.layer.hidden ? open() : close();
  });

  ui.layer.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-tw-notification-close]')) { close(); return; }
    const action = event.target.closest?.('[data-tw-notification-action]');
    if (!action) return;
    const id = String(action.dataset.notificationId || '');
    const item = currentItems().find((candidate) => candidate.id === id);
    if (!item) return;
    const choice = String(action.dataset.twNotificationAction || '');
    if (choice === 'not-yet') {
      close();
      document.dispatchEvent(new CustomEvent('twogether:notification-action', { detail:{ id, choice, kind:item.kind } }));
      return;
    }
    if (choice === 'yes' || choice === 'open') {
      close();
      document.dispatchEvent(new CustomEvent('twogether:notification-action', { detail:{ id, choice, kind:item.kind } }));
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.layer.hidden) close();
  });

  if (actorObserver) actorObserver.disconnect();
  actorObserver = new MutationObserver(render);
  actorObserver.observe(document.body, { attributes:true, attributeFilter:['data-actor'] });

  window.TwogetherNotifications = {
    setPending,
    refresh: render,
    open,
    close,
  };

  render();
}
