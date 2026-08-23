/**
 * Test-only accessor for a real Pi `Theme`. Production never imports
 * this file: render functions receive `theme` from Pi
 * (`docs/extensions.md` § Theme Colors).
 *
 * Public entry exports `Theme`, `ThemeColor`, and `initTheme`.
 * `initTheme` returns void and writes a process-global the public
 * entry does not expose. `getThemeByName` is not public. Tests
 * therefore construct `Theme` with a fixture of the documented
 * tokens so ANSI generation stays real.
 *
 * Named exports only, never `export *`.
 */
import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";

type RequiredFg = Exclude<ThemeColor, "thinkingMax" | "searchMatchText">;
type RequiredBg =
	| "selectedBg"
	| "userMessageBg"
	| "customMessageBg"
	| "toolPendingBg"
	| "toolSuccessBg"
	| "toolErrorBg";

export type TestThemeKind = "dark" | "light";

function foreground(kind: TestThemeKind): Record<RequiredFg, string> {
	const text = kind === "dark" ? "#d4d4d4" : "#1f2328";
	const muted = kind === "dark" ? "#808080" : "#6c6c6c";
	const dim = kind === "dark" ? "#666666" : "#767676";
	const accent = kind === "dark" ? "#8abeb7" : "#5a8080";
	const success = kind === "dark" ? "#b5bd68" : "#588458";
	const error = kind === "dark" ? "#cc6666" : "#aa5555";
	const warning = kind === "dark" ? "#ffff00" : "#9a7326";
	const border = kind === "dark" ? "#5f87ff" : "#547da7";
	const label = kind === "dark" ? "#9575cd" : "#7e57c2";
	return {
		accent,
		border,
		borderAccent: accent,
		borderMuted: dim,
		success,
		error,
		warning,
		muted,
		dim,
		text,
		thinkingText: muted,
		userMessageText: text,
		customMessageText: text,
		customMessageLabel: label,
		toolTitle: text,
		toolOutput: muted,
		mdHeading: warning,
		mdLink: border,
		mdLinkUrl: dim,
		mdCode: accent,
		mdCodeBlock: success,
		mdCodeBlockBorder: muted,
		mdQuote: muted,
		mdQuoteBorder: muted,
		mdHr: muted,
		mdListBullet: accent,
		toolDiffAdded: success,
		toolDiffRemoved: error,
		toolDiffContext: muted,
		syntaxComment: dim,
		syntaxKeyword: border,
		syntaxFunction: warning,
		syntaxVariable: accent,
		syntaxString: error,
		syntaxNumber: success,
		syntaxType: accent,
		syntaxOperator: text,
		syntaxPunctuation: text,
		thinkingOff: dim,
		thinkingMinimal: dim,
		thinkingLow: border,
		thinkingMedium: accent,
		thinkingHigh: label,
		thinkingXhigh: label,
		bashMode: success,
	};
}

function background(kind: TestThemeKind): Record<RequiredBg, string> {
	if (kind === "dark") {
		return {
			selectedBg: "#3a3a4a",
			userMessageBg: "#343541",
			customMessageBg: "#2d2838",
			toolPendingBg: "#282832",
			toolSuccessBg: "#283228",
			toolErrorBg: "#3c2828",
		};
	}
	return {
		selectedBg: "#d0d0e0",
		userMessageBg: "#e8e8e8",
		customMessageBg: "#ede7f6",
		toolPendingBg: "#e8e8f0",
		toolSuccessBg: "#e8f0e8",
		toolErrorBg: "#f0e8e8",
	};
}

/** Real `Theme` instance. `dark` and `light` differ so restyle assertions can see a change. */
export function testTheme(kind: TestThemeKind): Theme {
	return new Theme(foreground(kind), background(kind), "truecolor", {
		name: kind,
	});
}
