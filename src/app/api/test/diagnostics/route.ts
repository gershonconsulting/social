export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { validateTestApiKey } from "@/lib/test-auth";
import prisma from "@/lib/db";

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

async function runCheck(
  name: string,
  fn: () => Promise<{ status: "pass" | "fail" | "warn"; message: string; details?: Record<string, unknown> }>
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return { name, ...result, durationMs: Date.now() - start };
  } catch (error: unknown) {
    return {
      name,
      status: "fail",
      message: error instanceof Error ? error.message : "Unknown error",
      durationMs: Date.now() - start,
    };
  }
}

/**
 * GET /api/test/diagnostics
 *
 * Deep system check â exercises the database schema, checks all tables exist,
 * validates environment variables, and tests internal consistency.
 * OpenClaw uses this to understand the full state of the application.
 *
 * Returns an array of check results, each with pass/fail/warn status.
 */
export async function GET(req: NextRequest) {
  const authError = validateTestApiKey(req);
  if (authError) return authError;

  const checks: CheckResult[] = [];

  // 1. Database connection
  checks.push(
    await runCheck("database_connection", async () => {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "pass", message: "Database is reachable" };
    })
  );

  // 2. Check all expected tables exist and are queryable
  const tables = [
    { name: "client", query: () => prisma.client.count() },
  ];

  // Dynamically check for optional tables that may not exist yet
  const optionalTables = ["platformConnection", "socialPost"] as const;

  for (const table of tables) {
    checks.push(
      await runCheck(`table_${table.name}`, async () => {
        const count = await table.query();
        return {
          status: "pass",
          message: `Table accessible, ${count} rows`,
          details: { rowCount: count },
        };
      })
    );
  }

  for (const tableName of optionalTables) {
    checks.push(
      await runCheck(`table_${tableName}`, async () => {
        try {
          const count = await (prisma as any)[tableName].count();
          return {
            status: "pass",
            message: `Table accessible, ${count} rows`,
            details: { rowCount: count },
          };
        } catch {
          return {
            status: "warn",
            message: `Table "${tableName}" not found or not accessible â may not be migrated yet`,
          };
        }
      })
    );
  }

  // 3. Environment variables
  const requiredEnvVars = ["DATABASE_URL"];
  const optionalEnvVars = [
    "NEXT_PUBLIC_APP_VERSION",
    "NEXT_PUBLIC_BUILD_DATE",
    "TEST_API_KEY",
  ];

  for (const envVar of requiredEnvVars) {
    checks.push(
      await runCheck(`env_${envVar}`, async () => {
        const value = process.env[envVar];
        if (!value) {
          return { status: "fail", message: `${envVar} is not set` };
        }
        // Don't leak the actual value â just confirm it's present
        return {
          status: "pass",
          message: `${envVar} is set (${value.length} chars)`,
          details: { length: value.length },
        };
      })
    );
  }

  for (const envVar of optionalEnvVars) {
    checks.push(
      await runCheck(`env_${envVar}`, async () => {
        const value = process.env[envVar];
        if (!value) {
          return { status: "warn", message: `${envVar} is not set (optional)` };
        }
        return {
          status: "pass",
          message: `${envVar} is set`,
        };
      })
    );
  }

  // 4. Data integrity checks
  checks.push(
    await runCheck("data_integrity_client_slugs", async () => {
      try {
        const clients = await prisma.client.findMany({
          select: { id: true, slug: true, name: true },
        });
        const slugs = clients.map((c) => c.slug);
        const duplicates = slugs.filter((s, i) => slugs.indexOf(s) !== i);
        if (duplicates.length > 0) {
          return {
            status: "fail",
            message: `Duplicate slugs found: ${duplicates.join(", ")}`,
            details: { duplicates },
          };
        }
        const invalidSlugs = clients.filter(
          (c) => !c.slug || !/^[a-z0-9-]+$/.test(c.slug)
        );
        if (invalidSlugs.length > 0) {
          return {
            status: "warn",
            message: `${invalidSlugs.length} client(s) with invalid slug format`,
            details: {
              invalidClients: invalidSlugs.map((c) => ({
                id: c.id,
                slug: c.slug,
              })),
            },
          };
        }
        return {
          status: "pass",
          message: `All ${clients.length} client slugs are valid and unique`,
        };
      } catch {
        return { status: "warn", message: "Could not check client slugs" };
      }
    })
  );

  checks.push(
    await runCheck("data_integrity_orphaned_connections", async () => {
      try {
        const orphaned = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count FROM "PlatformConnection" pc
          LEFT JOIN "Client" c ON pc."clientId" = c.id
          WHERE c.id IS NULL
        `;
        const count = Number(orphaned[0]?.count ?? 0);
        if (count > 0) {
          return {
            status: "warn",
            message: `${count} platform connection(s) reference non-existent clients`,
            details: { orphanedCount: count },
          };
        }
        return {
          status: "pass",
          message: "No orphaned platform connections",
        };
      } catch {
        return {
          status: "warn",
          message: "Could not check for orphaned connections (table may not exist)",
        };
      }
    })
  );

  // 5. Schema version check
  checks.push(
    await runCheck("schema_migrations", async () => {
      try {
        const migrations = await prisma.$queryRaw<
          { migration_name: string; finished_at: Date }[]
        >`SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 5`;
        return {
          status: "pass",
          message: `${migrations.length} recent migration(s) applied`,
          details: {
            latestMigrations: migrations.map((m) => ({
              name: m.migration_name,
              appliedAt: m.finished_at,
            })),
          },
        };
      } catch {
        return {
          status: "warn",
          message: "Could not read migration history",
        };
      }
    })
  );

  // Summary
  const passed = checks.filter((c) => c.status === "pass").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const totalMs = checks.reduce((sum, c) => sum + c.durationMs, 0);

  return NextResponse.json({
    success: true,
    data: {
      summary: {
        total: checks.length,
        passed,
        warned,
        failed,
        overallStatus: failed > 0 ? "unhealthy" : warned > 0 ? "degraded" : "healthy",
        totalDurationMs: totalMs,
      },
      checks,
      timestamp: new Date().toISOString(),
    },
  });
}
