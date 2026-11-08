# Research: `homebridge-emporia-matter`

**Status:** research complete, implementation not started
**Date:** 2026-11-08
**Scope:** A Matter-only Homebridge plugin that exposes Emporia Vue energy monitors (mains and branch circuits) as Matter electrical measurement devices, with live power and cumulative energy in Apple Home.

---

## 1. Executive summary

The design is feasible with the public Homebridge 2.5 Matter API and the (unofficial) Emporia cloud API:

- **Matter side.** Homebridge ≥ 2.5.0 exposes a `MatterAPI` that lets a platform register Matter accessories directly. Declaring `electricalPowerMeasurement` and `electricalEnergyMeasurement` cluster state on an `OnOffOutlet` endpoint makes Homebridge add the `ElectricalSensor` device type and synthesize the mandatory accuracy metadata. This is the same shape Eve Energy and other metered plugs use, and it is the only shape known to show live wattage on an Apple Home tile.
- **Emporia side.** Authentication is AWS Cognito (`USER_PASSWORD_AUTH`, then `REFRESH_TOKEN_AUTH`). Device metadata comes from `GET /v1/customers/devices`; instantaneous usage comes from `GET /v1/customers/devices/usages?scale=1MIN&energy_unit=KILOWATT_HOURS`. Usage values are **energy over the scale window**, not power, so watts must be derived (`kWh × 60 000` for a one-minute window).
- **Energy total.** No lifetime kWh counter was found in the API. The plugin must integrate reported power over time, persist the total, and document that it is locally derived (resets if plugin storage is lost).
- **Identity.** Matter endpoint identity must be deterministic and stable, derived from Emporia `device_gid` + `channel_id`, with a rotation generation for structural changes (split/grouped, accessory type, channel set). Cached accessories must be restored before the bridge goes online and re-registered with handlers on every start.
- **Apple caveats.** Apple Home shows per-accessory energy only for accessories paired directly (not bridged children), assigns rooms per accessory (so split-by-channel is essential), and will double-count if mains and branch circuits are both exposed. These are product/documentation constraints, not bugs.

Recommended defaults: `splitChannels: true`, `accessoryType: "outlet"`, mains exposed but individually hideable, 60 s poll interval, local cumulative energy persisted to Homebridge storage.

---

## 2. Goals and non-goals

### Goals

- One Matter accessory per Emporia channel (branch circuit) and per mains, configurable.
- Live active power (mW), voltage (mV), current (mA), and cumulative imported energy (mWh).
- Email/password login with Cognito refresh-token persistence; credentials never logged.
- Stable Matter identities, safe structural-change handling, restore-before-online.
- Changed-value-only publishing; stale data becomes unavailable, not zero.
- Deterministic unit tests with sanitized fixtures; no real API calls in CI.
- Homebridge plugin-template layout, TypeScript, Node 22/24/26, Homebridge `^2.5.0`.
- `package.json` keywords `homebridge-plugin` and `supports-matter`, never `supports-hap`.

### Non-goals (v1)

- Controlling Emporia smart outlets, EV chargers, or Vue relays. This plugin is a meter, not a switch. The `OnOffOutlet` tile is a display vehicle; its switch is inert.
- Solar/export/bidirectional metering beyond a documented `solar` opt-in that allows negative power and reports exported energy.
- Historical charts, billing rates, cost, or per-appliance disaggregation.
- Homebridge UI custom tables or a settings UI beyond `config.schema.json` arrays.
- Local/LAN access. Emporia Vue data is cloud-only unless the user runs a third-party local bridge.

---

## 3. Platform and packaging constraints

### Homebridge Matter API

Source: `homebridge-matter` wiki (`matter-wiki/Core-Concepts.md`, `API-Reference.md`) and `homebridge-shelly-matter/src/platform.ts`.

Required runtime checks:

```ts
if (!api.isMatterAvailable?.() || !api.matter || !api.isMatterEnabled?.()) {
  log.warn('Matter is not enabled on this bridge...')
  return
}
if (api.isMatterExternalsOnly?.()) {
  log.warn('This bridge is in Matter externals-only mode; bridged accessories will not publish.')
}
```

