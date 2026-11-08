import { EmporiaMatterPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';
/**
 * Registers the platform with Homebridge.
 */
export default (api) => {
    api.registerPlatform(PLATFORM_NAME, EmporiaMatterPlatform);
};
//# sourceMappingURL=index.js.map