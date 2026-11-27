import { CompressionLevel, Platform } from "../core";
export interface ArchiveOptions {
    compression?: CompressionLevel | null;
    /**
     * @default false
     */
    withoutDir?: boolean;
    /**
     * @default true
     */
    solid?: boolean;
    /**
     * @default true
     */
    isArchiveHeaderCompressed?: boolean;
    dictSize?: number;
    excluded?: Array<string> | null;
    method?: "Copy" | "LZMA" | "Deflate" | "DEFAULT";
    isRegularFile?: boolean;
    /**
     * Preserve symlinks (e.g. macOS .framework `Versions/Current`) instead of dereferencing them.
     * Passes `-snl` to 7za — modern 7-Zip derefs by default, which breaks bundle codesigning. See #9846.
     * @default false
     */
    preserveSymlinks?: boolean;
    /**
     * Paths, relative to the archived directory, to append as uncompressed (`Copy`) members instead of
     * compressing them with the rest of the archive. Differential updates diff the *compressed* archive
     * with a content-defined blockmap, and a large compressed member (an asar) diverges wholesale from
     * its previous version on any change — storing it keeps unchanged regions byte-identical between
     * builds, so the delta stays proportional to what actually changed. The stored members are excluded
     * from the main (compressed) pass and appended in a second 7za invocation with `-mx=0`; the
     * `ELECTRON_BUILDER_COMPRESSION_LEVEL` override deliberately does not apply to them (byte-stability
     * is the point), while `preserveSymlinks` and `isArchiveHeaderCompressed` are mirrored into the
     * append pass. Paths that do not exist are skipped. Not supported by the native-zip NFD fallback.
     */
    storedPaths?: Array<string> | null;
    /**
     * Restrict the 7z filter to one the install-time extractor (the self-vendored Nsis7z plugin) can
     * decode. Modern 7za (24.09) auto-applies a CPU branch converter to executable content at
     * `-mx>=1` — `BCJ2` on x86/x64 and `ARM64` on arm64 — which that decoder silently skips, dropping
     * every executable from the install. When set, the archive is pinned to the single-stream `BCJ`
     * filter while compressing (decodable, and the best-ratio filter that decoder supports) and to
     * plain `Copy` while storing. Deliberately NOT overridable by `ELECTRON_BUILDER_7Z_FILTER`, which
     * could otherwise reintroduce an unreadable archive. Only affects the 7z format. See #9983.
     * @default false
     */
    installTimeDecodable?: boolean;
}
/**
 * Whether archives for the given target platform should preserve symlinks (i.e. pass `-snl`).
 * Non-Windows targets preserve them: macOS `.framework` bundles need them for codesigning (#9846)
 * and Linux bundles may legitimately contain them. Windows dereferences because restoring symlinks
 * there requires elevated privileges. Keyed on the target platform, not the build host.
 */
export declare function shouldPreserveSymlinks(platform: Platform): boolean;
export declare function compute7zCompressArgs(format: string, options?: ArchiveOptions): string[];
