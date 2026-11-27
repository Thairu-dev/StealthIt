"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBrandingOpts = createBrandingOpts;
exports.removeUnusedLanguagesIfNeeded = removeUnusedLanguagesIfNeeded;
exports.createElectronFrameworkSupport = createElectronFrameworkSupport;
exports.cleanupAfterUnpack = cleanupAfterUnpack;
const builder_util_1 = require("builder-util");
const fs_extra_1 = require("fs-extra");
const path = require("path");
const tiny_async_pool_1 = require("tiny-async-pool");
const index_1 = require("../index");
const pathManager_1 = require("../util/pathManager");
const resolve_1 = require("../util/resolve");
const electronGet_1 = require("../util/electronGet");
const electronMac_1 = require("./electronMac");
const electronVersion_1 = require("./electronVersion");
const electronWin_1 = require("./electronWin");
const injectFFMPEG_1 = require("./injectFFMPEG");
function createBrandingOpts(opts) {
    var _a, _b;
    return {
        projectName: ((_a = opts.electronBranding) === null || _a === void 0 ? void 0 : _a.projectName) || "electron",
        productName: ((_b = opts.electronBranding) === null || _b === void 0 ? void 0 : _b.productName) || "Electron",
    };
}
function createDownloadOpts(opts, platform, arch, electronVersion) {
    var _a;
    const base = { platform, arch, version: electronVersion };
    const dl = opts.electronDownload;
    if (dl == null) {
        return base;
    }
    if (Object.hasOwnProperty.call(dl, "mirrorOptions")) {
        // ElectronGetOptions: flatten mirrorOptions.mirror for the app-builder binary
        const { mirrorOptions } = dl;
        return { ...base, mirror: (_a = mirrorOptions === null || mirrorOptions === void 0 ? void 0 : mirrorOptions.mirror) !== null && _a !== void 0 ? _a : undefined };
    }
    return { ...base, ...dl };
}
async function beforeCopyExtraFiles(options) {
    const { appOutDir, packager } = options;
    const electronBranding = createBrandingOpts(packager.config);
    if (packager.platform === index_1.Platform.LINUX) {
        const linuxPackager = packager;
        const executable = path.join(appOutDir, linuxPackager.executableName);
        await (0, fs_extra_1.rename)(path.join(appOutDir, electronBranding.projectName), executable);
    }
    else if (packager.platform === index_1.Platform.WINDOWS) {
        const executable = path.join(appOutDir, `${packager.appInfo.productFilename}.exe`);
        await (0, fs_extra_1.rename)(path.join(appOutDir, `${electronBranding.projectName}.exe`), executable);
        if (options.asarIntegrity) {
            await (0, electronWin_1.addWinAsarIntegrity)(executable, options.asarIntegrity);
        }
    }
    else {
        await (0, electronMac_1.createMacApp)(packager, appOutDir, options.asarIntegrity, options.platformName === "mas");
    }
    await removeUnusedLanguagesIfNeeded(options);
}
async function removeUnusedLanguagesIfNeeded(options) {
    const { packager, appOutDir } = options;
    const { config, platformSpecificBuildOptions, platform } = packager;
    const getLocalesConfig = () => {
        if (platform === index_1.Platform.MAC) {
            return { dirs: [packager.getResourcesDir(appOutDir), packager.getMacOsElectronFrameworkResourcesDir(appOutDir)], langFileExt: ".lproj" };
        }
        return { dirs: [path.join(packager.getResourcesDir(appOutDir), "..", "locales")], langFileExt: ".pak" };
    };
    // case-insensitive, treating "-" and "_" as the same separator
    const normalizeLocale = (locale) => locale.trim().toLowerCase().replace(/_/g, "-");
    const wantedLanguages = (0, builder_util_1.asArray)(platformSpecificBuildOptions.electronLanguages || config.electronLanguages)
        .map(normalizeLocale)
        .filter(it => it.length > 0);
    if (!wantedLanguages.length) {
        return;
    }
    // bare wanted "en" keeps "en-US.pak"; region-qualified wanted "en-US" keeps mac's bare "en.lproj"
    const isLocaleMatch = (wanted, language) => wanted === language || language.startsWith(`${wanted}-`) || wanted.startsWith(`${language}-`);
    const { dirs, langFileExt } = getLocalesConfig();
    const matchedWantedLanguages = new Set();
    const filesToDelete = [];
    for (const dir of dirs) {
        const localeFiles = (await (0, fs_extra_1.readdir)(dir)).filter(file => path.extname(file) === langFileExt);
        const unwantedFiles = [];
        for (const file of localeFiles) {
            const language = normalizeLocale(path.basename(file, langFileExt));
            const matches = wantedLanguages.filter(wanted => isLocaleMatch(wanted, language));
            if (matches.length === 0) {
                unwantedFiles.push(path.join(dir, file));
            }
            else {
                matches.forEach(it => matchedWantedLanguages.add(it));
            }
        }
        if (localeFiles.length > 0 && unwantedFiles.length === localeFiles.length) {
            // an empty locales dir produces an app that crashes at startup (https://github.com/electron/electron/issues/52307)
            builder_util_1.log.warn({ electronLanguages: wantedLanguages, dir }, "electronLanguages doesn't match any locale in this directory, skipping cleanup to avoid packaging an app without locales");
            continue;
        }
        filesToDelete.push(...unwantedFiles);
    }
    const unmatchedLanguages = wantedLanguages.filter(it => !matchedWantedLanguages.has(it));
    if (unmatchedLanguages.length > 0) {
        builder_util_1.log.warn({ electronLanguages: unmatchedLanguages }, "some electronLanguages don't match any locale, they may be misspelled or unavailable on this platform");
    }
    await (0, tiny_async_pool_1.default)(builder_util_1.MAX_FILE_REQUESTS, filesToDelete, file => (0, fs_extra_1.rm)(file, { recursive: true, force: true }));
}
class ElectronFramework {
    constructor(name, version, macOsProductName) {
        this.name = name;
        this.version = version;
        this.macOsProductName = macOsProductName;
        // noinspection JSUnusedGlobalSymbols
        this.macOsDefaultTargets = ["zip", "dmg"];
        // noinspection JSUnusedGlobalSymbols
        this.defaultAppIdPrefix = "com.electron.";
        // noinspection JSUnusedGlobalSymbols
        this.isCopyElevateHelper = true;
        // noinspection JSUnusedGlobalSymbols
        this.isNpmRebuildRequired = true;
    }
    get distMacOsAppName() {
        return `${this.macOsProductName}.app`;
    }
    getDefaultIcon(platform) {
        if (platform === index_1.Platform.LINUX) {
            return path.join((0, pathManager_1.getTemplatePath)("icons"), "electron-linux");
        }
        else {
            // default icon is embedded into app skeleton
            return null;
        }
    }
    async prepareApplicationStageDirectory(options) {
        const downloadOptions = createDownloadOpts(options.packager.config, options.platformName, options.arch, this.version);
        const shouldCleanup = await unpack(options, downloadOptions, this.distMacOsAppName);
        await cleanupAfterUnpack(options, this.distMacOsAppName, shouldCleanup);
        if (options.packager.config.downloadAlternateFFmpeg) {
            const injector = new injectFFMPEG_1.FFMPEGInjector(options, this.version, createBrandingOpts(options.packager.config));
            await injector.inject();
        }
    }
    beforeCopyExtraFiles(options) {
        return beforeCopyExtraFiles(options);
    }
}
async function createElectronFrameworkSupport(configuration, packager) {
    let version = configuration.electronVersion;
    if (version == null) {
        // for prepacked app asar no dev deps in the app.asar
        if (packager.isPrepackedAppAsar) {
            version = await (0, electronVersion_1.getElectronVersionFromInstalled)(packager.projectDir);
            if (version == null) {
                throw new Error(`Cannot compute electron version for prepacked asar`);
            }
        }
        else {
            version = await (0, electronVersion_1.computeElectronVersion)(packager.projectDir);
        }
        configuration.electronVersion = version;
    }
    const branding = createBrandingOpts(configuration);
    return new ElectronFramework(branding.projectName, version, branding.productName);
}
/**
 * Unpacks a custom or default Electron distribution into the app output directory.
 */
