import { execSync } from 'node:child_process';
export const COMMIT = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'unknown'; }
})();
export const BRANCH = (() => {
  try { return execSync('git rev-parse --abbrev-ref HEAD').toString().trim(); } catch { return 'unknown'; }
})();
export const BUILT_AT = new Date().toISOString();
