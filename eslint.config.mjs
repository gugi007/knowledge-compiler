import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // `.vercel/**` 与 `.next`/`out`/`build` 同类：都是构建产物，都在 .gitignore 里，
  // 而 flat config 不读 .gitignore，漏掉它会让 Vercel 部署后 `npm run lint` 误报。
  globalIgnores([".next/**", "out/**", "build/**", ".vercel/**", "next-env.d.ts"]),
]);
