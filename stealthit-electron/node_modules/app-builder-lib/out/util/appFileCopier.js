"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ELECTRON_COMPILE_SHIM_FILENAME = void 0;
exports.getDestinationPath = getDestinationPath;
exports.copyAppFiles = copyAppFiles;
exports.transformFiles = transformFiles;
exports.computeFileSets = computeFileSets;
exports.computeNodeModuleFileSets = computeNodeModuleFileSets;
exports.collectionMatchesAppDependencies = collectionMatchesAppDependencies;
exports.resolveFirstMatchingCollection = resolveFirstMatchingCollection;
exports.enforceAllowMissingDependencies = enforceAllowMissingDependencies;
exports.collectNodeModulesWithLogging = collectNodeModulesWithLogging;
const builder_util_1 = require("builder-util");
const fs_extra_1 = require("fs-extra");
const promises_1 = require("fs/promises");
const path = require("path");
const tiny_async_pool_1 = require("tiny-async-pool");
const unpackDetector_1 = require("../asar/unpackDetector");
const core_1 = require("../core");
const fileMatcher_1 = require("../fileMatcher");
const fileTransformer_1 = require("../fileTransformer");
const node_module_collector_1 = require("../node-module-collector");
const moduleManager_1 = require("../node-module-collector/moduleManager");
const AppFileWalker_1 = require("./AppFileWalker");
const NodeModuleCopyHelper_1 = require("./NodeModuleCopyHelper");
const BOWER_COMPONENTS_PATTERN = `${path.sep}bower_components${path.sep}`;
/** @internal */
exports.ELECTRON_COMPILE_SHIM_FILENAME = "__shim.js";
function getDestinationPath(file, fileSet) {
    if (file === fileSet.src) {
        return fileSet.destination;
    }
    const src = fileSet.src;
    const dest = fileSet.destination;
    // get node_modules path relative to src and then append to dest
    if (file.startsWith(src + path.sep)) {
        return path.join(dest, path.relative(src, file));
    }
    return dest;
}
async function copyAppFiles(fileSet, packager, transformer) {
    const metadata = fileSet.metadata;
    // search auto unpacked dir
    const taskManager = new builder_util_1.AsyncTaskManager(packager.cancellationToken);
    const createdParentDirs = new Set();
    const fileCopier = new builder_util_1.FileCopier(file => {
        return !(0, unpackDetector_1.isLibOrExe)(file);
    }, transformer);
    const links = [];
    for (let i = 0, n = fileSet.files.length; i < n; i++) {
        const sourceFile = fileSet.files[i];
        const stat = metadata.get(sourceFile);
        if (stat == null) {
            // dir
            continue;
        }
        const destinationFile = getDestinationPath(sourceFile, fileSet);
        if (stat.isSymbolicLink()) {
            links.push({ file: destinationFile, link: await (0, promises_1.readlink)(sourceFile) });
            continue;
        }
        const fileParent = path.dirname(destinationFile);
        if (!createdParentDirs.has(fileParent)) {
            createdParentDirs.add(fileParent);
            await (0, promises_1.mkdir)(fileParent, { recursive: true });
        }
        taskManager.addTask(fileCopier.copy(sourceFile, destinationFile, stat));
        if (taskManager.tasks.length > builder_util_1.MAX_FILE_REQUESTS) {
            await taskManager.awaitTasks();
        }
    }
    if (taskManager.tasks.length > 0) {
        await taskManager.awaitTasks();
    }
    await (0, tiny_async_pool_1.default)(builder_util_1.MAX_FILE_REQUESTS, links, it => (0, fs_extra_1.ensureSymlink)(it.link, it.file));
}
// used only for ASAR, if no asar, file transformed on the fly
async function transformFiles(transformer, fileSet) {
    if (transformer == null) {
        return;
    }
    let transformedFiles = fileSet.transformedFiles;
    if (fileSet.transformedFiles == null) {
        transformedFiles = new Map();
        fileSet.transformedFiles = transformedFiles;
    }
    const metadata = fileSet.metadata;
    const filesPromise = fileSet.files.map(async (it, index) => {
        const fileStat = metadata.get(it);
        if (fileStat == null || !fileStat.isFile()) {
            return;
        }
        const transformedValue = transformer(it);
        if (transformedValue == null) {
            return;
        }
        if (typeof transformedValue === "object" && "then" in transformedValue) {
            return transformedValue.then(it => {
                if (it != null) {
                    transformedFiles.set(index, it);
                }
                return;
            });
        }
        transformedFiles.set(index, transformedValue);
        return;
    });
    // `asyncPool` doesn't provide `index` in it's handler, so we `map` first before using it
    await (0, tiny_async_pool_1.default)(builder_util_1.MAX_FILE_REQUESTS, filesPromise, promise => promise);
}
async function computeFileSets(matchers, transformer, platformPackager, isElectronCompile) {
    const fileSets = [];
    const packager = platformPackager.info;
    for (const matcher of matchers) {
        const fileWalker = new AppFileWalker_1.AppFileWalker(matcher, packager);
        const fromStat = await (0, builder_util_1.statOrNull)(matcher.from);
        if (fromStat == null) {
            builder_util_1.log.debug({ directory: matcher.from, reason: "doesn't exist" }, `skipped copying`);
            continue;
        }
        const files = await (0, builder_util_1.walk)(matcher.from, fileWalker.filter, fileWalker);
        const metadata = fileWalker.metadata;
        fileSets.push(validateFileSet({ src: matcher.from, files, metadata, destination: matcher.to }));
    }
    if (isElectronCompile) {
        // cache files should be first (better IO)
        fileSets.unshift(await compileUsingElectronCompile(fileSets[0], packager));
    }
    return fileSets;
}
function getNodeModuleExcludedExts(platformPackager) {
    // do not exclude *.h files (https://github.com/electron-userland/electron-builder/issues/2852)
    const result = [".o", ".obj"].concat(fileMatcher_1.excludedExts.split(",").map(it => `.${it}`));
    if (platformPackager.config.includePdb !== true) {
        result.push(".pdb");
    }
    if (platformPackager.platform !== core_1.Platform.WINDOWS) {
        // https://github.com/electron-userland/electron-builder/issues/1738
        result.push(".dll");
        result.push(".exe");
    }
    return result;
}
function validateFileSet(fileSet) {
    if (fileSet.src == null || fileSet.src.length === 0) {
        throw new Error("fileset src is empty");
    }
    return fileSet;
}
/** @internal */
async function computeNodeModuleFileSets(platformPackager, mainMatcher) {
    const deps = await collectNodeModulesWithLogging(platformPackager);
    const nodeModuleExcludedExts = getNodeModuleExcludedExts(platformPackager);
    // serial execution because copyNodeModules is concurrent and so, no need to increase queue/pressure
    const result = new Array();
    let index = 0;
    const NODE_MODULES = "node_modules";
    const collectNodeModules = async (dep, destination) => {
        const source = dep.dir;
        const matcher = new fileMatcher_1.FileMatcher(source, destination, mainMatcher.macroExpander, mainMatcher.patterns);
        const copier = new NodeModuleCopyHelper_1.NodeModuleCopyHelper(matcher, platformPackager.info);
        const files = await copier.collectNodeModules(dep, nodeModuleExcludedExts, path.relative(mainMatcher.to, destination));
        result[index++] = validateFileSet({ src: source, destination, files, metadata: copier.metadata });
        builder_util_1.log.debug({ dep: dep.name, from: builder_util_1.log.filePath(source), to: builder_util_1.log.filePath(destination), filesCount: files.length }, "identified module");
        if (dep.dependencies) {
            for (const c of dep.dependencies) {
                await collectNodeModules(c, path.join(destination, NODE_MODULES, c.name));
            }
        }
    };
    for (const dep of deps) {
        const destination = path.join(mainMatcher.to, NODE_MODULES, dep.name);
        await collectNodeModules(dep, destination);
    }
    return result;
}
// `workspace:`/`file:`/`link:`/`portal:` dependencies are symlinked into place rather than
// installed as standalone, hoistable packages, so they may legitimately be absent from a
// collected tree and cannot be used to validate it.
const LOCAL_DEPENDENCY_SPEC = /^(?:workspace|file|link|portal):/;
/**
 * Determines whether a collected module tree actually describes the package being built.
 *
 * A package-manager `list` invocation can resolve to the wrong project root — most notably when
 * electron-builder is run from a workspace sub-package whose dependencies are hoisted to the
 * workspace root. In that case the collector returns a non-empty but unrelated tree. Accepting it
 * would suppress the manual-traversal fallback that resolves the correct modules, so we need to
 * tell a matching collection from a mismatched one.
 *
 * A collection matches when at least one of the package's declared external (registry-installed,
 * non-`workspace:`/`file:`/`link:`/`portal:`) production dependencies is present at the top level —
 * those direct dependencies are always hoisted to the top level of a correct collection. When the
 * package declares no external production dependencies there is nothing to validate against, so any
 * non-empty collection is accepted.
 */
