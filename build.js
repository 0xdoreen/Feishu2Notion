import * as esbuild from "esbuild";
import { cpSync, mkdirSync, existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outdir = "dist";

if (!existsSync(outdir)) mkdirSync(outdir);

const entryPoints = {
  background: "src/background/index.ts",
  content: "src/content/index.ts",
  popup: "src/popup/popup.ts",
  options: "src/options/options.ts",
};

const buildOptions = {
  entryPoints,
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome110",
  sourcemap: true,
  logLevel: "info",
};

function copyStaticFiles() {
  cpSync("manifest.json", `${outdir}/manifest.json`);
  cpSync("src/popup/popup.html", `${outdir}/popup.html`);
  cpSync("src/options/options.html", `${outdir}/options.html`);
  if (existsSync("icons")) cpSync("icons", `${outdir}/icons`, { recursive: true });
}

copyStaticFiles();

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("Build complete.");
}
