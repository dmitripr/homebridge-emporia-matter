# Contributing

Thanks for helping improve `homebridge-emporia-matter`.

## Development setup

```bash
git clone https://github.com/dmitripr/homebridge-emporia-matter.git
cd homebridge-emporia-matter
npm install
npm run build
npm test
npm run lint
```

Requirements: Node.js 22.12+, 24, or 26, and npm.

## What to run before opening a pull request

```bash
npm run lint
npm test
npm run build
npm pack --dry-run
```

All four must pass. The packed file list should contain only `dist/`, `docs/`,
`config.schema.json`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`,
and `package.json`.

`dist/` is committed so that global GitHub installs work without
devDependencies. Rebuild it before committing and include the output in your
change:

```bash
npm run build
git diff --exit-code -- dist
```

CI runs the same check; a source change with stale `dist/` output fails the
build.

## Tests

- Tests use Vitest and live in `test/`.
- Use sanitized or synthetic fixtures only. Never commit real account data,
  device IDs, tokens, email addresses, or usage exports.
- CI never calls the Emporia API. Live checks belong in the manual
  `npm run test:auth` script, which reads `EMPORIA_EMAIL` and
  `EMPORIA_PASSWORD` from the environment.
- Add a test for every behavior change. Parsing, unit conversion, identity
  generation, config defaults, and stale-data handling are all covered today.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add solar export support
fix: keep identity stable when a channel is renamed
docs: clarify Apple Home double counting
test: cover legacy usage fallback
chore: update dev dependencies
```

Keep commits focused. Describe the user-visible effect in the subject line.

## Code style

- TypeScript, ESM, strict mode. No `any` unless unavoidable and documented.
- Follow the existing structure: parsing in `src/emporia/`, Matter accessory
  construction in `src/accessory.ts`, orchestration in `src/platform.ts`.
- Do not add runtime dependencies without a strong reason; the plugin currently
  has none.
- Keep user-facing log messages actionable and free of credentials, tokens,
  and full API payloads.
- Preserve the plugin's core guarantees:
  - Matter-only; never add `supports-hap`.
  - Stable identities, rotated only on structural change.
  - Publish changed values only.
  - Stale data is unavailable, not zero.
  - No negative power unless `solar` is enabled.

## Pull requests

- Describe the problem, the change, and how you tested it.
- Include the output of `npm run lint`, `npm test`, and `npm run build`.
- Call out any change that affects Matter identity, storage format, or Apple
  Home presentation.
- Update `README.md` and `CHANGELOG.md` when behavior or configuration changes.

## Security

Do not open a public issue for a credential leak or a vulnerability that could
expose account data. Report it privately to the maintainer instead. Never commit
`.env` files, tokens, or real API responses.

## License

By contributing, you agree that your contributions are licensed under the MIT
License.
