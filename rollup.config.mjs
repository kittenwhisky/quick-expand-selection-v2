import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const isProduction = process.env.BUILD === "production";

export default {
  input: "src/main.ts",
  output: {
    file: "main.js",
    format: "cjs",
    sourcemap: !isProduction,
    exports: "default"
  },
  // src/outliner/ is type-checked with Outliner's own settings by `npm run typecheck`; don't
  // repeat strict-mode warnings for it here.
  onwarn(warning, warn) {
    if (warning.plugin === "typescript" && /[\\/]src[\\/]outliner[\\/]/.test(warning.loc?.file ?? warning.message)) return;
    warn(warning);
  },
  external: ["obsidian", "@codemirror/language", "@codemirror/state", "@codemirror/view"],
  plugins: [
    nodeResolve({ browser: true }),
    typescript({
      tsconfig: "./tsconfig.build.json",
      compilerOptions: {
        declaration: false,
        sourceMap: !isProduction
      }
    })
  ]
};