- `api.isMatterAvailable()` is true on Homebridge ≥ 2.0.
- `api.isMatterEnabled()` is true only when the bridge config has a `matter` object.
- `api.isMatterExternalsOnly()` requires Homebridge ≥ 2.5 and means bridged accessories (ours) will not publish.
- The plugin should also check `api.versionGreaterOrEqual?.('2.5.0')` and refuse to start on older versions, because it depends on 2.5 registration semantics (resolved promises, `ElectricalSensor` support, `isMatterExternalsOnly`).
- A Matter-only plugin publishes no HAP accessories. If the child bridge still has HAP enabled, users can pair the HAP QR code and see an empty bridge. Detect this from the raw config file and warn (pattern from `homebridge-shelly-matter/src/platform.ts`).

Registration pattern:

```ts
await api.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessories)
await api.matter.updateAccessoryState(uuid, 'electricalPowerMeasurement', { activePower })
```

- `configureMatterAccessory(accessory)` is called for cached accessories before `didFinishLaunching`.
- Every accessory must be registered on every start, including restored ones: handlers are functions and cannot be cached.
- A restored accessory keeps its cached cluster state; `clusters` passed at registration is only the initial state for a new accessory. Push current state with `updateAccessoryState()` after registration resolves.
- `registerPlatformAccessories` and `unregisterPlatformAccessories` are async; 2.5 resolves them once the bridge has applied the change.

### Package metadata

From the Matter Plugins wiki and `homebridge-plugin-template`:

```json
{
  "keywords": ["homebridge-plugin", "supports-matter"],
  "main": "dist/index.js",
  "engines": {
    "node": "^22.12.0 || ^24.0.0 || ^26.0.0",
    "homebridge": "^2.5.0"
  }
}
```

- Never include `supports-hap`.
- `type: "module"`, `module: "nodenext"`, `target: "ES2022"` per the template.
- Template dependencies (`homebridge-lib`) are optional; we only need `homebridge` types at build time and no runtime dependencies beyond Node built-ins. Keeping runtime deps at zero reduces install risk.

---

## 4. Matter device modeling

### 4.1 Device type choice

Sources: `matter-wiki/Section-5-Smart-Plugs.md`, `Section-14-Energy.md`, `homebridge-matter/src/devices/OnOffOutletAccessory.ts`, `ElectricalMeterAccessory.ts`.

| Device type | Clusters | Apple behavior | Use |
|---|---|---|---|
| `OnOffOutlet` (0x010A) | `onOff`, `electricalPowerMeasurement`, `electricalEnergyMeasurement` | Tile shows live wattage; switch is tappable (inert here); "Show As → Light" available | **Chosen for channels and mains** |
| `OnOffSwitch` / `OnOffLight` | `onOff` + measurement | No tile wattage | Optional per-channel `accessoryType` |
| `ElectricalSensor` (0x0510) | measurement clusters + `powerTopology` | No tile in Apple Home; may appear in other controllers | Internal part only |
| `ElectricalMeter` (0x0510 / §14.8) | measurement clusters on the endpoint | Unknown in Apple Home; docs conflict on composition | **Avoid in v1** |
| `BridgedNode` | no clusters | Parent for composed devices | Parent for grouped mode |

Important details:

- Homebridge ≥ 2.2 auto-detects `electricalPowerMeasurement` / `electricalEnergyMeasurement` state, adds `ElectricalSensor` to the endpoint, and synthesizes `powerMode`, `numberOfMeasurementTypes`, and `accuracy`. We should still declare the attributes we actually report.
- The `OnOffOutlet` device type requires `onOff`. For a meter with no relay, the switch is cosmetic. Handlers can accept `on`/`off` and immediately re-publish the real state (or return `InvalidInState`). Simpler and safer: keep `onOff: true` and make handlers no-ops that log; document that the switch does nothing.
- `ElectricalMeter` is documented by Homebridge as non-composed, but the Matter model describes §14.8 as a composed device with an `ElectricalSensor` part. The wiki itself flags Apple presentation as unknown. Avoid until hardware/Apple verification.
- `PowerTopology` is mandatory on `ElectricalSensor`. Homebridge adds it automatically when it synthesizes the sensor. Do not declare it manually unless composing by hand.

### 4.2 Units

Matter uses raw integer units (`matter-wiki/Section-14-Energy.md`, §14.3):

| Quantity | Cluster attribute | Unit | Conversion from Emporia |
|---|---|---|---|
| Voltage | `electricalPowerMeasurement.voltage` | mV | `V × 1000` |
| Current | `electricalPowerMeasurement.activeCurrent` | mA | `A × 1000` |
| Active power | `electricalPowerMeasurement.activePower` | mW | `W × 1000` |
| Imported energy | `electricalEnergyMeasurement.cumulativeEnergyImported.energy` | mWh | `kWh × 1 000 000` |
| Exported energy | `cumulativeEnergyExported.energy` | mWh | `kWh × 1 000 000` |

