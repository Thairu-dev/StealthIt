"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determinePackageManagerEnv = exports.PM = exports.getPackageManagerCommand = void 0;
exports.getCollectorByPackageManager = getCollectorByPackageManager;
exports.findWorkspaceRoot = findWorkspaceRoot;
const npmNodeModulesCollector_1 = require("./npmNodeModulesCollector");
const packageManager_1 = require("./packageManager");
Object.defineProperty(exports, "getPackageManagerCommand", { enumerable: true, get: function () { return packageManager_1.getPackageManagerCommand; } });
Object.defineProperty(exports, "PM", { enumerable: true, get: function () { return packageManager_1.PM; } });
const pnpmNodeModulesCollector_1 = require("./pnpmNodeModulesCollector");
const yarnBerryNodeModulesCollector_1 = require("./yarnBerryNodeModulesCollector");
const yarnNodeModulesCollector_1 = require("./yarnNodeModulesCollector");
const bunNodeModulesCollector_1 = require("./bunNodeModulesCollector");
const lazy_val_1 = require("lazy-val");
const builder_util_1 = require("builder-util");
const fs = require("fs-extra");
const path = require("path");
const traversalNodeModulesCollector_1 = require("./traversalNodeModulesCollector");
function getCollectorByPackageManager(pm, rootDir, tempDirManager) {
    switch (pm) {
        case packageManager_1.PM.PNPM:
            return new pnpmNodeModulesCollector_1.PnpmNodeModulesCollector(rootDir, tempDirManager);
        case packageManager_1.PM.YARN:
            return new yarnNodeModulesCollector_1.YarnNodeModulesCollector(rootDir, tempDirManager);
        case packageManager_1.PM.YARN_BERRY:
            return new yarnBerryNodeModulesCollector_1.YarnBerryNodeModulesCollector(rootDir, tempDirManager);
        case packageManager_1.PM.BUN:
            return new bunNodeModulesCollector_1.BunNodeModulesCollector(rootDir, tempDirManager);
        case packageManager_1.PM.NPM:
            return new npmNodeModulesCollector_1.NpmNodeModulesCollector(rootDir, tempDirManager);
        case packageManager_1.PM.TRAVERSAL:
            return new traversalNodeModulesCollector_1.TraversalNodeModulesCollector(rootDir, tempDirManager);
    }
}
const determinePackageManagerEnv = ({ projectDir, appDir, workspaceRoot }) => new lazy_val_1.Lazy(async () => {
    const availableDirs = [workspaceRoot, projectDir, appDir].filter((it) => !(0, builder_util_1.isEmptyOrSpaces)(it));
    const pm = await (0, packageManager_1.detectPackageManager)(availableDirs);
    const root = await findWorkspaceRoot(pm.pm, projectDir);
    if (root != null) {
        // re-detect package manager from workspace root, this seems particularly necessary for pnpm workspaces
        const actualPm = await (0, packageManager_1.detectPackageManager)([root]);
        if (actualPm.resolvedDirectory == null) {
            // The root was located from the workspace config (e.g. `pnpm-workspace.yaml`) but carries neither a lockfile nor a
            // `packageManager` field, so detection fell through to the process environment and resolved no directory. Dropping the
            // root here silently confines `@electron/rebuild` to the app dir (#10187), so keep the located directory instead.
            builder_util_1.log.warn({ root: builder_util_1.log.filePath(root), pm: pm.pm, projectDir: builder_util_1.log.filePath(projectDir) }, "workspace root located, but no lockfile or `packageManager` field was found there to re-detect the package manager; using it as-is");
            return {
                pm: pm.pm,
                workspaceRoot: Promise.resolve(root),
            };
        }
        builder_util_1.log.info({ pm: actualPm.pm, config: actualPm.corepackConfig, resolved: actualPm.resolvedDirectory, projectDir }, `detected workspace root for project using ${actualPm.detectionMethod}`);
        return {
            pm: actualPm.pm,
            workspaceRoot: Promise.resolve(actualPm.resolvedDirectory),
        };
    }
    return {
        pm: pm.pm,
        workspaceRoot: Promise.resolve(pm.resolvedDirectory),
    };
});
exports.determinePackageManagerEnv = determinePackageManagerEnv;
/** @internal exported for tests */
async function findWorkspaceRoot(pm, cwd) {
    if (pm === packageManager_1.PM.PNPM) {
        // pnpm itself locates the workspace root with a plain upward search for `pnpm-workspace.yaml` (@pnpm/find-workspace-dir), so
        // mirror that on disk instead of shelling out to `pnpm --workspace-root exec pwd`. `pwd` is a POSIX command: on Windows it is
        // either missing (so detection fell back to a `package.json#workspaces` walk, which pnpm workspaces do not use) or resolves to
        // the Git-for-Windows binary, whose MSYS-style `/d/a/repo` output is not a usable path. Either way the root was lost and
        // `@electron/rebuild` never reached native modules stored under the root `node_modules/.pnpm` (#10187).
        const root = await findNearestDir(cwd, dir => (0, builder_util_1.exists)(path.join(dir, "pnpm-workspace.yaml")));
        if (root != null) {
            builder_util_1.log.debug({ path: root }, "identified pnpm workspace root");
            return root;
        }
        return findNearestPackageJsonWithWorkspacesField(cwd);
    }
    let command;
    switch (pm) {
        case packageManager_1.PM.YARN_BERRY:
            command = { command: "yarn", args: ["workspaces", "list", "--json"] };
            break;
        case packageManager_1.PM.YARN: {
            command = { command: "yarn", args: ["workspaces", "info", "--silent"] };
            break;
        }
        case packageManager_1.PM.BUN:
            command = { command: "bun", args: ["pm", "ls", "--json"] };
            break;
        case packageManager_1.PM.NPM:
        default:
            command = { command: "npm", args: ["prefix", "-w"] };
            break;
    }
    const output = await (0, builder_util_1.spawn)(command.command, command.args, { cwd, stdio: ["ignore", "pipe", "ignore"] })
        .then(async (it) => {
        const out = it === null || it === void 0 ? void 0 : it.trim();
        if (!out) {
            return undefined;
        }
        if (pm === packageManager_1.PM.YARN) {
            JSON.parse(out); // if JSON valid, workspace detected
            return findNearestPackageJsonWithWorkspacesField(cwd);
        }
        else if (pm === packageManager_1.PM.BUN) {
            const json = JSON.parse(out);
            if (Array.isArray(json) && json.length > 0) {
                return findNearestPackageJsonWithWorkspacesField(cwd);
            }
        }
        else if (pm === packageManager_1.PM.YARN_BERRY) {
            const lines = out
                .split("\n")
                .map(l => l.trim())
                .filter(Boolean);
            for (const line of lines) {
                const parsed = JSON.parse(line);
                if (parsed.location != null) {
                    const potential = path.resolve(cwd, parsed.location);
                    return (await (0, builder_util_1.exists)(potential)) ? findNearestPackageJsonWithWorkspacesField(potential) : undefined;
                }
            }
        }
        return out.length === 0 || out === "undefined" ? undefined : out;
    })
        .catch((error) => {
        var _a;
        builder_util_1.log.debug({ command: `${command.command} ${command.args.join(" ")}`, error: (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : error }, "workspace root command failed, falling back to package.json walk");
        return findNearestPackageJsonWithWorkspacesField(cwd);
    });
    return output;
}
async function findNearestPackageJsonWithWorkspacesField(dir) {
    const root = await findNearestDir(dir, async (current) => {
        try {
            const pkg = JSON.parse(await fs.readFile(path.join(current, "package.json"), "utf8"));
            return !!pkg.workspaces;
        }
        catch {
            return false;
        }
    });
    if (root != null) {
        builder_util_1.log.debug({ path: root }, "identified workspace root");
    }
    return root;
}
/** Walks from `dir` up to the filesystem root and returns the first directory for which `isRoot` holds. */
async function findNearestDir(dir, isRoot) {
    let current = dir;
    while (true) {
        if (await isRoot(current)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}
//# sourceMappingURL=index.js.map