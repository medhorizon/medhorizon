import { defineConfig } from "vitest/config"
import solidPlugin from "vite-plugin-solid"

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    conditions: ["browser", "development"],
  },
  test: {
    environment: "jsdom",
    include: ["src/components/async-state.test.tsx"],
    css: false,
  },
})