`null` means "no reading right now" and is the correct way to express stale data. Never send `0` for an unknown value.

### 4.3 Composed vs flat

Two viable shapes:

1. **Flat** — one `OnOffOutlet` accessory per channel, measurement clusters on the same endpoint. Simplest, gives tile wattage, and matches Homebridge's own outlet example.
2. **Composed** — a `BridgedNode` parent with an `OnOffOutlet` part (or an `ElectricalSensor` part) per channel. Needed only when grouping multiple channels into one accessory or when mixing actuator and meter parts.

`homebridge-shelly-matter` uses composed accessories universally (BridgedNode + parts) because it mixes relays, covers, sensors, and meters, and because part IDs let it rotate identities cleanly. For Emporia, flat outlets are simpler and sufficient for split mode. For grouped mode (`splitChannels: false`), use a `BridgedNode` parent with one outlet part per channel.

Recommendation: **flat `OnOffOutlet` for split mode; `BridgedNode` + outlet parts for grouped mode.** Both paths share the same cluster-state builder so behavior cannot drift.

### 4.4 Identity, cache, and structural change

Sources: `matter-wiki/Advanced-Patterns.md`, `State-Management.md`, `homebridge-shelly-matter/src/platform.ts`, `shellyAccessory.ts`.

Rules:

- UUID seed must be deterministic and include the structure generation:
  - Split: `${deviceGid}|${channelId}|${accessoryType}|g${generation}`
  - Grouped: `${deviceGid}|bridge|${sortedChannelTokens}|g${generation}`
- A structural change (channel added/removed, split toggled, accessory type changed) must produce a **new UUID**. Reusing a UUID with a different structure corrupts Apple Home records (stale tiles, broken automations, "no response").
- Store `generation` per device in Homebridge storage. On detecting a structure-signature change at startup, bump the generation, unregister the old cached accessories, then register the new ones **before** the bridge goes online.
- On startup, `configureMatterAccessory` collects cached accessories. Match them to expected identities. Unregister orphans (removed channels, old generations). Register the expected set.
- Never rename a part ID or an identity seed without a generation bump. Part IDs must not contain `:`.
- Keep serial numbers stable per physical device/channel (for information), but UUIDs are what Matter uses.

Restore sequence:

1. `configureMatterAccessory` runs for each cached accessory; store it.
2. On `didFinishLaunching`, compute expected accessories from config + Emporia metadata.
3. If the structure signature changed, bump generation and unregister all cached accessories for that device.
4. Register expected accessories (including ones restored with unchanged identity).
5. Push current state after registration resolves.

### 4.5 Publishing cadence and change detection

Source: `matter-wiki/State-Management.md`, `Monitoring-External-Changes.md`, `homebridge-matter/src/devices/OnOffOutletAccessory.ts`.

- Power attributes change frequently and are throttled by Matter; publish only when the rounded value changes by a meaningful delta.
- Energy updates emit a spec-required measurement event and are **not** throttled like power. Publish energy at most once per poll (60 s), and only when the value changed.
- Recommended debounce: publish power if `|newMw − lastMw| ≥ max(1000 mW, 1% of last)`; publish energy if `|newMwh − lastMwh| ≥ 1` (1 mWh is tiny; use ≥ 100 mWh or a percentage to avoid chatter). Exact thresholds are implementation choices; document them.
- Staleness: if the last successful poll is older than `max(3 × interval, 180 s)`, set `activePower`, `activeCurrent`, and `voltage` to `null` (unavailable). Do not zero energy; the total remains the last known cumulative value, but power is unavailable. Consider a `StatusFault`/`BridgedDeviceBasicInformation` signal if available; otherwise `null` is the contract.
- On auth failure or API outage, keep the last energy total but mark power unavailable; retry with exponential backoff (base 1 s, cap 60 s, jitter). Never hammer the API.

---

## 5. Emporia API

**The Emporia cloud API is unofficial and undocumented.** It can change without notice. This plugin must degrade gracefully and document the risk.

### 5.1 Authentication

Source: `PyEmVue/pyemvue/auth.py`, `pyemvue.py`; `ha-emporia-vue/custom_components/emporia_vue/__init__.py`.

