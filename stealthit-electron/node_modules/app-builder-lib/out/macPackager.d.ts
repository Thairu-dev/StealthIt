import { SignOptions } from "@electron/osx-sign/dist/cjs/types";
import { Identity } from "@electron/osx-sign/dist/cjs/util-identities";
import { Arch, AsyncTaskManager } from "builder-util";
import { MemoLazy, Nullish } from "builder-util-runtime";
import { AppInfo } from "./appInfo";
import { CodeSigningInfo, CreateKeychainOptions } from "./codeSign/macCodeSign";
import { Target } from "./core";
import { AfterPackContext } from "./index";
import { MacTargetHelper, PlatformType } from "./mac/MacTargetHelper";
import { MacConfiguration, MasConfiguration } from "./options/macOptions";
import { Packager } from "./packager";
import { DoPackOptions, PlatformPackager } from "./platformPackager";
export type CustomMacSignOptions = SignOptions;
export type CustomMacSign = (configuration: CustomMacSignOptions, packager: MacPackager) => Promise<void>;
export declare class MacPackager extends PlatformPackager<MacConfiguration | MasConfiguration> {
    readonly codeSigningInfo: MemoLazy<CreateKeychainOptions | null, CodeSigningInfo>;
    private _iconPath;
    private _activePackConfig;
    readonly helper: MacTargetHelper;
    constructor(info: Packager);
    get defaultTarget(): Array<string>;
    /**
     * Get the merged configuration for a specific platform type
     */
    private getPlatformConfig;
    expandArch(pattern: string, arch?: Arch | null): string[];
    protected prepareAppInfo(appInfo: AppInfo): AppInfo;
    getIconPath(): Promise<string | null>;
    createTargets(targets: Array<string>, mapper: (name: string, factory: (outDir: string) => Target) => void): void;
    protected doPack(config: DoPackOptions<MacConfiguration>): Promise<any>;
    /**
     * Handle universal build packing
     */
    private doUniversalPack;
    pack(outDir: string, arch: Arch, targets: Array<Target>, taskManager: AsyncTaskManager): Promise<void>;
    private packMasTargets;
    private packMacTargets;
    protected signMas(appPath: string, arch: Arch, targetPlatform: PlatformType): Promise<boolean>;
    /**
     * Creates the signed MAS installer .pkg for an already codesigned app. Kept separate from `sign()`
     * so that the `afterSign` hook can run between codesigning and installer creation (see `packMasTargets`).
     */
    protected createMasInstaller(appPath: string, outDir: string, arch: Arch, targetPlatform: PlatformType): Promise<void>;
    /**
     * Main signing method with platform awareness
     */
    private sign;
    protected doSign(opts: SignOptions, customSignOptions: MacConfiguration | MasConfiguration, identity: Identity | null): Promise<void>;
    doFlat(appPath: string, outFile: string, identity: Identity, keychain: string | Nullish): Promise<any>;
    getElectronSrcDir(dist: string): string;
    getElectronDestinationDir(appOutDir: string): string;
    applyCommonInfo(appPlist: any, contentsPath: string): Promise<void>;
    protected signApp(packContext: AfterPackContext, isAsar: boolean): Promise<boolean>;
}
