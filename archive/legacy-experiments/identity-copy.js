(() => {
  'use strict';

  const badge = document.getElementById('loggedUserBadge');
  const wizardBody = document.getElementById('wizardBody');

  function desiredHelp(name){
    const other = name === 'Principessa' ? 'Principe' : 'Principessa';
    return `Start a new trip, or add your version to one ${other} already logged.`;
  }

  function applyIdentity(name){
    if(name !== 'Principessa' && name !== 'Principe') return;
    document.body.dataset.actor = name;
    if(badge){
      badge.textContent = name;
      badge.classList.remove('hidden');
    }
    updateTripChoiceHelp(name);
  }

  function updateTripChoiceHelp(name){
    if(!wizardBody) return;
    const heading = [...wizardBody.querySelectorAll('h2')].find(el => el.textContent.trim() === 'Which trip are you logging?');
    if(!heading) return;
    const p = heading.parentElement?.querySelector('p');
    if(!p) return;
    const nextText = desiredHelp(name);
    if(p.textContent !== nextText) p.textContent = nextText;
  }

  document.querySelectorAll('.identity-choice[data-actor]').forEach(button => {
    button.addEventListener('click', () => applyIdentity(button.dataset.actor));
  });

  if(wizardBody){
    new MutationObserver(() => {
      const name = document.body.dataset.actor;
      if(name) updateTripChoiceHelp(name);
    }).observe(wizardBody, {childList:true, subtree:true});
  }
})();