Constants:

- Cognito region: `us-east-2`
- User pool: `us-east-2_ghlOXVLi1`
- Client ID: `4qte47jbstod8apnfic0bunmrq`
- Cognito endpoint: `https://cognito-idp.us-east-2.amazonaws.com/`

Flow:

1. **Login:** `InitiateAuth` with `AuthFlow: USER_PASSWORD_AUTH`, `ClientId`, `AuthParameters: { USERNAME: email.toLowerCase(), PASSWORD: password }`.
2. **Response:** `AuthenticationResult` with `IdToken`, `AccessToken`, `RefreshToken`, `ExpiresIn` (typically 3600 s).
3. **Refresh:** `InitiateAuth` with `AuthFlow: REFRESH_TOKEN_AUTH`, `AuthParameters: { REFRESH_TOKEN: refreshToken }`. The response may not include a new refresh token; keep the old one.
4. **API auth header:**
   - Legacy API (`https://api.emporiaenergy.com/...`): `authtoken: <IdToken>`
   - v1 API (`https://api.emporiaenergy.com/v1/...`): `Authorization: Bearer <IdToken>`
5. Refresh proactively when the ID token is within ~5 minutes of expiry, and reactively on `401` (refresh once, retry once).
6. Handle `NotAuthorizedException`, `UserNotFoundException`, `PasswordResetRequiredException`, and `TooManyRequestsException` distinctly. Surface actionable errors without leaking credentials.

Storage:

- Persist `{ refreshToken, idToken?, accessToken?, email? }` in Homebridge storage (`api.user.storagePath()`), mode `0600`, atomic write.
- Never persist the password unless the user explicitly opts into "store password" (not recommended). If no refresh token exists, require the password from config/env.
- Never log tokens, passwords, Authorization headers, or full API responses. Redact email in logs (`d***@example.com`).
- Cognito refresh-token lifetime is not verified. Cognito defaults are commonly 30 days; if refresh fails with `NotAuthorizedException`, fall back to password auth and tell the user to re-enter credentials.

Env-based credential test:

- `.env.example` with `EMPORIA_EMAIL`, `EMPORIA_PASSWORD`.
- A `scripts/test-auth.ts` (or `npm run test:auth`) that reads env vars, performs login + one usage call, prints only status/channel counts, and exits non-zero on failure. Never prints tokens.

### 5.2 Endpoints

Source: `PyEmVue/pyemvue/pyemvue.py` (`API_ROOT`, `API_ROOT_V1`).

Primary (v1):

```
GET https://api.emporiaenergy.com/v1/customers/devices
GET https://api.emporiaenergy.com/v1/customers/devices/usages?device_gids=1001,1002&instant=<ISO8601>&scale=1MIN&energy_unit=KILOWATT_HOURS
```

Fallback (legacy):

```
GET https://api.emporiaenergy.com/customers/devices
GET https://api.emporiaenergy.com/AppAPI?apiMethod=getDeviceListUsages&deviceGids=1001,1002&instant=<ISO8601>&scale=1MIN&energyUnit=KilowattHours
```

Notes:

- v1 `instant` is ISO-8601 UTC, e.g. `2026-11-01T20:10:20.657Z`. Legacy uses the same instant format.
- `scale` values: `1S`, `1MIN`, `15MIN`, `1H`, `1D`, `1W`, `1MON`, `1Y`.
- `energy_unit`: `KILOWATT_HOURS` (v1) / `KilowattHours` (legacy). Also supports `VOLTAGE` for voltage-only calls, but we do not need it.
- Multiple device GIDs are comma-separated. One call can cover all monitors on the account.
- Device metadata should be fetched at startup and refreshed every ~15–60 minutes (or on a 404/unknown channel), not every poll. Usage is fetched every poll.
- `GET /v1/customers/devices` returns a `devices` array (or a bare array in some responses). Parse defensively.
- Some accounts have nested devices (`device.devices`), e.g. a Vue monitor plus a paired smart outlet. Flatten recursively and dedupe by `device_gid`.
- Optional status endpoint: `GET /customers/devices/status` (legacy auth) returns online/offline state per device. Not required for v1; useful for diagnostics.

### 5.3 Device metadata schema

Source: `PyEmVue/tests/fixtures/devices_v1.json`, `pyemvue/device.py`.

Relevant fields per device:

