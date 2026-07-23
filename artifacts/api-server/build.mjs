import { build } from "esbuild";

// Bundle the server (and its workspace TS deps) into a single CJS file.
// node_modules are bundled too, except modules that must stay external:
//   - pino + transports use worker threads / dynamic requires that don't bundle
//   - native/optional binaries have no portable bundle form
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: true,
  minify: false,
  external: [
    "pino",
    "pino-http",
    "pino-pretty",
    "thread-stream",
    "pg-native",
    "cpu-features",
    "@google-cloud/storage",
  ],
});

console.log("api-server bundled -> dist/index.cjs");
