# QueueSmart Kenya — Improvement Backlog

Living list of product/UX ideas, not a committed roadmap. Grouped by theme;
the last section covers three specific feature requests with advice and an
implementation plan for each, since they're more involved than a UI tweak.

Status markers: `[ ]` not started · `[~]` partially there · `[x]` done.

---

## 1. Landing page

- [ ] **Live stat strip** above the fold — "247 served today · avg wait 12
      min" pulled from the existing `/admin/stats` aggregate (no PII, safe
      to expose publicly). Turns the landing page from static marketing
      copy into visible proof the system is live.
- [ ] **Background treatment** — a soft radial gradient or low-opacity
      concentric-ring pattern echoing the `Radio` icon brand mark, in the
      green/black/maroon palette. Not a literal flag graphic — the
      `gov-stripe` hairline already carries that reference tastefully.
- [ ] **"How it works" 3-step strip** (Join → Watch live → Get notified)
      with lucide icons, for citizens arriving cold who don't yet know this
      isn't just another government form.
- [ ] **Trust/social-proof line** — branch count, citizens served this
      month, once real pilot data exists to show.

## 2. More content on existing pages

- [ ] **Citizen ticket view**: once called, show which counter to go to
      ("Proceed to Counter 2"), not just "proceed to the counter."
- [ ] **History page**: visual timeline/calendar view instead of a plain
      list — most valuable for multi-visit `Case` tracking (passport
      renewal), where seeing the whole journey at a glance matters most.
- [ ] **Admin dashboard**: surface a "busiest hour" / "best time to come"
      insight computed from the timeseries data already being fetched.
- [ ] **Staff console**: attribute call/complete/no-show actions to the
      agent who performed them (needs an audit trail — see Critique doc
      gap on staff accountability) so a supervisor can see per-agent
      throughput, not just branch totals.
- [ ] **Empty/loading states**: explicit "No one's waiting — you'll be
      seen immediately" and skeleton loaders instead of blank flashes.
      Cheap, disproportionately improves perceived polish.

## 3. Extra functionality / use cases

- [ ] **QR code per branch** — a poster that deep-links straight to
      `/citizen?branch=X`, skipping the branch picker for someone standing
      at the centre. Very cheap, meaningfully reduces walk-in friction.
- [ ] **Shareable read-only ticket link** — a citizen sends a link so a
      family member can watch the live position too (useful for elderly
      citizens being assisted by relatives). `QueueStateOut` already has
      the shape for this; needs a public read-only route keyed by ticket id.
- [ ] **Branch comparison before picking one** — show each branch's
      current wait at the picker step, not after joining. Lightweight
      version of the cross-branch load-balancing idea from the earlier
      critique.
- [ ] **Staff "pause counter" toggle** — today `_active_counters` assumes
      every *assigned* counter is actively staffed. A real on/off toggle
      an agent controls makes the wait estimate honest and gives staff a
      genuine "I'm on break" affordance.
- [ ] **Post-visit feedback** — one-tap rating sent after `completed_at`
      fires. Closes a loop citizens never currently get asked about, and
      is a cheap new data source for the admin dashboard.

---

## 4. New requests — advice + implementation plan

### 4.1 Location-aware "start heading to the centre" notification

**The idea**: ask for location permission, estimate travel time (with
traffic) from the citizen to the branch, and notify them to leave home once
their queue wait is about to drop below their travel time.

**Advice before building:**
- This is the most expensive idea here — it needs a maps/traffic provider,
  which is a real external dependency and, unlike everything else so far,
  not something we can fully keep on a free tier at scale. Treat it as a
  phased build, not a single PR.
- Location is sensitive data. Treat it the same way `national_id` is
  treated today: explicit opt-in, never persisted longer than needed to
  compute an ETA, never visible to staff. Don't add a `location` column to
  `CitizenProfile` — keep it transient (same in-memory, TTL'd pattern as
  `app/otp.py`'s code store), not a permanent DB row.
- `Branch` currently has no coordinates (`name`, `address` only) — that's
  the first real gap, not the maps API.

**Phased implementation plan:**
1. **Phase 1 — no external API, ship first.** Add `latitude`/`longitude`
   to `Branch` (admin-set once per branch). Frontend asks for geolocation
   permission (clearly optional, same opt-in pattern as the push button)
   once a ticket exists. Compute a *straight-line distance ÷ assumed
   average speed* travel estimate client-side — free, no API key, good
   enough to validate whether citizens actually want this feature before
   paying for traffic data.
2. **Phase 2 — real traffic-aware ETA.** Swap the Phase 1 estimate for
   Mapbox's Directions API (100k requests/month free tier — more generous
   than Google's Distance Matrix for this volume) called server-side (key
   stays secret, never shipped to the browser). Recompute periodically
   while a ticket is waiting.
