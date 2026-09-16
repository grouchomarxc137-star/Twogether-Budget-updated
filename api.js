import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, getDoc, initializeFirestore, runTransaction } from 'firebase/firestore';
import { firebaseConfig } from './config.js';
import { normalizeStateDocument, runStateTransaction } from './src/lib/state-document.js';

const CACHE_KEY = 'twogether_state_cache_v2';
const ACTORS = ['Principessa', 'Principe'];
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const database = initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true });
const stateReference = doc(database, 'twogether', 'shared-state');
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {});

let queue = Promise.resolve();
let warmCacheUsed = false;
let currentUser = null;
let userWaiters = [];

function remember(state) {
  if (!state) return;
  window.__TWOGETHER_CACHED_STATE__ = state;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch {}
}

function forgetState() {
  warmCacheUsed = false;
  delete window.__TWOGETHER_CACHED_STATE__;
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

function authenticationError(error) {
  const code = String(error?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'The email or password is incorrect.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Wait a moment and try again.';
  if (code.includes('network-request-failed')) return 'Could not reach Firebase. Check your connection.';
  return error?.message || 'Could not sign in.';
}

function setAuthMessage(message = '') {
  const output = document.getElementById('firebaseAuthMessage');
  if (output) output.textContent = message;
}

function showAuthGate() {
  document.body.dataset.authenticated = 'false';
  const gate = document.getElementById('firebaseAuthGate');
  gate?.classList.add('show');
  gate?.setAttribute('aria-hidden', 'false');
  const app = document.getElementById('app');
  if (app) { app.style.visibility = 'hidden'; app.style.opacity = '0'; }
  document.getElementById('firebaseSignOut')?.classList.add('hidden');
}

function revealAuthenticatedApp(user) {
  document.body.dataset.authenticated = 'true';
  const gate = document.getElementById('firebaseAuthGate');
  gate?.classList.remove('show');
  gate?.setAttribute('aria-hidden', 'true');
  setAuthMessage('');
  const app = document.getElementById('app');
  if (app) {
    app.style.transition = 'opacity .12s ease';
    app.style.visibility = 'visible';
    app.style.opacity = '1';
  }
  const button = document.getElementById('firebaseSignOut');
  if (button) {
    button.classList.remove('hidden');
    button.title = user?.email ? `Signed in as ${user.email}` : 'Sign out of Firebase';
  }
  document.dispatchEvent(new CustomEvent('twogether:authenticated', { detail: { email: user?.email || '' } }));
}

async function requireAuthenticatedUser() {
  await persistenceReady;
  if (currentUser) return currentUser;
  return new Promise((resolve) => { userWaiters.push(resolve); });
}

async function readStateDocument() {
  await requireAuthenticatedUser();
  const snapshot = await getDoc(stateReference);
  if (snapshot.exists()) return normalizeStateDocument(snapshot.data()?.state);
  return runTransaction(database, async (transaction) => {
    const latest = await transaction.get(stateReference);
    if (latest.exists()) return normalizeStateDocument(latest.data()?.state);
    const initialState = normalizeStateDocument({});
    transaction.set(stateReference, { schemaVersion: 18, state: initialState });
    return initialState;
  });
}

async function remoteState() {
  const state = await readStateDocument();
  remember(state);
  return state;
}

async function state() {
  await requireAuthenticatedUser();
  const cached = window.__TWOGETHER_CACHED_STATE__;
  if (!warmCacheUsed && cached) {
    warmCacheUsed = true;
    setTimeout(() => remoteState().catch(() => {}), 0);
    return cached;
  }
  return remoteState();
}

async function send(action, payload, actor) {
  await requireAuthenticatedUser();
  if (!ACTORS.includes(actor)) throw new Error('Choose your profile first');
  const devMaintenance = ['saveFinanceProfile'];
  if (document.body.classList.contains('dev-playground') && !devMaintenance.includes(action)) {
    throw new Error('Leave DEV to save normal shared trip or finance changes. DEV only permits explicit maintenance deletes.');
  }
  const result = await runStateTransaction(
    async (update) => runTransaction(database, async (transaction) => {
      const snapshot = await transaction.get(stateReference);
      const latestState = snapshot.exists() ? snapshot.data()?.state : {};
      const nextState = update(latestState);
      transaction.set(stateReference, { schemaVersion: 18, state: nextState });
    }),
    action,
    payload || {},
    actor,
  );
  await remoteState();
  document.dispatchEvent(new CustomEvent('twogether:saved'));
  return result;
}

async function signIn(email, password) {
  await persistenceReady;
  setAuthMessage('Signing in…');
  try {
    return await signInWithEmailAndPassword(auth, String(email || '').trim(), String(password || ''));
  } catch (error) {
    const message = authenticationError(error);
    setAuthMessage(message);
    throw new Error(message);
  }
}

async function signOut() {
  await firebaseSignOut(auth);
  window.location.reload();
}

function installAuthUi() {
  const form = document.getElementById('firebaseAuthForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await signIn(document.getElementById('firebaseEmail')?.value, document.getElementById('firebasePassword')?.value);
      const password = document.getElementById('firebasePassword');
      if (password) password.value = '';
    } catch {
      document.getElementById('firebasePassword')?.focus();
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  document.getElementById('firebaseSignOut')?.addEventListener('click', () => signOut().catch((error) => setAuthMessage(authenticationError(error))));
}

installAuthUi();
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    userWaiters.forEach((resolve) => resolve(user));
    userWaiters = [];
    revealAuthenticatedApp(user);
  } else {
    forgetState();
    showAuthGate();
  }
});

window.TwogetherAPI = {
  state,
  remoteState,
  post(action, payload, actor) {
    const result = queue.then(() => send(action, payload, actor));
    queue = result.catch(() => {});
    return result;
  },
};
window.TwogetherAuth = { signIn, signOut, user: () => currentUser };
