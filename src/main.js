// New module entry point. Grows as more of the app migrates out of the
// legacy global scripts (still loaded by index.html) and into src/.
import { installPwa } from './app/pwa.js';

installPwa();
