// Type-checks V2's own code strictly, and the code adapted from Outliner (src/outliner/) with
// Outliner's looser settings, so that code can stay identical to upstream.
import { spawnSync } from "node:child_process";

function tsc(project) {
  const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false", "-p", project], {
    encoding: "utf8",
    shell: true
  });
  return result.stdout + result.stderr;
}

// Each diagnostic starts at column 0 with its file path; indented lines continue it.
function diagnostics(output) {
  const groups = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\s/.test(line) && groups.length > 0) groups[groups.length - 1] += "\n" + line;
    else groups.push(line);
  }
  return groups;
}

const isOutliner = (diagnostic) => diagnostic.replaceAll("\\", "/").startsWith("src/outliner/");
const strict = diagnostics(tsc("tsconfig.json")).filter((diagnostic) => !isOutliner(diagnostic));
const outliner = diagnostics(tsc("tsconfig.outliner.json"));
const errors = [...strict, ...outliner];
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Type-check passed.");
