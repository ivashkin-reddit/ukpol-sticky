import { devvit } from "@devvit/start/vite";
import { defineConfig } from "vite";

// devvit() builds the server from src/server/index.ts into dist/server/index.cjs, which devvit.json's "server" names.
export default defineConfig({ plugins: [devvit()] });
