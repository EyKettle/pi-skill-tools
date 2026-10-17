/**
 * Skill creation.
 *
 * The content is written verbatim — frontmatter included, nothing generated.
 * A main document becomes `<location>/<name>/SKILL.md`; a related file becomes
 * a file under an existing skill's directory, and the reference must stay
 * inside that directory (the containment rule reaches this module through the
 * port).
 *
 * Creation never overwrites: a name the index already holds anywhere, or a
 * target that already exists on disk, is a conflict. The write itself is
 * atomic and exclusive — a same-directory temporary file, a hard link that
 * fails if the target appeared meanwhile, then a read-back comparison.
 */
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatSkillId, parseSkillId, resolveSkillId } from "../discovery/skill-id";
import type { RegistryLocation } from "../discovery/types";
import type { Failure } from "../failure/types";
import {
	countLines,
	targetExistsId,
	targetExistsPath,
	writeFailed,
	writableLocation,
} from "./support";
import type { CreateResult, ManagementPorts } from "./types";

let tempCounter = 0;

export function createSkill(
	ports: ManagementPorts,
	id: string,
	content: string,
): CreateResult {
	const index = ports.index;
	const parsed = parseSkillId(
		id,
		index.locations.map((location) => location.id),
	);
	if (!parsed.ok) {
		return { ok: false, failure: parsed.failure };
	}

	const check = writableLocation(
		index,
		parsed.value.location ?? ports.defaultLocation,
	);
	if (!check.ok) {
		return { ok: false, failure: check.failure };
	}
	const location = check.location;

	if (parsed.value.refPath === undefined) {
		return createMainDocument(ports, location, parsed.value.name, content);
	}
	return createRelatedFile(
		ports,
		location,
		parsed.value.name,
		parsed.value.refPath,
		content,
	);
}

function createMainDocument(
	ports: ManagementPorts,
	location: RegistryLocation & { path: string },
	name: string,
	content: string,
): CreateResult {
	const clash = ports.index.entries.find((entry) => entry.name === name);
	if (clash !== undefined) {
		return { ok: false, failure: targetExistsId(clash.id) };
	}
	const skillDir = path.join(location.path, name);
	if (existsSync(skillDir)) {
		return { ok: false, failure: targetExistsPath(skillDir) };
	}
	return writeNew(path.join(skillDir, "SKILL.md"), content);
}

/** A related file needs its skill: the reference is resolved against it. */
function createRelatedFile(
	ports: ManagementPorts,
	location: RegistryLocation & { path: string },
	name: string,
	refPath: string,
	content: string,
): CreateResult {
	const resolved = resolveSkillId(ports.index, formatSkillId(location.id, name));
	if (!resolved.ok) {
		return { ok: false, failure: resolved.failure };
	}
	const probe = ports.resolveRef(resolved.entry.baseDir, refPath);
	if (probe.ok) {
		return { ok: false, failure: targetExistsPath(probe.path) };
	}
	// A contained, missing target is exactly the free path creation needs.
	if (probe.failure.code !== "PATH_NOT_FOUND") {
		return { ok: false, failure: probe.failure };
	}
	const target = path.resolve(resolved.entry.baseDir, refPath);
	return writeNew(target, content);
}

/**
 * Write a new file without ever replacing one: the temporary file and the
 * target share a directory, and `link` fails if the target appeared between
 * the conflict check and the write.
 */
function writeNew(target: string, content: string): CreateResult {
	const directory = path.dirname(target);
	const temp = path.join(
		directory,
		`.${path.basename(target)}.tmp-${process.pid}-${tempCounter++}`,
	);

	try {
		mkdirSync(directory, { recursive: true });
		writeFileSync(temp, content);
	} catch (error) {
		removeQuietly(temp);
		return { ok: false, failure: writeFailed(target, error) };
	}

	try {
		linkSync(temp, target);
	} catch (error) {
		removeQuietly(temp);
		return {
			ok: false,
			failure:
				(error as NodeJS.ErrnoException | null)?.code === "EEXIST"
					? targetExistsPath(target)
					: writeFailed(target, error),
		};
	}
	removeQuietly(temp);

	if (!roundTrips(target, content)) {
		removeQuietly(target);
		return {
			ok: false,
			failure: writeFailed(
				target,
				new Error("the written file did not round-trip"),
			),
		};
	}
	return {
		ok: true,
		path: target,
		bytes: Buffer.byteLength(content, "utf8"),
		lines: countLines(content),
	};
}

function roundTrips(target: string, content: string): boolean {
	try {
		return readFileSync(target, "utf8") === content;
	} catch {
		return false;
	}
}

function removeQuietly(target: string): void {
	try {
		rmSync(target, { force: true });
	} catch {
		// best effort: a leftover temp file never blocks the operation
	}
}