```json
{
  "device_gid": 1004,
  "device_id": "A2304A0000000000000004",
  "display_name": "Kelwood",
  "model": "VUE002",
  "firmware": "Vue2-823",
  "device_type": "MONITOR",
  "category": "MONITOR",
  "time_zone": "America/Denver",
  "channels": [
    {
      "channel_id": "Mains",
      "name": null,
      "multiplier": 1.0,
      "channel_type_gid": null,
      "parent_channel_id": null,
      "channel_classification": "MAIN",
      "has_data": true
    },
    {
      "channel_id": "Branch_1",
      "name": "Main floor red",
      "multiplier": 1.0,
      "channel_type_gid": 21,
      "parent_channel_id": "Merged_100",
      "channel_classification": "FIFTY_AMP",
      "has_data": true
    }
  ]
}
```

Channel ID families:

- `Mains`, `Mains_A`, `Mains_B`, `Mains_C` — mains and phases.
- `Branch_1` … `Branch_16` (Vue 2), `Branch_1` … `Branch_8` (Vue 1) — branch circuits.
- `Balance` — the computed "other" load (mains minus monitored branches).
- `TotalUsage` — aggregate (may appear in usage responses, not always in device metadata).
- `Merged_100`, `Merged_101`, … — synthetic groups of two branch channels (e.g. a 240 V circuit using two clamps). `parent_channel_id` points to the merged channel. The merged channel itself may or may not appear as a channel; usage responses can include it.
- `1,2,3` — Vue 1 three-phase combined channel (PyEmVue normalizes this).
- `EvCharger`, `Evse_*` — EV charger channels (out of scope).
- `Outlet_*` / smart plug channels — out of scope.

Multipliers:

- `multiplier` (a.k.a. `channelMultiplier`) records how the clamp was configured (e.g. 200 A clamp, 240 V two-clamp circuit). Neither PyEmVue nor HA multiplies `usage` by it; the cloud already returns normalized values. **Implementation rule: use `usage` as-is and do not apply `multiplier`.** Keep `multiplier` only as diagnostic metadata. Add a unit test with a multiplier ≠ 1 to prove it is not applied twice.
- `has_data: false` means the channel is not reporting (no CT or disabled). Expose it as unavailable, not zero. Optionally skip creating an accessory for channels that never have data, but this can change at runtime; better to create it and mark unavailable.

Names:

- `channel.name` is user-assigned in the Emporia app; fall back to a generated name (`Kelwood Branch 1`, `Kelwood Mains`).
- `display_name` is the device/site name.

### 5.4 Usage schema

Source: `PyEmVue/tests/fixtures/usages_v1.json`, `pyemvue.py::get_device_list_usage_v1`, `device.py::VueDeviceChannelUsage`.

```json
{
  "instant": "2026-11-01T20:10:20.657Z",
  "scale": "SECOND",
  "energy_unit": "KILOWATT_HOURS",
  "device_usages": [
    {
      "device_gid": 1001,
      "channel_usages": [
        {
          "device_gid": 1001,
          "channel_id": "Mains",
          "usage": 0.0020296568,
          "percentage": 100.0,
          "raw_usage": 2.0296568,
          "included_in_total_usage": null,
          "nested_devices": []
        }
      ]
    }
  ]
}
```

Field notes:

- `usage` is **energy in kWh over the requested scale window**, not kW and not W. The fixture's `scale` is `SECOND`, so `usage × 3 600 000 = W`.
- `raw_usage` is the same reading in **watt-hours** (fixture: `2.0296568 Wh ÷ 1000 = 0.0020296568 kWh`; `0.25 Wh ÷ 1000 = 0.00025 kWh`). It is informational; treat `usage` as authoritative.
- `percentage` is share of the parent/total; not needed.
- `included_in_total_usage` indicates whether the channel is already counted in `TotalUsage`/mains. Useful for documentation, not for math.
- `nested_devices` contains sub-device usages (e.g. a smart plug under a Vue). Flatten recursively if we ever expose them.
- `has_data` may appear on channel usage objects. If absent, infer from `usage !== null`.
- A missing channel in the response means no data for that channel this cycle. Do not assume zero.

### 5.5 Power conversion

Source: `ha-emporia-vue/.../sensor.py::scale_usage`; `pyemvue.py` docstring ("1MIN in kw = 60*result").

```
W = kWh_over_1s    × 3_600_000
W = kWh_over_1min  × 60_000
W = kWh_over_15min × 4_000
```

