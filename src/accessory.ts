import type { API, MatterAccessory } from 'homebridge';

import type { AccessoryType } from './identity.js';
import { partIdForChannel } from './identity.js';

type MatterAccessoryPart = NonNullable<MatterAccessory['parts']>[number];
type ClusterState = NonNullable<MatterAccessory['clusters']>;

export interface ChannelSpec {
  channelId: string;
  displayName: string;
  accessoryType: AccessoryType;
  solar: boolean;
  nominalVoltage?: number;
}

export interface SplitAccessorySpec extends ChannelSpec {
  uuid: string;
  deviceGid: number;
  deviceId: string;
  model?: string;
  firmware?: string;
}

export interface GroupedAccessorySpec {
  uuid: string;
  displayName: string;
  deviceGid: number;
  deviceId: string;
  model?: string;
  firmware?: string;
  channels: ChannelSpec[];
}

function deviceTypeFor(api: API, type: AccessoryType) {
  const matter = api.matter;
  if (!matter) {
    throw new Error('Matter API is not available.');
  }
  switch (type) {
  case 'light':
    return matter.deviceTypes.OnOffLight;
  case 'switch':
    return matter.deviceTypes.OnOffSwitch;
  case 'outlet':
  default:
    return matter.deviceTypes.OnOffOutlet;
  }
}

function clustersFor(spec: ChannelSpec): ClusterState {
  const power: Record<string, unknown> = { activePower: 0 };
  if (spec.nominalVoltage !== undefined) {
    power.voltage = Math.round(spec.nominalVoltage * 1000);
    power.activeCurrent = 0;
  }

  const energy: Record<string, unknown> = {
    cumulativeEnergyImported: { energy: 0 },
  };
  if (spec.solar) {
    energy.cumulativeEnergyExported = { energy: 0 };
  }

  return {
    onOff: { onOff: true },
    electricalPowerMeasurement: power,
    electricalEnergyMeasurement: energy,
  } as ClusterState;
}

/**
 * The tile switch is cosmetic: this accessory measures a circuit, it does not
 * control one. Accept the command and immediately restore "on" so the tile
 * does not appear to switch off.
 */
function handlersFor(api: API, uuid: string, partId?: string) {
  const keepOn = async (): Promise<void> => {
    try {
      await api.matter?.updateAccessoryState(uuid, 'onOff', { onOff: true }, partId);
    } catch {
      // The accessory may be unregistering; there is nothing useful to do.
    }
  };
  return { onOff: { on: keepOn, off: keepOn, toggle: keepOn } };
}

export function buildSplitAccessory(api: API, spec: SplitAccessorySpec): MatterAccessory {
  const accessory: MatterAccessory = {
    UUID: spec.uuid,
    displayName: spec.displayName,
    deviceType: deviceTypeFor(api, spec.accessoryType),
    serialNumber: `${spec.deviceId}-${spec.channelId}`,
    manufacturer: 'Emporia',
    model: spec.model ?? 'Emporia Vue',
    firmwareRevision: spec.firmware ?? '1.0.0',
    context: {
      deviceGid: spec.deviceGid,
      channelId: spec.channelId,
      accessoryType: spec.accessoryType,
      solar: spec.solar,
    },
    clusters: clustersFor(spec),
    handlers: handlersFor(api, spec.uuid),
  };
  return accessory;
}

export function buildGroupedAccessory(api: API, spec: GroupedAccessorySpec): MatterAccessory {
  const matter = api.matter;
  if (!matter) {
    throw new Error('Matter API is not available.');
  }

  const parts: MatterAccessoryPart[] = spec.channels.map((channel) => {
    const partId = partIdForChannel(channel.channelId);
    return {
      id: partId,
      displayName: channel.displayName,
      deviceType: deviceTypeFor(api, channel.accessoryType),
      clusters: clustersFor(channel),
      handlers: handlersFor(api, spec.uuid, partId),
    };
  });

  return {
    UUID: spec.uuid,
    displayName: spec.displayName,
    deviceType: matter.deviceTypes.BridgedNode,
    serialNumber: spec.deviceId,
    manufacturer: 'Emporia',
    model: spec.model ?? 'Emporia Vue',
    firmwareRevision: spec.firmware ?? '1.0.0',
    context: {
      deviceGid: spec.deviceGid,
      grouped: true,
      channels: spec.channels.map((channel) => channel.channelId),
    },
    parts,
  };
}
