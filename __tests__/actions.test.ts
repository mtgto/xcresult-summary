import { expect, test } from "vitest";
import { escapeData, escapeProperty } from "../src/actions.ts";

test("escapeData keeps multi-line messages on one workflow command line", () => {
  expect(escapeData("100% done\r\nnext")).toBe("100%25 done%0D%0Anext");
});

test("escapeProperty also escapes the property separators", () => {
  expect(escapeProperty("Suite/test(a:b,c)")).toBe("Suite/test(a%3Ab%2Cc)");
});
