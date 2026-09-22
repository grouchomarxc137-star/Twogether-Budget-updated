// Mounts the redesigned Trips screen into its own sheet (#tripsV2), next to
// the old Trips pages, so both can be tried side by side.
import { mount } from './app.js';

function boot() {
  const el = document.getElementById('tripsV2');
  if (el) mount(el);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
