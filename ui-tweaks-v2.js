(() => {
  'use strict';

  // The identity badge is display-only. Prevent the logo from acting as a hidden user switch.
  const brand = document.getElementById('brandMark') || document.querySelector('.brand-mark');
  if (brand) {
    brand.removeAttribute('title');
    brand.style.cursor = 'default';
    brand.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  const tripGallery = document.getElementById('tripGallery');
  const tripKpi = document.getElementById('kpiTrips');

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
    tripKpi.textContent = String(cards.filter(card => isInBudgetYear(card.querySelector('p')?.textContent)).length);
  }

  if(tripGallery){
    new MutationObserver(updateTripsPerYear).observe(tripGallery, {childList:true, subtree:true});
  }
  updateTripsPerYear();
})();
