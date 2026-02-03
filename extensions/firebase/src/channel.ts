/**
 * Firebase channel plugin implementation.
 * This plugin enables OpenClaw to work with the Grio Firebase platform.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ChannelPlugin,
  ChannelGatewayContext,
  ChannelAccountSnapshot,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk";

import type { FirebaseResolvedAccount } from "./types.js";
import { handleFirebaseWebhookRequest } from "./monitor.js";

/**
 * Wrapper that adapts the boolean-returning handler to void-returning
 * for use with registerPluginHttpRoute.
 */
async function webhookRouteHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await handleFirebaseWebhookRequest(req, res);
}

/**
 * Firebase channel configuration in OpenClaw config.
 */
interface FirebaseChannelConfig {
  enabled?: boolean;
  appServerUrl?: string;
  llmProxyUrl?: string;
}

/**
 * Get Firebase config from OpenClaw config.
 */
function getFirebaseConfig(cfg: OpenClawConfig): FirebaseChannelConfig | undefined {
  return (cfg.channels as Record<string, FirebaseChannelConfig> | undefined)?.firebase;
}

/**
 * Firebase channel plugin definition.
 */
export const firebasePlugin: ChannelPlugin<FirebaseResolvedAccount> = {
  id: "firebase",

  meta: {
    id: "firebase",
    label: "Firebase",
    selectionLabel: "Firebase (Grio)",
    docsPath: "/channels/firebase",
    docsLabel: "firebase",
    blurb: "Grio Firebase messaging channel for AI assistants",
  },

  capabilities: {
    chatTypes: ["direct"], // Firebase only supports direct messages
    media: false,
    reactions: false,
    threads: false,
  },

  config: {
    listAccountIds: (_cfg: OpenClawConfig): string[] => {
      // Firebase plugin uses a single "default" account
      return ["default"];
    },

    resolveAccount: (
      cfg: OpenClawConfig,
      accountId?: string | null,
    ): FirebaseResolvedAccount => {
      const firebaseConfig = getFirebaseConfig(cfg);
      const resolved: FirebaseResolvedAccount = {
        accountId: accountId ?? "default",
        enabled: firebaseConfig?.enabled !== false,
        configured: Boolean(
          process.env.VM_INTERNAL_SECRET && process.env.LLM_PROXY_API_KEY,
        ),
        appServerUrl: firebaseConfig?.appServerUrl || process.env.APP_SERVER_URL,
        llmProxyUrl: firebaseConfig?.llmProxyUrl || process.env.LLM_PROXY_URL,
      };
      return resolved;
    },

    setAccountEnabled: ({
      cfg,
      accountId: _accountId,
      enabled,
    }: {
      cfg: OpenClawConfig;
      accountId: string;
      enabled: boolean;
    }): OpenClawConfig => {
      const channels = (cfg.channels || {}) as Record<string, FirebaseChannelConfig>;
      return {
        ...cfg,
        channels: {
          ...channels,
          firebase: {
            ...channels.firebase,
            enabled,
          },
        },
      };
    },

    isConfigured: (account: FirebaseResolvedAccount): boolean => {
      return account.configured;
    },

    isEnabled: (account: FirebaseResolvedAccount): boolean => {
      return account.enabled;
    },
  },

  gateway: {
    startAccount: async (
      ctx: ChannelGatewayContext<FirebaseResolvedAccount>,
    ): Promise<() => void> => {
      const { accountId, account, log } = ctx;

      log?.info(`[Firebase] Starting webhook handler for account ${accountId}`);

      // Check if properly configured
      if (!account.configured) {
        log?.warn(
          `[Firebase] Account ${accountId} not configured - missing VM_INTERNAL_SECRET or LLM_PROXY_API_KEY`,
        );
      }

      // Register the HTTP webhook handler
      const unregister = registerPluginHttpRoute({
        path: "/api/message",
        handler: webhookRouteHandler,
        pluginId: "firebase",
        accountId,
      });

      // Update status
      ctx.setStatus({
        accountId,
        running: true,
        lastStartAt: Date.now(),
        webhookPath: "/api/message",
      } as ChannelAccountSnapshot);

      log?.info(`[Firebase] Webhook handler registered at /api/message`);

      // Return cleanup function
      return () => {
        log?.info(`[Firebase] Stopping webhook handler for account ${accountId}`);
        unregister();
        ctx.setStatus({
          accountId,
          running: false,
          lastStopAt: Date.now(),
        } as ChannelAccountSnapshot);
      };
    },
  },

  status: {
    buildChannelSummary: async ({ account, snapshot }) => {
      return {
        accountId: account.accountId,
        configured: account.configured,
        enabled: account.enabled,
        running: snapshot.running ?? false,
      };
    },
  },
};
