import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companyService } from "../services/companies.js";

function createCompanyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "company-2",
    name: "test2",
    description: null,
    status: "active",
    issuePrefix: "TESA",
    issueCounter: 0,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    attachmentMaxBytes: 10 * 1024 * 1024,
    requireBoardApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    brandColor: null,
    logoAssetId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createEnvironmentRow(companyId: string) {
  return {
    id: "environment-1",
    companyId,
    name: "Local",
    description: "Default execution environment for Paperclip runs on this machine.",
    driver: "local",
    status: "active",
    config: {},
    metadata: {
      managedByPaperclip: true,
      defaultForCompany: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createSelectSequenceDb(results: unknown[]) {
  const pending = [...results];
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    then: vi.fn((resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(pending.shift() ?? []))),
  };

  return vi.fn(() => chain);
}

function createInsertChain(result: unknown[] | Error) {
  const chain = {
    values: vi.fn(() => chain),
    onConflictDoNothing: vi.fn(() => chain),
    returning: vi.fn(() => {
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    }),
    then: vi.fn((resolve: (value: unknown[]) => unknown) => {
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(resolve(result));
    }),
  };
  return chain;
}

describe("companyService", () => {
  it("retries generated issue prefixes when Drizzle wraps a duplicate constraint error", async () => {
    const duplicatePrefixError = Object.assign(new Error("Failed query"), {
      cause: {
        code: "23505",
        constraint: "companies_issue_prefix_idx",
      },
    });
    const createdCompany = createCompanyRow();
    const insertChains = [
      createInsertChain(duplicatePrefixError),
      createInsertChain([createdCompany]),
      createInsertChain([createEnvironmentRow(createdCompany.id)]),
    ];
    const db = {
      insert: vi.fn(() => insertChains.shift()),
      select: createSelectSequenceDb([[createdCompany], []]),
    };

    const created = await companyService(db as any).create({
      name: "test2",
      budgetMonthlyCents: 0,
    });

    expect(created.issuePrefix).toBe("TESA");
    expect(db.insert).toHaveBeenCalledTimes(3);
    expect(insertChains).toHaveLength(0);
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres company service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("companyService embedded Postgres", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-company-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("retries generated issue prefixes when Postgres reports the unique constraint error", async () => {
    await db.insert(companies).values({
      name: "Aron Existing",
      issuePrefix: "ARO",
    });

    const created = await companyService(db).create({
      name: "Aron & Sharon",
    });

    expect(created.issuePrefix).toBe("AROA");

    const rows = await db.select({ issuePrefix: companies.issuePrefix }).from(companies);
    expect(rows.map((row) => row.issuePrefix).sort()).toEqual(["ARO", "AROA"]);
  });
});
