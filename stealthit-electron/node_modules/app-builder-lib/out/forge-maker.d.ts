import type { Configuration } from "./configuration";
import { PackagerOptions } from "./packagerApi";
export interface ForgeOptions {
    readonly dir: string;
}
/** Platforms Electron Forge makes for (`ForgePlatform` in `@electron-forge/shared-types`). */
export type ForgePlatform = "darwin" | "mas" | "win32" | "linux";
/**
 * The options Electron Forge passes to a maker's `make()` (`MakerOptions` in `@electron-forge/maker-base`).
 * Only the fields electron-builder reads are declared.
 */
export interface ForgeMakerOptions extends ForgeOptions {
    /** Where Forge expects artifacts. Defaults to a `make` directory next to `dir`. */
    readonly makeDir?: string;
    /** The sanitized app name Forge packaged the app with. */
    readonly appName?: string;
    readonly targetPlatform?: string;
    readonly targetArch: string;
    readonly forgeConfig?: {
        readonly packagerConfig?: {
            readonly executableName?: string;
        };
    };
}
/** A maker config, or a function returning one for the target arch (as accepted by Forge's `MakerBase`). */
export type ForgeMakerConfig<C> = C | ((targetArch: string) => C | Promise<C>);
/** The electron-builder targets and target configuration a maker builds for one arch. */
export interface ForgeMakerTarget {
    readonly win?: Array<string>;
    readonly linux?: Array<string>;
    readonly config: Configuration;
}
export declare function buildForge(forgeOptions: ForgeOptions, options: PackagerOptions): Promise<string[]>;
/**
 * Base class for electron-builder's Electron Forge makers. Structurally compatible with `MakerBase` from
 * `@electron-forge/maker-base` (Forge 6+), without depending on it: Forge instantiates the package's default export
 * with `new Maker(config, platforms)`, or accepts an instance directly in `makers`.
 */
export declare abstract class ElectronBuilderForgeMaker<C extends object = object> {
    private readonly configOrConfigFetcher?;
    protected readonly platformsToMakeOn?: (ReadonlyArray<string> | null) | undefined;
    abstract readonly name: string;
    abstract readonly defaultPlatforms: ForgePlatform[];
    readonly requiredExternalBinaries: string[];
    /** The resolved maker config, set by `prepareConfig()`. */
    config: C | undefined;
    private isConfigPrepared;
    constructor(configOrConfigFetcher?: ForgeMakerConfig<C> | undefined, platformsToMakeOn?: (ReadonlyArray<string> | null) | undefined);
    /** Forge identifies maker instances in `makers` by this flag. */
    get __isElectronForgeMaker(): true;
    get platforms(): ForgePlatform[];
    prepareConfig(targetArch: string): Promise<void>;
    isSupportedOnCurrentPlatform(): boolean;
    externalBinariesExist(): boolean;
    ensureExternalBinariesExist(): void;
    clone(): ElectronBuilderForgeMaker<C>;
    make(options: ForgeMakerOptions): Promise<string[]>;
    /** Maps Forge's `make()` options onto the electron-builder `build()` options for this maker's target. */
    getBuildOptions(options: ForgeMakerOptions): PackagerOptions;
    /** The electron-builder targets for `targetArch`, with the maker config applied to the target's configuration key. */
    protected abstract getTarget(targetArch: string, config: C | undefined): ForgeMakerTarget;
}
type ForgeMakerClass = new (...args: never[]) => ElectronBuilderForgeMaker;
/**
 * Lets the maker class also be called as a function, as Electron Forge 5 called a maker module's default export
 * (`maker.default(options)`). Forge 6+ constructs it with `new`, which is passed through unchanged.
 */
export declare function withLegacyForgeCall<T extends ForgeMakerClass>(MakerClass: T): T;
export {};
