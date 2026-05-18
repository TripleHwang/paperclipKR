import { applyPendingMigrations, inspectMigrations } from "./client.js";
import { resolveMigrationConnection, type MigrationConnection } from "./migration-runtime.js";

const STOP_TIMEOUT_MS = 5_000;

async function stopMigrationConnection(resolved: MigrationConnection): Promise<void> {
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const stop = resolved.stop().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Unable to stop ${resolved.source} cleanly: ${message}`);
  });
  const stopTimeout = new Promise<void>((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      resolve();
    }, STOP_TIMEOUT_MS);
  });

  await Promise.race([stop, stopTimeout]);
  if (timeout) clearTimeout(timeout);
  if (timedOut) {
    console.warn(`Timed out stopping ${resolved.source}; continuing startup.`);
  }
}

async function main(): Promise<void> {
  const resolved = await resolveMigrationConnection();

  console.log(`Migrating database via ${resolved.source}`);

  try {
    const before = await inspectMigrations(resolved.connectionString);
    if (before.status === "upToDate") {
      console.log("No pending migrations");
      return;
    }

    console.log(`Applying ${before.pendingMigrations.length} pending migration(s)...`);
    await applyPendingMigrations(resolved.connectionString);

    const after = await inspectMigrations(resolved.connectionString);
    if (after.status !== "upToDate") {
      throw new Error(`Migrations incomplete: ${after.pendingMigrations.join(", ")}`);
    }
    console.log("Migrations complete");
  } finally {
    await stopMigrationConnection(resolved);
  }
}

await main();
