import { test } from "node:test";
import assert from "node:assert/strict";
import { payload } from "../js/tools/qr.js";

test("wi-fi codes escape the characters the format reserves", () => {
  assert.equal(payload("wifi", { ssid: "Cafe;Dock", pass: 'a:b"c', security: "WPA", hidden: false }),
    'WIFI:T:WPA;S:Cafe\\;Dock;P:a\\:b\\"c;;');
  assert.equal(payload("wifi", { ssid: "Open", pass: "ignored", security: "nopass", hidden: true }), "WIFI:T:nopass;S:Open;H:true;;");
  assert.equal(payload("wifi", { ssid: "" }), "");
});

test("contact cards only include what was filled in", () => {
  assert.equal(payload("contact", { name: "Sam Rowe", org: "", phone: "705-555-0142", email: "", site: "" }),
    "BEGIN:VCARD\nVERSION:3.0\nFN:Sam Rowe\nTEL:705-555-0142\nEND:VCARD");
});
