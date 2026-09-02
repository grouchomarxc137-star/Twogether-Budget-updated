(() => {
  'use strict';

  const badge = document.getElementById('loggedUserBadge');
  const tripGallery = document.getElementById('tripGallery');
  const tripKpi = document.getElementById('kpiTrips');

  function setLoggedIn(name){
    if(!badge) return;
    badge.textContent = `Logged in as ${name}`;
    badge.classList.remove('hidden');
    badge.setAttribute('aria-label', `Logged in as ${name}. Click to switch user.`);
  }

  document.querySelectorAll('.identity-choice[data-actor]').forEach(button => {
    button.addEventListener('click', () => setLoggedIn(button.dataset.actor));
  });

  badge?.addEventListener('click', () => {
    document.getElementById('identityModal')?.classList.add('show');
    document.getElementById('identityModal')?.setAttribute('aria-hidden','false');
  });

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
    const count = cards.filter(card => isInBudgetYear(card.querySelector('p')?.textContent)).length;
    tripKpi.textContent = String(count);
  }

  if(tripGallery){
    new MutationObserver(updateTripsPerYear).observe(tripGallery, {childList:true, subtree:true});
  }

  updateTripsPerYear();
})();
