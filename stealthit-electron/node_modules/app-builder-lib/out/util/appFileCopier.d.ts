import { FileTransformer } from "builder-util";
import { Stats } from "fs";
import { FileMatcher } from "../fileMatcher";
import { PM } from "../node-module-collector";
import { ModuleManager } from "../node-module-collector/moduleManager";
import { Packager } from "../packager";
import { PlatformPackager } from "../platformPackager";
import { NodeModuleInfo } from "./packageDependencies";
export declare function getDestinationPath(file: string, fileSet: ResolvedFileSet): string;
export declare function copyAppFiles(fileSet: ResolvedFileSet, packager: Packager, transformer: FileTransformer): Promise<void>;
export interface ResolvedFileSet {
    src: string;
    destination: string;
    files: Array<string>;
    metadata: Map<string, Stats>;
    transformedFiles?: Map<number, string | Buffer> | null;
}
export declare function transformFiles(transformer: FileTransformer, fileSet: ResolvedFileSet): Promise<void>;
export declare function computeFileSets(matchers: Array<FileMatcher>, transformer: FileTransformer | null, platformPackager: PlatformPackager<any>, isElectronCompile: boolean): Promise<Array<ResolvedFileSet>>;
type CollectedNodeModules = {
    nodeModules: NodeModuleInfo[];
    logSummary: ModuleManager["logSummary"];
};
/** Runs a single package-manager collector against a single directory. */
type CollectorRunner = (pm: PM, dir: string) => Promise<CollectedNodeModules>;
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
export declare function collectionMatchesAppDependencies(nodeModules: NodeModuleInfo[], dependencies: Record<string, string> | undefined): boolean;
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
export declare function resolveFirstMatchingCollection(options: {
    pmApproaches: PM[];
    searchDirectories: string[];
    dependencies: Record<string, string> | undefined;
    run: CollectorRunner;
}): Promise<CollectedNodeModules | undefined>;
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
export declare function enforceAllowMissingDependencies(allowMissingDependencies: boolean | Array<string> | null | undefined, logSummary: ModuleManager["logSummary"] | undefined): void;
/** Exported for tests (an internal-tagged export would be stripped from the declarations the test project consumes). */
export declare function collectNodeModulesWithLogging(platformPackager: PlatformPackager<any>): Promise<NodeModuleInfo[]>;
export {};
