/**
 * Centralized accessor for `@earendil-works/pi-tui`.
 *
 * One accessor per upstream package. Named re-exports only, never
 * `export *`: a wildcard re-export leaves the namespace undefined at
 * runtime when the package is kept external (pi-lens
 * `clients/deps/pi-tui.js`).
 *
 * The bare specifier resolves for tsc and vitest from this package's
 * `node_modules`, and for a live Pi load through the host jiti alias.
 * Bindings are the ones this tree actually imports. `index.ts` keeps
 * its own `await import("@earendil-works/pi-tui")` so the running
 * extension shares the host TUI instance rather than a vendored copy.
 */
export {
	Box,
	Container,
	Text,
	sliceByColumn,
	visibleWidth,
} from "@earendil-works/pi-tui";
