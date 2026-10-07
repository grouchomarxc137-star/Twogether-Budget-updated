// Module entry point. Grows as more of the app migrates out of the legacy
// global scripts (still loaded by index.html) and into src/. Position-
// sensitive pieces (navigation, the shared Wishlist/rewards bridge) boot from their own
// <script type="module"> tags at their original document position instead
// of here, since this file loads last -- see src/app/navigation.js and
// src/shop/boot.js for why that ordering matters.
import { installPwa } from './app/pwa.js';
import { initNotifications } from './app/notifications.js';
import { initPushNotifications } from './app/push.js';
import './trips/our-stays.js';

installPwa();
initPushNotifications();
initNotifications();
