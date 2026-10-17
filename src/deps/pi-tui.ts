/**
 * Centralized accessor for `@earendil-works/pi-tui`.
 *
 * One accessor per upstream package, named re-exports only — never
 * `export *`: with the package kept external, a wildcard re-export leaves the
 * namespace undefined at runtime. The bare specifier resolves through the
 * host's alias in a live Pi load and through this package's `node_modules`
 * for tsc and vitest.
 */
export {
	Box,
	Container,
	Text,
	sliceByColumn,
	visibleWidth,
} from "@earendil-works/pi-tui";

/**
 * The component contract every injected node and every product handed back to
 * pi must satisfy. `invalidate` is not optional: pi's alt screen walks
 * `this.children` and calls `child.invalidate()` unguarded
 * (pi-tui 1.3.0 tui-alt-screen.js:90), so a product implementing only
 * `render` takes the process down on a whole-tree invalidation.
 */
export interface PiComponent {
	render(width: number): string[];
	invalidate(): void;
}
