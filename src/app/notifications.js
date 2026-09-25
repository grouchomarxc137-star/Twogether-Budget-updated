import { actor } from '../lib/session.js';

const PANEL_ID = 'twNotificationCenter';
const BUTTON_ID = 'twNotificationButton';

const pendingSources = new Map();
let actorObserver = null;
let activeSource = 'trips';
const expandedTripNotifications = new Set();
let pushDeepLinkSource = (() => {
  try {
    const value = new URLSearchParams(window.location.search).get('notifications') || '';
    return value === 'trips' || value === 'finances' ? value : '';
  } catch {
    return '';
  }
})();

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
    '<div class="tw-notification-group-items">' + group.items.map((item) => renderItem(item, group.source)).join('') + '</div>' +
  '</section>';
}

function clearPushDeepLink() {
  if (!pushDeepLinkSource) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('notifications');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch {}
}

const PUSH_PROMPT_ID = 'twPushPrompt';

function ensurePushPrompt() {
  let layer = document.getElementById(PUSH_PROMPT_ID);
  if (layer) return layer;
  layer = document.createElement('div');
  layer.id = PUSH_PROMPT_ID;
  layer.className = 'tw-push-prompt-layer';
  layer.hidden = true;
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML =
    '<div class="tw-push-prompt-backdrop" data-tw-push-close></div>' +
    '<section class="tw-push-prompt-card" role="dialog" aria-modal="true" aria-labelledby="twPushPromptTitle">' +
      '<div id="twPushPromptBody"></div>' +
    '</section>';
  document.body.appendChild(layer);

  layer.addEventListener('click', async (event) => {
    if (event.target.closest?.('[data-tw-push-close]')) {
      closePushPrompt();
      return;
    }
    const action = event.target.closest?.('[data-tw-push-prompt-action]');
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const api = window.TwogetherPush;
    if (!api) return;
    action.disabled = true;
    const mode = String(action.dataset.twPushPromptAction || '');
    if (mode === 'disable') await api.disable?.();
    else await api.enable?.();
    const status = api.status?.() || {};
    if ((mode === 'enable' && status.enabled) || (mode === 'disable' && !status.enabled && !status.message)) {
      closePushPrompt();
      return;
    }
    renderPushPrompt();
  });

  return layer;
}

function renderPushPrompt() {
  const layer = ensurePushPrompt();
  const body = layer.querySelector('#twPushPromptBody');
  const api = window.TwogetherPush;
  if (!body || !api?.status) return;
  const status = api.status();

  let title = status.enabled ? 'Turn phone notifications off?' : 'Turn phone notifications on?';
  let detail = status.enabled
    ? 'Twogether will stop sending reminders to this phone.'
    : 'Twogether can show your Trips and Finances reminders on your lock screen.';
  let action = status.enabled ? 'disable' : 'enable';
  let actionLabel = status.enabled ? 'Turn off' : 'Turn on';

  if (!status.supported) {
    title = 'Phone notifications';
    detail = 'Install Twogether on your Home Screen first to use lock-screen notifications.';
    action = '';
  } else if (status.permission === 'denied') {
    title = 'Phone notifications are blocked';
    detail = 'Allow notifications for Twogether in your phone settings, then try again.';
    action = '';
  }

  body.innerHTML =
    '<h3 id="twPushPromptTitle">' + esc(title) + '</h3>' +
    '<p>' + esc(detail) + '</p>' +
    (status.message ? '<small class="tw-push-prompt-message">' + esc(status.message) + '</small>' : '') +
    '<div class="tw-push-prompt-actions">' +
      '<button type="button" data-tw-push-close>Cancel</button>' +
      (action ? '<button type="button" class="is-primary" data-tw-push-prompt-action="' + action + '"' + (status.busy ? ' disabled' : '') + '>' + (status.busy ? 'Working…' : actionLabel) + '</button>' : '') +
    '</div>';
}

async function openPushPrompt() {
  close();
  const api = window.TwogetherPush;
  if (api?.refresh) await api.refresh().catch(() => {});
  const layer = ensurePushPrompt();
  renderPushPrompt();
  layer.hidden = false;
  layer.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => layer.classList.add('show'));
}

