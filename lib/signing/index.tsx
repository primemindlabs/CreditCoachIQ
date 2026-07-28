/**
 * E-signature module — vendored locally.
 *
 * Originally built as a shared `@primemind/sdk/signing` module intended for
 * reuse across PrimeMind Labs products. CreditCoachIQ is owned by a separate
 * company (EquityNest Capital) and the private `primemindlabs/platform`
 * GitHub repo isn't (and shouldn't be) something this codebase depends on at
 * install time — a git+ssh dependency on another company's private repo is a
 * deploy-time landmine (SSH key access, repo visibility, etc.), so the module
 * is copied here in full instead of imported. If PrimeMind Labs' SDK is ever
 * published as a real npm package this can be swapped back for a normal
 * dependency; until then, this file is CreditCoachIQ's own copy to edit.
 *
 * In-house click-to-sign primitive: capture, tamper-evident record, PDF
 * certificate stamping.
 *
 * Scope, deliberately: this is ESIGN Act / UETA-style click-to-sign (typed
 * or drawn signature + explicit consent + a retrievable, tamper-evident
 * record), not a notarization or qualified-electronic-signature product.
 * That's sufficient for consumer disclosures, CROA agreements, engagement
 * letters, and similar — it is NOT a substitute for legal review of whether
 * a specific document type requires a higher signature standard in your
 * jurisdiction.
 *
 * This module does not own storage — the caller persists the SignatureRecord
 * it produces (see app/api/portal/[token]/sign-croa/route.ts, which stores it
 * on credit_repair_enrollments.croa_signature_record).
 *
 * Usage — capture (Client Component):
 *   import { SignaturePad, ESIGN_CONSENT_TEXT } from "@/lib/signing"
 *
 *   <SignaturePad
 *     signerName="Jane Borrower"
 *     onCapture={(result) => fetch("/api/sign", { method: "POST", body: JSON.stringify(result) })}
 *   />
 *
 * Usage — build + persist the record (server-side, e.g. a Route Handler):
 *   import { buildSignatureRecord, hashDocument } from "@/lib/signing"
 *
 *   const record = await buildSignatureRecord({
 *     documentHash: await hashDocument(croaDisclosureText),
 *     signerName: "Jane Borrower",
 *     signerEmail: "jane@example.com",
 *     capture: captureResultFromClient,
 *     ipAddress: req.headers.get("x-forwarded-for"),
 *     userAgent: req.headers.get("user-agent"),
 *   })
 *   // now store `record` (it's plain JSON) on your own signed_at / signature_record column
 *
 * Usage — verify later (audit, dispute, compliance review):
 *   import { verifySignatureRecord } from "@/lib/signing"
 *   const { valid, reason } = await verifySignatureRecord(record)
 */

"use client";

import { useRef, useState, useCallback } from "react";
import type { CSSProperties } from "react";

// ── Consent language ────────────────────────────────────────────────────────

/**
 * Standard ESIGN Act / UETA electronic-consent disclosure. Show this (or
 * your counsel-reviewed equivalent) before capturing a signature — federal
 * law requires affirmative consent to sign electronically, separate from
 * the signature itself.
 */
export const ESIGN_CONSENT_TEXT =
  "By signing electronically, you agree that your electronic signature is the legal equivalent of your manual signature, and you consent to be legally bound by this document's terms. You may request a paper copy of any signed document at any time by contacting your account representative. You are not required to sign electronically, and you may withdraw this consent at any time before signing.";

// ── Capture (client) ────────────────────────────────────────────────────────

export type SignatureMethod = "typed" | "drawn";

export interface SignatureCaptureResult {
  method: SignatureMethod;
  /** Typed full name (method: "typed") */
  typedName?: string;
  /** PNG data URL of the drawn signature (method: "drawn") */
  drawingDataUrl?: string;
  consentAcceptedAt: string;
}

export interface SignaturePadProps {
  signerName: string;
  onCapture: (result: SignatureCaptureResult) => void;
  /** Override the default ESIGN_CONSENT_TEXT if your counsel has different language. */
  consentText?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Captures a typed-name or drawn signature plus explicit ESIGN consent.
 * Renders the consent checkbox itself — the caller doesn't need to build
 * that UI separately, since consent capture is not optional under ESIGN.
 */
export function SignaturePad({ signerName, onCapture, consentText, className, style }: SignaturePadProps) {
  const [method, setMethod] = useState<SignatureMethod>("typed");
  const [typedName, setTypedName] = useState(signerName);
  const [consented, setConsented] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  const startDraw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawingRef.current = true;
    hasDrawnRef.current = true;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  }, []);

  const draw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1D1D1F";
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  }, []);

  const endDraw = useCallback(() => {
    drawingRef.current = false;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
  }, []);

  function submit() {
    if (!consented) return;
    const consentAcceptedAt = new Date().toISOString();
    if (method === "typed") {
      if (!typedName.trim()) return;
      onCapture({ method: "typed", typedName: typedName.trim(), consentAcceptedAt });
    } else {
      if (!hasDrawnRef.current || !canvasRef.current) return;
      onCapture({ method: "drawn", drawingDataUrl: canvasRef.current.toDataURL("image/png"), consentAcceptedAt });
    }
  }

  const canSubmit = consented && (method === "typed" ? typedName.trim().length > 0 : hasDrawnRef.current);

  return (
    <div className={className} style={style}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => setMethod("typed")} aria-pressed={method === "typed"}>
          Type my signature
        </button>
        <button type="button" onClick={() => setMethod("drawn")} aria-pressed={method === "drawn"}>
          Draw my signature
        </button>
      </div>

      {method === "typed" ? (
        <input
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="Type your full legal name"
          style={{ fontFamily: "cursive", fontSize: 24, width: "100%" }}
        />
      ) : (
        <div>
          <canvas
            ref={canvasRef}
            width={400}
            height={120}
            style={{ border: "1px solid #E8E7E3", touchAction: "none", width: "100%" }}
            onPointerDown={startDraw}
            onPointerMove={draw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
          />
          <button type="button" onClick={clearCanvas}>Clear</button>
        </div>
      )}

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 16, fontSize: 13 }}>
        <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
        <span>{consentText ?? ESIGN_CONSENT_TEXT}</span>
      </label>

      <button type="button" onClick={submit} disabled={!canSubmit} style={{ marginTop: 16 }}>
        Sign
      </button>
    </div>
  );
}

