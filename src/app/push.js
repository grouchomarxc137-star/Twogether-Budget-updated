import { actor } from '../lib/session.js';

const API_BASE = import.meta.env?.DEV ? 'http://localhost:4310' : '';
const state = { supported:false, permission:'default', enabled:false, busy:false, message:'' };
let actorObserver = null;
let syncTimer = null;

function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function emit() {
  document.dispatchEvent(new CustomEvent('twogether:push-status', { detail:{ ...state } }));
}

function setState(next) {
  Object.assign(state, next);
  emit();
}

function applicationServerKey(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(API_BASE + path, options);
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.ok) throw new Error(json.error || 'Could not update phone notifications');
  return json;
}

async function registration() {
  if (!supported()) return null;
  return navigator.serviceWorker.ready;
}

function subscriptionPayload(subscription) {
  const json = subscription?.toJSON?.() || {};
  return {
    endpoint: String(json.endpoint || subscription?.endpoint || ''),
    keys: {
      p256dh: String(json.keys?.p256dh || ''),
      auth: String(json.keys?.auth || ''),
    },
  };
}

async function syncSubscription(subscription) {
  const owner = actor();
  if (!owner || !subscription) return;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  await jsonFetch('/api/push/subscribe', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ actor:owner, subscription:subscriptionPayload(subscription), timezone }),
  });
}

async function refresh({ sync = true } = {}) {
  const isSupported = supported();
  const permission = isSupported ? Notification.permission : 'unsupported';
  if (!isSupported) {
    setState({ supported:false, permission, enabled:false, busy:false, message:'' });
    return { ...state };
  }
  try {
    const reg = await registration();
    const subscription = await reg.pushManager.getSubscription();
    const enabled = permission === 'granted' && !!subscription;
    setState({ supported:true, permission, enabled, busy:false, message:'' });
    if (enabled && sync && actor()) await syncSubscription(subscription);
  } catch (error) {
    setState({ supported:true, permission, enabled:false, busy:false, message:error?.message || 'Could not check phone notifications' });
  }
  return { ...state };
}

async function enable() {
  if (state.busy) return { ...state };
  if (!supported()) {
    setState({ supported:false, permission:'unsupported', enabled:false, message:'Install Twogether on your Home Screen first.' });
    return { ...state };
  }
  if (!actor()) {
    setState({ message:'Choose your profile first.' });
    return { ...state };
  }
  setState({ busy:true, message:'' });
  try {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') {
      setState({ permission, enabled:false, busy:false, message:permission === 'denied' ? 'Notifications are blocked in your phone settings.' : '' });
      return { ...state };
    }
    const reg = await registration();
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      const key = await jsonFetch('/api/push/public-key');
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:applicationServerKey(String(key.publicKey || '')),
      });
    }
    await syncSubscription(subscription);
    setState({ supported:true, permission:'granted', enabled:true, busy:false, message:'' });
  } catch (error) {
    setState({ supported:true, permission:Notification.permission, enabled:false, busy:false, message:error?.message || 'Could not enable phone notifications' });
  }
  return { ...state };
}

async function disable() {
  if (state.busy || !supported()) return { ...state };
  setState({ busy:true, message:'' });
  try {
    const reg = await registration();
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      await jsonFetch('/api/push/subscribe', {
        method:'DELETE',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ endpoint:subscription.endpoint }),
      }).catch(() => {});
      await subscription.unsubscribe();
    }
    setState({ supported:true, permission:Notification.permission, enabled:false, busy:false, message:'' });
  } catch (error) {
    setState({ busy:false, message:error?.message || 'Could not turn off phone notifications' });
  }
  return { ...state };
}


async function scheduleTest() {
  if (state.busy || !supported()) return { ...state };
  setState({ busy:true, message:'' });
  try {
    const reg = await registration();
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription || Notification.permission !== 'granted') {
      setState({ busy:false, enabled:false, message:'Turn phone notifications on first.' });
      return { ...state };
    }
    await jsonFetch('/api/push/test', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ endpoint:subscription.endpoint }),
    });
    setState({ busy:false, enabled:true, message:'Test scheduled — it should arrive in about 1 minute.' });
  } catch (error) {
    setState({ busy:false, message:error?.message || 'Could not schedule the test notification' });
  }
  return { ...state };
}

function scheduleActorSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    refresh({ sync:true }).catch(() => {});
  }, 100);
}

export function initPushNotifications() {
  state.supported = supported();
  state.permission = state.supported ? Notification.permission : 'unsupported';
  window.TwogetherPush = {
    status:() => ({ ...state }),
    refresh,
    enable,
    disable,
    scheduleTest,
  };
  refresh({ sync:true }).catch(() => {});
  actorObserver?.disconnect?.();
  actorObserver = new MutationObserver(() => scheduleActorSync());
  actorObserver.observe(document.body, { attributes:true, attributeFilter:['data-actor'] });
  window.addEventListener('online', scheduleActorSync, { passive:true });
}
