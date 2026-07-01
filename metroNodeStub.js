/**
 * Stand-in for Node's `fs`/`path` core modules when Metro bundles for a
 * native (Android/iOS) target — see metro.config.js. Only resolved because
 * @anthropic-ai/sdk's optional file-based credential storage (workload
 * identity / OAuth token caching) imports `node:fs`/`node:path` at module
 * scope; this app never calls those functions (ClaudeClient/ClaudeProvider
 * are always constructed with an explicit apiKey — see
 * src/claude/secureKeyStore.ts / src/llm/secureKeyStore.ts), so nothing
 * here is meant to actually execute.
 */
module.exports = {};
