import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Point SWITCHBOARD_HOME at a fresh temp dir. Call before importing modules that read config. */
export function tempHome(prefix = 'switchboard-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.SWITCHBOARD_HOME = dir;
  return dir;
}

export function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold SQLite files briefly; leaving temp dirs is acceptable in tests.
  }
}
