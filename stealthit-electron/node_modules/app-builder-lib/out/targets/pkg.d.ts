import { Arch } from "builder-util";
import { Nullish } from "builder-util-runtime";
import { Identity } from "../codeSign/macCodeSign";
import { Target } from "../core";
import { MacPackager } from "../macPackager";
import { PkgOptions } from "../options/pkgOptions";
export declare class PkgTarget extends Target {
    private readonly packager;
    readonly outDir: string;
    readonly options: PkgOptions;
    constructor(packager: MacPackager, outDir: string);
    build(appPath: string, arch: Arch): Promise<any>;
    private getExtraPackages;
    private customizeDistributionConfiguration;
    private buildComponentPackage;
}
export declare function prepareProductBuildArgs(identity: Identity | null, keychain: string | Nullish): Array<string>;
/**
 * Resolves the version string to pass as `--version` to pkgbuild.
 * Reads CFBundleShortVersionString from the app bundle's Info.plist (what pkgbuild
 * previously inferred automatically), falling back to the appInfo version.
 */
export declare function resolvePkgBuildVersion(appPath: string, fallback: string): Promise<string>;
/**
 * Resolves the scripts directory path for pkgbuild.
 * Returns null when scripts is explicitly set to null (disabled).
 * Returns a custom path when scripts is a non-empty string.
 * Falls back to the default "pkg-scripts" directory otherwise.
 */
export declare function resolveScriptsDir(buildResourcesDir: string, scripts: string | null | undefined): string | null;
/**
 * Adds `rootVolumeOnly="true"` to the `<options>` element of a synthesized `distribution.xml`.
 *
 * `<domains>` is a deprecated Distribution element. On macOS 26 the Installer probes the current-user-home domain while
 * parsing it — even with `enable_currentUserHome="false"` — which trips `kTCCServiceSystemPolicyAppData` and makes
 * Installer.app ask for "data from other apps" before any file is written. `rootVolumeOnly` is the current spelling of
 * the same restriction and leaves the install-domain decision unchanged.
 *
 * Only applied when both user-home install domains are disabled, which is exactly when `<domains>` and
 * `rootVolumeOnly` express the same thing. The `<domains>` element is left byte-for-byte as generated, so
 * distributions that rely on it keep working as before.
 *
 * Assumes the document contains the `<options …>` element emitted by `productbuild --synthesize`, which is always the
 * case for a component-based distribution.
 */
export declare function applyRootVolumeOnly(distInfo: string, options: Pick<PkgOptions, "allowAnywhere" | "allowCurrentUserHome">): string;
