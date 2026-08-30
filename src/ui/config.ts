// Compatibility entry point. Configuration ownership moved out of the UI;
// existing host imports keep working while new code depends on contracts or
// the runtime adapter directly.

export { Config } from '../runtime/config.ts'
