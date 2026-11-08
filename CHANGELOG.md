# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-08

### Added

- Matter-only Homebridge platform for Emporia Vue energy monitors.
- One accessory per branch circuit and mains feed, with optional grouped layout.
- Live active power (mW), optional voltage (mV) and current (mA), and cumulative
  imported/exported energy (mWh) via the Matter electrical measurement clusters.
- Email/password Cognito authentication with refresh-token persistence in
  Homebridge storage; credentials and tokens are never logged.
- v1 Emporia API with legacy endpoint fallback, defensive parsing, and support
  for nested devices and merged channels.
- Local cumulative energy integration persisted across restarts.
- Stable Matter identities derived from device GID and channel ID, with
  generation rotation on structural changes and cached-accessory restoration
  before the bridge goes online.
- Stale-reading handling: unavailable power instead of zero.
- Configurable poll interval (60–300 s), per-channel hide/name/accessory type,
  mains visibility, solar/export opt-in, and optional nominal voltage.
- `config.schema.json` for the Homebridge UI.
- Sanitized fixtures and unit tests for auth, API parsing, units, identity,
  energy integration, config defaults, and platform orchestration.
- CI matrix for Node 22/24/26 and tag-based npm publishing with provenance.
- Environment-based live authentication smoke test.

[0.1.0]: https://github.com/dmitripr/homebridge-emporia-matter/releases/tag/v0.1.0