For `scale=1MIN`, `W = usage × 60 000`. Then `mW = round(W × 1000)`.

- Negative values: Emporia reports negative usage for solar/export in some configurations. Default: clamp to `0` for import-only channels and log a debug warning once. If `solar: true`, allow negative power and declare `cumulativeEnergyExported`.
- Voltage: Emporia's usage API does not return per-channel voltage in the normal call. Options:
  1. Omit `voltage` and `activeCurrent` (declare only `activePower`). This is valid; Homebridge synthesizes accuracy.
  2. Use a nominal voltage (e.g. 120 V / 230 V) from config and derive `activeCurrent = activePower / voltage`. This is an estimate; label it clearly in docs and config (`nominalVoltage`, default 120 for US, 230 for EU).
  3. Call the usage API with `energy_unit=VOLTAGE` for mains only and use the returned voltage for all channels on that device. Extra API call; unverified per-channel support.
- Recommendation: v1 omits voltage/current by default, with optional `nominalVoltage` to enable estimates. Never present an estimate as a measurement without documenting it. (Alternatively, declare `voltage: null` and `activeCurrent: null`; Homebridge accepts null.)

### 5.6 Rate limits and reliability

- No published rate limit. Emporia's own apps poll on the order of a minute; HA uses a 1-minute coordinator; the Vue hardware reports at 1-second granularity but the cloud aggregates.
- Minimum poll interval: **60 s**. Allow 60–300 s in config; default 60. Do not allow < 60.
- One usage request per poll for all devices, not one per channel.
- Retry only on `5xx`, network errors, and `429`; use exponential backoff with jitter and a cap. Do not retry `4xx` auth errors more than once after a refresh.
- Cache device metadata; refresh every 30–60 minutes and on startup.
- Respect `Retry-After` if present.
- If the API is in maintenance (`https://s3.amazonaws.com/com.emporiaenergy.manual.ota/maintenance/maintenance.json`), surface the message and back off. Optional.
- Log a single concise error per failure, not one per channel.

---

## 6. Data semantics

### 6.1 Cumulative energy

The API exposes instantaneous/interval usage, not a lifetime counter. Therefore:

- Integrate power over elapsed wall-clock time between successful polls:
  `energyMwh += max(0, powerMw) × elapsedMs / 3_600_000` (mW × ms / 3.6e6 = mWh).
- Use the actual elapsed time, not the configured interval, and cap the integration step (e.g. 2 × interval) to avoid a huge jump after sleep/network outage.
- Persist `{ energyMwh, lastPollMs, lastPowerMw }` per channel in a JSON file in Homebridge storage, atomic write, debounced (e.g. every 5 minutes and on shutdown).
- On startup, restore the total. If the file is missing/corrupt, start at 0 and log a warning.
- Never decrease the imported total. On a detected device reset (usage drops to 0 for a long time), keep the total.
- Energy is per accessory; grouped mode still keeps per-channel totals internally and may report the sum on the parent.
- Document: "Cumulative energy is integrated by the plugin from live power samples. It is not read from Emporia and resets if the plugin's storage is deleted."

Optional improvement: Emporia's chart API (`AppAPI?apiMethod=getChartUsage`) can return historical usage. Using it to backfill the total on first run is possible but adds complexity and another unofficial endpoint. Defer to v2.

### 6.2 Stale data

- Track `lastSuccessMs` per device (not per channel; one API call covers all).
- If `now − lastSuccessMs > max(3 × interval, 180_000)`, publish `activePower: null`, `activeCurrent: null`, `voltage: null` for all channels of that device. Keep energy as-is.
- If a channel has `has_data: false` or no usage entry for N consecutive polls (e.g. 3), publish `null` for power.
- When data returns, publish immediately (do not wait for the next threshold).
- Homebridge/Matter treats `null` as "no reading"; Apple Home shows "—" or "Unavailable" rather than 0 W. This is the desired behavior.

### 6.3 Negative power / solar

- Default `solar: false`: clamp negative power to 0, log once per channel per hour.
- `solar: true` (global or per-device): allow negative `activePower`; declare `cumulativeEnergyExported` and integrate negative power into an exported total. Also declare `cumulativeEnergyImported` for positive power. This matches the Matter energy cluster's Imported/Exported features.
- Mains with `net_metering` in device metadata may legitimately go negative; auto-enable solar mode for those devices if the field is present, with a log line.

