"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIconsToolsetPath = getIconsToolsetPath;
exports.runIconsTool = runIconsTool;
const builder_util_1 = require("builder-util");
const path = require("path");
const electronGet_1 = require("../util/electronGet");
const iconsToolsChecksums = {
    "icons-bundle.tar.gz": "4e5bb546c9d3ab0c2bbacc22857467bf415f742a34c2be9dd138779d2fc066f9",
};
async function getIconsToolsetPath() {
    const envPath = await (0, builder_util_1.resolveEnvToolsetPath)("ELECTRON_BUILDER_ICONS_TOOLSET_DIR", "directory");
    if (envPath != null) {
        return envPath;
    }
    return (0, electronGet_1.downloadBuilderToolset)({
        releaseName: "icons@1.2.3",
        filenameWithExt: "icons-bundle.tar.gz",
        checksums: iconsToolsChecksums,
        githubOrgRepo: "electron-userland/electron-builder-binaries",
    });
}
const VALID_OUTPUT_FORMATS = ["icns", "ico", "set"];
async function runIconsTool({ inputFile, outputFormat, outDir }) {
    if (!VALID_OUTPUT_FORMATS.includes(outputFormat)) {
        throw new builder_util_1.InvalidConfigurationError(`Invalid icon output format: ${outputFormat}`);
    }
    const safeInput = (0, builder_util_1.sanitizeDirPath)(inputFile);
    const safeOutDir = (0, builder_util_1.sanitizeDirPath)(outDir);
    const toolsetPath = await getIconsToolsetPath();
    const scriptPath = path.resolve(toolsetPath, "icon-tool.js");
    if (!(await (0, builder_util_1.exists)(scriptPath))) {
        throw new builder_util_1.InvalidConfigurationError(`Icons tool not found at expected path: ${scriptPath}`);
    }
    await (0, builder_util_1.exec)(process.execPath, [scriptPath, `--input=${safeInput}`, `--format=${outputFormat}`, `--out=${safeOutDir}`], { shell: false });
}
//# sourceMappingURL=icons.js.map