function collectionMatchesAppDependencies(nodeModules, dependencies) {
    const requiredExternalDeps = Object.entries(dependencies !== null && dependencies !== void 0 ? dependencies : {})
        .filter(([, spec]) => !LOCAL_DEPENDENCY_SPEC.test(spec))
        .map(([name]) => name);
    if (requiredExternalDeps.length === 0) {
        return true;
    }
    const collected = new Set(nodeModules.map(it => it.name));
    return requiredExternalDeps.some(name => collected.has(name));
}
/**
 * Walks the candidate (package-manager, directory) combinations and returns the first collection
 * that both contains modules and matches the package being built (see
 * {@link collectionMatchesAppDependencies}). A non-empty collection that does NOT match — e.g. a
 * workspace-root tree returned for a sub-package — is retained only as a last-resort fallback so a
 * later approach (notably {@link PM.TRAVERSAL}) can supply the correct modules.
 *
 * An approach that throws (e.g. the package manager exited without producing its dependency tree,
 * issue #10208) is logged as a warning and skipped so the remaining approaches still run. If every
 * approach fails to produce a collection and at least one threw, the first error is rethrown rather
 * than silently reporting "no node modules".
 */
async function resolveFirstMatchingCollection(options) {
    var _a;
    const { pmApproaches, searchDirectories, dependencies, run } = options;
    let fallback;
    let firstError;
    for (const pm of pmApproaches) {
        for (const dir of searchDirectories) {
            builder_util_1.log.info({ pm, searchDir: dir }, "searching for node modules");
            let deps;
            try {
                deps = await run(pm, dir);
            }
            catch (error) {
                builder_util_1.log.warn({ pm, searchDir: dir, error: (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : String(error) }, "node module collection failed, trying next search directory/approach");
                firstError !== null && firstError !== void 0 ? firstError : (firstError = error instanceof Error ? error : new Error(String(error)));
                continue;
            }
            if (deps.nodeModules.length === 0) {
                builder_util_1.log.info({ pm, searchDir: dir }, "no node modules found in collection, trying next search directory");
                continue;
            }
            if (collectionMatchesAppDependencies(deps.nodeModules, dependencies)) {
                builder_util_1.log.debug({ pm, searchDir: dir, depCount: deps.nodeModules.length }, "collected node modules");
                return deps;
            }
            builder_util_1.log.info({ pm, searchDir: dir }, "collected node modules do not match the target package, trying next search directory/approach");
            fallback !== null && fallback !== void 0 ? fallback : (fallback = deps);
        }
    }
    if (fallback == null && firstError != null) {
        throw firstError;
    }
    return fallback;
}
/** Extracts the package name from a `name@version` log-summary entry, handling `@scope/name@version`. */
function dependencyNameFromSummaryId(id) {
    let at;
    if (id.startsWith("@")) {
        // Scoped package: the version separator is the first `@` after the scope's `/`
        const slashIndex = id.indexOf("/");
        if (slashIndex === -1) {
            return id;
        }
        at = id.indexOf("@", slashIndex + 1);
    }
    else {
        at = id.indexOf("@");
    }
    return at > 0 ? id.slice(0, at) : id;
}
/**
 * Enforces `allowMissingDependencies` against the finished collection summary (issue #10058).
 * Runs only after collection completes, so the error reports the COMPLETE set of missing
 * production dependencies at once instead of failing on the first one.
 *
 * v26 defaults to warn-only: `true` and omitted keep the historical warning behavior of the
 * stable 26.x line, while `false`/`null` fail the build on any missing production dependency
 * (the electron-builder 27+ default). When the option is a `string[]`, only the listed dependency
 * names are allowed to be missing — matched against the package name parsed from the summary's
 * `name@version` entries (scoped names included), with an exact-entry match accepted as well.
 *
 * Only genuinely missing production dependencies (`PKG_NOT_FOUND` / `PKG_NOT_ON_DISK`) are fatal;
 * missing optional dependencies (`PKG_OPTIONAL_NOT_INSTALLED` / `PKG_OPTIONAL_PLATFORM_NOT_INSTALLED`)
 * never fail the build.
 *
 * Exported for tests (an internal-tagged export would be stripped from the declarations the test
 * project consumes).
 */
function enforceAllowMissingDependencies(allowMissingDependencies, logSummary) {
    var _a, _b;
    // v26 default: omitted behaves like `true` (warn-only) so existing 26.x builds keep working.
    if (allowMissingDependencies === true || allowMissingDependencies === undefined) {
        return;
    }
    const missing = new Set([...((_a = logSummary === null || logSummary === void 0 ? void 0 : logSummary[moduleManager_1.LogMessageByKey.PKG_NOT_FOUND]) !== null && _a !== void 0 ? _a : []), ...((_b = logSummary === null || logSummary === void 0 ? void 0 : logSummary[moduleManager_1.LogMessageByKey.PKG_NOT_ON_DISK]) !== null && _b !== void 0 ? _b : [])]);
    const allowed = new Set(Array.isArray(allowMissingDependencies) ? allowMissingDependencies : []);
    const fatal = Array.from(missing)
        .filter(id => !allowed.has(dependencyNameFromSummaryId(id)) && !allowed.has(id))
        .sort();
    if (fatal.length === 0) {
        return;
    }
    throw new builder_util_1.InvalidConfigurationError(`The following production dependencies could not be resolved during node-module collection:\n` +
        fatal.map(id => `  - ${id}`).join("\n") +
        `\nInstall the missing dependencies, list names in \`allowMissingDependencies\` to allow specific ones to be missing, or set \`allowMissingDependencies\` to true to only warn.`);
}
/** Exported for tests (an internal-tagged export would be stripped from the declarations the test project consumes). */
async function collectNodeModulesWithLogging(platformPackager) {
    var _a, _b;
    const packager = platformPackager.info;
    const { tempDirManager, appDir, projectDir } = packager;
    const searchDirectories = Array.from(new Set([appDir, projectDir, await packager.getWorkspaceRoot()])).filter((it) => (0, builder_util_1.isEmptyOrSpaces)(it) === false);
    const pmApproaches = [await packager.getPackageManager(), node_module_collector_1.PM.TRAVERSAL];
    // Validate against the as-declared (pre-extraMetadata) production dependencies so a configured
    // `extraMetadata.dependencies` entry that isn't installed cannot reject a correct collection.
    const deps = await resolveFirstMatchingCollection({
        pmApproaches,
        searchDirectories,
        dependencies: packager.originalMetadata.dependencies,
        run: (pm, dir) => (0, node_module_collector_1.getCollectorByPackageManager)(pm, dir, tempDirManager).getNodeModules({ packageName: packager.nodePackageName }),
    });
    if (!((_a = deps === null || deps === void 0 ? void 0 : deps.nodeModules) === null || _a === void 0 ? void 0 : _a.length)) {
        builder_util_1.log.warn({ searchDirectories: searchDirectories.map(it => builder_util_1.log.filePath(it)) }, "no node modules returned while searching directories");
        return [];
    }
    const summary = Object.entries((_b = deps.logSummary) !== null && _b !== void 0 ? _b : {}).filter(([, dependencies]) => Array.isArray(dependencies) && dependencies.length > 0);
    for (const [errorMessage, dependencies] of summary) {
        const logLevel = moduleManager_1.logMessageLevelByKey[errorMessage] || "debug";
        builder_util_1.log[logLevel]({ dependencies }, errorMessage);
    }
    // Enforcement (issue #10058): collection is complete and the summary above has reached the log,
    // so failing here reports every missing production dependency at once.
    enforceAllowMissingDependencies(packager.config.allowMissingDependencies, deps.logSummary);
    return deps.nodeModules;
}
async function compileUsingElectronCompile(mainFileSet, packager) {
    builder_util_1.log.info("compiling using electron-compile");
    const electronCompileCache = await packager.tempDirManager.getTempDir({ prefix: "electron-compile-cache" });
    const cacheDir = path.join(electronCompileCache, ".cache");
    // clear and create cache dir
    await (0, promises_1.mkdir)(cacheDir, { recursive: true });
    const compilerHost = await (0, fileTransformer_1.createElectronCompilerHost)(mainFileSet.src, cacheDir);
    const nextSlashIndex = mainFileSet.src.length + 1;
    // pre-compute electron-compile to cache dir - we need to process only subdirectories, not direct files of app dir
    const filesPromise = mainFileSet.files.map(file => {
        if (file.includes(fileTransformer_1.NODE_MODULES_PATTERN) ||
            file.includes(BOWER_COMPONENTS_PATTERN) ||
            !file.includes(path.sep, nextSlashIndex) || // ignore not root files
            !mainFileSet.metadata.get(file).isFile()) {
            return;
        }
        return compilerHost.compile(file);
    });
    await (0, tiny_async_pool_1.default)(builder_util_1.MAX_FILE_REQUESTS, filesPromise, promise => promise);
    await compilerHost.saveConfiguration();
    const metadata = new Map();
    const cacheFiles = await (0, builder_util_1.walk)(cacheDir, file => !file.startsWith("."), {
        consume: (file, fileStat) => {
            if (fileStat.isFile()) {
                metadata.set(file, fileStat);
            }
            return null;
        },
    });
    // add shim
    const shimPath = `${mainFileSet.src}${path.sep}${exports.ELECTRON_COMPILE_SHIM_FILENAME}`;
    mainFileSet.files.push(shimPath);
    mainFileSet.metadata.set(shimPath, { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false });
    if (mainFileSet.transformedFiles == null) {
        mainFileSet.transformedFiles = new Map();
    }
    mainFileSet.transformedFiles.set(mainFileSet.files.length - 1, `
'use strict';
require('electron-compile').init(__dirname, require('path').resolve(__dirname, '${packager.metadata.main || "index"}'), true);
`);
    return { src: electronCompileCache, files: cacheFiles, metadata, destination: mainFileSet.destination };
}
//# sourceMappingURL=appFileCopier.js.map