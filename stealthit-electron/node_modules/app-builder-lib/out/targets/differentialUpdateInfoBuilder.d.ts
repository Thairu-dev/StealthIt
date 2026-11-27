import { BlockMapDataHolder, PackageFileInfo } from "builder-util-runtime";
import { Target } from "../core";
import { PlatformPackager } from "../platformPackager";
import { ArchiveOptions } from "./archive";
import { BlockMapRegion, BuildBlockMapOptions, ChunkerParams } from "./blockmap/blockmap";
export declare const BLOCK_MAP_FILE_SUFFIX = ".blockmap";
/**
 * Chunker parameters for a stored (`Copy`) archive member — e.g. `resources/app.asar` when
 * `nsis.differentialPackage` is `"store-asar"` — whose bytes sit verbatim in the artifact. Such a member
 * changes in small, localized ways between releases, so it is chunked finer than the surrounding
 * compressed streams to keep the differential download proportional to the change.
 *
 * Set by benchmark (`test/src/differentialOneLineBenchTest.ts`, 32 MB asar / 3,001 files): 4/8/16 KiB
 * minimizes download bytes + new-blockmap bytes for a one-line edit (−5 % same-length, −17 % length-changing
 * vs. the 8/16/32 default); anything finer is a net loss because the v2 blockmap (~22 B per block, re-downloaded
 * in full on every update) grows faster than the block savings. `avg` must stay a power of two.
 */
export declare const STORED_MEMBER_CHUNKER: ChunkerParams;
/**
 * Locates each of `memberFiles` (absolute paths of files stored verbatim inside `artifact`) and returns
 * a `STORED_MEMBER_CHUNKER` blockmap region per located file, sorted by offset. The regions never
 * overlap: byte-identical members (a pure-JS app packaged for x64 + arm64 has the same asar twice in
 * the universal installer) are each matched to their own copy, and a copy already claimed by an
 * earlier member is skipped. A member file that does not exist, or that cannot be found verbatim, is
 * logged at warn and skipped — the blockmap then falls back to the default chunker for those bytes;
 * it never fails the build.
 */
export declare function locateStoredMemberRegions(artifact: string, memberFiles: Array<string>): Promise<Array<BlockMapRegion>>;
/** `BuildBlockMapOptions` for `regions`, or `undefined` when there are none so the default chunker path is taken unchanged. */
export declare function toBlockMapOptions(regions: Array<BlockMapRegion>): BuildBlockMapOptions | undefined;
export declare function createNsisWebDifferentialUpdateInfo(artifactPath: string, packageFiles: {
    [arch: string]: PackageFileInfo;
}): {
    packages: {
        [arch: string]: PackageFileInfo;
    };
} | null;
export declare function configureDifferentialAwareArchiveOptions(archiveOptions: ArchiveOptions): ArchiveOptions;
export declare function appendBlockmap(file: string, options?: BuildBlockMapOptions): Promise<BlockMapDataHolder>;
export declare function createBlockmap(file: string, target: Target, packager: PlatformPackager<any>, safeArtifactName: string | null, options?: BuildBlockMapOptions): Promise<BlockMapDataHolder>;
