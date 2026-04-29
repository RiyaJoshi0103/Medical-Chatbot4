import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 30000, // ← give Neon time to wake up
  allowExitOnIdle: true,
});

// This keeps the connection alive
pool.on("error", (err) => {
  console.error("Pool error:", err.message);
});

export default pool;
