// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  renderCiTableLine,
  extractCiTable,
  replaceManagedLine,
  prepareCiTableUpdate,
  CONTRACT_ERROR,
} from "../src/extensions/stryd/ci-table.js";

/** A field script that has adopted the sentinel contract. */
function contractScript(managedLine = `  let CI_TABLE = {"default":57.4};`): string {
  return [
    "{",
    "  // === CI_TABLE_BEGIN (managed by intervals-mcp; do not edit this line by hand) ===",
    managedLine,
    "  // === CI_TABLE_END ===",
    "  let g = activity.gear_id;",
    '  let CI = (g && CI_TABLE[g]) ? CI_TABLE[g] : CI_TABLE["default"];',
    "  1.0;",
    "}",
  ].join("\n");
}

describe("renderCiTableLine", () => {
  it("default only", () => {
    expect(renderCiTableLine({ default: 57.4 })).toBe('let CI_TABLE = {"default":57.4};');
  });

  it("default first, then gear_id keys ascending numeric (not JS object order)", () => {
    // Insertion order deliberately scrambled; output must be default → 60751 → 60752.
    const line = renderCiTableLine({ default: 57.4, entries: { "60752": 58, "60751": 59 } });
    expect(line).toBe('let CI_TABLE = {"default":57.4,"60751":59,"60752":58};');
  });

  it("renders integers without a trailing .0", () => {
    expect(renderCiTableLine({ default: 60 })).toBe('let CI_TABLE = {"default":60};');
  });
});

describe("extractCiTable", () => {
  it("parses the managed line into a value table", () => {
    expect(extractCiTable(contractScript())).toEqual({ default: 57.4 });
    expect(
      extractCiTable(contractScript(`  let CI_TABLE = {"default":57.4,"60751":59};`)),
    ).toEqual({ default: 57.4, "60751": 59 });
  });

  it("throws when no markers (contract not adopted)", () => {
    const plain = "{\n  let CI = 57.4;\n  1.0;\n}";
    expect(() => extractCiTable(plain)).toThrow(CONTRACT_ERROR);
  });

  it("throws on duplicate BEGIN markers", () => {
    const dup = contractScript() + "\n// === CI_TABLE_BEGIN dup ===";
    expect(() => extractCiTable(dup)).toThrow(CONTRACT_ERROR);
  });

  it("throws when more than one line sits between the markers", () => {
    const twoLines = [
      "{",
      "  // === CI_TABLE_BEGIN ===",
      '  let CI_TABLE = {"default":57.4};',
      "  let sneaky = 1;",
      "  // === CI_TABLE_END ===",
      "}",
    ].join("\n");
    expect(() => extractCiTable(twoLines)).toThrow(CONTRACT_ERROR);
  });

  it("throws when the managed line is not a CI_TABLE object of numbers", () => {
    expect(() => extractCiTable(contractScript(`  let CI_TABLE = "nope";`))).toThrow(CONTRACT_ERROR);
    expect(() => extractCiTable(contractScript(`  let CI_TABLE = {"default":"x"};`))).toThrow(CONTRACT_ERROR);
  });
});

describe("replaceManagedLine", () => {
  it("replaces only the managed line, preserving indent and all other lines", () => {
    const before = contractScript();
    const after = replaceManagedLine(before, 'let CI_TABLE = {"default":60,"60751":58};');
    expect(after).toContain('  let CI_TABLE = {"default":60,"60751":58};'); // 2-space indent kept
    // Everything else identical: same line count, markers + logic intact.
    expect(after.split("\n").length).toBe(before.split("\n").length);
    expect(after).toContain('let CI = (g && CI_TABLE[g]) ? CI_TABLE[g] : CI_TABLE["default"];');
    expect(after).toContain("CI_TABLE_BEGIN");
    expect(after).toContain("CI_TABLE_END");
  });

  it("throws (writes nothing) when the contract is absent", () => {
    expect(() => replaceManagedLine("{ let CI = 1; }", "let CI_TABLE = {};")).toThrow(CONTRACT_ERROR);
  });
});

describe("prepareCiTableUpdate", () => {
  it("returns current table, new line, and updated content in one pass", () => {
    const { currentTable, newLine, newContent } = prepareCiTableUpdate(contractScript(), {
      default: 60,
      entries: { "60751": 58 },
    });
    expect(currentTable).toEqual({ default: 57.4 });
    expect(newLine).toBe('let CI_TABLE = {"default":60,"60751":58};');
    expect(extractCiTable(newContent)).toEqual({ default: 60, "60751": 58 });
  });

  it("throws on a contract-less script", () => {
    expect(() => prepareCiTableUpdate("{ let CI = 1; }", { default: 60 })).toThrow(CONTRACT_ERROR);
  });
});
