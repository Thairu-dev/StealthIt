import { ElectronPlatformArtifactDetails, MirrorOptions } from "@electron/get";
import * as crypto from "crypto";
import { ElectronPlatformName } from "../electron/ElectronFramework";
export type ElectronGetOptions = Omit<ElectronPlatformArtifactDetails, "platform" | "arch" | "version" | "artifactName" | "artifactSuffix" | "customFilename" | "tempDirectory" | "downloader" | "cacheMode" | "cacheRoot" | "downloadOptions" | "isGeneric" | "mirrorOptions"> & {
    mirrorOptions?: Omit<MirrorOptions, "customDir" | "customFilename" | "customVersion">;
};
export type ArtifactDownloadOptions = {
    electronDownload?: ElectronGetOptions | ElectronDownloadOptions | null;
    artifactName: string;
    platformName: string;
    arch: string;
    version: string;
    cacheDir?: string;
};
export interface ElectronDownloadOptions {
    version?: string;
    /**
     * The [cache location](https://github.com/electron-userland/electron-download#cache-location).
     */
    cache?: string | null;
    /**
     * The mirror.
     */
    mirror?: string | null;
    /** @private */
    customDir?: string | null;
    /** @private */
    customFilename?: string | null;
    /** @private */
    strictSSL?: boolean;
    /** @private */
    isVerifyChecksum?: boolean;
    platform?: ElectronPlatformName;
    arch?: string;
}
export declare function getCacheDirectory(options: {
    isAvoidSystemOnWindows?: boolean;
    allowEnvVarOverride: boolean;
}): string;
export declare function extractArchive(file: string, dir: string): Promise<void>;
export type ExpectedChecksum = {
    algorithm: "sha256" | "sha512";
    encoding: crypto.BinaryToTextEncoding;
    value: string;
};
/**
 * Downloads a generic artifact (.tar.gz or .zip) from a GitHub release.
 * Used for electron-builder-binaries tools (appimage, etc.).
 */
export declare function downloadBuilderToolset(options: {
    releaseName: string;
    filenameWithExt: string;
    checksums?: Record<string, string>;
    githubOrgRepo?: string;
    overrideUrl?: string;
}): Promise<string>;
/**
 * Mirrors @electron/get's default cache root (`env-paths("electron", { suffix: "" }).cache`).
 * @electron/get does not export it, so the (deliberately tiny) platform switch is replicated here.
 * Must stay in sync with the `cacheRoot` default documented in @electron/get's
 * `ElectronDownloadRequestOptions`.
 * Exposed for unit testing; not part of the public API.
 */
export declare function defaultElectronGetCacheRoot(): string;
/**
 * Parses the upstream `SHASUMS256.txt` format into the `Record<filename, sha256-hex>` shape that
 * @electron/get accepts as inline `checksums`. Each line is `<sha256-hex> *<filename>` (binary
 * mode) or `<sha256-hex>  <filename>` (text mode); malformed lines are ignored.
 * Exposed for unit testing; not part of the public API.
 */
export declare function parseChecksumFile(content: string): Record<string, string>;
/**
 * Looks for a locally seeded SHASUMS256 file at the root of the @electron/get cache and returns
 * its contents as inline `checksums`, or null when nothing usable is seeded.
 *
 * Why: without inline `checksums`, @electron/get re-downloads `SHASUMS256.txt` with a hardcoded
 * `cacheMode: Bypass` on EVERY build — even when the artifact itself is a cache hit — so a fully
 * seeded cache still requires network access and air-gapped builds fail (#10039). Cache-seeding
 * tools (e.g. flatpak-node-generator) already place `SHASUMS256.txt-<version>` flat at the cache
 * root; feeding it back as inline `checksums` keeps checksum validation enabled while making it
 * fully offline. A plain `SHASUMS256.txt` at the cache root is accepted as a manual-seeding
 * fallback. A candidate file is only used when it actually contains an entry for the requested
 * artifact, so a stale file for another version can never break an online build.
 * See https://www.electron.build/tutorials/offline-air-gapped-builds for the seeding contract.
 * Exposed for unit testing; not part of the public API.
 */
export declare function resolveSeededChecksums(cacheRoot: string, version: string, artifactFileName: string): Promise<Record<string, string> | null>;
/**
 * Assembles the `@electron/get` artifact config from `ArtifactDownloadOptions`, accepting both the
 * legacy `ElectronDownloadOptions` and the modern `ElectronGetOptions` config shapes. When the
 * resolved config has no `checksums` (user-provided `electronDownload.checksums` always wins) and
 * checksum verification is not disabled, a locally seeded `SHASUMS256.txt-<version>` at the cache
 * root is picked up as inline `checksums` so validation works offline (see resolveSeededChecksums).
 * Exposed for unit testing; not part of the public API.
 */
export declare function buildElectronArtifactConfig(options: ArtifactDownloadOptions): Promise<ElectronPlatformArtifactDetails>;
/**
 * Downloads the electron artifact zip via @electron/get (with caching) and returns the zip file path.
 * Use when you need to extract the zip yourself (e.g. directly to appOutDir to preserve empty dirs and symlinks).
 */
export declare function downloadElectronArtifactZip(options: ArtifactDownloadOptions): Promise<string>;
export declare function downloadElectronArtifact(options: ArtifactDownloadOptions): Promise<string>;
/**
 * Get the binaries mirror URL from environment variables.
 * Supports various npm config formats and falls back to GitHub.
 */
export declare function getBinariesMirrorUrl(githubOrgRepo: string): string;
