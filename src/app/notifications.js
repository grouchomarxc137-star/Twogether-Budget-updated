import { actor } from '../lib/session.js';

const PANEL_ID = 'twNotificationCenter';
const BUTTON_ID = 'twNotificationButton';

const pendingSources = new Map();
let actorObserver = null;
let activeSource = 'trips';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
}

function itemPriority(item) {
  if (item?.priority === 'critical' || item?.urgent === true) return 2;
  if (item?.priority === 'important') return 1;
  return 0;
}

function currentGroups() {
  const a = actor();
  const groups = [...pendingSources.entries()].map(([source, items]) => ({
    source,
    items: items.filter((item) => !item.actor || item.actor === a),
  })).filter((group) => group.items.length);

  groups.forEach((group) => {
    group.items.sort((left, right) => itemPriority(right) - itemPriority(left));
  });

  const tripsImportant = groups.some((group) => group.source === 'trips' && group.items.some((item) => itemPriority(item) > 0));
  const normalRank = { finances:0, trips:1 };
  groups.sort((left, right) => {
    const leftRank = tripsImportant && left.source === 'trips' ? -1 : (normalRank[left.source] ?? 10);
    const rightRank = tripsImportant && right.source === 'trips' ? -1 : (normalRank[right.source] ?? 10);
    return leftRank - rightRank;
  });
  return groups;
}

function currentItems() {
  return currentGroups().flatMap((group) => group.items);
}

function groupMeta(source) {
  if (source === 'finances') return { title:'Finances', className:'is-finances' };
  if (source === 'trips') return { title:'Trips', className:'is-trips' };
  return { title:'Other', className:'is-other' };
}

function itemsForSource(groups, source) {
  return groups.find((group) => group.source === source)?.items || [];
}

function sourceIcon(source) {
  if (source === 'finances') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3h11"/><path d="M3 7.5h14"/><path d="M15 11h6v5h-6a2.5 2.5 0 0 1 0-5Z"/><circle cx="16.5" cy="13.5" r=".7"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14a2 2 0 0 1 2 2v9H3v-9a2 2 0 0 1 2-2Z"/><path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8"/><path d="M8 8v11m8-11v11"/></svg>';
}

function renderSourceTabs(groups) {
  const tripCount = itemsForSource(groups, 'trips').length;
  const financeCount = itemsForSource(groups, 'finances').length;
  return '<div class="tw-notification-tabs" role="tablist" aria-label="Notification category">' +
    '<button type="button" role="tab" class="tw-notification-tab is-trips' + (activeSource === 'trips' ? ' is-active' : '') + '" data-tw-notification-tab="trips" aria-selected="' + (activeSource === 'trips' ? 'true' : 'false') + '">' +
      '<span class="tw-notification-tab-icon">' + sourceIcon('trips') + '</span><strong>Trips</strong><span class="tw-notification-tab-count">' + tripCount + '</span>' +
    '</button>' +
    '<span class="tw-notification-tab-divider" aria-hidden="true"></span>' +
    '<button type="button" role="tab" class="tw-notification-tab is-finances' + (activeSource === 'finances' ? ' is-active' : '') + '" data-tw-notification-tab="finances" aria-selected="' + (activeSource === 'finances' ? 'true' : 'false') + '">' +
      '<span class="tw-notification-tab-icon">' + sourceIcon('finances') + '</span><strong>Finances</strong><span class="tw-notification-tab-count">' + financeCount + '</span>' +
    '</button>' +
  '</div>';
}

function renderGroup(group) {
  const meta = groupMeta(group.source);
  const level = group.source === 'trips' ? Math.max(0, ...group.items.map(itemPriority)) : 0;
  const priorityClass = level === 2 ? ' is-priority is-critical' : level === 1 ? ' is-priority is-important' : '';
  return '<section class="tw-notification-group ' + meta.className + priorityClass + '">' +
    '<div class="tw-notification-group-head"><strong>' + esc(meta.title) + '</strong><span>' + group.items.length + '</span></div>' +
    '<div class="tw-notification-group-items">' + group.items.map(renderItem).join('') + '</div>' +
  '</section>';
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
    ? '<div class="tw-notification-actions"><button type="button" data-tw-notification-action="not-yet" data-notification-id="' + esc(item.id) + '">Not yet</button><button type="button" class="is-primary" data-tw-notification-action="yes" data-notification-id="' + esc(item.id) + '">' + esc(item.actionLabel || 'Yes') + '</button></div>'
    : '';
  const openAction = item.openLabel
    ? '<div class="tw-notification-actions"><button type="button" class="is-primary" data-tw-notification-action="open" data-notification-id="' + esc(item.id) + '">' + esc(item.openLabel) + '</button></div>'
    : '';
  const level = itemPriority(item);
  const priorityClass = level === 2 ? ' is-urgent' : level === 1 ? ' is-important' : '';
  return '<article class="tw-notification-item' + priorityClass + '" data-notification-id="' + esc(item.id) + '">' +
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

  const groups = currentGroups();
  const items = groups.flatMap((group) => group.items);
  const visibleItems = itemsForSource(groups, activeSource);
  const count = ui.button.querySelector('.tw-notification-count');
  if (count) {
    count.textContent = String(items.length);
    count.hidden = items.length === 0;
  }
  ui.button.classList.toggle('has-pending', items.length > 0);
  ui.button.setAttribute('aria-label', items.length ? 'Open notifications, ' + items.length + ' pending' : 'Open notifications');

  const body = document.getElementById('twNotificationBody');
  if (!body) return;
  const pendingText = items.length + ' pending';
  const emptyLabel = activeSource === 'finances' ? 'No finance notifications' : 'No trip notifications';
  body.innerHTML =
    '<div class="tw-notification-title-block">' +
      '<h2 id="twNotificationTitle">Notifications</h2>' +
      '<p>' + esc(pendingText) + '</p>' +
    '</div>' +
    renderSourceTabs(groups) +
    '<div class="tw-notification-list tw-notification-source-list is-' + esc(activeSource) + '" role="tabpanel">' +
      (visibleItems.length
        ? visibleItems.map(renderItem).join('')
        : '<div class="tw-notification-empty"><span>✓</span><strong>' + esc(emptyLabel) + '</strong></div>') +
    '</div>';
}
function open() {
  const ui = ensureUi();
  if (!ui || !actor()) return;
  const groups = currentGroups();
  if (!itemsForSource(groups, activeSource).length) {
    if (itemsForSource(groups, 'trips').length) activeSource = 'trips';
    else if (itemsForSource(groups, 'finances').length) activeSource = 'finances';
  }
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
    actionLabel: String(item?.actionLabel || ''),
    kind: String(item?.kind || ''),
    openLabel: String(item?.openLabel || ''),
    urgent: item?.urgent === true,
    priority: item?.priority === 'critical' ? 'critical' : item?.priority === 'important' ? 'important' : '',
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
    const tab = event.target.closest?.('[data-tw-notification-tab]');
    if (tab) {
      const source = String(tab.dataset.twNotificationTab || '');
      if (source === 'trips' || source === 'finances') {
        activeSource = source;
        render();
      }
      return;
    }
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
