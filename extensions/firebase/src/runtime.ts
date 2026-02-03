/**
 * Firebase plugin runtime singleton.
 * Provides access to OpenClaw's runtime services for the Firebase plugin.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

/**
 * Set the Firebase plugin runtime.
 * Called by OpenClaw during plugin initialization.
 */
export function setFirebaseRuntime(next: PluginRuntime): void {
  runtime = next;
}

/**
 * Get the Firebase plugin runtime.
 * Throws if runtime has not been initialized.
 */
export function getFirebaseRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Firebase runtime not initialized - plugin may not be properly loaded");
  }
  return runtime;
}

/**
 * Check if runtime is available.
 */
export function hasFirebaseRuntime(): boolean {
  return runtime !== null;
}
