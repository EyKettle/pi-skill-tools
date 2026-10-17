/**
 * Accessor for the theme surface of `@earendil-works/pi-coding-agent`.
 *
 * Production never constructs a theme: render functions receive the painted
 * role function by injection. `Theme` and the role types are re-exported for
 * the test fixture under `tests/support/`, which builds a real theme so ANSI
 * generation stays real.
 *
 * Named exports only, never `export *`.
 */
import {
	Theme,
	type ThemeBg,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";

export { Theme, type ThemeBg, type ThemeColor };

/**
 * The painted-role function a render path receives: `theme.fg` reduced to the
 * one operation the channel uses. Derived from `Theme`, so an upstream rename
 * fails compilation.
 */
export type ThemeFg = Theme["fg"];
