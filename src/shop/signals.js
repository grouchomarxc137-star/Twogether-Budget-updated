// Social signals: sending a heart or a note between partners. Extracted
// from v27.js.
import { $ } from '../lib/dom.js';
import { esc } from '../lib/format.js';
import { actor, otherActor as other } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { post, testState, ensureModal, currentGame } from './state.js';

function signalBox(type, text, preview = false) {
  let el = $('#flyingMessage');
  if (!el) {
    el = document.createElement('aside');
    el.id = 'flyingMessage'; el.className = 'v27-flying';
    document.body.appendChild(el);
  }
  el.innerHTML = `<button aria-label="Close">×</button><span>${type === 'note' ? '✉' : '♥'}</span><small>${preview ? 'Test preview' : type === 'note' ? 'A little note arrived' : 'A little heart flew over'}</small><strong>${esc(text || `${actor()} is thinking about you ♡`)}</strong>`;
  el.classList.add('show');
  $('button', el).onclick = () => el.classList.remove('show');
}

export async function sendHeart() {
  if (testState().active) {
    signalBox('heart', 'Principessa is thinking about you ♡', true);
    return;
  }
  try {
    await post('shopSendSignal', { type: 'heart' });
    toast(`Heart sent to ${other(actor())} ♥`);
  } catch (e) {
    toast(e.message, 'warn');
  }
}

export function openNote() {
  const m = ensureModal(), body = $('#v27ModalBody', m);
  body.innerHTML = `<span class="eyebrow">FLYING NOTE</span><h2>Leave something for ${other(actor())}</h2><textarea id="v27Note" maxlength="160" placeholder="Thinking about you…"></textarea><button class="btn primary" id="v27SendNote">Send note</button>`;
  $('#v27SendNote').onclick = async () => {
    const text = $('#v27Note').value.trim();
    if (!text) return;
    if (testState().active) {
      signalBox('note', text, true);
      m.hidden = true;
      return;
    }
    try {
      await post('shopSendSignal', { type: 'note', text });
      m.hidden = true;
      toast('Flying note sent ✉');
    } catch (e) {
      toast(e.message, 'warn');
    }
  };
  m.hidden = false;
}

export function showIncoming() {
  const g = currentGame(), a = actor();
  if (!g || !a) return;
  const unread = (g.signals || []).filter((x) => x.to === a && !x.seenAt);
  if (!unread.length) return;
  const msg = unread[unread.length - 1];
  signalBox(msg.type, msg.type === 'note' ? msg.text : `${msg.from} is thinking about you ♡`);
  post('shopMarkSignalsSeen', {}).catch(() => {});
}
