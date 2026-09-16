import { configureStateStore, getState, runAction } from '../../server/src/core.js';

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function normalizeStateDocument(value) {
  configureStateStore({
    read: () => clone(value && typeof value === 'object' ? value : {}),
    write: () => {},
  });
  return clone(getState());
}

export function applyActionToState(value, action, payload, actor) {
  let writtenState = null;
  configureStateStore({
    read: () => clone(value && typeof value === 'object' ? value : {}),
    write: (nextState) => { writtenState = clone(nextState); },
  });
  const result = runAction(action, payload, actor);
  if (!result?.ok) throw new Error(result?.error || 'Could not save the change');
  if (!writtenState) throw new Error('The action did not persist a state update');
  return { result, state: writtenState };
}

// transactionRunner must call update(latestState) inside its own atomic
// transaction and persist the state returned by update. Firestore supplies
// optimistic retries; keeping this adapter generic makes that contract
// testable without connecting the test suite to a live Firebase project.
export async function runStateTransaction(transactionRunner, action, payload, actor) {
  let actionResult = null;
  await transactionRunner((latestState) => {
    const applied = applyActionToState(latestState, action, payload, actor);
    actionResult = applied.result;
    return applied.state;
  });
  return actionResult;
}
