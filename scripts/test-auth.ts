import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { EmporiaAuth } from '../src/emporia/auth.js';
import { EmporiaClient } from '../src/emporia/client.js';
import { FileStore, TokenStore } from '../src/storage.js';

const email = process.env.EMPORIA_EMAIL;
const password = process.env.EMPORIA_PASSWORD;

if (!email || !password) {
  console.error('Set EMPORIA_EMAIL and EMPORIA_PASSWORD (see .env.example).');
  process.exit(1);
}

const tokenStore = new TokenStore(new FileStore(join(tmpdir(), 'emporia-matter-auth-test.json')));
const auth = new EmporiaAuth({ email, password, tokenStore });
const client = new EmporiaClient({ auth });

try {
  const devices = await client.getDevices();
  console.log(`Authenticated. ${devices.length} Emporia monitor(s) found.`);
  for (const device of devices) {
    console.log(`- ${device.deviceGid} ${device.displayName} (${device.channels.length} channel(s))`);
  }

  if (devices.length > 0) {
    const usage = await client.getUsage(devices.map((device) => device.deviceGid));
    console.log(`Usage received for ${usage.size} monitor(s).`);
    for (const [gid, deviceUsage] of usage) {
      console.log(`- ${gid}: ${deviceUsage.channels.size} channel reading(s)`);
    }
  }
} catch (error) {
  console.error(`Emporia auth test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
