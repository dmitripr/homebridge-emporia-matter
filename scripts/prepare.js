import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';

// Global npm installs of a git dependency run `prepare` without installing
// devDependencies. The repository commits `dist/` so those installs can use the
// prebuilt output; local checkouts with devDependencies still rebuild.
const hasRimraf = existsSync('node_modules/rimraf/dist/esm/bin.mjs');
const hasTsc = existsSync('node_modules/typescript/bin/tsc');
const hasDist = existsSync('dist/index.js');

if (!hasRimraf || !hasTsc) {
  if (hasDist) {
    console.log('Build tools are not installed; using the committed dist/ output.');
    process.exit(0);
  }

  console.error('Build tools are missing and dist/index.js does not exist.');
  console.error('Install dev dependencies and run npm run build.');
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'build'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