function closePushPrompt() {
  const layer = document.getElementById(PUSH_PROMPT_ID);
  if (!layer) return;
  layer.classList.remove('show');
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
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

function renderItem(item, source = activeSource) {
  const important = item.reminders?.length
    ? '<div class="tw-notification-prep-block is-important"><b>Important reminders</b>' + item.reminders.map((text) => '<span>• ' + esc(text) + '</span>').join('') + '</div>'
    : '';
  const packing = item.packing?.length
    ? '<div class="tw-notification-prep-block"><b>Packing / checklist</b>' + item.packing.map((text) => '<span>• ' + esc(text) + '</span>').join('') + '</div>'
    : '';
  const swipeConfirm = source === 'finances' && item.actionable;
  const financeActions = item.actionable && !swipeConfirm
    ? '<div class="tw-notification-actions"><button type="button" data-tw-notification-action="not-yet" data-notification-id="' + esc(item.id) + '">Not yet</button><button type="button" class="is-primary" data-tw-notification-action="yes" data-notification-id="' + esc(item.id) + '">' + esc(item.actionLabel || 'Yes') + '</button></div>'
    : '';
  const openAction = item.openLabel
    ? '<div class="tw-notification-actions tw-notification-open-action"><button type="button" class="is-primary" data-tw-notification-action="open" data-notification-id="' + esc(item.id) + '">' + esc(item.openLabel) + '</button></div>'
    : '';
  const level = itemPriority(item);
  const priorityClass = level === 2 ? ' is-urgent' : level === 1 ? ' is-important' : '';
  const priorityCue = level > 0
    ? '<span class="tw-notification-priority-cue" aria-label="' + (level === 2 ? 'Final checks' : 'Important') + '"><span aria-hidden="true">▲</span>' + (level === 2 ? 'Final checks' : 'Important') + '</span>'
    : '';
  const isTrip = source === 'trips';
  const expandable = isTrip && (!!item.reminders?.length || !!item.packing?.length);
  const expanded = expandable && expandedTripNotifications.has(item.id);
  const titleContent = '<strong>' + esc(item.title || 'Reminder') + '</strong>' + priorityCue;
  const titleRow = expandable
    ? '<button type="button" class="tw-notification-expand" data-tw-notification-expand="' + esc(item.id) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
        '<span class="tw-notification-title-row">' + titleContent + '</span><span class="tw-notification-chevron" aria-hidden="true">⌄</span>' +
      '</button>'
    : '<div class="tw-notification-title-row">' + titleContent + '</div>';
  const details = expandable
    ? '<div class="tw-notification-expandable" ' + (expanded ? '' : 'hidden') + '>' + important + packing + '</div>'
    : important + packing;
  const sourceClass = isTrip ? ' is-trip' : ' is-finance';
  const expandableClass = expandable ? ' is-expandable' + (expanded ? ' is-expanded' : '') : '';
  const actionableClass = swipeConfirm ? ' is-actionable' : '';
  const content =
    '<div class="tw-notification-copy">' + titleRow +
    (item.detail ? '<small>' + esc(item.detail) + '</small>' : '') +
    details + '</div>' + financeActions + openAction;
  const swipeContent = swipeConfirm
    ? '<span class="tw-notification-swipe-reveal" aria-hidden="true"><b>✓</b><span>Confirm</span></span><div class="tw-notification-swipe-content">' + content + '</div>'
    : content;
  return '<article class="tw-notification-item' + sourceClass + actionableClass + expandableClass + priorityClass + '" data-notification-id="' + esc(item.id) + '">' +
    swipeContent + '</article>';
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
        ? visibleItems.map((item) => renderItem(item, activeSource)).join('')
        : '<div class="tw-notification-empty"><span>✓</span><strong>' + esc(emptyLabel) + '</strong></div>') +
    '</div>';
}
function open() {
  const ui = ensureUi();
  if (!ui || !actor()) return;
  window.TwogetherPush?.refresh?.().catch?.(() => {});
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
  const sourceKey = String(source || 'default');
  pendingSources.set(sourceKey, normalized);
  const openFromPush = pushDeepLinkSource === sourceKey && (sourceKey === 'trips' || sourceKey === 'finances') && !!actor();
  if (openFromPush) activeSource = sourceKey;
  render();
  if (openFromPush) {
    clearPushDeepLink();
    pushDeepLinkSource = '';
    setTimeout(() => open(), 0);
  }
}
export function initNotifications() {
  const ui = ensureUi();
  if (!ui) return;

  let financeSwipe = { tracking:false, active:false, startX:0, startY:0, lastX:0, item:null, content:null };

  function resetFinanceSwipe(animate = true) {
    const content = financeSwipe.content;
    if (content?.isConnected) {
      content.style.transition = animate ? 'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease' : 'none';
      content.style.transform = 'translateX(0)';
      content.style.opacity = '1';
      content.closest('.tw-notification-item')?.classList.remove('is-swiping-confirm');
      if (animate) setTimeout(() => { if (content.isConnected) content.style.transition = ''; }, 220);
    }
    financeSwipe = { tracking:false, active:false, startX:0, startY:0, lastX:0, item:null, content:null };
  }

  function confirmFinanceSwipe(itemEl) {
    const id = String(itemEl?.dataset.notificationId || '');
    const item = currentItems().find((candidate) => candidate.id === id);
    if (!item || !item.actionable) { resetFinanceSwipe(true); return; }
    const content = financeSwipe.content;
    if (content?.isConnected) {
      const width = itemEl.getBoundingClientRect().width || 280;
      content.style.transition = 'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';
      content.style.transform = 'translateX(' + Math.max(width, 280) + 'px)';
      content.style.opacity = '.72';
    }
    financeSwipe = { tracking:false, active:false, startX:0, startY:0, lastX:0, item:null, content:null };
    setTimeout(() => {
      close();
      document.dispatchEvent(new CustomEvent('twogether:notification-action', { detail:{ id, choice:'yes', kind:item.kind } }));
    }, 170);
  }

  let bellPressTimer = null;
  let bellPressStart = null;
  let ignoreBellClickUntil = 0;

  function cancelBellLongPress() {
    if (bellPressTimer) clearTimeout(bellPressTimer);
    bellPressTimer = null;
    bellPressStart = null;
    ui.button.classList.remove('is-long-pressing');
  }

  ui.button.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    cancelBellLongPress();
    bellPressStart = { x:event.clientX, y:event.clientY, pointerId:event.pointerId };
    ui.button.classList.add('is-long-pressing');
    bellPressTimer = setTimeout(() => {
      bellPressTimer = null;
      ignoreBellClickUntil = Date.now() + 700;
      ui.button.classList.remove('is-long-pressing');
      openPushPrompt().catch(() => {});
    }, 550);
  });

  ui.button.addEventListener('pointermove', (event) => {
    if (!bellPressStart || event.pointerId !== bellPressStart.pointerId) return;
    if (Math.hypot(event.clientX - bellPressStart.x, event.clientY - bellPressStart.y) > 10) cancelBellLongPress();
  });

  ui.button.addEventListener('pointerup', cancelBellLongPress);
  ui.button.addEventListener('pointercancel', cancelBellLongPress);
  ui.button.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') cancelBellLongPress();
  });

  ui.button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() < ignoreBellClickUntil) return;
    ui.layer.hidden ? open() : close();
  });

  ui.layer.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    const item = event.target.closest?.('.tw-notification-item.is-finance.is-actionable');
    if (!item) return;
    const content = item.querySelector('.tw-notification-swipe-content');
    if (!content) return;
    const touch = event.touches[0];
    resetFinanceSwipe(false);
    financeSwipe = { tracking:true, active:false, startX:touch.clientX, startY:touch.clientY, lastX:touch.clientX, item, content };
  }, { passive:true });

  ui.layer.addEventListener('touchmove', (event) => {
    if (!financeSwipe.tracking || !financeSwipe.item || !financeSwipe.content || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - financeSwipe.startX;
    const dy = Math.abs(touch.clientY - financeSwipe.startY);
    financeSwipe.lastX = touch.clientX;

    if (!financeSwipe.active) {
      if (Math.abs(dx) < 8 && dy < 8) return;
      const horizontal = Math.abs(dx) > dy * 1.25;
      if (horizontal && dx > 10) financeSwipe.active = true;
      else if (dy >= Math.abs(dx) || dx < -10) { resetFinanceSwipe(false); return; }
    }
    if (!financeSwipe.active) return;

    event.preventDefault();
    event.stopPropagation();
    const width = financeSwipe.item.getBoundingClientRect().width || 280;
    const distance = Math.max(0, Math.min(width * .72, dx));
    financeSwipe.item.classList.add('is-swiping-confirm');
    financeSwipe.content.style.transition = 'none';
    financeSwipe.content.style.transform = 'translateX(' + distance + 'px)';
    financeSwipe.content.style.opacity = String(1 - Math.min(.12, distance / width * .12));
  }, { passive:false });

  ui.layer.addEventListener('touchend', (event) => {
    if (!financeSwipe.tracking || !financeSwipe.item) return;
    const item = financeSwipe.item;
    const dx = financeSwipe.lastX - financeSwipe.startX;
    const width = item.getBoundingClientRect().width || 280;
    const threshold = Math.max(92, width * .38);
    const shouldConfirm = financeSwipe.active && dx >= threshold;
    if (financeSwipe.active) event.stopPropagation();
    if (shouldConfirm) confirmFinanceSwipe(item);
    else resetFinanceSwipe(true);
  }, { passive:true });

  ui.layer.addEventListener('touchcancel', () => {
    if (financeSwipe.tracking) resetFinanceSwipe(true);
  }, { passive:true });

  ui.layer.addEventListener('click', async (event) => {
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
    const expander = event.target.closest?.('[data-tw-notification-expand]');
    if (expander) {
      const id = String(expander.dataset.twNotificationExpand || '');
      if (id) {
        if (expandedTripNotifications.has(id)) expandedTripNotifications.delete(id);
        else expandedTripNotifications.add(id);
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

  document.addEventListener('twogether:push-status', () => {
    render();
    const prompt = document.getElementById(PUSH_PROMPT_ID);
    if (prompt && !prompt.hidden) renderPushPrompt();
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
