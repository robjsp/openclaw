/**
 * Plugin runtime management.
 * Stores the OpenClaw runtime reference for use across the plugin.
 */

import type { RuntimeEnv } from "openclaw/plugin-sdk";

let runtime: RuntimeEnv | undefined;

export function setFirebaseRuntime(r: RuntimeEnv): void {
  runtime = r;
}

export function getFirebaseRuntime(): RuntimeEnv | undefined {
  return runtime;
}
