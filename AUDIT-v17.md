# Outstanding-request audit and v17 validation

Audited main: `b9f813cbdebf543344be729fffc0444315bf21ef`.
Protected rollback-ver-9: `cdb24f841a89afd98935d1380cb46830759d15eb` (must not move).

| Request | Audit finding on main | Update |
|---|---|---|
| Persistent DEV playground | v12 preview toolbar; edits not persisted or undoable | Separate browser-local DEV patches, contextual editor, fonts/colours/icons/spacing, drag/position, test text/sections/categories, hide/duplicate, undo/redo, undoable Reset, profile exit restores normal design |
| Click profile to switch | Already implemented | Retained; DEV exit restores the normal profile |
| Hover and mutually exclusive pinned menus | Layered hover handlers; no single pinned state | One active menu with shared close timer, hover traversal and click pinning |
| Budget after dates | Workflow automatically clicked Skip budget | Removed automatic skip; retained budget → budget-only/some/all bridge; acknowledged saves |
| Current Trip metrics and overview | Unlinked plans could not open; inconsistent totals | Four metrics on cards; overview for planned trips; both records, differences, payments, editing and confirmation |
| Trip Stories only confirmed | Post-render hiding could temporarily expose unconfirmed cards | Filter at source, retaining independent opening of current trips |
| Matching input | Styling workaround and competing async state | Explicit editable field styling and regression coverage; detached shared-save callbacks cannot mutate a new form |
| Accommodation/Flights ownership | DOM interception tied to headings and stale metadata | Direct full/partial workflow integration, full-payment skip, editable remaining share, unknown totals and direct overview editing |
| Accommodation 20% | Missing in some entry paths | Live calculation in total entry and retained in payment and overview displays |
| Reconciliation | Unknown-only confirmation guard | Shared-payment sum, unknown/estimated totals, differing declared totals and total trip payments checked server-side; overview warnings |
| Enter | Multiple competing keyboard handlers | One capture handler for trip, budget, partial, matching and shared-payment inputs |
| Wishlist | Sort re-appended rows on every mutation | Stable priority order/filter and bounded enhancement updates |
| Calmer design/nav labels | Multiple refinement layers | Quiet full-width cards, four consistent metrics, responsive overview, non-selectable nav |
| Crash safety | Self-triggering whole-page mutations; automatic Lonato deletion | Bounded enhancement refresh; removed name-based deletion; no test data sent to the live backend |

## Validation

- `node tests/validate.cjs`: all loaded JavaScript, referenced assets and Apps Script syntax.
- `node tests/backend.cjs`: executes the Apps Script handler against an in-memory PropertiesService; shared/full/unknown payments, invalid input, reconciliation, confirmation and locked-trip checks.
- `node tests/browser.cjs`: Chromium browser with network requests routed to the real Apps Script handler in memory. Exercises the main wizard, both profiles, shared/partial/full flows, matching, DEV persistence/undo/reset, dropdowns, wishlist and history filtering. Desktop/mobile captures saved locally.
- GitHub Pages workflow runs asset and backend checks before deployment and publishes only frontend assets.

## Backend rollout

Replace the existing Apps Script project's Code.gs with `backend/Code.gs` (identical to `backend/Code-v17.gs`), save, then update the existing Web App deployment to a new version. Retain its URL and current database. Do not run the database reset helper.

The frontend shows backend errors and requires v17 for writes. Browser tests use simulated Google services; they do not prove the user's Apps Script deployment has been updated. Production backend confirmation remains dependent on that redeploy.
