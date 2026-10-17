/**
 * The extension's entry: wire the plugin to the host and nothing else.
 *
 * Everything the extension does lives under `src/`; this file exists because
 * the host loads a default export from the package root.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPlugin } from "./src/plugin/plugin";

export default async function (pi: ExtensionAPI): Promise<void> {
	await createPlugin(pi);
}