async function unpack(prepareOptions, downloadOptions, _distMacOsAppName) {
    var _a, _b, _c;
    async function selectElectron(filepath) {
        const resolvedDist = path.isAbsolute(filepath) ? filepath : path.resolve(packager.projectDir, filepath);
        const electronDistStats = await (0, builder_util_1.statOrNull)(resolvedDist);
        if (!electronDistStats) {
            throw new Error(`The specified electronDist does not exist: ${resolvedDist}. Please provide a valid path to the Electron zip file, cache directory, or electron build directory.`);
        }
        if (resolvedDist.endsWith(".zip")) {
            builder_util_1.log.info({ zipFile: resolvedDist }, "using custom electronDist zip file");
            await (0, electronGet_1.extractArchive)(resolvedDist, appOutDir);
            return false; // do not clean up after unpacking, it's a custom bundle and we should respect its configuration/contents as required
        }
        if (electronDistStats.isDirectory()) {
            // backward compatibility: if electronDist is a directory, check for the default zip file inside it
            const files = await (0, fs_extra_1.readdir)(resolvedDist);
            if (files.includes(defaultZipName)) {
                builder_util_1.log.info({ electronDist: builder_util_1.log.filePath(resolvedDist) }, "using custom electronDist directory");
                await (0, electronGet_1.extractArchive)(path.join(resolvedDist, defaultZipName), appOutDir);
                return false; // do not clean up after unpacking, it's a custom bundle and we should respect its configuration/contents as required
            }
            // if we reach here, it means the provided electronDist is neither a zip file nor a directory with the default zip file
            // e.g. we treat it as a custom already-unpacked Electron distribution
            builder_util_1.log.info({ electronDist: builder_util_1.log.filePath(resolvedDist) }, "using custom unpacked Electron distribution");
            const source = packager.getElectronSrcDir(resolvedDist);
            const destination = packager.getElectronDestinationDir(prepareOptions.appOutDir);
            builder_util_1.log.info({ source, destination }, "copying unpacked Electron");
            await (0, fs_extra_1.emptyDir)(prepareOptions.appOutDir);
            await (0, builder_util_1.copyDir)(source, destination, {
                isUseHardLink: builder_util_1.DO_NOT_USE_HARD_LINKS,
            });
            return false;
        }
        throw new Error(`The specified electronDist is neither a zip file nor a directory: ${resolvedDist}. Please provide a valid path to the Electron zip file or cache directory.`);
    }
    const { packager, appOutDir, platformName } = prepareOptions;
    const { version, arch } = downloadOptions;
    const defaultZipName = `electron-v${version}-${platformName}-${arch}.zip`;
    const electronDist = packager.config.electronDist;
    if (typeof electronDist === "string" && !(0, builder_util_1.isEmptyOrSpaces)(electronDist)) {
        return selectElectron(electronDist);
    }
    let resolvedDist = null;
    try {
        const electronDistHook = await (0, resolve_1.resolveFunction)(packager.appInfo.type, electronDist, "electronDist", await packager.info.getWorkspaceRoot());
        resolvedDist = typeof electronDistHook === "function" ? await Promise.resolve(electronDistHook(prepareOptions)) : electronDistHook;
    }
    catch (error) {
        builder_util_1.log.warn({ error }, "Failed to resolve electronDist, using default unpack logic");
    }
    if (resolvedDist == null) {
        // if no custom electronDist is provided, use the default unpack logic
        builder_util_1.log.debug(null, "no custom electronDist provided, unpacking default Electron distribution");
        const zipPath = await (0, electronGet_1.downloadElectronArtifactZip)({
            electronDownload: downloadOptions,
            artifactName: "electron",
            platformName: (_a = downloadOptions.platform) !== null && _a !== void 0 ? _a : prepareOptions.platformName,
            arch: (_b = downloadOptions.arch) !== null && _b !== void 0 ? _b : prepareOptions.arch,
            version: (_c = downloadOptions.version) !== null && _c !== void 0 ? _c : prepareOptions.version,
        });
        await (0, electronGet_1.extractArchive)(zipPath, appOutDir);
        builder_util_1.log.info({ output: appOutDir }, "downloaded electron zip extracted successfully");
        return true; // indicates that we should clean up after unpacking
    }
    return selectElectron(resolvedDist);
}
function cleanupAfterUnpack(prepareOptions, distMacOsAppName, isFullCleanup) {
    const out = prepareOptions.appOutDir;
    const isMac = prepareOptions.packager.platform === index_1.Platform.MAC;
    const resourcesPath = isMac ? path.join(out, distMacOsAppName, "Contents", "Resources") : path.join(out, "resources");
    return Promise.all([
        isFullCleanup ? (0, builder_util_1.unlinkIfExists)(path.join(resourcesPath, "default_app.asar")) : Promise.resolve(),
        isFullCleanup ? (0, builder_util_1.unlinkIfExists)(path.join(out, "version")) : Promise.resolve(),
        retainElectronLicenseFiles(out, resourcesPath, isMac),
    ]);
}
/**
 * The Electron dist ships Electron's own `LICENSE` and Chromium's `LICENSES.chromium.html` next to the binary, and both licenses require them to be
 * retained in distributables. On win/linux they stay next to the executable, but on macOS they sit outside the `.app` bundle, which is the only thing
 * packaged into the artifacts, so move them into `Contents/Resources`. See https://github.com/electron-userland/electron-builder/issues/9407
 */
async function retainElectronLicenseFiles(appOutDir, resourcesPath, isMac) {
    const destinationDir = isMac ? resourcesPath : appOutDir;
    // a custom Electron distribution may not ship license files, so only a missing source file is tolerated; any other error propagates
    const move = (name, newName = name) => (0, builder_util_1.orIfFileNotExist)((0, fs_extra_1.rename)(path.join(appOutDir, name), path.join(destinationDir, newName)), undefined);
    await Promise.all([move("LICENSE", "LICENSE.electron.txt"), ...(isMac ? [move("LICENSES.chromium.html")] : [])]);
}
//# sourceMappingURL=ElectronFramework.js.map