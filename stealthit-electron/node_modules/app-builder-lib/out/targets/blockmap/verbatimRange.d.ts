export interface VerbatimRange {
    offset: number;
    size: number;
}
/**
 * A needle prepared for `findPreparedVerbatimRange`: its scan probe and full hash, computed once so a
 * needle searched for several times (e.g. resumed past an earlier occurrence) is read only once.
 */
export interface VerbatimNeedle {
    readonly file: string;
    readonly size: number;
    /** sha256 of the whole needle; also what identifies byte-identical needles. */
    readonly hash: string;
    /** the first `min(PROBE_SIZE, size)` bytes */
    readonly probe: Buffer;
}
/**
 * Reads what `findPreparedVerbatimRange` needs to know about `needleFile`.
 * @throws when the needle is empty — an empty range is meaningless as a blockmap region.
 */
export declare function prepareVerbatimNeedle(needleFile: string): Promise<VerbatimNeedle>;
/**
 * Finds the first byte range of `haystackFile` whose contents are exactly the contents of `needleFile`
 * (e.g. the location of an archive member stored with `Copy` inside an installer that embeds the archive).
 *
 * Streams the haystack in `READ_CHUNK_SIZE` reads (never loads it whole), scanning for the first
 * `min(PROBE_SIZE, needle size)` bytes of the needle — with a `probe.length - 1` byte overlap between
 * reads so a probe straddling a chunk boundary is still seen — and confirms each probe hit by hashing the
 * candidate haystack range against the needle's hash. False-positive probe hits are skipped and the scan
 * continues; the first confirmed match at or after `startOffset` is returned. Passing the end of an
 * earlier match as `startOffset` finds the next occurrence, which is how identical members (e.g. the
 * same asar packaged for several archs) are each given their own range.
 *
 * Reads the needle on every call; a caller searching for the same needle repeatedly should prepare it
 * once with `prepareVerbatimNeedle` and use `findPreparedVerbatimRange`.
 *
 * @returns the confirmed range, or `null` when the needle does not occur verbatim at or after
 *   `startOffset` (including when it is larger than the haystack).
 * @throws when the needle is empty — an empty range is meaningless as a blockmap region.
 */
export declare function findVerbatimRange(haystackFile: string, needleFile: string, startOffset?: number): Promise<VerbatimRange | null>;
/** `findVerbatimRange` for a needle prepared with `prepareVerbatimNeedle`. */
export declare function findPreparedVerbatimRange(haystackFile: string, needle: VerbatimNeedle, startOffset?: number): Promise<VerbatimRange | null>;
