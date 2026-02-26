import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

type PluginCfg = {
  voiceServerUrl?: string;
  defaultDevice?: string;
  defaultMode?: "announce" | "conversation";
  timeoutSeconds?: number;
};

export function createPhoneCallTool(api: OpenClawPluginApi) {
  return {
    name: "phone-call",
    description:
      "Make an outbound phone call via the claude-phone voice server. " +
      "Use 'announce' mode to play a one-way message then hang up. " +
      "Use 'conversation' mode for a two-way AI voice conversation. " +
      "The 'to' field accepts E.164 phone numbers (+15551234567) or internal extensions (e.g. 12610).",

    parameters: Type.Object({
      to: Type.String({
        description: "Phone number or extension to call (E.164 like +15551234567, or internal extension like 12610).",
      }),
      message: Type.String({
        description:
          "What the device says when the call connects. For 'conversation' mode this is the opening line; for 'announce' mode it's the only message played.",
      }),
      mode: Type.Optional(
        Type.Union([Type.Literal("announce"), Type.Literal("conversation")], {
          description:
            "'announce' = play message then hang up. 'conversation' = stay on the line for a two-way AI voice conversation. Defaults to 'conversation'.",
        }),
      ),
      device: Type.Optional(
        Type.String({
          description:
            "Device extension or name to use as the caller (e.g. '12611' or VoiceBot). Uses plugin default if not specified.",
        }),
      ),
      context: Type.Optional(
        Type.String({
          description:
            "Background context passed to the AI during a conversation call — what the AI knows but doesn't say aloud (e.g. 'User is expecting a delivery today').",
        }),
      ),
      timeoutSeconds: Type.Optional(
        Type.Number({
          description: "How many seconds to wait for the call to be answered (5–120, default 30).",
        }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const pluginCfg = (api.pluginConfig ?? {}) as PluginCfg;

      const voiceServerUrl =
        (typeof pluginCfg.voiceServerUrl === "string" && pluginCfg.voiceServerUrl.trim()) ||
        "http://YOUR_SERVER_LAN_IP:3000";

      const to = typeof params.to === "string" ? params.to.trim() : "";
      if (!to) {
        throw new Error("'to' is required");
      }

      const message = typeof params.message === "string" ? params.message.trim() : "";
      if (!message) {
        throw new Error("'message' is required");
      }

      const mode =
        (typeof params.mode === "string" && (params.mode === "announce" || params.mode === "conversation")
          ? params.mode
          : null) ??
        pluginCfg.defaultMode ??
        "conversation";

      const device =
        (typeof params.device === "string" && params.device.trim()) ||
        (typeof pluginCfg.defaultDevice === "string" && pluginCfg.defaultDevice.trim()) ||
        undefined;

      const context =
        typeof params.context === "string" && params.context.trim()
          ? params.context.trim()
          : undefined;

      const timeoutSeconds =
        typeof params.timeoutSeconds === "number" && params.timeoutSeconds >= 5
          ? Math.min(Math.round(params.timeoutSeconds), 120)
          : typeof pluginCfg.timeoutSeconds === "number"
            ? pluginCfg.timeoutSeconds
            : 30;

      const body: Record<string, unknown> = {
        to,
        message,
        mode,
        timeoutSeconds,
      };
      if (device) body.device = device;
      if (context) body.context = context;

      let callId: string;
      let callStatus: string;

      // Initiate the call
      try {
        const response = await fetch(`${voiceServerUrl}/api/outbound-call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = (await response.json()) as {
          success: boolean;
          callId?: string;
          status?: string;
          error?: string;
          message?: string;
        };

        if (!response.ok || !data.success) {
          const errMsg = data.message ?? data.error ?? `HTTP ${response.status}`;
          throw new Error(`Voice server rejected call: ${errMsg}`);
        }

        callId = data.callId ?? "unknown";
        callStatus = data.status ?? "queued";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to initiate call: ${msg}`);
      }

      // For announce mode, poll briefly for final status (call is short-lived)
      if (mode === "announce") {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        try {
          const statusResp = await fetch(`${voiceServerUrl}/api/call/${callId}`);
          const statusData = (await statusResp.json()) as {
            success: boolean;
            data?: { state?: string; reason?: string };
          };
          if (statusData.success && statusData.data) {
            callStatus = statusData.data.state ?? callStatus;
          }
        } catch {
          // Status check is best-effort
        }
      }

      const summary =
        mode === "announce"
          ? `Called ${to} and played message. Final status: ${callStatus}.`
          : `Started conversation call to ${to}. Call ID: ${callId}. The AI voice agent is now handling the conversation.`;

      return {
        content: [{ type: "text", text: summary }],
        details: {
          callId,
          to,
          mode,
          device: device ?? null,
          status: callStatus,
          voiceServerUrl,
        },
      };
    },
  };
}
