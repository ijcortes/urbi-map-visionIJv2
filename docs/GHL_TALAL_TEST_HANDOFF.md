# GHL ↔ Medellín Social — Test & Unblock Handoff (for Talal)

Hey Talal 👋 — you have code access. This is the exact state of the GHL
integration + what we need from you to finish and test **both directions**
(website → GHL, and GHL → website).

**Honest TL;DR:**

- **Outbound (website → GHL)** for **Listings, Local Business, Agency** is
  already **built and passing live tests** against the real location
  (`Nk32TtnZAnbsRtIZ0lWS`) — create + update + read-back confirmed.
- **Inbound (GHL → website)** is **0% testable today** — not because of our
  code (the receiver is wired and returns an explicit `501`/`400` until it has
  a contract), but because the pieces that unblock it can only come from you
  (webhook secret + signature + a Workflow that fires the webhook).
- **Events** and **Realtor/User Contacts** are also blocked on you (Event
  object not confirmed; `POST /contacts` payload not shared yet).

So the ask isn't "test everything" — half of it is blocked **on you**. The
fastest path is: you deliver Section A, we finish the code, then we test
together.

---

## A. What only you can unblock (priority order)

1. **Webhook signing → unblocks ALL inbound (every entity shares this).**
   - `GHL_WEBHOOK_SECRET` value
   - Signature scheme: header name + algorithm (HMAC? which hash?)
   - **One real sample payload per entity** (what a "record created/updated"
     webhook actually looks like) so we map fields instead of guessing.
   - Inbound endpoint is live and waiting: **`POST /api/v1/webhook/ghl`**
     (Railway `Social-api`). Dispatches on an `object_type` field →
     `listing | tienda | evento | agent | visita | deal | referidor`.

2. **`POST /contacts` Postman JSON → unblocks Realtor + User sync.**
   You already tested it (201 Created). We just need the exact request body
   so `find_or_create_contact()` matches it 1:1 (no speculative endpoints).

3. **Confirm / create the Event custom object → unblocks Events.**
   Everything else is confirmed native; Event is the only one still "proposed".

4. **Featured-by-scope custom fields → unblocks "Featured" everywhere.**
   We mark a record featured at a scope: `barrio` (neighborhood) / `comuna`
   (district) / `ciudad` (city) + a zone code. GHL needs 2 custom fields on
   **Business**, **Real Estate Listing**, and **Event**:
   - `featured_scope` (picklist: neighborhood / district / city)
   - `featured_zone_code` (text)
   Confirmed 2026-10-03 these do **not** exist yet on Business.

5. **One GHL Workflow per entity** (trigger: record created/updated → action:
   Webhook → our endpoint above). None exist today — without them, nothing
   ever leaves GHL toward us.

6. **Confirm prod credentials.** `GHL_PRIVATE_TOKEN` / `GHL_LOCATION_ID` are in
   our local `.env` and verified working live. Confirm they're also set on
   Railway `Social-api` (last check 2026-08-28: absent).

---

## B. Current verified state

| Entity | Outbound (→GHL) | Inbound (→us) | Featured sync | Blocker (yours) |
|---|---|---|---|---|
| **Listing** | ✅ live-tested | 🟡 wired, stub | ❌ no scope field | webhook contract |
| **Local Business** | ✅ in prod | 🟡 wired, stub | ⚠️ columns exist, push omits them + GHL fields missing | webhook contract + featured fields |
| **Agency** | ✅ live-tested | — | n/a | — |
| **Event** | 🟡 stub | 🟡 wired, stub | 🟡 columns exist, sync stub | Event object + webhook contract |
| **Realtor (agent)** | 🟡 skeleton/stub | 🟡 wired, stub | n/a | `POST /contacts` payload + webhook |
| **User** | 🔒 stub | ❌ no handler | n/a | `POST /contacts` payload + webhook |

Legend: ✅ built & tested · 🟡 skeleton (returns 501 until contract) · ⚠️ partial gap · ❌ missing · 🔒 blocked

---

## C. Per-entity test plan (both directions)

### Events — Publish + Featured
- **Publish (outbound):** our `push_evento_to_ghl` is a stub → blocked on #3
  (Event object). Once the object exists, we map `public.eventos` →
  Event fields and test create/update.
