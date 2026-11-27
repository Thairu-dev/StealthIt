import { Lazy } from "lazy-val";
import { NodeModulesCollector } from "./nodeModulesCollector";
import { PM } from "./packageManager";
import { PnpmDependency } from "./types";
export declare class PnpmNodeModulesCollector extends NodeModulesCollector<PnpmDependency, PnpmDependency> {
    readonly installOptions: {
        manager: PM;
        lockfile: string;
    };
    private _allWorkspacePackages;
    private _pnpmMajorVersion;
    private readonly pnpmVersion;
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
    protected isHoisted: Lazy<boolean>;
    /**
     * The pnpm workspace root containing `rootDir` (nearest ancestor with `pnpm-workspace.yaml`, as pnpm
     * itself resolves it), or null outside a workspace or when `rootDir` is the workspace root.
     */
    private readonly workspaceRoot;
    /** `rootDir`, then the workspace root when `rootDir` is a workspace package. */
    private readonly layoutRoots;
    /** Returns true if `nmDir` is an isolated (`.pnpm`) store, false if hoisted, null if it holds no packages. */
    private scanNodeModulesLayout;
    /**
     * Memo for `locateFromDepOrRoot`, keyed by `name@version`. pnpm's content-addressed virtual
     * store guarantees that any given `name@version` resolves to a single location on disk, so
     * once we've resolved a package we can short-circuit every subsequent lookup. This is the
     * dominant speedup for large workspaces where the `pnpm list --json` tree contains the same
     * `name@version` thousands of times (one entry per dependent).
     */
    private readonly locateMemo;
    /**
     * Visited set for `collectDepsRecursively`, keyed by `name@version`. Without this we re-walk
     * every shared subtree of the pnpm list output, exploding work in deep workspaces.
     */
    private readonly collectedDeps;
    /** Reverse index of `allDependencies` keyed by package name (without version). Built once on
     *  first access inside `extractProductionDependencyGraph`, after `allDependencies` is settled. */
    private _allDepsByName;
    /** The app's own node of the `pnpm list` output (the root of the production graph), set by `getTreeFromWorkspaces`. */
    private rootTree;
    /**
     * Returns the workspace packages to iterate over, gated by detected pnpm version:
     * - pnpm v11+: multi-entry workspace output → return the full parsed array
     * - pnpm < v11 / non-workspace / detection failure: single-tree behavior → return only [0]
     */
    private get allWorkspacePackages();
    protected getArgs(): string[];
    private getAllDepsByName;
    /**
     * Locate a package version, preferring the dep's own reported path before falling back to rootDir.
     * This is critical for pnpm non-hoisted (virtual store) setups where each package has its own
     * nested node_modules. Searching only from rootDir can resolve the wrong version when multiple
     * versions of a dep exist in the workspace.
     */
    private locateFromDepOrRoot;
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
    private toRealPackage;
    protected extractProductionDependencyGraph(tree: PnpmDependency, dependencyId: string): Promise<void>;
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
    private resolveOmittedDependency;
    protected collectAllDependencies(_tree: PnpmDependency, _appPackageName: string): Promise<void>;
    private readPackageJsonAt;
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
    private visitDep;
    private collectDepsRecursively;
    protected getTreeFromWorkspaces(tree: PnpmDependency, packageName: string): PnpmDependency;
    protected parseDependenciesTree(jsonBlob: string): Promise<PnpmDependency>;
}
