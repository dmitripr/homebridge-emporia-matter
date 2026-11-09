'use strict';

(() => {
  const state = {
    config: null,
    discovered: null,
    rows: [],
    loading: false,
    multiDevice: false,
  };

  let pushTimer;
  let pushGeneration = 0;
  let autoTimer;
  let autoAttempted = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(message, kind) {
    const box = byId('status');
    if (!message) {
      box.className = 'alert d-none';
      box.textContent = '';
      return;
    }
    box.className = `alert alert-${kind || 'info'}`;
    box.textContent = message;
  }

  function setLoading(loading) {
    state.loading = loading;
    const button = byId('discover');
    button.disabled = loading;
    button.classList.toggle('disabled', loading);
  }

  function defaultAccessoryType() {
    const type = state.config && state.config.accessoryType;
    return type === 'light' || type === 'switch' || type === 'outlet' ? type : 'outlet';
  }

  function defaultsFor(row) {
    const hideMains = Boolean(state.config && state.config.hideMains === true);
    let exposed = false;
    if (row.channelId === 'Mains') {
      exposed = !hideMains;
    } else if (/^Mains_[A-Z]$/.test(row.channelId)) {
      exposed = !row.hasMainTotal && !hideMains;
    } else if (/^Branch_\d+$/.test(row.channelId)) {
      exposed = true;
    }
    return { exposed, accessoryType: defaultAccessoryType() };
  }

  function isAccessoryType(value) {
    return value === 'outlet' || value === 'light' || value === 'switch';
  }

  /** The plugin's parser treats a missing or non-numeric deviceGid as global. */
  function overrideDeviceGid(entry) {
    if (entry.deviceGid === undefined || entry.deviceGid === null || entry.deviceGid === '') {
      return undefined;
    }
    const gid = Number(entry.deviceGid);
    return Number.isFinite(gid) ? gid : undefined;
  }

  function buildRows() {
    const specific = new Map();
    const global = new Map();
    const overrides = state.config && Array.isArray(state.config.channels) ? state.config.channels : [];
    for (const override of overrides) {
      if (!override || typeof override.channelId !== 'string') {
        continue;
      }
      const deviceGid = overrideDeviceGid(override);
      if (deviceGid === undefined) {
        global.set(override.channelId, override);
      } else {
        specific.set(`${deviceGid}:${override.channelId}`, override);
      }
    }

    const rows = [];
    const devices = state.discovered ? state.discovered.devices : [];
    for (const device of devices) {
      for (const channel of device.channels) {
        const override = specific.get(`${device.deviceGid}:${channel.channelId}`)
          || global.get(channel.channelId)
          || {};
        const defaults = defaultsFor(channel);
        rows.push({
          deviceGid: device.deviceGid,
          deviceName: device.deviceName,
          channelId: channel.channelId,
          label: channel.label,
          defaultName: channel.defaultName,
          hasData: channel.hasData,
          hasMainTotal: channel.hasMainTotal,
          name: typeof override.name === 'string' ? override.name : '',
          exposed: typeof override.hide === 'boolean' ? !override.hide : defaults.exposed,
          accessoryType: isAccessoryType(override.accessoryType) ? override.accessoryType : '',
        });
      }
    }

    state.rows = rows;
    state.multiDevice = devices.length > 1;
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    const generation = ++pushGeneration;
    pushTimer = setTimeout(() => {
      if (!state.config) {
        return;
      }
      // Send only the field this page owns. The UI merges blocks in place, so
      // any in-flight edit in the schema form below is left untouched, and the
      // response gives us the authoritative merged config.
      void homebridge.updatePluginConfig([{ channels: state.config.channels || [] }]).then((blocks) => {
        if (generation === pushGeneration && Array.isArray(blocks) && blocks[0]) {
          state.config = blocks[0];
        }
      });
    }, 300);
  }

  /**
   * A global override (no deviceGid) is shown on every monitor's row. Before
   * the first edit to such a row, turn it into per-monitor overrides so that
   * editing or resetting one row cannot silently change the others.
   */
  function expandGlobalOverride(row) {
    const config = state.config;
    if (!config || !Array.isArray(config.channels) || !state.discovered) {
      return;
    }
    const hasSpecific = config.channels.some((entry) => entry
      && entry.channelId === row.channelId
      && overrideDeviceGid(entry) === Number(row.deviceGid));
    if (hasSpecific) {
      return;
    }
    const globalEntry = config.channels.find((entry) => entry
      && entry.channelId === row.channelId
      && overrideDeviceGid(entry) === undefined);
    if (!globalEntry) {
      return;
    }
    const devices = state.discovered.devices.filter((device) => device.channels
      .some((channel) => channel.channelId === row.channelId));
    if (devices.length < 2) {
      globalEntry.deviceGid = row.deviceGid;
      return;
    }
    config.channels = config.channels
      .filter((entry) => entry !== globalEntry)
      .concat(devices.map((device) => ({ ...globalEntry, deviceGid: device.deviceGid })));
  }

  function applyRowToConfig(row) {
    const config = state.config;
    if (!config) {
      return;
    }

    expandGlobalOverride(row);
    const channels = Array.isArray(config.channels) ? config.channels.slice() : [];
    const index = channels.findIndex((entry) => entry
      && entry.channelId === row.channelId
      && overrideDeviceGid(entry) === Number(row.deviceGid));
    const defaults = defaultsFor(row);
    const override = {};
    const name = row.name.trim();

    if (name && name !== row.defaultName) {
      override.name = name;
    }
    if (row.exposed !== defaults.exposed) {
      override.hide = !row.exposed;
    }
    if (row.accessoryType && row.accessoryType !== defaults.accessoryType) {
      override.accessoryType = row.accessoryType;
    }

    if (Object.keys(override).length > 0) {
      override.deviceGid = row.deviceGid;
      override.channelId = row.channelId;
      if (index >= 0) {
        channels[index] = override;
      } else {
        channels.push(override);
      }
    } else if (index >= 0) {
      channels.splice(index, 1);
    }

    config.channels = channels;
    schedulePush();
  }

  function cell(text, className) {
    const td = document.createElement('td');
    if (className) {
      td.className = className;
    }
    td.textContent = text;
    return td;
  }

  function render() {
    const tbody = byId('channel-rows');
    const tableWrap = byId('table-wrap');
    const deviceHead = byId('device-head');
    tbody.replaceChildren();
    tableWrap.classList.toggle('d-none', state.rows.length === 0);
    deviceHead.classList.toggle('d-none', !state.multiDevice);

    for (const row of state.rows) {
      const tr = document.createElement('tr');

      if (state.multiDevice) {
        tr.appendChild(cell(row.deviceName, 'text-nowrap'));
      }

      const channelCell = document.createElement('td');
      channelCell.className = 'text-nowrap';
      const label = document.createElement('span');
      label.textContent = row.label;
      channelCell.appendChild(label);
      const channelId = document.createElement('div');
      channelId.className = 'small text-muted';
      channelId.textContent = row.channelId;
      channelCell.appendChild(channelId);
      if (row.hasData === false) {
        const badge = document.createElement('span');
        badge.className = 'badge text-bg-secondary ms-1';
        badge.textContent = 'no clamp';
        channelCell.appendChild(badge);
      }
      tr.appendChild(channelCell);

      const nameCell = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'form-control form-control-sm';
      input.value = row.name;
      input.placeholder = row.defaultName;
      input.setAttribute('aria-label', `Name for ${row.label}`);
      input.addEventListener('input', () => {
        row.name = input.value;
        applyRowToConfig(row);
      });
      nameCell.appendChild(input);
      tr.appendChild(nameCell);

      const showCell = document.createElement('td');
      showCell.className = 'text-center';
      const show = document.createElement('input');
      show.type = 'checkbox';
      show.className = 'form-check-input';
      show.checked = row.exposed;
      show.setAttribute('aria-label', `Show ${row.label}`);
      show.addEventListener('change', () => {
        row.exposed = show.checked;
        applyRowToConfig(row);
      });
      showCell.appendChild(show);
      tr.appendChild(showCell);

      const typeCell = document.createElement('td');
      const select = document.createElement('select');
      select.className = 'form-select form-select-sm';
      select.setAttribute('aria-label', `Accessory type for ${row.label}`);
      const inherit = document.createElement('option');
      inherit.value = '';
      inherit.textContent = `Default (${defaultAccessoryType()})`;
      select.appendChild(inherit);
      for (const type of ['outlet', 'light', 'switch']) {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        select.appendChild(option);
      }
      select.value = row.accessoryType;
      select.addEventListener('change', () => {
        row.accessoryType = select.value;
        applyRowToConfig(row);
      });
      typeCell.appendChild(select);
      tr.appendChild(typeCell);

      const resetCell = document.createElement('td');
      resetCell.className = 'text-end';
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'btn btn-link btn-sm';
      reset.textContent = 'Reset';
      reset.setAttribute('aria-label', `Reset ${row.label} to defaults`);
      reset.addEventListener('click', () => {
        const defaults = defaultsFor(row);
        row.name = '';
        row.exposed = defaults.exposed;
        row.accessoryType = '';
        applyRowToConfig(row);
        render();
      });
      resetCell.appendChild(reset);
      tr.appendChild(resetCell);

      tbody.appendChild(tr);
    }
  }

  function errorText(error) {
    if (error && typeof error.message === 'string' && error.message) {
      return error.message;
    }
    if (error && error.error && typeof error.error.message === 'string' && error.error.message) {
      return error.error.message;
    }
    return 'Could not load channels from Emporia.';
  }

  async function discover(options) {
    const auto = Boolean(options && options.auto);
    const config = state.config;
    if (!config || state.loading) {
      return;
    }

    const email = typeof config.email === 'string' ? config.email.trim() : '';
    if (!email) {
      if (!auto) {
        setStatus('Enter your Emporia email and password in the settings below, then click Discover channels.', 'info');
      }
      return;
    }

    setLoading(true);
    if (!auto) {
      setStatus('Contacting Emporia...', 'info');
    }

    try {
      const result = await homebridge.request('/discover', {
        email,
        password: typeof config.password === 'string' ? config.password : '',
        config,
      });
      state.discovered = result;
      buildRows();
      render();
      const channels = state.rows.length;
      const monitors = result.devices.length;
      if (monitors === 0) {
        setStatus('Emporia returned no monitors for this account. Check that the Vue is online and paired in the Emporia app.', 'warning');
        return;
      }
      setStatus(
        `Found ${channels} channel${channels === 1 ? '' : 's'} on ${monitors} monitor${monitors === 1 ? '' : 's'}.`,
        'success',
      );
    } catch (error) {
      const message = errorText(error);
      if (auto) {
        setStatus(`${message} Enter your password below, then click Discover channels.`, 'warning');
      } else {
        setStatus(message, 'danger');
      }
    } finally {
      setLoading(false);
    }
  }

  /**
   * Retries discovery once the user has typed an email and password into the
   * schema form. Runs at most once per page load so a wrong password does not
   * turn into a retry loop.
   */
  function scheduleFirstDiscovery() {
    if (state.discovered || state.loading || autoAttempted) {
      return;
    }
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      const config = state.config;
      if (!config) {
        return;
      }
      const email = typeof config.email === 'string' ? config.email.trim() : '';
      const password = typeof config.password === 'string' ? config.password : '';
      if (!email.includes('@') || !password) {
        return;
      }
      autoAttempted = true;
      void discover({ auto: true });
    }, 800);
  }

  function relevantConfigKey(config) {
    if (!config) {
      return '';
    }
    return JSON.stringify({
      channels: config.channels || [],
      accessoryType: config.accessoryType || '',
      hideMains: config.hideMains === true,
    });
  }

  async function init() {
    byId('discover').addEventListener('click', () => {
      void discover();
    });

    try {
      const blocks = await homebridge.getPluginConfig();
      if (Array.isArray(blocks) && blocks.length > 0 && blocks[0]) {
        state.config = blocks[0];
      } else {
        state.config = {
          platform: 'EmporiaMatter',
          name: 'Emporia Matter',
        };
        await homebridge.updatePluginConfig([state.config]);
      }
    } catch {
      setStatus('Could not read the plugin configuration.', 'danger');
      return;
    }

    homebridge.showSchemaForm();

    window.homebridge.addEventListener('configChanged', (event) => {
      const blocks = event && event.data;
      if (!Array.isArray(blocks) || !blocks[0]) {
        return;
      }
      const before = relevantConfigKey(state.config);
      state.config = blocks[0];
      if (!state.discovered) {
        scheduleFirstDiscovery();
      } else if (before !== relevantConfigKey(state.config)) {
        buildRows();
        render();
      }
    });

    await discover({ auto: true });
  }

  void init();
})();
