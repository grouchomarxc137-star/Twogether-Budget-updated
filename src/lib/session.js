// Consolidates the actor/session convention duplicated across nearly every
// live file (app.js, workflow.js, ui.js, finances.js, trip-wizard-bridge-v15.js,
// approved-v18.js, v27.js, v28.js and more all redefine ACTOR_KEY/ACTORS/actor()).

export const ACTOR_KEY = 'twogether_actor_v1';
export const ACTORS = ['Principessa', 'Principe'];

export function actor() {
  const current = document.body.dataset.actor || '';
  if (ACTORS.includes(current)) return current;
  try {
    const saved = localStorage.getItem(ACTOR_KEY) || '';
    return ACTORS.includes(saved) ? saved : '';
  } catch {}
  return '';
}

export function otherActor(name = actor()) {
  return name === 'Principessa' ? 'Principe' : 'Principessa';
}

export function setActor(name, { persist = true } = {}) {
  if (!ACTORS.includes(name)) return;
  document.body.dataset.actor = name;
  if (persist) {
    try { localStorage.setItem(ACTOR_KEY, name); } catch {}
  }
}
