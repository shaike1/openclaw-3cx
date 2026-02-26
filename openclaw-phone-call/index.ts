import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { createPhoneCallTool } from "./src/phone-call-tool.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(createPhoneCallTool(api), { optional: true });
}