- **Publish (inbound):** GHL is the source of truth for events (admin lives in
  GHL) → you create/approve/reject an Event, Workflow fires webhook with
  `object_type: "evento"`, we upsert into `public.eventos` (incl. `is_active`
  from approve/reject). Blocked on #1 + #5.
- **Featured:** needs `featured_scope` + `featured_zone_code` on the Event
  object (#4), both directions.

### Local Business — Publish + Featured
- **Publish (outbound):** ✅ already works. `push_tienda_to_ghl` sends 6
  standard + 13 custom fields; create + read-back verified. You can review the
  record and confirm field values look right on your side.
- **Publish (inbound):** you edit/approve a Business in GHL → webhook
  `object_type: "tienda"` → we map `business_listing_status` + `active` into
  our `activo`. Blocked on #1 + #5.
- **Featured:** two gaps — (a) our push doesn't send `featured_scope`/
  `featured_zone_code` yet (fast to add once the GHL fields exist), (b) those
  fields don't exist on Business (#4).

### Listings — Publish + Featured + rent/sell
- **Publish (outbound):** ✅ live-tested. `sync_listing` create + update +
  read-back confirmed (`operation`, `price`, status, re-uses the same record
  on update via PUT).
- **rent/sell:** `operacion` maps venta→`sale`, arriendo→`rent` — confirmed.
  ⚠️ `property_type` only has `apartment`/`house` confirmed; we have 9 types —
  send us the full `property_type` picklist or those won't sync.
- **Publish (inbound):** you edit a Listing in GHL → webhook
  `object_type: "listing"` → we upsert `public.listing`. Blocked on #1 + #5.
- **Featured:** ❌ listings currently have only a boolean `destacado`, **no
  scope column** on our side. Decision needed: do listings need the same
  neighborhood/district/city featuring as business/events? If yes → we add the
  column + you add the 2 custom fields on the Listing object.
- **Associations:** Agency↔Listing ✅ works. Agent↔Listing and Owner↔Listing
  are blocked on #2 (need Contact IDs → need `POST /contacts`).

### Realtors — Publish (both ways)
- **Publish (outbound):** skeleton wired at realtor-creation points
  (`/suscripciones/agente/registro`, agency invite-accept). Raises until #2.
  Confirmed object type = **Contact** (2026-10-03). Fields proposed:
  firstName/lastName (split of `nombre`), email, phone, `contact_type="agent"`,
  `agent_internal_id`, `agent_status`, `agent_status_reason`,
  `profile_photo_url`, bio.
- **Publish (inbound):** you create/approve a realtor Contact in GHL → webhook
  `object_type: "agent"` → we upsert `public.agent`. Blocked on #1 + #5.
- **Picklists to confirm:** `agent_status` (pending/active/rejected/inactive),
  `contact_type` (agent/owner).

---

## D. How to run the outbound tests that already pass

Live integration test (hits the real location, creates records tagged
`Pytest GHL` / `pytest-ghl-`, cleans up our DB but **not** the GHL side — no
DELETE in the contract):

```bash
set -a; . ./.env; set +a
python -m pytest -m require_db api/tests/test_ghl_client_integration.py -v
```

Covers: `sync_listing` (create + update + read-back), `sync_tienda`,
`sync_agency`. Last run: **3/3 passed** against `Nk32…`.

Code to read:
- Outbound: `api/utils/ghl_client.py` (field maps, associations, dedup table).
- Inbound: `api/routers/ghl_webhook.py` (dispatcher + per-entity handlers).
- Full field contract + decisions: `docs/GHL_CONTRATO_PROPUESTO.md`.

**Heads-up:** our last live test left ~3 orphaned `Pytest GHL` records in the
location — safe to delete from the GHL dashboard.

---

## E. Product gaps not yet in any contract (flagging, not asking yet)

- **Listing media/photos** → GHL: we have the images, no sync designed.
- **Realtor calendars (visit booking)**: the "Agendar visita" (book a visit)
  button should send the buyer to the agent's availability page. That needs a
  GHL Calendar per agent + a booking URL + the Appointments API. Zero contract
  today — separate conversation when we get there.
