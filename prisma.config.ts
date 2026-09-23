import "dotenv/config";
import { defineConfig } from "prisma/config";

// NOTE: We intentionally do NOT use prisma's `env("DATABASE_URL")` helper here.
// That helper resolves eagerly at config-load time and throws
// `PrismaConfigEnvError` when the variable is missing. During the Docker build
// stage `prisma generate` runs before any env vars are injected, which broke
// the build. `prisma generate` only reads the schema and does not need a DB
// connection, so we read DATABASE_URL directly (undefined during build is fine).
// At runtime (migrate deploy + the app), Render injects the real value.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
});