### 6.4 Double counting in Apple Home

Apple Home's Energy tab sums energy for accessories in the home. If both mains and branch circuits are exposed, the total is roughly 2×. Options:

- Default: expose mains and branches, document the double-count, provide `hideMains` and per-channel `hide`.
- Alternative: default `hideMains: true` when branch channels exist. Less surprising for Energy totals, but users lose whole-home power.
- Recommendation: expose mains by default (users want whole-home watts), document clearly, and make `hideMains` prominent. Per-channel `hide` handles the rest.

Also note: Apple's Energy view lists per-device consumption only for **directly paired** accessories. Bridged accessories (all of ours) contribute to the home total but are not itemized. This is Apple policy, not a plugin bug. The tile wattage still works.

---

## 7. Prior art comparison

| Project | What it does | What we reuse | What we avoid |
|---|---|---|---|
| `PyEmVue` | Python client for Emporia | Cognito constants/flow, v1 endpoints, parsing rules, sanitized fixtures | Python dependency, `pycognito` |
| `ha-emporia-vue` | HA custom integration | 1-minute coordinator, kWh→W conversions, stale handling, sign handling | HA-specific plumbing |
| `homebridge-emporia` (sbates) | HAP plugin for outlets/EV chargers | Config naming (`updateInterval`, `devices[].hide`), API shape | HAP accessories, 10 s minimum poll |
| `homebridge-emporia-vue-plugin` | HAP virtual switches from watts | Threshold concept (out of scope) | HAP, switch-only model |
| `homebridge-shelly-matter` | Matter plugin for Shelly | Matter-only gating, cache reconciliation, identity generation, composed parts, Apple caveats | Shelly transport, relay control, settings UI |
| `homebridge-matter` | Reference Matter accessories | `OnOffOutlet` + measurement pattern, `ElectricalMeter` example, API usage | Copying example code verbatim |
| `homebridge-plugin-template` | Scaffold | `package.json`, `tsconfig`, eslint, layout | `homebridge-lib` dependency, `supports-hap` keyword |

License note: all reference projects use permissive licenses (MIT/Apache-2.0). We will write original code and only reuse factual API details and patterns. Do not copy source verbatim; if any code is adapted, add attribution in `NOTICE`/README.

---

## 8. Test strategy

