// SHA-256 fingerprints and the signing certificate Sign adds, shared by Sign (which writes it)
// and Verify (which reads it back). Everything here runs in the browser; nothing is sent anywhere.

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 64 hex characters are easier to read and compare in groups of four.
export const grouped = (hex) => hex.match(/.{1,4}/g).join(" ");

// Whatever someone pastes (spaces, line breaks, upper case, a label in front): just the hex.
export const cleanHex = (text) => String(text).toLowerCase().replace(/[^0-9a-f]/g, "");

export const CERT_TITLE = "Signing certificate";
export const ORIGINAL_LABEL = "Fingerprint of the document before signing";

// The certificate page's text, as pdf.js reads it back, into its fields. Null if it isn't one.
export function readCertificate(text) {
  if (!text || !text.includes(CERT_TITLE) || !text.includes(ORIGINAL_LABEL)) return null;
  const field = (label) => (text.match(new RegExp(`${label}:\\s*([^\\n]+)`)) || [])[1]?.trim() || "";
  const after = text.slice(text.indexOf(ORIGINAL_LABEL) + ORIGINAL_LABEL.length);
  const original = cleanHex(after.replace(/^[^:]*:/, "")).slice(0, 64);
  return { document: field("Document"), signer: field("Signed by"), signedOn: field("Signed on"), placed: field("Placed"), original };
}
