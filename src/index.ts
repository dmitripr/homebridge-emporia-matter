import type { API } from 'homebridge';

import { EmporiaMatterPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

/**
 * Registers the platform with Homebridge.
 */
export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, EmporiaMatterPlatform);
};
