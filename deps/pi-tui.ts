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

/**
 * The pi-tui `Component` contract: what every injected node and every product
 * handed back to pi must satisfy. `invalidate` is not optional — pi's
 * `MouseRegion` calls `child.invalidate()` without a guard (pi-tui 0.85.1
 * components/mouse-region.ts:31), so a product implementing only `render`
 * takes the process down on any whole-tree invalidation (exit, `/reload`, or
 * a fullscreen mode switch) and leaves the persisted session unresumable.
 */
export interface PiComponent {
	render(width: number): string[];
	invalidate(): void;
}
