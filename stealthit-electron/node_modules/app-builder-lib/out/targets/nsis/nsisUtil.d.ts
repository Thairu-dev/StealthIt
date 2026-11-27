import { Arch } from "builder-util";
import { PackageFileInfo } from "builder-util-runtime";
import { ArchiveOptions } from "../archive";
import { NsisTarget } from "./NsisTarget";
export declare const nsisTemplatesDir: string;
export interface PackArchResult {
    fileInfo: PackageFileInfo;
    unpackedSize: number;
    /**
     * Absolute source paths of the members stored verbatim (`Copy`) in the app package — see
     * `ArchiveOptions.storedPaths`. The package is embedded verbatim in the installer, so these are
     * located again in the final installer to give the block map its finer-chunked regions.
     */
    storedMemberFiles: Array<string>;
}
export declare class AppPackageHelper {
    private readonly elevateHelper;
    private readonly archToResult;
    private readonly archToPackageCount;
    private readonly infoToIsDelete;
    /** @private */
    refCount: number;
    constructor(elevateHelper: CopyElevateHelper);
    packArch(arch: Arch, target: NsisTarget): Promise<PackArchResult>;
    finishBuild(): Promise<any>;
}
export declare class CopyElevateHelper {
    private elevatePath;
    private readonly stagedUnpackedCopies;
    private resolve;
    addToArchive(archiveFile: string, target: NsisTarget, format: string, archiveOptions: ArchiveOptions, appOutDir: string): Promise<void>;
}
export declare class UninstallerReader {
    static exec(installerPath: string, uninstallerPath: string): Promise<void>;
}
