# homebridge-emporia-matter

[![CI](https://github.com/dmitripr/homebridge-emporia-matter/actions/workflows/ci.yml/badge.svg)](https://github.com/dmitripr/homebridge-emporia-matter/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/homebridge-emporia-matter.svg)](https://www.npmjs.com/package/homebridge-emporia-matter)

Expose Emporia Vue energy monitors to Apple Home over **Matter**. Each mains feed or branch circuit becomes its own accessory with live active power and a cumulative energy total.

This plugin is **Matter-only**. It does not publish HAP accessories and does not use `supports-hap`.

> This is an independent project. It is not affiliated with Emporia Energy, Apple, or the Homebridge project.

## What you get

- One Matter accessory per branch circuit, plus the whole-home mains feed (both configurable).
- Live active power in watts on the accessory tile.
- Cumulative imported energy in kWh, integrated locally and persisted across restarts.
- Optional voltage and current estimates when you configure a nominal voltage.
- Optional solar/export support with a separate exported-energy total.
- Stable Matter identities that survive restarts, with automatic rotation when the channel layout changes.
- Changed values only are published. A failed poll marks power as unavailable rather than reporting `0 W`.

## Requirements

- Homebridge **2.5.0 or newer** with Matter enabled on the bridge.
- Node.js **22.12+**, **24**, or **26**.
- An Emporia Energy account with a Vue monitor that reports to the Emporia cloud.
- Apple Home with a home hub (Apple TV, HomePod, or iPad) for remote access and automations.

## Install

### Homebridge UI

Open **Plugins**, search for `Emporia Matter` (or `homebridge-emporia-matter`),
and install it. Enter your Emporia email and password in the plugin settings,
then restart Homebridge.

### Command line

On the machine running Homebridge, as the same user that runs Homebridge:

```bash
npm install -g homebridge-emporia-matter
```

Verify the install:

```bash
npm ls -g homebridge-emporia-matter
```

Node.js 22.12+ is required. Then restart Homebridge and configure the plugin
as described below.

#### Homebridge with a managed plugin directory

If the Homebridge log shows startup flags like:

```text
Starting Homebridge with extra flags: -P /var/lib/homebridge/node_modules --strict-plugin-resolution
```

then Homebridge only loads plugins from that directory. The Homebridge UI sets
these flags when it manages plugins locally, and a global install is invisible
to both Homebridge and the UI plugin list. Install into the plugin directory
instead:

```bash
npm uninstall -g homebridge-emporia-matter
cd /var/lib/homebridge
npm install homebridge-emporia-matter --save
```

Verify that the plugin is in the directory named by `-P`:

```bash
ls /var/lib/homebridge/node_modules/homebridge-emporia-matter/dist/index.js
```

### Install from GitHub

To test unreleased changes, install from the repository instead of npm:

```bash
npm install -g github:dmitripr/homebridge-emporia-matter --install-links
```

`--install-links` matters: without it, npm 11 can symlink a global git install
to a temporary cache clone, leaving a broken package after the cache is
cleaned.

The repository includes the compiled `dist/` output, so GitHub installs do not
need devDependencies or a build step. For a Homebridge-managed plugin directory,
run the same command after `cd /var/lib/homebridge` and add `--save`.

> npm may warn that the `prepare` script is "not yet covered by allowScripts".
> That is harmless: the committed `dist/` output is used either way.

### Docker

Run the install inside the Homebridge container, then restart it:

```bash
docker exec -it <container-name> npm install -g homebridge-emporia-matter
docker restart <container-name>
```

### Local tarball

If you prefer to build on the machine first, or if install scripts are blocked:

```bash
git clone https://github.com/dmitripr/homebridge-emporia-matter.git
cd homebridge-emporia-matter
npm pack
npm install -g ./homebridge-emporia-matter-0.1.2.tgz
```

After installing, add the platform configuration and restart Homebridge.

## Homebridge and Matter setup

This plugin registers **bridged Matter accessories**, so the bridge itself must be a normal Matter bridge:

- In the Homebridge UI, open the bridge settings and turn on **Enable Matter**.
- HAP can be turned off if this bridge only runs Matter plugins, but it is not required.
- Do **not** use Matter "externals only" mode. Bridged accessories are not published in that mode, and the plugin will log a warning.
- Pair the bridge with Apple Home using the Matter pairing code shown in the Homebridge UI.

The plugin refuses to start on Homebridge versions older than 2.5.0 and logs an actionable message when Matter is unavailable.

## Configuration

In the Homebridge UI, open the plugin settings and enter your Emporia email and
password; the form exposes every option below. For a manual setup, add a
platform block to `config.json`.

Minimal `config.json`:

```json
{
  "platforms": [
    {
      "platform": "EmporiaMatter",
      "name": "Emporia Matter",
      "email": "you@example.com",
      "password": "your-password"
    }
  ]
}
```

A fuller example:

```json
{
  "platforms": [
    {
      "platform": "EmporiaMatter",
      "name": "Emporia Matter",
      "email": "you@example.com",
      "password": "your-password",
      "pollInterval": 60,
      "splitChannels": true,
      "hideMains": false,
      "accessoryType": "outlet",
      "solar": false,
      "channels": [
        { "channelId": "Branch_3", "name": "Dishwasher" },
        { "channelId": "Branch_5", "hide": true },
        { "channelId": "Branch_7", "accessoryType": "light" }
      ]
    }
  ]
}
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `name` | `Emporia Matter` | Platform name shown in Homebridge. |
| `email` | — | Emporia account email. Required. |
| `password` | — | Used for the first sign-in. After that, a refresh token is stored in Homebridge storage. Leave blank when a valid token already exists. |
| `pollInterval` | `60` | Seconds between usage requests. Minimum `60`, maximum `300`. Emporia does not publish a rate limit; 60 seconds matches its 1-minute data. |
| `splitChannels` | `true` | `true`: one accessory per channel, so each circuit can live in its own room. `false`: one composed accessory per monitor with all circuits as parts. |
| `hideMains` | `false` | Hide the whole-home mains accessory. See the double-counting note below. |
| `accessoryType` | `outlet` | `outlet`, `light`, or `switch`. Apple Home shows live wattage on the tile for outlet-typed accessories; use Show As → Light afterwards if you prefer a light tile. |
| `solar` | `false` | Allow negative power and report exported energy. Leave off for import-only circuits. |
| `nominalVoltage` | — | Optional, 100–300 V. When set, the plugin publishes that voltage and derives current from power. This is an estimate, not a measurement. |
| `channels` | `[]` | Per-channel overrides: `deviceGid`, `channelId`, `name`, `hide`, `accessoryType`. |

### Channel overrides

Channel IDs look like `Mains`, `Mains_A`, `Branch_1` … `Branch_16`, or `Merged_100`. An override without `deviceGid` applies to that channel ID on every monitor. An override with `deviceGid` applies only to one monitor.

```json
{
  "channels": [
    { "deviceGid": 1004, "channelId": "Branch_2", "name": "Garage freezer" },
    { "channelId": "Balance", "hide": true }
  ]
}
```

Branch circuits are exposed by default. Phase channels (`Mains_A`, `Mains_B`, …) are exposed only when the monitor has no total `Mains` channel, unless you explicitly unhide them. Derived channels such as `Balance`, `TotalUsage`, and `Merged_*` are hidden by default.

## What appears in Apple Home

- **Power:** the tile shows current active power for `outlet` accessories.
- **Energy:** the accessory reports cumulative imported energy, and exported energy when `solar` is enabled.
- **Switch:** the on/off control is cosmetic. This plugin is a meter, not a relay: commands are accepted and immediately restored to "on" so the tile does not appear to turn off.

## Apple Home limitations

These are limitations of Apple Home and Matter, not bugs in the plugin:

- **Mains and branch circuits double-count.** Apple Home's Energy view sums energy across accessories in the home. If you expose both the mains feed and its branch circuits, the home total is roughly twice the real consumption. Either set `hideMains: true`, hide the branches, or accept the doubled total.
- **Bridged accessories are not itemized in the Energy view.** Apple Home lists per-device energy only for directly paired accessories. All accessories from this plugin are bridged, so they contribute to the home total but do not appear as individual rows. Tile wattage still works.
- **Rooms are assigned per accessory.** That is why `splitChannels` defaults to `true`: with grouped mode, every circuit shares one accessory and therefore one room.
- **Structural changes create new accessories.** Changing `splitChannels`, an accessory type, or the set of exposed channels rotates the Matter identity. The old accessory is removed and a new one appears, which may need to be re-added to rooms, scenes, and automations. Renaming a channel does not rotate identity; hiding a channel removes its accessory, and in grouped mode hiding a channel also rotates the composed accessory.
- **Energy totals are local.** Apple Home does not provide a lifetime counter from Emporia, so the plugin integrates power over time. See below.

## Cumulative energy

The Emporia API reports energy over a short window, not a lifetime counter. The plugin integrates reported power into a running total and persists it in Homebridge storage:

- Totals survive Homebridge restarts.
- Energy is integrated only while Homebridge is running and readings are arriving. A single integration step is capped at 10 minutes, so long gaps are only partially estimated rather than fully backfilled.
- Deleting `emporia-matter-state.json` resets the totals.
- A negative reading is clamped to `0 W` unless `solar` is enabled, in which case it contributes to exported energy.

## Stale readings

If polling fails, the plugin keeps the last energy total but stops publishing new power. After `max(3 × pollInterval, 180 seconds)` without a successful reading, power is published as unavailable (`null`), which Apple Home shows as no reading rather than `0 W`. Polling continues and values recover automatically.

## Emporia API risk

The Emporia cloud API used here is **unofficial and undocumented**. It can change without notice. The plugin uses the v1 endpoints with a legacy fallback and degrades to unavailable readings on failure, but a future Emporia change may require a plugin update. There is no published rate limit; the 60-second default is deliberately conservative.

Authentication uses AWS Cognito directly:

- Email/password sign-in happens only when no valid refresh token exists.
- Only refresh/session tokens are stored, in `emporia-matter-tokens.json` under the Homebridge storage directory, with mode `0600`.
- Passwords, tokens, and authorization headers are never logged.
- If the refresh token is rejected (for example after a password change), update the password in the plugin settings and restart.

## Troubleshooting

**"Matter is not enabled on this bridge"**  
Open the bridge settings in the Homebridge UI and turn on **Enable Matter**, then restart.

**"This bridge is in Matter externals-only mode"**  
Bridged accessories cannot be published in that mode. Use a normal Matter bridge for this plugin.

**Installed but not shown in the Homebridge UI**  
Restart Homebridge itself (the power menu, not just the browser or UI). The
Plugins search only queries the npm registry, so a GitHub install will not
appear there; look under the installed plugins list after Homebridge reloads.
If it still does not appear, check the Homebridge log for
`homebridge-emporia-matter` and add the platform block manually — the plugin
runs without a settings card.

If the log says `No plugin was found for the platform "EmporiaMatter"`, check
the startup flags. When Homebridge runs with
`-P /var/lib/homebridge/node_modules --strict-plugin-resolution`, it ignores
globally installed plugins; install into that directory instead. See
[Homebridge with a managed plugin directory](#homebridge-with-a-managed-plugin-directory).

**No accessories appear**  
Check the Homebridge log for authentication or API errors. You can verify credentials from a terminal with the auth smoke test described below. Make sure the bridge is paired with Apple Home and that the plugin is enabled.

**Power shows unavailable**  
The channel may have no CT clamp (`has_data: false`), the monitor may be offline, or the Emporia API may be failing. Energy totals are retained.

**Duplicate or missing accessories after a settings change**  
A structural change rotates identities. Remove the old accessory from Apple Home if it lingers, then re-add the new one to rooms and automations.

**Energy total reset to zero**  
The state file was removed or Homebridge storage changed. This is expected; totals are local.

## Privacy

The plugin talks only to `api.emporiaenergy.com` and the Emporia Cognito endpoint. It sends your Emporia credentials only during sign-in and stores only refresh/session tokens afterwards. No telemetry is collected.

## Development

```bash
npm install
npm run build
npm test
npm run lint
npm pack --dry-run
```

Tests use sanitized fixtures and a mocked client; CI never calls the Emporia API.

Live authentication smoke test (prints only device and channel counts):

```bash
cp .env.example .env
# edit .env with your credentials
set -a && source .env && set +a
npm run test:auth
```

`scripts/sync.sh` copies a local build into a Homebridge storage directory for manual testing:

```bash
./scripts/sync.sh ~/.homebridge
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions and the pull-request checklist, and [docs/research.md](docs/research.md) for the underlying API and Matter research.

## License

MIT © 2026 Dmitri Prigojev
