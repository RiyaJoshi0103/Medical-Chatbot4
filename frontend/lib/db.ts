import { Pool } from "pg";

const poolOption = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 30000, // ← give Neon time to wake up
  allowExitOnIdle: true,
};

let pool: any;

if (process.env.NODE_ENV === "production") {
  pool = new Pool(poolOption);
} else {
  // Guarantee connection pool is not recreated on hot reloads
  if (!(global as any).pgPool) {
    (global as any).pgPool = new Pool(poolOption);
  }
  pool = (global as any).pgPool;
}

pool.on("error", (err: any) => {
  console.error("Pool error:", err.message);
});

export default pool;

