// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  parseDate,
  formatDate,
  addDays,
  dateRange,
  toWeekStart,
  today,
} from "../src/utils/date.js";

// ─── parseDate / formatDate ───────────────────────────────────────────────────

describe("parseDate", () => {
  it("UTC 深夜0時にアンカーする", () => {
    const d = parseDate("2024-01-15");
    expect(d.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("Date の YYYY-MM-DD パースと同じ UTC 日付になる", () => {
    // new Date("2024-01-15") は UTC 00:00 = 2024-01-15T00:00:00Z
    const naive = new Date("2024-01-15");
    const parsed = parseDate("2024-01-15");
    expect(parsed.getTime()).toBe(naive.getTime());
  });

  it("formatDate と往復変換が一致する", () => {
    const dates = ["2024-01-01", "2024-06-15", "2024-12-31", "2023-12-31"];
    for (const d of dates) {
      expect(formatDate(parseDate(d), "Asia/Tokyo")).toBe(d);
    }
  });
});

describe("formatDate", () => {
  it("東京時間で日付を返す (UTC との差が出るケース)", () => {
    // 2024-01-14T15:00:00Z = 東京 2024-01-15T00:00:00+09:00 → "2024-01-15"
    expect(formatDate(new Date("2024-01-14T15:00:00Z"), "Asia/Tokyo")).toBe("2024-01-15");
  });

  it("UTC では前日になる時刻でも東京日付を返す", () => {
    // 2024-01-14T23:59:59Z → UTC は 2024-01-14, 東京は 2024-01-15T08:59:59+09:00 → "2024-01-15"
    expect(formatDate(new Date("2024-01-14T23:59:59Z"), "Asia/Tokyo")).toBe("2024-01-15");
  });

  it("東京深夜の直前 (UTC 14:59) は前日になる", () => {
    // 2024-01-14T14:59:59Z → 東京 2024-01-14T23:59:59+09:00 → "2024-01-14"
    expect(formatDate(new Date("2024-01-14T14:59:59Z"), "Asia/Tokyo")).toBe("2024-01-14");
  });

  it("America/New_York の spring-forward 直前で現地日付を返す", () => {
    expect(formatDate(new Date("2024-03-10T04:30:00Z"), "America/New_York")).toBe(
      "2024-03-09",
    );
  });

  it("America/New_York の fall-back 直前で現地日付を返す", () => {
    expect(formatDate(new Date("2024-11-03T03:30:00Z"), "America/New_York")).toBe(
      "2024-11-02",
    );
  });

  it("Europe/London の BST 境界で現地日付を返す", () => {
    expect(formatDate(new Date("2024-03-31T23:30:00Z"), "Europe/London")).toBe(
      "2024-04-01",
    );
  });
});

// ─── today ────────────────────────────────────────────────────────────────────

describe("today", () => {
  it("YYYY-MM-DD 形式の文字列を返す", () => {
    expect(today("Asia/Tokyo")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── addDays ──────────────────────────────────────────────────────────────────

describe("addDays", () => {
  it("+1 日", () => {
    expect(addDays("2024-01-15", 1)).toBe("2024-01-16");
  });

  it("-1 日", () => {
    expect(addDays("2024-01-15", -1)).toBe("2024-01-14");
  });

  it("0 日（同日）", () => {
    expect(addDays("2024-01-15", 0)).toBe("2024-01-15");
  });

  it("年末 → 年初（年跨ぎ）", () => {
    expect(addDays("2023-12-31", 1)).toBe("2024-01-01");
  });

  it("年初 → 前年末（逆方向 年跨ぎ）", () => {
    expect(addDays("2024-01-01", -1)).toBe("2023-12-31");
  });

  it("月末 → 翌月初（月跨ぎ）", () => {
    expect(addDays("2024-01-31", 1)).toBe("2024-02-01");
  });

  it("うるう年 2/28 → 2/29", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("うるう年 2/29 → 3/1", () => {
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("平年 2/28 → 3/1（2/29 は存在しない）", () => {
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("うるう年を含む 366 日後", () => {
    // 2024 はうるう年（366日）→ 2024-01-01 + 366 = 2025-01-01
    expect(addDays("2024-01-01", 366)).toBe("2025-01-01");
  });

  it("DST 開始日でも civil date として 1 日進む", () => {
    expect(addDays("2024-03-10", 1)).toBe("2024-03-11");
  });
});

// ─── dateRange ────────────────────────────────────────────────────────────────

describe("dateRange", () => {
  it("通常の 3 日間", () => {
    expect(dateRange("2024-01-15", "2024-01-17")).toEqual([
      "2024-01-15",
      "2024-01-16",
      "2024-01-17",
    ]);
  });

  it("start == end のとき 1 件", () => {
    expect(dateRange("2024-06-15", "2024-06-15")).toEqual(["2024-06-15"]);
  });

  it("start > end のとき空配列", () => {
    expect(dateRange("2024-01-17", "2024-01-15")).toEqual([]);
  });

  it("年跨ぎ", () => {
    expect(dateRange("2023-12-30", "2024-01-02")).toEqual([
      "2023-12-30",
      "2023-12-31",
      "2024-01-01",
      "2024-01-02",
    ]);
  });

  it("月跨ぎ（1月→2月）", () => {
    expect(dateRange("2024-01-30", "2024-02-02")).toEqual([
      "2024-01-30",
      "2024-01-31",
      "2024-02-01",
      "2024-02-02",
    ]);
  });

  it("うるう年 2/29 を含む月跨ぎ", () => {
    expect(dateRange("2024-02-28", "2024-03-01")).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
  });

  it("平年は 2/29 が存在しない", () => {
    expect(dateRange("2025-02-28", "2025-03-01")).toEqual([
      "2025-02-28",
      "2025-03-01",
    ]);
  });

  it("結果は昇順になっている", () => {
    const result = dateRange("2024-01-01", "2024-01-07");
    expect(result).toHaveLength(7);
    for (let i = 1; i < result.length; i++) {
      expect(result[i] > result[i - 1]).toBe(true);
    }
  });

  it("開始・終了が inclusive になっている", () => {
    const result = dateRange("2024-03-05", "2024-03-10");
    expect(result[0]).toBe("2024-03-05");
    expect(result.at(-1)).toBe("2024-03-10");
    expect(result).toHaveLength(6);
  });
});

// ─── toWeekStart ─────────────────────────────────────────────────────────────

describe("toWeekStart", () => {
  // 週の全曜日テスト（2024-01-15〜2024-01-21 は月〜日）
  it.each([
    ["2024-01-15", "2024-01-15", "月曜日"],
    ["2024-01-16", "2024-01-15", "火曜日"],
    ["2024-01-17", "2024-01-15", "水曜日"],
    ["2024-01-18", "2024-01-15", "木曜日"],
    ["2024-01-19", "2024-01-15", "金曜日"],
    ["2024-01-20", "2024-01-15", "土曜日"],
    ["2024-01-21", "2024-01-15", "日曜日"],
  ])("%s（%s）→ %s", (input, expected) => {
    expect(toWeekStart(input)).toBe(expected);
  });

  describe("月跨ぎ", () => {
    it("月初（金）→ 前月の月曜日", () => {
      // 2024-03-01 は金曜日 → 週の月曜日 = 2024-02-26
      expect(toWeekStart("2024-03-01")).toBe("2024-02-26");
    });

    it("月末（木）→ 同月の月曜日", () => {
      // 2024-01-31 は水曜日 → 2024-01-29
      expect(toWeekStart("2024-01-31")).toBe("2024-01-29");
    });

    it("月初（月）→ 同日（週の先頭）", () => {
      // 2024-01-01 は月曜日 → 2024-01-01
      expect(toWeekStart("2024-01-01")).toBe("2024-01-01");
    });

    it("うるう年 2/29（木）→ 2/26（月）", () => {
      // 2024-02-29 は木曜日
      expect(toWeekStart("2024-02-29")).toBe("2024-02-26");
    });
  });

  describe("年跨ぎ", () => {
    it("年末（日）→ 同年の月曜日（週が年内で完結）", () => {
      // 2023-12-31 は日曜日 → 2023-12-25（月曜）
      expect(toWeekStart("2023-12-31")).toBe("2023-12-25");
    });

    it("年初（月）→ 同日（新年が週の先頭）", () => {
      // 2024-01-01 は月曜日
      expect(toWeekStart("2024-01-01")).toBe("2024-01-01");
    });

    it("年初（日）→ 前年の月曜日（週が年跨ぎ）", () => {
      // 2023-01-01 は日曜日 → 2022-12-26（月曜）
      expect(toWeekStart("2023-01-01")).toBe("2022-12-26");
    });

    it("年初（火）→ 前年末の月曜日（週が年跨ぎ）", () => {
      // 2019-01-01 は火曜日 → 2018-12-31（月曜）
      expect(toWeekStart("2019-01-01")).toBe("2018-12-31");
    });

    it("月曜日の週末（日）が翌年になる", () => {
      // 2024-12-30 は月曜日 → 2024-12-30
      expect(toWeekStart("2024-12-30")).toBe("2024-12-30");
      // 2024-12-31 は火曜日 → 2024-12-30
      expect(toWeekStart("2024-12-31")).toBe("2024-12-30");
      // 2025-01-01 は水曜日 → 2024-12-30（前年の月曜日）
      expect(toWeekStart("2025-01-01")).toBe("2024-12-30");
    });
  });

  describe("toWeekStart と dateRange の組み合わせ", () => {
    it("週の全 7 日は同じ week_start を返す", () => {
      const monday = "2024-01-15";
      const week = dateRange(monday, addDays(monday, 6));
      for (const d of week) {
        expect(toWeekStart(d)).toBe(monday);
      }
    });

    it("連続する 2 週の月曜日は 7 日離れている", () => {
      const w1 = toWeekStart("2024-01-17"); // 水曜 → 2024-01-15
      const w2 = toWeekStart("2024-01-24"); // 水曜 → 2024-01-22
      expect(addDays(w1, 7)).toBe(w2);
    });
  });

  describe("DST 境界を含む週", () => {
    it("America/New_York spring-forward の週は月曜始まり", () => {
      expect(toWeekStart("2024-03-10")).toBe("2024-03-04");
    });

    it("America/New_York fall-back の週は月曜始まり", () => {
      expect(toWeekStart("2024-11-03")).toBe("2024-10-28");
    });
  });
});
