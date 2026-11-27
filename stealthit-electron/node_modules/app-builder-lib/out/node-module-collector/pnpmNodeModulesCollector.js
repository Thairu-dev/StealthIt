"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PnpmNodeModulesCollector = void 0;
const fs = require("fs-extra");
const lazy_val_1 = require("lazy-val");
const path = require("path");
const moduleManager_1 = require("./moduleManager");
const nodeModulesCollector_1 = require("./nodeModulesCollector");
const packageManager_1 = require("./packageManager");
const builder_util_1 = require("builder-util");
class PnpmNodeModulesCollector extends nodeModulesCollector_1.NodeModulesCollector {
    constructor() {
        super(...arguments);
        this.installOptions = {
            manager: packageManager_1.PM.PNPM,
            lockfile: "pnpm-lock.yaml",
        };
        // Raw backing field — all entries from `pnpm list --json`
        this._allWorkspacePackages = [];
        // Cached after parseDependenciesTree resolves the Lazy; 0 = safe default (treated as < v11)
        this._pnpmMajorVersion = 0;
        // Runs `pnpm --version` once and caches the major version number
        this.pnpmVersion = new lazy_val_1.Lazy(async () => {
            var _a;
            const result = await this.asyncExec((0, packageManager_1.getPackageManagerCommand)(packageManager_1.PM.PNPM), ["--version"]);
            const major = parseInt(((_a = result.stdout) !== null && _a !== void 0 ? _a : "0").split(".")[0], 10);
            return isNaN(major) ? 0 : major;
        });
        /**
         * Detect pnpm's installed layout from the on-disk structure rather than `pnpm config list`.
         * pnpm 11 no longer echoes `node-linker` (from `.npmrc`) in `config list`, so the base-class
         * config-parsing detection silently reports "not hoisted" for a hoisted install, which would
         * disable the downward search needed to find version-conflicted nested deps.
         *
         * In the default isolated store every regular top-level package resolves — through a symlink
         * on POSIX, a junction on Windows — into `node_modules/.pnpm/<name>@<ver>/node_modules/<name>`.
         * In a hoisted layout the same package is a real directory directly under `node_modules`.
         * `realpath` transparently follows both symlinks and junctions, so a layout is isolated iff
         * *any* top-level package's real path routes through `.pnpm`. We scan rather than sample the
         * first entry because `link:` packages resolve to their source (never under `.pnpm`) and could
         * otherwise mask an isolated store.
         */
        this.isHoisted = new lazy_val_1.Lazy(async () => {
            // A workspace package's own `node_modules` is often absent (or holds only its version
            // conflicts) in a hoisted workspace, so fall back to the workspace root's `node_modules`.
            let sawPackage = false;
            for (const dir of await this.layoutRoots.value) {
                const isolated = await this.scanNodeModulesLayout(path.join(dir, "node_modules"));
                if (isolated != null) {
                    if (isolated) {
                        return false;
                    }
                    sawPackage = true;
                }
            }
            // Packages exist and none route through `.pnpm` → hoisted. No packages → flat default.
            return sawPackage;
        });
        /**
         * The pnpm workspace root containing `rootDir` (nearest ancestor with `pnpm-workspace.yaml`, as pnpm
         * itself resolves it), or null outside a workspace or when `rootDir` is the workspace root.
         */
        this.workspaceRoot = new lazy_val_1.Lazy(async () => {
            let current = path.resolve(this.rootDir);
            while (true) {
                if (await (0, builder_util_1.exists)(path.join(current, "pnpm-workspace.yaml"))) {
                    return current === path.resolve(this.rootDir) ? null : current;
                }
                const parent = path.dirname(current);
                if (parent === current) {
                    return null;
                }
                current = parent;
            }
        });
        /** `rootDir`, then the workspace root when `rootDir` is a workspace package. */
        this.layoutRoots = new lazy_val_1.Lazy(async () => {
            const workspaceRoot = await this.workspaceRoot.value;
            return workspaceRoot == null ? [this.rootDir] : [this.rootDir, workspaceRoot];
        });
        /**
         * Memo for `locateFromDepOrRoot`, keyed by `name@version`. pnpm's content-addressed virtual
         * store guarantees that any given `name@version` resolves to a single location on disk, so
         * once we've resolved a package we can short-circuit every subsequent lookup. This is the
         * dominant speedup for large workspaces where the `pnpm list --json` tree contains the same
         * `name@version` thousands of times (one entry per dependent).
         */
        this.locateMemo = new Map();
        /**
         * Visited set for `collectDepsRecursively`, keyed by `name@version`. Without this we re-walk
         * every shared subtree of the pnpm list output, exploding work in deep workspaces.
         */
        this.collectedDeps = new Set();
        /** Reverse index of `allDependencies` keyed by package name (without version). Built once on
         *  first access inside `extractProductionDependencyGraph`, after `allDependencies` is settled. */
        this._allDepsByName = null;
        /** The app's own node of the `pnpm list` output (the root of the production graph), set by `getTreeFromWorkspaces`. */
        this.rootTree = null;
    }
    /** Returns true if `nmDir` is an isolated (`.pnpm`) store, false if hoisted, null if it holds no packages. */
    async scanNodeModulesLayout(nmDir) {
        const entries = await fs.readdir(nmDir).catch(() => []);
        let sawPackage = false;
        for (const name of entries) {
            if (name.startsWith(".")) {
                continue; // .pnpm, .bin, .modules.yaml
            }
            const entryPath = path.join(nmDir, name);
            // A scoped dir (@scope) is not a package itself; descend to its packages.
            const candidates = name.startsWith("@") ? (await fs.readdir(entryPath).catch(() => [])).map(s => path.join(entryPath, s)) : [entryPath];
            for (const candidate of candidates) {
                const real = await fs.realpath(candidate).catch(() => null);
                if (real == null) {
                    continue;
                }
                sawPackage = true;
                if (real.split(path.sep).includes(".pnpm")) {
                    return true; // isolated store: a package routes through the virtual store
                }
            }
        }
        return sawPackage ? false : null;
    }
    /**
     * Returns the workspace packages to iterate over, gated by detected pnpm version:
     * - pnpm v11+: multi-entry workspace output → return the full parsed array
     * - pnpm < v11 / non-workspace / detection failure: single-tree behavior → return only [0]
     */
    get allWorkspacePackages() {
        if (this._pnpmMajorVersion >= 11) {
            return this._allWorkspacePackages;
        }
        return this._allWorkspacePackages.slice(0, 1);
    }
    getArgs() {
        return ["list", "--prod", "--json", "--depth", "Infinity", "--silent", "--loglevel=error"];
    }
    getAllDepsByName() {
        if (!this._allDepsByName) {
            this._allDepsByName = new Map();
            for (const [id, dep] of this.allDependencies.entries()) {
                const { name } = this.parseNameVersion(id);
                if (!this._allDepsByName.has(name)) {
                    this._allDepsByName.set(name, dep);
                }
            }
        }
        return this._allDepsByName;
    }
    /**
     * Locate a package version, preferring the dep's own reported path before falling back to rootDir.
     * This is critical for pnpm non-hoisted (virtual store) setups where each package has its own
     * nested node_modules. Searching only from rootDir can resolve the wrong version when multiple
     * versions of a dep exist in the workspace.
     */
    async locateFromDepOrRoot(pkgName, parentPath, requiredRange) {
        // pnpm's virtual store is content-addressed: every `name@version` lookup is deterministic,
        // so memoize on the exact version. `requiredRange` is normally an exact version coming from
        // the pnpm list output (e.g. `value.version`), which makes this cache hit on duplicates.
        // Only memoize when we have a concrete version — semver ranges could resolve differently
        // depending on what's installed at `parentPath` vs root, so skip the cache for those.
        const memoKey = requiredRange && /^\d/.test(requiredRange) ? `${pkgName}@${requiredRange}` : null;
        if (memoKey != null) {
            const cached = this.locateMemo.get(memoKey);
            if (cached != null) {
                return cached;
            }
        }
        // pnpm's default `.pnpm` virtual store is flat, so `downwardSearch` would burn thousands
        // of `readdir`/`lstat` calls finding nothing. With `nodeLinker: hoisted`, however, the
        // layout is a traditional nested `node_modules` tree where version-conflicted packages
        // land at `<root>/node_modules/A/node_modules/B` — downward BFS is needed to find them.
        const skipDownwardSearch = !(await this.isHoisted.value);
        const promise = (async () => {
            // Phase 1: find a version that SATISFIES requiredRange, trying the dep's own location
            // first, then the workspace root. Crucially, neither pass accepts an out-of-range override
            // here — so a wrong-version copy reachable via upward search from `parentPath` (e.g. a
            // hoisted top-level dep) can't shadow the correct nested copy under root. With
            // `nodeLinker: hoisted`, pnpm still reports virtual-store `path`s that don't exist on disk;
            // an upward walk from one meets the root copy, which previously got accepted as an
            // "override" before the root search (whose downward BFS finds the nested copy) ever ran.
            //
            // When `rootDir` is a workspace package, a hoisted install keeps the tree — including the
            // nested `<workspaceRoot>/node_modules/A/node_modules/B` copies — under the workspace root,
            // which the downward BFS from `rootDir` never reaches (its `node_modules` is often absent),
            // so search the workspace root last.
            let satisfying = parentPath ? await this.cache.locatePackageVersion({ pkgName, parentDir: parentPath, requiredRange, skipDownwardSearch, skipOverrideFallback: true }) : null;
            for (const dir of await this.layoutRoots.value) {
                satisfying !== null && satisfying !== void 0 ? satisfying : (satisfying = await this.cache.locatePackageVersion({ pkgName, parentDir: dir, requiredRange, skipDownwardSearch, skipOverrideFallback: true }));
            }
            if (satisfying) {
                return satisfying;
            }
            // Phase 2: no version satisfies requiredRange (package-manager override, or no range
            // given). Fall back to the original dep-then-root order, now allowing override versions.
            const fromDep = parentPath ? await this.cache.locatePackageVersion({ pkgName, parentDir: parentPath, requiredRange, skipDownwardSearch }) : null;
            if (fromDep) {
                return fromDep;
            }
            return this.cache.locatePackageVersion({ pkgName, parentDir: this.rootDir, requiredRange, skipDownwardSearch });
        })().then(pkg => this.toRealPackage(pkg));
        if (memoKey != null) {
            this.locateMemo.set(memoKey, promise);
        }
        return promise;
    }
    /**
     * Resolve a located package to its real directory (the symlink target), leaving a non-symlinked
     * hit untouched.
     *
     * `locatePackageVersion` returns the path it *walked*, which in pnpm's isolated store is the
     * `node_modules/<name>` symlink rather than `.pnpm/<name>@<ver>/node_modules/<name>`. That
     * distinction matters because the store keeps a package's dependencies as SIBLINGS inside
     * `.pnpm/<name>@<ver>/node_modules/`, reachable only from the real path: searching upward from
     * the symlink walks the dependent's directory instead, and finds the dependency only by accident
     * (through pnpm's hidden `.pnpm/node_modules` hoist, possibly at the wrong version). `visitDep`
     * resolves the deps of every package pnpm printed without children (deduped stubs) from disk
     * through here.
     *
     * Resolving the link is what Node itself does (`--preserve-symlinks` is off by default).
     */
    async toRealPackage(pkg) {
        if (pkg == null) {
            return null;
        }
        const packageDir = await this.cache.realPath[pkg.packageDir];
        return packageDir === pkg.packageDir ? pkg : { ...pkg, packageDir };
    }
    // pnpm 10+ does not automatically preserve transitive optional platform-specific
    // packages (e.g. sass-embedded-linux-x64) across lock file regeneration. Users
    // must list them as direct optionalDependencies. Missing ones are emitted as
    // PKG_OPTIONAL_PLATFORM_NOT_INSTALLED warnings in the log summary.
    async extractProductionDependencyGraph(tree, dependencyId) {
        var _a;
        if (this.productionGraph[dependencyId]) {
            return;
        }
        this.productionGraph[dependencyId] = { dependencies: [] };
        if (((_a = tree.dedupedDependenciesCount) !== null && _a !== void 0 ? _a : 0) > 0) {
            const realDep = this.allDependencies.get(dependencyId);
            if (realDep) {
                this.cache.logSummary[moduleManager_1.LogMessageByKey.PKG_DUPLICATE_REF].push(dependencyId);
                tree = realDep;
            }
            else {
                this.cache.logSummary[moduleManager_1.LogMessageByKey.PKG_DUPLICATE_REF_UNRESOLVED].push(dependencyId);
                return;
            }
        }
        const packageName = tree.name || tree.from;
        // The app root is never installed inside a node_modules directory, so it is read from its own
        // directory instead of being located by name. A by-name lookup finds a same-named dependency
        // whenever the app shares its name with one (an app called `debug` depending on `debug`), and
        // that dependency's package.json would then decide which of the app's dependencies are kept.
        const isRoot = tree === this.rootTree;
        const rootPackageJson = isRoot && tree.path ? await fs.readJson(path.join(tree.path, "package.json")).catch(() => null) : null;
        const { packageJson } = (isRoot ? { packageJson: rootPackageJson } : await this.locateFromDepOrRoot(packageName, tree.path, tree.version)) || {};
        const all = packageJson ? { ...packageJson.dependencies, ...packageJson.optionalDependencies } : { ...tree.dependencies, ...tree.optionalDependencies };
        const optional = packageJson ? { ...packageJson.optionalDependencies } : {};
        const deps = { ...(tree.dependencies || {}), ...(tree.optionalDependencies || {}) };
        // pnpm --prod omits sub-deps for link: packages (and synthetic entries derived from them), and pnpm
        // 10.29.3+ prints a repeated subtree only once, so every later occurrence is a childless `deduped`
        // stub (which is what `tree` is when the stub was the first occurrence collected). For any dep
        // declared in the package.json (all) that pnpm left out of the tree, recover the resolved entry
        // from allDependencies so it lands in the production graph.
        for (const [depName, declaredRange] of Object.entries(all)) {
            if (!deps[depName]) {
                const dep = await this.resolveOmittedDependency(depName, declaredRange, tree.path);
                if (dep && (0, builder_util_1.isValidKey)(depName)) {
                    deps[depName] = dep;
                }
            }
        }
        this.productionGraph[dependencyId] = { dependencies: [] };
        const depPromises = Object.entries(deps).map(async ([packageName, dependency]) => {
            // First check if it's in production dependencies
            if (!all[packageName]) {
                return undefined;
            }
            // Then check if optional dependency path exists (using actual resolved path)
            if (optional[packageName]) {
                const pkg = await this.locateFromDepOrRoot(packageName, tree.path, dependency.version);
                if (!pkg) {
                    // Declared in `optionalDependencies`, so a miss is an expected condition (e.g. fsevents
                    // on Linux/Windows) — classify it as a missing optional dependency, not PKG_NOT_ON_DISK.
                    this.logMissingDependency(`${packageName}@${dependency.version}`, true);
                    return undefined;
                }
            }
            const { id: childDependencyId, pkgOverride } = this.normalizePackageVersion(packageName, dependency);
            await this.extractProductionDependencyGraph(pkgOverride, childDependencyId);
            return childDependencyId;
        });
        const collectedDependencies = [];
        for (const dep of depPromises) {
            const result = await dep;
            if (result !== undefined) {
                collectedDependencies.push(result);
            }
        }
        this.productionGraph[dependencyId] = { dependencies: collectedDependencies };
    }
    /**
     * Resolve a dependency that `pnpm list` left out of a package's tree to its `allDependencies` entry.
     * The lookup goes through the copy node itself would load from `parentPath` (the package's real store
     * directory), filtered by the declared range, and falls back to a name-only match only when nothing on
     * disk resolves to a collected entry (a `link:` dep, whose entry is keyed by its `link:` version).
     *
     * A name-only lookup returns whichever version was collected first, which is wrong as soon as two
     * versions of the package are installed: with the app pinning es5-ext@0.10.53 while its transitive
     * d@1.0.2 needs es5-ext ^0.10.64, `d` was wired to 0.10.53 and the nested 0.10.64 copy (with its own
     * esniff / event-emitter / next-tick@1.1.0 closure) vanished from the asar (#8493). pnpm 10.29.3+
     * made this common, because its deduped output routes every repeated package through this recovery.
     */
    async resolveOmittedDependency(depName, declaredRange, parentPath) {
        const range = typeof declaredRange === "string" ? declaredRange : undefined;
        const located = await this.locateFromDepOrRoot(depName, parentPath, range);
        const exact = located ? this.allDependencies.get(`${depName}@${located.packageJson.version}`) : undefined;
        return exact !== null && exact !== void 0 ? exact : this.getAllDepsByName().get(depName);
    }
    async collectAllDependencies(_tree, _appPackageName) {
        for (const root of this.allWorkspacePackages) {
            await this.collectDepsRecursively(root);
        }
    }
    async readPackageJsonAt(dir) {
        const packageJson = await fs.readJson(path.join(dir, "package.json")).catch(() => null);
        return packageJson ? { packageDir: dir, packageJson } : null;
    }
    /**
     * Visit a single dependency node, adding it and its transitive deps to allDependencies.
     *
     * pnpm 10.29.3+ prints a repeated subtree only once; every later occurrence is a childless
     * `deduped` stub. Stubs must still be registered here: the one full print can sit under a node
     * this walk skips, e.g. a second peer variant of a package with the same `name@version` (the
     * guard below), so a package seen only as stubs was dropped from the asar together with its whole
     * closure (#10253). For a stub (and every dependency discovered beneath one, `fromDisk`), we fall
     * back to the on-disk package.json to discover transitive deps, resolving each one from the
     * package's own store directory first (where pnpm placed them).
     *
     * Other childless entries keep the tree walk. A `link:` package is also printed without children,
     * but its declared deps resolve from the link target's own `node_modules` (e.g. a linked
     * electron-updater checkout's monorepo store), outside the app. Walking them would register those
     * foreign copies under `name@version`, so the guard below then skips the app's own copy of the same
     * `name@version` together with its subtree (`jsonfile` vanished from under `fs-extra`).
     */
    async visitDep(key, value, fromDisk = false) {
        var _a, _b, _c, _d;
        const id = `${key}@${value.version}`;
        // The pnpm list output can include the same `name@version` thousands of times across a
        // deep workspace; without this guard we re-resolve and re-recurse each occurrence.
        if (this.collectedDeps.has(id)) {
            return;
        }
        this.collectedDeps.add(id);
        const located = await this.locateFromDepOrRoot(key, value.path, value.version);
        const resolvedPath = (_a = located === null || located === void 0 ? void 0 : located.packageDir) !== null && _a !== void 0 ? _a : value.path;
        this.allDependencies.set(id, { ...value, path: resolvedPath });
        // Fall back to reading package.json straight from the resolved directory when the by-name lookup
        // came up empty, e.g. a workspace package, which nothing above it exposes under `node_modules/`.
        const pkg = located !== null && located !== void 0 ? located : (resolvedPath != null ? await this.readPackageJsonAt(resolvedPath) : null);
        const hasTreeDeps = Object.keys((_b = value.dependencies) !== null && _b !== void 0 ? _b : {}).length > 0 || Object.keys((_c = value.optionalDependencies) !== null && _c !== void 0 ? _c : {}).length > 0;
        const isDedupedStub = ((_d = value.dedupedDependenciesCount) !== null && _d !== void 0 ? _d : 0) > 0;
        if ((isDedupedStub || fromDisk) && !hasTreeDeps && (pkg === null || pkg === void 0 ? void 0 : pkg.packageJson)) {
            // Pass the declared version range so that resolution skips wrong-version hoisted packages and
            // finds the correct nested copy.
            const pkgOptionalDecl = pkg.packageJson.optionalDependencies || {};
            const pkgDepsDecl = { ...(pkg.packageJson.dependencies || {}), ...pkgOptionalDecl };
            for (const [depName, depRange] of Object.entries(pkgDepsDecl)) {
                const resolved = await this.locateFromDepOrRoot(depName, pkg.packageDir, typeof depRange === "string" ? depRange : undefined);
                if (!resolved) {
                    // A miss here silently ships a broken app (the dependency is simply absent from the
                    // asar and only fails at runtime with MODULE_NOT_FOUND), so surface it in the log
                    // summary. Optional deps are an expected miss and get the quieter bucket.
                    this.logMissingDependency(`${depName}@${depRange}`, pkgOptionalDecl[depName] != null);
                    continue;
                }
                await this.visitDep(depName, {
                    from: depName,
                    name: depName,
                    version: resolved.packageJson.version,
                    path: resolved.packageDir,
                    dependencies: {},
                    optionalDependencies: {},
                }, true);
            }
        }
        else {
            await this.collectDepsRecursively(value);
        }
    }
    async collectDepsRecursively(tree) {
        for (const [key, value] of Object.entries(tree.dependencies || {})) {
            await this.visitDep(key, value);
        }
        for (const [key, value] of Object.entries(tree.optionalDependencies || {})) {
            await this.visitDep(key, value);
        }
    }
    getTreeFromWorkspaces(tree, packageName) {
        var _a;
        // pnpm v10 workspace: app is nested as a dependency of root — handled by base class
        const result = super.getTreeFromWorkspaces(tree, packageName);
        // pnpm v11 workspace: each workspace package is a separate top-level array entry;
        // non-workspace (single-tree): find returns the one entry or undefined → falls back to tree
        this.rootTree = result !== tree ? result : ((_a = this.allWorkspacePackages.find(pkg => pkg.name === packageName || pkg.from === packageName)) !== null && _a !== void 0 ? _a : tree);
        return this.rootTree;
    }
    async parseDependenciesTree(jsonBlob) {
        const dependencyTree = this.extractJsonFromPollutedOutput(jsonBlob);
        this._allWorkspacePackages = dependencyTree;
        this._pnpmMajorVersion = await this.pnpmVersion.value;
        return dependencyTree[0];
    }
}
exports.PnpmNodeModulesCollector = PnpmNodeModulesCollector;
//# sourceMappingURL=pnpmNodeModulesCollector.js.map