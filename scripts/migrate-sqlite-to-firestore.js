import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getFirestore, runTransaction, terminate } from 'firebase/firestore';
import { resolve } from 'node:path';
import { firebaseConfig } from '../config.js';
import { normalizeStateDocument } from '../src/lib/state-document.js';
import { openDatabase } from '../server/src/db/index.js';

const force = process.argv.includes('--force');
const databaseArgument = process.argv.find((argument) => argument.startsWith('--database='));
const databasePath = resolve(databaseArgument?.slice('--database='.length) || 'server/data/twogether.db');
const email = String(process.env.FIREBASE_EMAIL || '').trim();
const password = String(process.env.FIREBASE_PASSWORD || '');

if (!email || !password) {
  console.error('Set FIREBASE_EMAIL and FIREBASE_PASSWORD for one of the existing Firebase users.');
  process.exit(1);
}

function containsUserData(state) {
  if ((state?.trips || []).length || (state?.plans || []).length) return true;
  if ((state?.finances?.Principessa || []).length || (state?.finances?.Principe || []).length) return true;
  if ((state?.sharedJar?.transactions || []).length) return true;
  return ['Principessa', 'Principe'].some((actor) => {
    const profile = state?.financeProfiles?.[actor] || {};
    const game = state?.game?.[actor] || {};
    return ['bankAccounts', 'savingsReserved', 'receivables', 'scenarios', 'wishlist'].some((key) => (profile[key] || []).length)
      || Number(game.lovis || 0) !== 0
      || Number(game.twos || 0) !== 0
      || (game.purchases || []).length;
  });
}

const legacyDatabase = openDatabase(databasePath);
const state = normalizeStateDocument(legacyDatabase.store.read());
legacyDatabase.close();

const app = initializeApp(firebaseConfig, 'sqlite-migration');
const auth = getAuth(app);
const firestore = getFirestore(app);
const stateReference = doc(firestore, 'twogether', 'shared-state');

try {
  await signInWithEmailAndPassword(auth, email, password);
  await runTransaction(firestore, async (transaction) => {
    const existing = await transaction.get(stateReference);
    if (existing.exists() && containsUserData(existing.data()?.state) && !force) {
      throw new Error('Firestore already contains Twogether data. Nothing was overwritten. Re-run with --force only if replacement is intentional.');
    }
    transaction.set(stateReference, { schemaVersion: 18, state });
  });
  console.log(`Migrated ${state.trips.length} trips, ${state.plans.length} plans, and ${state.finances.Principessa.length + state.finances.Principe.length} finance months.`);
} finally {
  await signOut(auth).catch(() => {});
  await terminate(firestore).catch(() => {});
  await deleteApp(app).catch(() => {});
}