// ── Record + verification (server) ──────────────────────────────────────────

export interface SignatureRecord {
  documentHash: string;
  signerName: string;
  signerEmail?: string;
  method: SignatureMethod;
  /** Typed name, or the drawn-signature PNG data URL */
  signatureData: string;
  consentAcceptedAt: string;
  signedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  /** SHA-256 over the canonical JSON of every field above — tamper-evident */
  recordHash: string;
}

export interface BuildSignatureRecordParams {
  documentHash: string;
  signerName: string;
  signerEmail?: string;
  capture: SignatureCaptureResult;
  ipAddress?: string | null;
  userAgent?: string | null;
}

async function sha256Hex(input: string): Promise<string> {
  // Web Crypto — available in the Node.js runtime Next.js Route Handlers run
  // in (globalThis.crypto), and in Edge runtime. Avoids a Node-only `crypto`
  // import so this module works in either runtime without a second code path.
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of a document's exact text content, so the signature record ties to the precise version signed. */
export async function hashDocument(content: string): Promise<string> {
  return sha256Hex(content);
}

function canonicalize(record: Omit<SignatureRecord, "recordHash">): string {
  // Stable key order so the hash is reproducible regardless of object construction order.
  return JSON.stringify(record, Object.keys(record).sort());
}

/**
 * Builds the persistable signature record, including its own tamper-evident
 * hash. Call this server-side, immediately after receiving a
 * SignatureCaptureResult from the client — never trust a client-supplied
 * recordHash.
 */
export async function buildSignatureRecord(params: BuildSignatureRecordParams): Promise<SignatureRecord> {
  const base: Omit<SignatureRecord, "recordHash"> = {
    documentHash: params.documentHash,
    signerName: params.signerName,
    signerEmail: params.signerEmail,
    method: params.capture.method,
    signatureData: params.capture.method === "typed" ? (params.capture.typedName ?? "") : (params.capture.drawingDataUrl ?? ""),
    consentAcceptedAt: params.capture.consentAcceptedAt,
    signedAt: new Date().toISOString(),
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  };
  const recordHash = await sha256Hex(canonicalize(base));
  return { ...base, recordHash };
}

/** Recomputes the record hash and compares — detects any post-hoc edit to a stored SignatureRecord. */
export async function verifySignatureRecord(record: SignatureRecord): Promise<{ valid: boolean; reason?: string }> {
  const { recordHash, ...base } = record;
  const recomputed = await sha256Hex(canonicalize(base));
  if (recomputed !== recordHash) return { valid: false, reason: "Record hash mismatch — the stored record does not match its own signed fields." };
  return { valid: true };
}

// ── PDF certificate page (server) ───────────────────────────────────────────

/**
 * Appends a signature-certificate page to an existing PDF: signer name,
 * method, consent timestamp, signed-at timestamp, IP/user-agent, and the
 * record hash — the same information an auditor or a client's own lawyer
 * would ask for. Uses pdf-lib (already a dependency of this project — see
 * package.json); the capture/record/verify functions above have no such
 * requirement.
 */
export async function stampSignatureCertificate(pdfBytes: Uint8Array, record: SignatureRecord): Promise<Uint8Array> {
  let PDFDocument: typeof import("pdf-lib").PDFDocument;
  let rgb: typeof import("pdf-lib").rgb;
  try {
    ({ PDFDocument, rgb } = await import("pdf-lib"));
  } catch {
    throw new Error(
      "lib/signing's stampSignatureCertificate() requires pdf-lib. Run `npm install pdf-lib` and try again."
    );
  }

  const doc = await PDFDocument.load(pdfBytes);
  const page = doc.addPage();
  const { height } = page.getSize();
  const lines = [
    "Signature Certificate",
    "",
    `Signer: ${record.signerName}${record.signerEmail ? ` <${record.signerEmail}>` : ""}`,
    `Method: ${record.method === "typed" ? "Typed signature" : "Drawn signature"}`,
    `Consent accepted: ${record.consentAcceptedAt}`,
    `Signed at: ${record.signedAt}`,
    `IP address: ${record.ipAddress ?? "unknown"}`,
    `User agent: ${record.userAgent ?? "unknown"}`,
    `Document hash: ${record.documentHash}`,
    `Record hash: ${record.recordHash}`,
  ];

  let y = height - 72;
  for (const line of lines) {
    page.drawText(line, { x: 54, y, size: line === "Signature Certificate" ? 16 : 10, color: rgb(0.11, 0.11, 0.12) });
    y -= line === "Signature Certificate" ? 28 : 18;
  }

  return doc.save();
}
