# API

Base path: `/api`. JSON in and out. Authenticated calls send `Authorization: Bearer <token>`.

**Success** returns the resource itself (object or array). `204` has no body.
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
  "season_id": null, "season_name": null,
  "days": 31, "days_list": [0,1,2,3,4], "days_label": "א׳-ה׳",
  "time_kind": "relative", "time": null, "anchor_id": 2, "anchor_name": "שקיעה", "offset_minutes": -15,
  "time_label": "15 דק׳ לפני שקיעה",
  "notes": "", "is_active": true, "updated_at": "2026-10-25T20:00:00Z"
}
```

Write fields: `prayer_id` (required), `time_kind` (`fixed`|`relative`, required), `time` (`HH:MM`, for fixed),
`anchor_id` + `offset_minutes` (−720…720, for relative; negative = before), `days` (1–127, default 127),
`location_id`, `season_id` (null = all year), `notes`, `is_active`.

## Public (no login, cached 60s)

| | |
|---|---|
| `GET /health` | `{ ok: true }` |
| `GET /public/catalog` | `{ areas, prayers, seasons, anchors }` |
| `GET /public/synagogues?area_id=` | Active synagogues |
| `GET /public/synagogues/:id` | Synagogue + its active minyanim |
| `GET /public/minyanim?area_id=&synagogue_id=&prayer_id=&season_id=&day=0..6` | Active minyanim across synagogues (`season_id` also returns all-year ones; `day`: 0 = Sunday … 6 = Shabbat) |

## Phone extension (Yemot HaMashiach)

| | |
|---|---|
| `GET` or `POST /ivr?key=…` | Yemot `type=api` endpoint. Always answers 200 with Yemot command text (`id_list_message=…&read=…`), never JSON |
| `GET /admin/ivr` | `{ key, path, base_path, phones }`: what the admin UI needs to build the `api_link` |
| `POST /admin/ivr/rotate` | New key; the old link stops working |

All routes also work under `BASE_PATH` (`/zmanim/api/...`).

## Session

| | |
|---|---|
| `GET /setup` | `{ needed, enabled }`: is first-run setup available |
| `POST /setup` | `{ setup_key, name, email, password }` → creates the first admin, returns like login. Only while there are no users and `SETUP_KEY` is set |
| `POST /auth/login` | `{ email, password }` → `{ token, expires_at, user }` |
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
| `POST /synagogues/:sid/minyanim/:id/duplicate` | Copy |
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
| `POST /admin/users` | `{ name, email, password, role: admin\|manager, phone?, is_active?, synagogue_ids? }` |
| `PATCH /admin/users/:id` | Any subset; a new `password` or `is_active: false` signs the user out everywhere. You cannot demote, deactivate or delete yourself |
| `DELETE /admin/users/:id` | |
| `GET /admin/catalog/:kind` | `kind` = `prayers` · `anchors` · `seasons` · `areas`; rows include `used` |
| `POST /admin/catalog/:kind` | prayers: `{ name, sort?, earliest?, latest? }` · seasons: `{ name, sort?, is_default? }` · others: `{ name, sort? }` |
| `PATCH /admin/catalog/:kind/:id` | |
| `DELETE /admin/catalog/:kind/:id` | `409 IN_USE` while referenced |
