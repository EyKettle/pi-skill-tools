/**
 * Removing a skill or one of its related files.
 *
 * A skill's main document names the whole skill: removal takes the skill
 * directory and every file under it. A related-file id removes that one file.
 * The location must be writable before anything is deleted; the files list is
 * enumerated first, so a directory that cannot be read is not deleted blind.
 */
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { resolveSkillId } from "../discovery/skill-id";
import type { RegistryEntry } from "../discovery/types";
import {
	isSingleFileSkill,
	pathNotFound,
	writableLocation,
	writeFailed,
} from "./support";
import type { ManagementPorts, RemoveResult } from "./types";

export function removeSkill(
	ports: ManagementPorts,
	id: string,
): RemoveResult {
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
			return removeSingleFile(resolved.entry);
		}
		const directory = resolved.entry.baseDir;
		if (!existsSync(directory)) {
			return { ok: false, failure: pathNotFound(directory) };
		}
		const listed = ports.listFiles(directory);
		if (!listed.ok) {
			return { ok: false, failure: listed.failure };
		}
		try {
			rmSync(directory, { recursive: true, force: false });
		} catch (error) {
			return { ok: false, failure: writeFailed(directory, error) };
		}
		return { ok: true, kind: "skill", path: directory, files: listed.files };
	}

	const target = ports.resolveRef(resolved.entry.baseDir, resolved.refPath);
	if (!target.ok) {
		return { ok: false, failure: target.failure };
	}
	try {
		unlinkSync(target.path);
	} catch (error) {
		return { ok: false, failure: writeFailed(target.path, error) };
	}
	return { ok: true, kind: "file", path: target.path };
}

/** A single-file skill is removed as the one document it is. */
function removeSingleFile(entry: RegistryEntry): RemoveResult {
	if (!existsSync(entry.filePath)) {
		return { ok: false, failure: pathNotFound(entry.filePath) };
	}
	try {
		unlinkSync(entry.filePath);
	} catch (error) {
		return { ok: false, failure: writeFailed(entry.filePath, error) };
	}
	return { ok: true, kind: "file", path: entry.filePath };
}
