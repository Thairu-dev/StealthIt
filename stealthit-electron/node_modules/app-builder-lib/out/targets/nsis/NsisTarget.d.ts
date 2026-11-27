import { Arch } from "builder-util";
import { PackageFileInfo } from "builder-util-runtime";
import { Target } from "../../core";
import { WinPackager } from "../../winPackager";
import { ArchiveOptions } from "../archive";
import { Defines } from "./Defines";
import { NsisOptions } from "./nsisOptions";
import { AppPackageHelper, CopyElevateHelper } from "./nsisUtil";
/** The member `differentialPackage: "store-asar"` keeps uncompressed in the app package, relative to the unpacked app dir. */
export declare const STORED_ASAR_PATH = "resources/app.asar";
/**
 * The `archive()` options `buildAppPackage` packages the unpacked app with, before the differential-aware
 * adjustments of `configureDifferentialAwareArchiveOptions`. Exported so the benchmark
 * (`test/src/differentialOneLineBenchTest.ts`) packages exactly like a real build instead of copying these.
 */
export declare function createAppPackageArchiveOptions(compression: ArchiveOptions["compression"], excluded: Array<string> | null, storedPaths: Array<string> | null): ArchiveOptions;
export declare class NsisTarget extends Target {
    readonly packager: WinPackager;
    readonly outDir: string;
    protected readonly packageHelper: AppPackageHelper;
    readonly options: NsisOptions;
    /** @private */
    readonly archs: Map<Arch, string>;
    readonly isAsyncSupported = false;
    constructor(packager: WinPackager, outDir: string, targetName: string, packageHelper: AppPackageHelper);
    get shouldBuildUniversalInstaller(): boolean;
    build(appOutDir: string, arch: Arch): Promise<any>;
    get isBuildDifferentialAware(): boolean;
    private get isZipPayload();
    private get isStoreAsar();
    /**
     * Everything that makes buildAppPackage's archive differ between targets. Targets sharing an
     * AppPackageHelper (nsis + portable) reuse one app package per arch only when this key matches,
     * so a target never embeds an archive whose format or layout was chosen by another target.
     * @private
     */
    get appPackageCacheKey(): string;
    private getPreCompressedFileExtensions;
    /**
     * @private
     * @returns the package file info plus the absolute source paths of the members stored verbatim in it
     *   (`storedMemberFiles`, empty unless `differentialPackage` is `"store-asar"`).
     */
    buildAppPackage(appOutDir: string, arch: Arch, elevateHelper?: CopyElevateHelper | null, fileNameSuffix?: string): Promise<{
        fileInfo: PackageFileInfo;
        storedMemberFiles: Array<string>;
    }>;
    /**
     * `archive()` silently skips stored paths that don't exist, so without an asar (e.g. `asar: false`)
     * "store-asar" would do nothing unnoticed. The fallback is harmless — the differential package is
     * non-solid, so each unpacked file is already its own block — but say so once per target.
     * @private
     */
    warnIfStoreAsarHasNoAsar(appOutDir: string): Promise<void>;
    private storeAsarChecked;
    protected installerFilenamePattern(primaryArch?: Arch | null, defaultArch?: string): string;
    private get isPortable();
    finishBuild(): Promise<any>;
    private buildInstaller;
    protected generateGitHubInstallerName(primaryArch: Arch | null, defaultArch: string | undefined): string;
    private get isUnicodeEnabled();
    get isWebInstaller(): boolean;
    private computeScriptAndSignUninstaller;
    private computeVersionKey;
    protected configureDefines(oneClick: boolean, defines: Defines): Promise<any>;
    private configureDefinesForAllTypeOfInstaller;
    private executeMakensis;
    private computeCommonInstallerScriptHeader;
    private computeFinalScript;
}
