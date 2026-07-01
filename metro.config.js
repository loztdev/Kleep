// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// @anthropic-ai/sdk unconditionally imports `node:fs`/`node:path` (via
// dynamic `import()`) for an optional file-based credential-storage
// feature this app never uses — see metroNodeStub.js for why that's safe
// to stub out. Metro has no Node core-module resolution, so bundling for
// a native target otherwise fails to resolve those specifiers even though
// the code paths that use them are never reached at runtime.
const originalResolveRequest = config.resolver.resolveRequest;
const NODE_BUILTIN_STUB = require.resolve("./metroNodeStub.js");
const STUBBED_NODE_MODULES = new Set(["node:fs", "node:path"]);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (STUBBED_NODE_MODULES.has(moduleName)) {
    return { type: "sourceFile", filePath: NODE_BUILTIN_STUB };
  }
  return originalResolveRequest
    ? originalResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
