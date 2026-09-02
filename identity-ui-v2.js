(() => {
  'use strict';

  let selectedActor = '';
  const badge = document.getElementById('loggedUserBadge');
  const wizardBody = document.getElementById('wizardBody');
  const tripGallery = document.getElementById('tripGallery');
  const tripKpi = document.getElementById('kpiTrips');
  const identityModal = document.getElementById('identityModal');

  function desiredHelp(name){
    const other = name === 'Principessa' ? 'Principe' : 'Principessa';
    return `Start a new trip, or add your version to one ${other} already logged.`;
  }

  function updateTripChoiceHelp(){
    if(!selectedActor || !wizardBody) return;
    const heading = [...wizardBody.querySelectorAll('h2')]
      .find(el => el.textContent.trim() === 'Which trip are you logging?');
    if(!heading) return;
    const p = heading.parentElement?.querySelector('p');
    if(!p) return;
    const text = desiredHelp(selectedActor);
    if(p.textContent !== text) p.textContent = text;
  }

  function applyIdentity(name){
    if(name !== 'Principessa' && name !== 'Principe') return;
    selectedActor = name;
    document.body.dataset.actor = name;

    if(badge){
      badge.textContent = name;
      badge.classList.remove('hidden');
      badge.style.pointerEvents = 'none';
      badge.style.cursor = 'default';
    }

    // Fail-safe: the core app also closes this modal, but this guarantees it never remains stuck.
    identityModal?.classList.remove('show');
    identityModal?.setAttribute('aria-hidden','true');

    updateTripChoiceHelp();
    setTimeout(updateTripChoiceHelp, 250);
    setTimeout(updateTripChoiceHelp, 1200);
  }

  document.querySelectorAll('.identity-choice[data-actor]').forEach(button => {
    button.addEventListener('click', () => applyIdentity(button.dataset.actor));
  });

  // Only observe direct wizard replacements. Editing descendant text does not retrigger this observer.
  if(wizardBody){
    new MutationObserver(updateTripChoiceHelp).observe(wizardBody, {childList:true});
  }

  // Keep identity fixed for the session: the logo is decorative, not a switch-user control.
  const brand = document.getElementById('brandMark') || document.querySelector('.brand-mark');
  if(brand){
    brand.removeAttribute('title');
    brand.style.cursor = 'default';
    brand.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function isInBudgetYear(dateText){
    const match = String(dateText || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if(!match) return false;
    const [,dd,mm,yyyy] = match;
    const value = Number(`${yyyy}${mm}${dd}`);
    return value >= 20260901 && value <= 20270831;
  }

  function updateTripsPerYear(){
    if(!tripKpi || !tripGallery) return;
    const cards = [...tripGallery.querySelectorAll('.trip-story-card')];
    tripKpi.textContent = String(
      cards.filter(card => isInBudgetYear(card.querySelector('p')?.textContent)).length
    );
  }

  if(tripGallery){
    new MutationObserver(updateTripsPerYear).observe(tripGallery, {childList:true});
  }
  updateTripsPerYear();
})();
