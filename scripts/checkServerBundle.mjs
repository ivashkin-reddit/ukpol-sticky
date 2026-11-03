// Checks the server bundle `npm run build` wrote: it must hold the app's server and none of Blocks
// (@devvit/public-api), which the Devvit CLI still installs. The bundle's sourcemap names every module bundled into it.
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const SOURCE_MAP = new URL("../dist/server/index.cjs.map", import.meta.url);
const SERVER_ENTRY = "src/server/index.ts";
const BLOCKS_PACKAGE = "node_modules/@devvit/public-api/";

const sourceMap = readFileSync(SOURCE_MAP, "utf8");
const problems = [
    ...(sourceMap.includes(SERVER_ENTRY) ? [] : [`it does not contain ${SERVER_ENTRY}`]),
    ...(sourceMap.includes(BLOCKS_PACKAGE) ? [`it contains ${BLOCKS_PACKAGE}`] : []),
];

if (problems.length === 0) {
    process.stdout.write("The server bundle holds the app's server and no Blocks code.\n");
} else {
    process.stderr.write(`The server bundle is wrong: ${problems.join("; ")}.\n`);
    process.exitCode = 1;
}
