/**
 * Renaming a skill or one of its related files.
 *
 * A skill keeps its location and changes its name: the skill directory moves
 * to `<location>/<new name>`, every file under it included. A related file
 * changes its basename inside the type directory it already lives in. In both
 * cases the move never lands on an existing target, and a read-only location
 * refuses the operation before anything moves.
 */
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { isSkillName, resolveSkillId } from "../discovery/skill-id";
import type { RegistryEntry, RegistryLocation } from "../discovery/types";
import { createFailure } from "../failure/create";
import type { Failure } from "../failure/types";
import {
	isFileName,
	isSingleFileSkill,
	sameSkill,
	targetExistsId,
	targetExistsPath,
	writeFailed,
	writableLocation,
} from "./support";
import type { ManagementPorts, RenameResult } from "./types";

export function renameSkill(
	ports: ManagementPorts,
	id: string,
	name: string,
): RenameResult {
	const resolved = resolveSkillId(ports.index, id);
	if (!resolved.ok) {
		return { ok: false, failure: resolved.failure };
	}
	const check = writableLocation(ports.index, resolved.entry.location);
	if (!check.ok) {
		return { ok: false, failure: check.failure };
	}
	if (resolved.refPath === undefined) {
		if (isSingleFileSkill(resolved.entry)) {
			return renameSingleFile(ports, resolved.entry, name);
		}
		return renameDirectory(ports, check.location, resolved.entry, name);
	}
	return renameFile(ports, resolved.entry, resolved.refPath, name);
}

/** The target a rename proposes: the name it asks for and where that lands. */
interface RenameTarget {
	readonly name: string;
	readonly path: string;
}

/** The guards both renames share: a legal name and a free target. */
function renameGuard(
	ports: ManagementPorts,
	entry: RegistryEntry,
	target: RenameTarget,
): Failure | undefined {
	if (!isSkillName(target.name)) {
		return createFailure("ID_NAME_INVALID", {
			kind: "input",
			input: target.name,
		});
	}
	const clash = ports.index.entries.find(
		(candidate) =>
			candidate.name === target.name &&
			!sameSkill(candidate, entry.location, entry.name),
	);
	if (clash !== undefined) {
		return targetExistsId(clash.id);
	}
	if (existsSync(target.path)) {
		return targetExistsPath(target.path);
	}
	return undefined;
}

/** The move itself; the caller reports what it enumerated beforehand. */
function move(from: string, to: string): Failure | undefined {
	try {
		renameSync(from, to);
	} catch (error) {
		return writeFailed(to, error);
	}
	return undefined;
}

/** A single-file skill changes its basename inside the directory it lives in. */
function renameSingleFile(
	ports: ManagementPorts,
	entry: RegistryEntry,
	name: string,
): RenameResult {
	const from = entry.filePath;
	const to = path.join(path.dirname(from), `${name}.md`);
	const blocked = renameGuard(ports, entry, { name, path: to });
	if (blocked !== undefined) {
		return { ok: false, failure: blocked };
	}
	const failed = move(from, to);
	if (failed !== undefined) {
		return { ok: false, failure: failed };
	}
	return { ok: true, kind: "file", from, to };
}

function renameDirectory(
	ports: ManagementPorts,
	location: RegistryLocation & { path: string },
	entry: RegistryEntry,
	name: string,
): RenameResult {
	const from = entry.baseDir;
	const to = path.join(location.path, name);
	const blocked = renameGuard(ports, entry, { name, path: to });
	if (blocked !== undefined) {
		return { ok: false, failure: blocked };
	}
	// Enumerate before the move: the files list is part of the report, and a
	// failed enumeration must stop the move, not follow it.
	const listed = ports.listFiles(from);
	if (!listed.ok) {
		return { ok: false, failure: listed.failure };
	}
	const failed = move(from, to);
	if (failed !== undefined) {
		return { ok: false, failure: failed };
	}
	return {
		ok: true,
		kind: "skill",
		from,
		to,
		files: listed.files.map((file) => ({
			from: file,
			to: path.join(to, path.relative(from, file)),
		})),
	};
}

function renameFile(
	ports: ManagementPorts,
	entry: RegistryEntry,
	refPath: string,
	name: string,
): RenameResult {
	if (!isFileName(name)) {
		return {
			ok: false,
			failure: createFailure("REF_PATH_INVALID", {
				kind: "input",
				input: name,
			}),
		};
	}
	const source = ports.resolveRef(entry.baseDir, refPath);
	if (!source.ok) {
		return { ok: false, failure: source.failure };
	}
	const to = path.join(path.dirname(source.path), name);
	if (existsSync(to)) {
		return { ok: false, failure: targetExistsPath(to) };
	}
	// The check and the move are not one atomic step: POSIX `rename` replaces
	// an existing target silently, and no portable exclusive rename exists.
	// A target that appears in this window is overwritten; accepted.
	try {
		renameSync(source.path, to);
	} catch (error) {
		return { ok: false, failure: writeFailed(to, error) };
	}
	return { ok: true, kind: "file", from: source.path, to };
}
