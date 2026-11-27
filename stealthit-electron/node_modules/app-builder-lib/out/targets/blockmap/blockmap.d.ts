import { BlockMapDataHolder } from "builder-util-runtime";
export type CompressionFormat = "deflate" | "gzip";
/** Rabin content-defined chunker parameters. `avg` must be a power of two; `min` < `avg` <= `max`. */
export interface ChunkerParams {
    min: number;
    avg: number;
    max: number;
}
/** Default chunker (go-rabin defaults): 8 KB min / 16 KB avg / 32 KB max. */
export declare const DEFAULT_CHUNKER: ChunkerParams;
/**
 * A byte range of the input that should be chunked with its own parameters — e.g. a stored
 * (uncompressed) archive member that is expected to change in small, localized ways between
 * releases, where finer blocks make a differential download proportional to the change.
 * Chunk boundaries are forced at both edges of every region, so the blocks inside a region
 * depend only on the region's own bytes.
 */
export interface BlockMapRegion {
    offset: number;
    size: number;
    chunker: ChunkerParams;
}
export interface BuildBlockMapOptions {
    /**
     * Byte ranges of the input that are chunked with their own `ChunkerParams`; bytes outside every
     * region use `DEFAULT_CHUNKER`. Regions must be ascending, non-overlapping and lie entirely
     * within the input file (an empty list or `null` is equivalent to "no regions").
     *
     * A chunk boundary is forced at the start and at the end of every region: any pending chunk is
     * emitted when the region begins and the last chunk of the region is emitted when it ends. Because
     * the chunker state is reset at every boundary, the sequence of (checksum, size) blocks produced
     * for a region depends only on the region's own bytes — it is identical for the same bytes placed
     * at a different offset or surrounded by different data.
     */
    regions?: Array<BlockMapRegion> | null;
}
/**
 * Build a content-defined block map for `inFile` using Rabin fingerprinting.
 *
 * Files are processed via streaming (peak memory ≈ the largest chunker `max` — 32 KB by default —
 * per chunk, not the full file size), making this safe for large installers.
 *
 * - If `outFile` is omitted: compressed blockmap is appended to `inFile`
 *   (used for NSIS web installer / AppImage embed); `blockMapSize` is returned.
 * - If `outFile` is provided: compressed blockmap is written to that file;
 *   `blockMapSize` is not included in the result.
 *
 * `options.regions` lets byte ranges of the input be chunked with their own parameters (see
 * `BuildBlockMapOptions`). Chunk boundaries are forced at both edges of every region and the chunker
 * state is reset there, so the blocks of a region depend only on the region's own bytes. Without
 * regions the output is exactly what the default chunker produces. Regions never affect the returned
 * `size` or `sha512`.
 *
 * Returned `sha512` is SHA-512 of the full file as it exists after the call.
 */
export declare function buildBlockMap(inFile: string, compressionFormat: CompressionFormat, outFile?: string, options?: BuildBlockMapOptions): Promise<BlockMapDataHolder>;