3. **Trigger point — reuse what already exists, don't build a cron job.**
   The natural recompute moments are the same points that already
   broadcast `queue_update` today: `call_next`, `complete_ticket`, and
   `mark_no_show` in `staff.py`. At each of those, for every *other*
   waiting ticket in that service, compare current `estimated_wait_seconds`
   against that citizen's last-known travel time; if wait time has dropped
   to meet travel time (plus a small buffer), fire `send_push(db, phone,
   "Time to head to the centre", ...)` — same function already built for
   "it's your turn."
4. Mark it fired per ticket (a `left_notified` flag, same idea as section
   4.3's `notified_thresholds`) so it only fires once.

**Honest scope note:** this is genuinely the biggest lift of everything in
this document — new DB columns, a new external API relationship, a consent
flow, and periodic recomputation logic. Worth sequencing after the
cheaper, high-visibility items above.

---

### 4.2 Per-counter queue length, estimated time, and waiting animations

**The idea**: show how long each counter's queue is and the estimated wait
for the back of each line (and the branch total), with friendlier waiting
UI than a static number.

**Advice before building:**
- All the math already exists — `estimate_wait_seconds` and
  `_active_counters` in `queue.py` are both already built; this is mostly
  a new aggregation endpoint plus a frontend view, not new logic.
- This naturally doubles as a **waiting-room TV/signage view** — a public,
  no-login `/board/:branchId` screen showing all counters' queue lengths
  is a genuinely new use case (digital signage) for free, once the
  aggregation endpoint exists. Worth building the endpoint branch-shaped,
  not ticket-shaped, so it serves both the citizen app and a signage
  screen.

**Implementation plan:**
1. **Backend** — new endpoint `GET /branches/{id}/queue-overview` in
   `queue.py`. For each `Counter` at the branch: label, assigned
   service(s), `waiting_count`, and estimated wait for the *last* position
   in that counter's line (reuse `estimate_wait_seconds` with
   `position = waiting_count`). Also return a branch-wide total.
2. **Frontend** — a `QueueOverview` component, shown either as a step in
   the citizen flow (before picking a service, so they see which counters
   are backed up) or as the standalone `/board/:branchId` signage view.
3. **Waiting animations** — keep it CSS-only, no animation library, to
   match the existing lightweight bundle and the `prefers-reduced-motion`
   handling already in `index.css`:
   - A pulsing concentric-ring animation (ties back to the original logo
     motif) behind the ticket number while `status === "waiting"`.
   - A **progress bar that fills as `position` decreases** — more legible
     at a glance than the raw number, and reuses data already being
     fetched on every `queue_update`.
   - Skeleton loaders for the overview list while it fetches, instead of a
     blank flash.

---

### 4.3 "Notify me when wait drops to X" opt-in thresholds

**The idea**: citizen joins a queue with a 2-hour estimate, and can opt in
to be notified specifically when the estimate drops to e.g. 20 minutes,
then again at 10 minutes — not just the final "it's your turn."

**Advice before building:**
- This is the cheapest of the three to build — it's new trigger points on
  top of infrastructure that already exists (`send_push`, the
  `queue_update` broadcast points), not new infrastructure.
- Store thresholds as a JSON column on `Ticket`, matching the existing
  convention (`Counter.service_ids`, `Service.visit_steps` are both JSON
  columns already) rather than introducing a new join table for something
  this small.

**Implementation plan:**
1. **Schema** — add two JSON columns to `Ticket`: `notify_thresholds`
   (e.g. `[1200, 600]` seconds, citizen-selected) and
   `notified_thresholds` (which of those have already fired, so a
   threshold never re-fires on every subsequent recompute).
2. **Backend** — a small `_check_notify_thresholds(db, ticket)` helper
   called from the same three staff actions as 4.1
   (`call_next`/`complete_ticket`/`mark_no_show`, the only actions that
   *reduce* anyone's wait): recompute `estimate_wait_seconds` for every
   other waiting ticket in that service, and for any threshold in
   `notify_thresholds` not yet in `notified_thresholds` where the new
   estimate has dropped to or below it, call `send_push(...)` and record
   it as notified.
3. **Frontend** — in the "waiting" ticket view (`Citizen.jsx`), once a
   ticket exists, show toggle buttons: "Notify me at 20 min / 10 min" —
   multi-select, reusing the existing push-opt-in button pattern. POST the
   selection to a new `PATCH /tickets/{id}/notify-thresholds`.
4. Pairs naturally with 4.1 — both are "proactively tell the citizen
   something changed," so they can share the same push-trigger call sites
   once both exist.

**Suggested build order across all three:** 4.3 first (cheapest, reuses
the most existing code), then 4.2 (mostly already-built math + a new
view), then 4.1 last (the only one with a real external dependency and
genuinely new privacy surface).
