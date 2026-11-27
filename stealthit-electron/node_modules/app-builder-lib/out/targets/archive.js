"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tar = tar;
exports.shouldPreserveSymlinks = shouldPreserveSymlinks;
exports.compute7zCompressArgs = compute7zCompressArgs;
exports.archive = archive;
const builder_util_1 = require("builder-util");
const fs_extra_1 = require("fs-extra");
const path = require("path");
const tar_1 = require("tar");
const core_1 = require("../core");
const linux_1 = require("../toolsets/linux");
const _7zip_1 = require("../toolsets/7zip");
// Values accepted by ELECTRON_BUILDER_7Z_FILTER (passed through as `-mf=<value>`). "OFF" disables the
// branch/exec filter entirely (plain LZMA2); the rest are 7-Zip branch converters. 7za matches these
// case-insensitively, so the value is canonicalized to uppercase before use.
const ALLOWED_7Z_FILTERS = new Set(["OFF", "BCJ", "BCJ2", "ARM", "ARMT", "IA64", "PPC", "SPARC", "DELTA"]);
function validateCompressionLevel(level) {
    if (!/^[0-9]$/.test(level)) {
        throw new Error(`ELECTRON_BUILDER_COMPRESSION_LEVEL must be a single digit 0-9, got: "${level}"`);
    }
}
/** @internal */
async function tar({ compression, format, outFile, dirToArchive, isMacApp, tempDirManager }) {
    const tarFile = await tempDirManager.getTempFile({ suffix: ".tar" });
    const tarArgs = {
        file: tarFile,
        portable: true,
        cwd: dirToArchive,
        prefix: path.basename(outFile, `.${format}`),
    };
    let tarDirectory = ".";
    if (isMacApp) {
        delete tarArgs.prefix;
        tarArgs.cwd = path.dirname(dirToArchive);
        tarDirectory = path.basename(dirToArchive);
    }
    await Promise.all([
        (0, tar_1.create)(tarArgs, [tarDirectory]),
        // remove file before - 7z doesn't overwrite file, but update
        (0, builder_util_1.unlinkIfExists)(outFile),
    ]);
    if (format === "tar.lz") {
        const lzipPath = process.platform === "darwin" ? (await (0, linux_1.getLinuxToolsMacToolset)()).lzip : "lzip";
        await (0, builder_util_1.exec)(lzipPath, [compression === "store" ? "-1" : "-9", "--keep" /* keep (don't delete) input files */, tarFile]);
        // lzip creates the output file in the same directory as the input with a .lz suffix
        await (0, fs_extra_1.move)(`${tarFile}.lz`, outFile);
        return;
    }
    const compressFormat = format === "tar.xz" ? "xz" : format === "tar.bz2" ? "bzip2" : "gzip";
    const args = compute7zCompressArgs(compressFormat, { isRegularFile: true, method: "DEFAULT", compression });
    args.push(outFile, tarFile);
    await (0, builder_util_1.exec)(await (0, _7zip_1.getPath7za)(), args, { cwd: path.dirname(dirToArchive) }, builder_util_1.debug7z.enabled);
}
/**
 * Whether archives for the given target platform should preserve symlinks (i.e. pass `-snl`).
 * Non-Windows targets preserve them: macOS `.framework` bundles need them for codesigning (#9846)
 * and Linux bundles may legitimately contain them. Windows dereferences because restoring symlinks
 * there requires elevated privileges. Keyed on the target platform, not the build host.
 */
function shouldPreserveSymlinks(platform) {
    return platform !== core_1.Platform.WINDOWS;
}
/**
 * Builds the exclude switches for the given masks, rejecting any pattern that contains a path
 * traversal sequence. `prefix` is the tool-specific flag (`-xr!` for 7za, `-x` for native zip).
 */
