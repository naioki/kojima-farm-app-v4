import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * フロントエンドの純ロジック用テスト設定。
 *
 * コンポーネントの描画テストは対象外（jsdom も入れていない）。
 * 対象は lib/ に切り出した「間違えると業務が壊れる」計算 —
 * 出荷順の比較、警告を出す行の判定、未処理件数の絞り込み。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
});
