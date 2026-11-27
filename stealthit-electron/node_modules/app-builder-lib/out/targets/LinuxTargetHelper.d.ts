import { LinuxPackager } from "../linuxPackager";
import { CommonLinuxOptions } from "../options/linuxOptions";
import { SnapCore } from "./snap/SnapTarget";
import { IconInfo } from "../util/iconConverter";
/**
 * Build the argument portion of a .desktop Exec line.
 *
 * executableArgs are written verbatim — matching AppImage and the behavior that
 * shipped for years — so an arg like `--js-flags="--max-old-space-size=12288"`
 * reaches the launcher exactly as the developer specified. Only carriage-return
 * and newline characters are removed: the Exec key is a single line, and an
 * embedded line break would split it into additional .desktop entries.
 *
 * @see https://specifications.freedesktop.org/desktop-entry-spec/desktop-entry-spec-latest.html#exec-variables
 */
export declare function buildExecArgs(executableArgs: ReadonlyArray<string>): string;
export declare const installPrefix = "/opt";
export declare class LinuxTargetHelper {
    private packager;
    private readonly iconPromise;
    private readonly mimeTypeFilesPromise;
    maxIconPath: string | null;
    constructor(packager: LinuxPackager);
    get icons(): Promise<Array<IconInfo>>;
    get mimeTypeFiles(): Promise<string | null>;
    getSnapCore(): SnapCore<any>;
    isElectronVersionGreaterOrEqualThan(version: string, fallback?: string): boolean;
    private computeMimeTypeFiles;
    private computeDesktopIcons;
    getDescription(options: CommonLinuxOptions): string;
    getSanitizedVersion(target: string): string;
    writeDesktopEntry(targetSpecificOptions: CommonLinuxOptions, exec?: string, destination?: string | null, extra?: Record<string, string>): Promise<string>;
    getDesktopFileName(fallback?: string): string;
    computeDesktopEntry(targetSpecificOptions: CommonLinuxOptions, exec?: string, extra?: Record<string, string>): Promise<string>;
}