function buildExcludeArgs(excluded, prefix) {
    if (excluded == null) {
        return [];
    }
    return excluded.map(mask => {
        if (mask.includes("..")) {
            throw new Error(`Excluded archive pattern contains path traversal sequence: "${mask}"`);
        }
        return `${prefix}${mask}`;
    });
}
function compute7zCompressArgs(format, options = {}) {
    let storeOnly = options.compression === "store";
    const args = debug7zArgs("a");
    const compressionLevel = process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL;
    if (compressionLevel != null) {
        validateCompressionLevel(compressionLevel);
        storeOnly = false; // env var overrides "store" config
        args.push(`-mx=${compressionLevel}`);
    }
    else if (storeOnly) {
        // -mx=0 is the universal "no compression" flag across all formats (zip, 7z, gzip, xz, bzip2).
        // -mm=Copy would only be valid for zip/7z and causes E_INVALIDARG on xz/gzip/bzip2.
        args.push("-mx=0");
    }
    else {
        const isZip = format === "zip";
        // ZIP uses level 7 by default; everything else (7z, gzip, xz, bzip2) uses level 9
        args.push("-mx=" + (isZip && options.compression !== "maximum" ? "7" : "9"));
        if (isZip && options.compression === "maximum") {
            // http://superuser.com/a/742034
            args.push("-mfb=258", "-mpass=15");
        }
    }
    if (options.dictSize != null) {
        args.push(`-md=${options.dictSize}m`);
    }
    // Disable NTFS timestamps for reproducible archives
    if (!options.isRegularFile) {
        args.push("-mtc=off");
    }
    if (format === "7z" || format.endsWith(".7z")) {
        if (options.solid === false) {
            args.push("-ms=off");
        }
        if (options.isArchiveHeaderCompressed === false) {
            args.push("-mhc=off");
        }
        // Branch/exec filter selection. installTimeDecodable archives are unpacked by the self-vendored
        // Nsis7z extractor, whose decoder only understands plain LZMA2/Copy and the single-stream BCJ
        // filter — not the CPU branch converters modern 7za auto-applies (BCJ2 on x86/x64, ARM64 on
        // arm64). So pin them to BCJ while compressing (the best filter that decoder can read; Copy
        // needs none) and do not honor ELECTRON_BUILDER_7Z_FILTER, which could reintroduce an unreadable
        // archive. Any other 7z archive may use ELECTRON_BUILDER_7Z_FILTER, else 7za's auto-selection.
        if (options.installTimeDecodable) {
            if (!storeOnly) {
                args.push("-mf=BCJ");
            }
        }
        else {
            const sevenZFilter = process.env.ELECTRON_BUILDER_7Z_FILTER;
            if (sevenZFilter) {
                const canonicalFilter = sevenZFilter.toUpperCase();
                if (!ALLOWED_7Z_FILTERS.has(canonicalFilter)) {
                    throw new Error(`ELECTRON_BUILDER_7Z_FILTER must be one of: ${[...ALLOWED_7Z_FILTERS].join(", ")}`);
                }
                args.push(`-mf=${canonicalFilter}`);
            }
        }
        args.push("-mtm=off", "-mta=off");
    }
    if (options.method != null && options.method !== "DEFAULT") {
        args.push(`-mm=${options.method}`);
    }
    else if (format === "zip") {
        // -mm is only set explicitly for zip (Deflate/Copy) and includes the UTF-8 flag.
        // For all other formats the codec is implicit from the output file extension.
        args.push(`-mm=${storeOnly ? "Copy" : "Deflate"}`);
        args.push("-mcu");
    }
    return args;
}
// 7z is very fast, so, use ultra compression
/** @internal */
async function archive(format, outFile, dirToArchive, options = {}) {
    var _a;
    const outFileStat = await (0, builder_util_1.statOrNull)(outFile);
    const dirStat = await (0, builder_util_1.statOrNull)(dirToArchive);
    if (outFileStat && dirStat && outFileStat.mtime > dirStat.mtime) {
        builder_util_1.log.info({ reason: "Archive file is up to date", outFile }, `skipped archiving`);
        return outFile;
    }
    // Use 7za for all formats (matches pre-26.15 behavior). Native macOS `zip` is only a
    // fallback for NFD-normalized filenames, which 7za mangles.
    let use7z = true;
    if (process.platform === "darwin" && format === "zip" && dirToArchive.normalize("NFC") !== dirToArchive) {
        builder_util_1.log.warn({ reason: "7z doesn't support NFD-normalized filenames" }, `using zip`);
        use7z = false;
    }
    // Resolve storedPaths before the main pass so they can be excluded from it. Member names are
    // native-separator, relative to the 7za cwd (which differs with withoutDir), so the same string
    // works as both the exact `-x!` exclude mask and the append argument.
    const storedMembers = [];
    for (const storedPath of (_a = options.storedPaths) !== null && _a !== void 0 ? _a : []) {
        if (storedPath.includes("..")) {
            throw new Error(`Stored archive path contains path traversal sequence: "${storedPath}"`);
        }
        if (await (0, builder_util_1.exists)(path.join(dirToArchive, storedPath))) {
            storedMembers.push(path.normalize(options.withoutDir ? storedPath : path.join(path.basename(dirToArchive), storedPath)));
        }
    }
    if (storedMembers.length > 0 && !use7z) {
        throw new Error("storedPaths is not supported with the native zip fallback");
    }
    if (use7z) {
        const args = compute7zCompressArgs(format, options);
        // Modern 7-Zip (24.09) dereferences symlinks by default; the 7-Zip 16.02 bundled before
        // 26.15 stored them as links. Without -snl, a macOS .framework `Versions/Current` extracts
        // as a real directory → codesign "bundle format is ambiguous" → breaks Squirrel.Mac
        // auto-update (#9846). Callers enable it for all non-Windows targets (see ArchiveTarget).
        if (options.preserveSymlinks) {
            args.push("-snl");
        }
        await (0, builder_util_1.unlinkIfExists)(outFile);
        args.push(outFile, options.withoutDir ? "." : path.basename(dirToArchive));
        args.push(...buildExcludeArgs(options.excluded, "-xr!"));
        // `-x!` (exact, non-recursive) so only the member itself is skipped, never a same-named sibling
        args.push(...storedMembers.map(member => `-x!${member}`));
        const cwd = options.withoutDir ? dirToArchive : path.dirname(dirToArchive);
        try {
            await (0, builder_util_1.exec)(await (0, _7zip_1.getPath7za)(), args, { cwd }, builder_util_1.debug7z.enabled);
        }
        catch (e) {
            if (e.code === "ENOENT" && !(await (0, builder_util_1.exists)(dirToArchive))) {
                throw new Error(`Cannot create archive: "${dirToArchive}" doesn't exist`);
            }
            else {
                throw e;
            }
        }
        if (storedMembers.length > 0) {
            // Second pass: append the stored members with no compression. -mx=0 unconditionally — the
            // compression-level env override must not reach these members (see storedPaths docs). The
            // main pass's symlink, timestamp, and header-compression flags are mirrored so the option
            // stays generic: the append rewrites the archive header and may itself store a symlink.
            const appendArgs = debug7zArgs("a");
            appendArgs.push("-mx=0");
            if (options.preserveSymlinks) {
                appendArgs.push("-snl");
            }
            if (!options.isRegularFile) {
                appendArgs.push("-mtc=off");
            }
            if (format === "7z" || format.endsWith(".7z")) {
                if (options.isArchiveHeaderCompressed === false) {
                    appendArgs.push("-mhc=off");
                }
                appendArgs.push("-mtm=off", "-mta=off");
            }
            else if (format === "zip") {
                appendArgs.push("-mm=Copy", "-mcu");
            }
            appendArgs.push(outFile, ...storedMembers);
            await (0, builder_util_1.exec)(await (0, _7zip_1.getPath7za)(), appendArgs, { cwd }, builder_util_1.debug7z.enabled);
        }
    }
    else {
        // macOS native zip (NFD fallback): -y preserves symlinks
        const args = ["-q", "-r", "-y"];
        if (builder_util_1.debug7z.enabled) {
            args.push("-v");
        }
        if (options.compression === "store") {
            args.push("-0");
        }
        else {
            args.push(options.compression === "maximum" ? "-9" : "-7");
        }
        await (0, builder_util_1.unlinkIfExists)(outFile);
        args.push(outFile, options.withoutDir ? "." : path.basename(dirToArchive));
        args.push(...buildExcludeArgs(options.excluded, "-x"));
        await (0, builder_util_1.exec)("zip", args, { cwd: options.withoutDir ? dirToArchive : path.dirname(dirToArchive) }, builder_util_1.debug7z.enabled);
    }
    return outFile;
}
function debug7zArgs(command) {
    const args = [command, "-bd"];
    if (builder_util_1.debug7z.enabled) {
        args.push("-bb");
    }
    return args;
}
//# sourceMappingURL=archive.js.map