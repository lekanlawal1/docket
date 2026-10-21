import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, zip } from "../js/zip.js";

const enc = new TextEncoder();

test("crc32 matches the known value", () => {
  assert.equal(crc32(enc.encode("123456789")), 0xCBF43926);
});

test("the zip opens with a standard tool and the files come back intact", () => {
  const files = [
    { name: "page-1.txt", data: enc.encode("first page") },
    { name: "café notes.txt", data: enc.encode("second, with a non-ASCII name") },
  ];
  const dir = mkdtempSync(join(tmpdir(), "docket-zip-"));
  const path = join(dir, "out.zip");
  writeFileSync(path, zip(files));
  const script = "import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nfor i in z.infolist(): print(i.filename + '|' + z.read(i).decode())";
  const out = execFileSync("python3", ["-c", script, path], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(out, ["page-1.txt|first page", "café notes.txt|second, with a non-ASCII name"]);
});
