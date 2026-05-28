import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "../config.js";

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
  connectionTimeoutMillis: 10_000,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
