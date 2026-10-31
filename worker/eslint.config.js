// ESLint の設定（TypeScript の推奨ルール + any の使用を警告）
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
  },
});
