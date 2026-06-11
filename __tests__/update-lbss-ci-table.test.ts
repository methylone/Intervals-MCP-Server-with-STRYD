// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  updateLbssCiTableTool,
  resolveTargetCodes,
} from "../src/extensions/stryd/tools/update-lbss-ci-table.js";

// Test env: LBSS_FIELD=StrydLBSSv2 (default), ECC_FIELD=EccLBSS (default).
type Call = { path: string; method: string; body?: unknown };

function contractScript(line = `  let CI_TABLE = {"default":57.4};`): string {
  return [
    "{",
    "  // === CI_TABLE_BEGIN (managed) ===",
    line,
    "  // === CI_TABLE_END ===",
    '  let CI = CI_TABLE["default"];',
    "  1.0;",
    "}",
  ].join("\n");
}

/** Stateful custom-item store: GET returns current state, PUT overwrites by id. */
function stubItems(items: Array<{ id: number; code: string; script: string }>) {
  const state = new Map<string, Record<string, unknown>>();
  for (const it of items) {
    state.set(String(it.id), {
      id: it.id,
      name: it.code,
      content: { code: it.code, type: "numeric", units: "x", script: it.script },
    });
  }
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path: u.pathname, method, body });
      if (method === "PUT") {
        const id = u.pathname.split("/").pop()!;
        state.set(id, body as Record<string, unknown>);
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify([...state.values()]), { status: 200 }));
    }),
  );
  return { calls };
}

const puts = (c: Call[]) => c.filter((x) => x.method === "PUT");

afterEach(() => vi.unstubAllGlobals());

const bothFields = () => [
  { id: 1108590, code: "StrydLBSSv2", script: contractScript() },
  { id: 1108592, code: "EccLBSS", script: contractScript() },
];

describe("resolveTargetCodes (pure)", () => {
  it("targets both LBSS and Ecc when ECC_FIELD is non-empty", () => {
    expect(resolveTargetCodes("StrydLBSSv2", "EccLBSS")).toEqual({
      codes: ["StrydLBSSv2", "EccLBSS"],
      eccDisabled: false,
    });
  });
  it("targets LBSS only when ECC_FIELD is empty", () => {
    expect(resolveTargetCodes("StrydLBSSv2", "")).toEqual({
      codes: ["StrydLBSSv2"],
      eccDisabled: true,
    });
  });
});

describe("update_lbss_ci_table — dry-run (default)", () => {
  it("does NOT write; returns per-field before/after for both fields", async () => {
    const { calls } = stubItems(bothFields());

    const out = (await updateLbssCiTableTool.handler({
      ci_table: { default: 60, entries: { "60751": 58 } },
    })) as {
      applied: boolean;
      ecc_disabled: boolean;
      target_fields: string[];
      fields: Array<{ field: string; current_table: unknown; line_before: string; line_after: string }>;
      reanalysis_note: string;
    };

    expect(out.applied).toBe(false);
    expect(puts(calls)).toHaveLength(0); // no write
    expect(out.ecc_disabled).toBe(false);
    expect(out.target_fields).toEqual(["StrydLBSSv2", "EccLBSS"]);
    expect(out.fields).toHaveLength(2);
    expect(out.fields[0].current_table).toEqual({ default: 57.4 });
    expect(out.fields[0].line_before).toBe('let CI_TABLE = {"default":57.4};');
    expect(out.fields[0].line_after).toBe('let CI_TABLE = {"default":60,"60751":58};');
    expect(out.reanalysis_note).toMatch(/Keep existing intervals/);
  });
});

describe("update_lbss_ci_table — apply", () => {
  it("writes both fields and read-back verifies", async () => {
    const { calls } = stubItems(bothFields());

    const out = (await updateLbssCiTableTool.handler({
      ci_table: { default: 60 },
      apply: true,
    })) as {
      applied: boolean;
      fields: Array<{ field: string; verified: boolean; backup_content: string }>;
    };

    expect(out.applied).toBe(true);
    expect(puts(calls).map((c) => c.path)).toEqual([
      "/api/v1/athlete/i12345678/custom-item/1108590",
      "/api/v1/athlete/i12345678/custom-item/1108592",
    ]);
    expect(out.fields.every((f) => f.verified)).toBe(true);
    // backup retains the pre-write script
    expect(out.fields[0].backup_content).toContain('let CI_TABLE = {"default":57.4};');
    // the PUT body carried the rewritten managed line
    const put0 = puts(calls)[0].body as { content: { script: string } };
    expect(put0.content.script).toContain('let CI_TABLE = {"default":60};');
  });
});

describe("update_lbss_ci_table — abort (no partial write)", () => {
  it("throws and writes nothing when ANY field lacks the sentinel contract", async () => {
    const { calls } = stubItems([
      { id: 1108590, code: "StrydLBSSv2", script: contractScript() },
      { id: 1108592, code: "EccLBSS", script: "{ let CI = 57.4; 1.0; }" }, // no markers
    ]);

    await expect(
      updateLbssCiTableTool.handler({ ci_table: { default: 60 }, apply: true }),
    ).rejects.toThrow(/EccLBSS/);
    expect(puts(calls)).toHaveLength(0); // nothing written
  });

  it("throws when a target field code is not found", async () => {
    stubItems([{ id: 1108590, code: "StrydLBSSv2", script: contractScript() }]); // no EccLBSS
    await expect(
      updateLbssCiTableTool.handler({ ci_table: { default: 60 } }),
    ).rejects.toThrow(/EccLBSS|not found/);
  });
});

describe("update_lbss_ci_table — schema", () => {
  const schema = z.object(updateLbssCiTableTool.schema);

  it("requires default within 20–120", () => {
    expect(schema.safeParse({ ci_table: { default: 57 } }).success).toBe(true);
    expect(schema.safeParse({ ci_table: {} }).success).toBe(false);
    expect(schema.safeParse({ ci_table: { default: 10 } }).success).toBe(false);
    expect(schema.safeParse({ ci_table: { default: 200 } }).success).toBe(false);
  });

  it("validates entries: numeric gear_id keys, values 20–120", () => {
    expect(schema.safeParse({ ci_table: { default: 57, entries: { "60751": 58 } } }).success).toBe(true);
    expect(schema.safeParse({ ci_table: { default: 57, entries: { abc: 58 } } }).success).toBe(false);
    expect(schema.safeParse({ ci_table: { default: 57, entries: { "60751": 5 } } }).success).toBe(false);
  });
});
