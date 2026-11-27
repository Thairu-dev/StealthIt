"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectronBuilderForgeMaker = void 0;
exports.buildForge = buildForge;
exports.withLegacyForgeCall = withLegacyForgeCall;
const path = require("path");
const index_1 = require("./index");
function forgeOutputDir(appDir) {
    // https://github.com/electron/forge/blob/main/packages/api/core/src/api/make.ts (`makeDir`)
    return path.join(path.dirname(appDir), "make");
}
function buildForge(forgeOptions, options) {
    // Resolve appDir to an absolute canonical path before deriving any sibling
    // directories from it.  Using path.dirname avoids embedding ".." in the
    // resolved path, which keeps downstream path comparisons and CodeQL taint
    // tracking straightforward.
    const appDir = path.resolve(forgeOptions.dir);
    return (0, index_1.build)({
        prepackaged: appDir,
        config: {
            directories: {
                output: forgeOutputDir(appDir),
            },
        },
        ...options,
    });
}
const FORGE_PLATFORMS = ["darwin", "mas", "win32", "linux"];
function isForgePlatform(platform) {
    return FORGE_PLATFORMS.includes(platform);
}
function isConfigFetcher(config) {
    return typeof config === "function";
}
/**
 * Base class for electron-builder's Electron Forge makers. Structurally compatible with `MakerBase` from
 * `@electron-forge/maker-base` (Forge 6+), without depending on it: Forge instantiates the package's default export
 * with `new Maker(config, platforms)`, or accepts an instance directly in `makers`.
 */
class ElectronBuilderForgeMaker {
    constructor(configOrConfigFetcher, 
    // Forge 7 types platforms as `string`; Forge 8 narrows them to `ForgePlatform`
    platformsToMakeOn) {
        this.configOrConfigFetcher = configOrConfigFetcher;
        this.platformsToMakeOn = platformsToMakeOn;
        this.requiredExternalBinaries = [];
        this.isConfigPrepared = false;
    }
    /** Forge identifies maker instances in `makers` by this flag. */
    get __isElectronForgeMaker() {
        return true;
    }
    get platforms() {
        return this.platformsToMakeOn == null ? this.defaultPlatforms : this.platformsToMakeOn.filter(isForgePlatform);
    }
    async prepareConfig(targetArch) {
        const config = this.configOrConfigFetcher;
        this.config = isConfigFetcher(config) ? await config(targetArch) : config;
        this.isConfigPrepared = true;
    }
    isSupportedOnCurrentPlatform() {
        return true;
    }
    externalBinariesExist() {
        return true;
    }
    ensureExternalBinariesExist() {
        // electron-builder downloads the tools it needs
    }
    clone() {
        const clone = Reflect.construct(this.constructor, [this.configOrConfigFetcher, this.platformsToMakeOn]);
        if (!(clone instanceof ElectronBuilderForgeMaker)) {
            throw new Error(`Cannot clone maker ${this.name}`);
        }
        return clone;
    }
    async make(options) {
        if (!this.isConfigPrepared) {
            await this.prepareConfig(options.targetArch);
        }
        return (0, index_1.build)(this.getBuildOptions(options));
    }
    /** Maps Forge's `make()` options onto the electron-builder `build()` options for this maker's target. */
    getBuildOptions(options) {
        var _a, _b, _c, _d;
        const appDir = path.resolve(options.dir);
        // Forge configs commonly pass `config: {}`; leave the target's own defaults in place for it (an empty `snapcraft` is invalid)
        const makerConfig = this.config == null || Object.keys(this.config).length === 0 ? undefined : this.config;
        const { config, ...targets } = this.getTarget(options.targetArch, makerConfig);
        // The packaged binary is named by Forge (`packagerConfig.executableName`, else the app name), not by electron-builder's defaults.
        const executableName = (_c = (_b = (_a = options.forgeConfig) === null || _a === void 0 ? void 0 : _a.packagerConfig) === null || _b === void 0 ? void 0 : _b.executableName) !== null && _c !== void 0 ? _c : options.appName;
        return {
            ...targets,
            prepackaged: appDir,
            config: {
                ...(executableName == null ? {} : { executableName }),
                ...config,
                directories: {
                    output: (_d = options.makeDir) !== null && _d !== void 0 ? _d : forgeOutputDir(appDir),
                },
            },
        };
    }
}
exports.ElectronBuilderForgeMaker = ElectronBuilderForgeMaker;
/**
 * Lets the maker class also be called as a function, as Electron Forge 5 called a maker module's default export
 * (`maker.default(options)`). Forge 6+ constructs it with `new`, which is passed through unchanged.
 */
function withLegacyForgeCall(MakerClass) {
    return new Proxy(MakerClass, {
        apply(_target, _thisArg, args) {
            const options = args[0];
            if (options == null || typeof options !== "object" || !("dir" in options) || typeof options.dir !== "string") {
                throw new TypeError(`${MakerClass.name} must be constructed with "new" (Electron Forge 6+) or called with Electron Forge 5 maker options`);
            }
            const maker = Reflect.construct(MakerClass, []);
            if (!(maker instanceof ElectronBuilderForgeMaker)) {
                throw new TypeError(`${MakerClass.name} is not an electron-builder Forge maker`);
            }
            return maker.make({
                dir: options.dir,
                targetArch: "targetArch" in options && typeof options.targetArch === "string" ? options.targetArch : process.arch,
                appName: "appName" in options && typeof options.appName === "string" ? options.appName : undefined,
            });
        },
    });
}
//# sourceMappingURL=forge-maker.js.map