# API

Base path: `/api`. JSON in and out. Authenticated calls send `Authorization: Bearer <token>`.

**Success** returns the resource itself (object or array). `204` has no body.
Text fields are cleaned on input: invisible characters pasted from Hebrew apps (direction marks, zero-width spaces) are removed.

**Errors** always look like:

```json
{ "error": { "code": "VALIDATION", "message": "יש שדות שגויים", "fields": { "time": "שעה בפורמט HH:MM" } } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON / bad id or query param |
| 401 | `UNAUTHORIZED` | No / expired token, wrong login |
| 403 | `FORBIDDEN` | Logged in but not allowed (e.g. manager on an admin route, details locked) |
| 404 | `NOT_FOUND` | Missing, or a synagogue outside the manager's scope |
| 409 | `CONFLICT` · `LIMIT_REACHED` · `IN_USE` | State conflict, quota reached, catalog value in use |
| 422 | `VALIDATION` | Field errors in `fields` |
| 429 | `TOO_MANY_ATTEMPTS` | Login locked; see `Retry-After` |

## Minyan object

```json
{
  "id": 7, "synagogue_id": 1,
  "prayer_id": 2, "prayer_name": "מנחה",
  "location_id": 3, "location_name": "היכל ראשי",
  "season_id": 2, "season_name": "חורף",
  "days": 31, "days_list": [0,1,2,3,4], "days_label": "א׳-ה׳",
  "time_kind": "relative", "time": null, "anchor_id": 2, "anchor_name": "שקיעה", "offset_minutes": -15,
  "time_label": "15 דק׳ לפני שקיעה",
  "notes": "", "is_active": true, "updated_at": "2026-10-25T20:00:00Z"
}
```

Write fields: `prayer_id` (required), `time_kind` (`fixed`|`relative`, required), `time` (`HH:MM`, for fixed),
`anchor_id` + `offset_minutes` (−720…720, for relative; negative = before), `days` (1–127, default 127),
`location_id`, `season_id` (required on create: every minyan belongs to one season; there is no "all year"), `notes`, `is_active`.

## Public (no login, cached 60s)

| | |
|---|---|
| `GET /health` | `{ ok: true }` |
| `GET /public/catalog` | `{ site, current_season, areas, prayers, seasons, anchors, zmanim }`. `zmanim` = 7 days from today: `[{ date, times: { anchorId: "HH:MM" } }]` for the computed anchors (`anchor.calc`) |
| `GET /public/synagogues?area_id=` | Active synagogues |
| `GET /public/synagogues/:id` | Synagogue + its active minyanim |
| `GET /public/minyanim?area_id=&synagogue_id=&prayer_id=&season_id=&day=0..6` | Active minyanim across synagogues (only the current season, unless the admin opened the season choice; `day`: 0 = Sunday … 6 = Shabbat) |

## Self-service registration

| | |
|---|---|
| `GET /public/registrations/form` | `{ enabled, form_token }`: the token is signed and must be at least 4 seconds old when sent back |
| `POST /public/registrations` | `{ synagogue_name, area_id?, address?, contact_name, email, phone, message?, form_token, website }` (`website` is a honeypot and must stay empty) → `202`. Sends a verification e-mail. Spam is answered `202` too, and silently dropped |
| `POST /public/registrations/verify` `{ token }` | The request becomes `pending`, and the approvers get an e-mail |
| `GET /admin/registrations` | (permission `registrations`) `{ items, unverified }` |
| `POST /admin/registrations/:id/approve` | `{ synagogue_name?, area_id?, address? }`: creates the synagogue and the manager (or links an existing user), then e-mails the login details |
| `POST /admin/registrations/:id/reject` | `{ reason?, notify?, block? }` (`block` adds the e-mail to the blocklist) |
| `DELETE /admin/registrations/:id` | |

## Admin permissions

`user.perms` lists what an admin may do: `synagogues`, `synagogues_delete`, `minyanim`, `managers`, `admins`, `catalog`, `phone`, `registrations`. The super admin has all of them. An admin without a stored list gets everything except `registrations`. Only the super admin sets `admin_perms` (on `POST`/`PATCH /admin/users`). A missing permission answers `403`. Reading is always allowed.

## Phone extension (Yemot HaMashiach)

| | |
|---|---|
| `GET` or `POST /ivr?key=…` | Yemot `type=api` endpoint. Always answers 200 with Yemot command text (`id_list_message=…&read=…`), never JSON |
| `GET` or `POST /ivr/listen` | Public listening line (no key, no identification) |
| `GET /admin/ivr` | `{ key, path, base_path, phones }`: what the admin UI needs to build the `api_link` |
| `POST /admin/ivr/rotate` | New key; the old link stops working |

All routes also work under `BASE_PATH` (`/zmanim/api/...`).

## Login by e-mail link / password reset

| | |
|---|---|
| `GET /auth/options` | `{ magic_link, password_reset, google_client_id }`: what the login screen may offer (`google_client_id` null = Google sign-in off) |
| `POST /auth/google` `{ credential }` | Sign in with Google: the ID token from Google's button. It must be issued to our client id, with a verified e-mail that belongs to an active user |
| `POST /auth/email-link` `{ login }` · `POST /auth/reset-request` `{ login }` | Sends a one-time link (204 whether or not the user exists; 3 per hour) |
| `POST /auth/email-link/verify` `{ token }` | Login (one use, 30 minutes; welcome links: 7 days) |
| `POST /auth/reset` `{ token, new_password }` | New password + login |

## Me

| | |
|---|---|
| `PATCH /me` | `{ email? }` (unless blocked), `{ is_hidden? }` (super admin only). Name and phone are set by the admin |
| `PUT /me/password` | `{ current_password, new_password }` (unless blocked). When the admin required a new password (`user.must_change_password`), `current_password` is not needed, and every other call answers `403 PASSWORD_CHANGE_REQUIRED` until it is done |
| `PUT /me/phone-password` | `{ enabled, password }`: require the (numeric) password on management calls |
| `GET /me/logins` | Last 50 logins: `{ channel: web\|phone, detail, created_at }` |
| `GET /me/feedback` · `POST /me/feedback` | Messages to the developers: `{ blocked, items }` / `{ body }` |

## Super admin

| | |
|---|---|
| `POST /admin/control/test-mail` | Test e-mail to me |
| `POST /admin/users/:id/welcome` | (admin) welcome e-mail with a login link; `send_welcome: true` on create does the same |
| `GET / PATCH /admin/control` | `shabbat_enabled, public_site_enabled, site_notice, listen_phone, listen_enabled, manage_phone_enabled, feedback_enabled, google_login_enabled, google_client_id, zmanim_lat, zmanim_lng` (where times of day are computed; default Jerusalem) |
| `GET /admin/feedback` · `PATCH /admin/feedback/:id {is_read}` · `DELETE /admin/feedback/:id` | Developers' inbox |

## Session

| | |
|---|---|
| `POST /auth/login` | `{ login, password }` (`login` = e-mail or phone, any format) → `{ token, expires_at, user }` |
| `POST /auth/logout` | Ends this session |
| `GET /me` | `{ user, synagogues: [{ id, name, area_name }] }`: the synagogues this user can open |
| `PATCH /me` | `{ name?, phone? }` |
| `PUT /me/password` | `{ current_password, new_password }`: signs out other devices |

## Synagogue workspace (manager of the synagogue, or admin)

| | |
|---|---|
| `GET /synagogues` | Synagogues I can open |
| `GET /synagogues/:sid` | Everything for the screen in one call: `{ synagogue, settings, usage, locations, minyanim, managers, catalog }`. `catalog.prayers` is already limited to the allowed prayers |
| `PATCH /synagogues/:sid` | `{ name?, area_id?, address?, phone?, notes? }`: managers need `settings.can_edit_info` |
| `POST /synagogues/:sid/locations` | `{ name }`: respects `max_locations` |
| `PATCH /synagogues/:sid/locations/:id` | `{ name }` |
| `DELETE /synagogues/:sid/locations/:id` | Minyanim there keep existing without a location |
| `PUT /synagogues/:sid/locations/order` | `{ ids: [...] }`: the full new order |
| `POST /synagogues/:sid/minyanim` | Create (respects `max_minyanim` and allowed prayers) |
| `PATCH /synagogues/:sid/minyanim/:id` | Partial update, the merged result is validated as a whole |
| `POST /synagogues/:sid/minyanim/:id/duplicate` | Copy (same season, saved hidden) |
| `POST /synagogues/:sid/seasons/copy` | `{ from_season_id, to_season_id, minyan_ids?, prayer_ids?, replace? }` → `{ copied, skipped: [{ id, reason }] }`. With `prayer_ids`, only those prayers are copied, and `replace` clears only those prayers. Copies into the target season; a clash with an existing minyan is skipped; `replace` deletes the target season's minyanim first. Managers may target only seasons they can edit |
| `DELETE /synagogues/:sid/minyanim/:id` | |

`settings` = `{ can_edit_info, max_locations, max_minyanim, restrict_prayers, allowed_prayer_ids }` (`allowed_prayer_ids` is `null` when not restricted).

## Admin only

| | |
|---|---|
| `GET /admin/stats` | Counts + recently updated synagogues |
| `GET /admin/synagogues` | All, with settings, managers and counts |
| `POST /admin/synagogues` | `{ name, area_id?, address?, phone?, notes?, is_active?, can_edit_info?, max_locations?, max_minyanim?, restrict_prayers?, allowed_prayer_ids?, manager_ids? }` |
| `GET / PATCH / DELETE /admin/synagogues/:id` | PATCH takes any subset of the above; DELETE removes locations and minyanim too |
| `GET /admin/users` | All users with their synagogues |
| `POST /admin/users` | `{ name, email, phone, password, role: admin\|manager, is_active?, synagogue_ids?, must_change_password?, send_welcome?, send_password? }` (also on PATCH: `send_welcome` e-mails the login details; `send_password` adds the password set in the same call): e-mail, phone and password are required |
| `PATCH /admin/users/:id` | Any subset; a new `password` or `is_active: false` signs the user out everywhere. You cannot demote, deactivate or delete yourself |
| `DELETE /admin/users/:id` | |
| `GET /admin/catalog/:kind` | `kind` = `prayers` · `anchors` · `seasons` · `areas`; rows include `used` |
| `POST /admin/catalog/:kind` | prayers: `{ name, sort?, earliest?, latest? }` · seasons: `{ name, sort?, is_default?, starts_md? }` · anchors: `{ name, sort?, prayer_ids?, calc? }` (`calc`: `alot`·`sunrise`·`chatzot`·`sunset`·`tzeit`·`rabbeinu_tam`, null = not computed) · areas: `{ name, sort? }` |
| `PATCH /admin/catalog/:kind/:id` | |
| `DELETE /admin/catalog/:kind/:id` | `409 IN_USE` while referenced |
| `POST /admin/seasons/copy` | `{ from_season_id, to_season_id, prayer_ids?, replace? }` → `{ copied, skipped, synagogues }`: the same copy for every synagogue |
