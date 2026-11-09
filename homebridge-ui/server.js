import { join } from 'node:path';

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { EmporiaAuth } from '../dist/emporia/auth.js';
import { EmporiaClient } from '../dist/emporia/client.js';
import { buildDiscovery } from '../dist/ui/discover.js';
import { FileStore, TokenStore } from '../dist/storage.js';

const quietLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function storageDirectory() {
  const directory = process.env.HOMEBRIDGE_STORAGE_PATH;
  if (!directory) {
    throw new RequestError('Homebridge storage path is unavailable. Open this page from the Homebridge UI.');
  }
  return directory;
}

function describeError(error) {
  if (error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Could not reach the Emporia API.';
}

class EmporiaUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/discover', this.discover.bind(this));
    this.ready();
  }

  /**
   * Signs in (or reuses the stored refresh token) and returns every channel the
   * account can see, so the settings page can render one row per channel.
   */
  async discover(payload) {
    const config = payload && typeof payload.config === 'object' && payload.config ? payload.config : {};
    const email = typeof payload?.email === 'string' ? payload.email.trim() : '';
    const password = typeof payload?.password === 'string' && payload.password ? payload.password : undefined;

    if (!email) {
      throw new RequestError('Enter your Emporia email address first.');
    }

    const tokenStore = new TokenStore(new FileStore(join(storageDirectory(), 'emporia-matter-tokens.json')));
    const auth = new EmporiaAuth({
      email,
      password,
      tokenStore,
      log: quietLog,
    });
    const client = new EmporiaClient({
      auth,
      log: quietLog,
      maxRetries: 1,
    });

    try {
      const devices = await client.getDevices();
      return buildDiscovery({ ...config, email }, devices);
    } catch (error) {
      throw new RequestError(describeError(error));
    }
  }
}

export default new EmporiaUiServer();