Unit tests (Vitest or Node's built-in test runner; template uses none, so choose Vitest for speed and TS support):

- **Auth:** mock `fetch`; login success, refresh success, 401 → refresh → retry, expired token proactive refresh, invalid credentials, missing refresh token fallback, redaction of tokens in errors.
- **API parsing:** sanitized fixtures (`devices_v1.json`, `usages_v1.json`), legacy fallback shape, nested devices, missing channels, `has_data: false`, multiplier ≠ 1, malformed JSON, empty devices.
- **Conversions:** kWh→W for 1S/1MIN/15MIN, W→mW, kWh→mWh, negative/solar, rounding, overflow/clamping.
- **Identity:** deterministic UUID for same input, different UUID for different channel/type/generation, grouped vs split, stable across reorderings, rotation on structural change.
- **Config:** defaults (interval 60, split true, outlet, mains visible), validation/clamping of interval, per-channel overrides, hide behavior, unknown channel IDs.
- **Energy integrator:** accumulation over elapsed time, cap on long gaps, persistence round-trip, corrupt file recovery, monotonicity, solar export.
- **Staleness:** null after threshold, recovery, per-channel `has_data`.
- **Platform:** mocked Matter API; restore-before-online, unregister orphans, register expected set, no HAP registration, Matter-disabled warning, externals-only warning.
- **No network:** global `fetch` mock that throws if called unexpectedly.

Fixtures must be sanitized: no real emails, tokens, device IDs, addresses, or site names. Derive from PyEmVue fixtures and rewrite identifiers.

CI: GitHub Actions matrix Node 22/24/26, `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm pack --dry-run`. No secrets, no live API.

---

## 9. Packaging, docs, and release

- `README.md`: what it does, Apple Home limitations (tile wattage, Energy tab, bridged accessories, double counting), API risk, install, config reference, troubleshooting, privacy.
- `CHANGELOG.md`: Keep a Changelog format.
- `CONTRIBUTING.md`: conventional commits, dev setup, test/lint/build, no credentials.
- `LICENSE`: **pending user choice** (MIT recommended; Apache-2.0 acceptable).
- `.env.example`: `EMPORIA_EMAIL`, `EMPORIA_PASSWORD`; `.gitignore` includes `.env`.
- `scripts/sync.sh`: copy built plugin into a local Homebridge `node_modules` for manual testing (template pattern).
- `.github/workflows/ci.yml`: matrix, cache npm, lint/test/build/pack.
- `.github/workflows/release.yml`: on `v*` tag, `npm publish --provenance --access public`, with `NPM_TOKEN` secret and `id-token: write`.
- `npm pack --dry-run` verification: `dist/`, `config.schema.json`, `README.md`, `LICENSE`, `CHANGELOG.md` included; `src/`, `test/`, `.env` excluded.

---

## 10. Risks and open questions

### Verified

- Homebridge 2.5 Matter API shape and registration semantics.
- `OnOffOutlet` + measurement clusters is the Apple tile-wattage shape.
- Emporia Cognito constants and v1/legacy endpoints from PyEmVue.
- Usage values are energy over the scale window; 1MIN conversion is `× 60 000`.
- Device/channel schema and ID families from fixtures and PyEmVue.
- Matter units and `null` semantics.

### Unverified / needs live testing

- Apple Home presentation of `ElectricalMeter` and pure `ElectricalSensor` (avoided in v1).
- Exact refresh-token lifetime and whether Cognito returns a new refresh token on refresh.
- Whether v1 usage returns `has_data` per channel consistently.
- Whether `usage` already includes the channel multiplier in all cases (fixture suggests yes; test with a real multiplier ≠ 1).
- Per-channel voltage availability via `energy_unit=VOLTAGE`.
- Real-world rate limits and 429 behavior.
- Behavior when the Emporia account has multiple sites/monitors and nested devices.
- Whether Apple Home shows tile wattage for bridged `OnOffOutlet` accessories in the current iOS release (Shelly users report yes for outlet-typed accessories; re-verify on iOS 27+).

### Product questions for the user

1. **License:** MIT (recommended) or Apache-2.0?
2. **GitHub owner/org:** which account should own the repo?
3. **`gh` CLI:** it is not installed. Install it, or create the repo manually / via API token?
4. **Mains default:** expose mains by default (whole-home watts, double-count risk) or hide by default?
5. **Voltage/current:** omit by default, or estimate from a configurable nominal voltage?
6. **Accessory type:** default `outlet` (tile wattage) — confirm; allow `light`/`switch` per channel?
7. **Energy persistence:** OK to integrate locally and persist in Homebridge storage, with the documented reset caveat?

---

## 11. Sources

Local checkouts (research workspace):

- `PyEmVue/pyemvue/auth.py`, `pyemvue.py`, `device.py`, `enums.py`
- `PyEmVue/tests/fixtures/devices_v1.json`, `usages_v1.json`, `devices_legacy.json`
- `ha-emporia-vue/custom_components/emporia_vue/__init__.py`, `sensor.py`
- `homebridge-emporia` (sbates) `src/emporiaApi.ts`, `src/platform.ts`, `config.schema.json`
- `homebridge-emporia-vue-plugin` `README.md`
- `homebridge-shelly-matter` `README.md`, `src/platform.ts`, `src/shellyAccessory.ts`
- `homebridge-matter` `src/devices/OnOffOutletAccessory.ts`, `src/devices/ElectricalMeterAccessory.ts`, `CLAUDE.md`
- `matter-wiki` `Section-5-Smart-Plugs.md`, `Section-14-Energy.md`, `Core-Concepts.md`, `API-Reference.md`, `Advanced-Patterns.md`, `State-Management.md`, `Monitoring-External-Changes.md`, `Best-Practices.md`, `Value-Conversions.md`
- `homebridge-plugin-template` `package.json`, `tsconfig.json`, `eslint.config.js`
- `matterpkg` (`@matter/types@0.18.0`, `@matter/model@0.18.0`) cluster/device definitions

Upstream references:

- Homebridge Matter wiki: <https://github.com/homebridge-plugins/homebridge-matter/wiki>
- Matter Plugins wiki: <https://github.com/homebridge-plugins/homebridge-matter/wiki/Matter-Plugins>
- PyEmVue: <https://github.com/magico13/PyEmVue>
- HA Emporia Vue: <https://github.com/magico13/ha-emporia-vue>
- Emporia Energy: <https://www.emporiaenergy.com/>
- Matter specification § 5 (Smart Plugs), § 14 (Energy)
