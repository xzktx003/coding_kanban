const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Let Metro resolve workspace deps (especially @agent-orchestrator/shared)
// and watch the monorepo root for changes.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Module name map for workspace packages whose "main" is ESM dist.
config.resolver.extraNodeModules = {
  "@agent-orchestrator/shared": path.resolve(
    workspaceRoot,
    "packages/shared",
  ),
};

module.exports = config;
