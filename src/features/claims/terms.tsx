"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, FileSignature, ShieldCheck, AlertCircle } from "lucide-react";
import { useSession } from "@/features/session/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { explorerUrl, formatDate, money } from "@/lib/format";
import type { Claim } from "../../../packages/client";
import {
  DetailFacts,
  InlineError,
  SectionTitle,
  SyntheticNote,
  useClaimRoles,
  useRefreshClaim,
} from "./shared";
import { useClaimOperations } from "./operations";

export function ClaimTerms({ claim }: { claim: Claim }) {
  const { api, user, config } = useSession();
  const roles = useClaimRoles(claim);
  const refresh = useRefreshClaim(claim.id);
  const operations = useClaimOperations(claim);
  const evidence = useQuery({
    queryKey: ["evidence", claim.id],
    queryFn: () => api.evidence(claim.id),
  });
  const [reason, setReason] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [attestations, setAttestations] = useState<
    Array<
      | "buyerAcknowledgementStatus"
      | "deliveryEvidenceStatus"
      | "extractionStatus"
    >
  >([]);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeEvidence, setDisputeEvidence] = useState("");
  const [disputeFile, setDisputeFile] = useState<File | null>(null);
  const [disputeFileError, setDisputeFileError] = useState<string | null>(null);
  const disputeFileInput = useRef<HTMLInputElement>(null);
  const [revokeNonce, setRevokeNonce] = useState("");
  const [saved, setSaved] = useState("");
  const [checkedAt, setCheckedAt] = useState(() =>
    Math.floor(Date.now() / 1000),
  );
  useEffect(() => {
    const timer = window.setInterval(
      () => setCheckedAt(Math.floor(Date.now() / 1000)),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const resolving =
    claim.workflow === "REGISTERED" && (claim.fundingHold || claim.hasDispute);
  const reviewDocuments =
    evidence.data?.documents.filter(
      (document) => resolving || document.purpose !== "DISPUTE",
    ) ?? [];
  const buyerCanAttachDisputeEvidence =
    roles.buyer &&
    user?.wallet.toLowerCase() === claim.terms.buyer.toLowerCase();
  const review = useMutation({
    mutationFn: () =>
      api.review(
        claim.id,
        {
          expectedVersion: claim.version,
          decision,
          reason,
          evidenceIds,
          ...(decision === "APPROVE" && !resolving ? { attestations } : {}),
          ...(resolving ? { resolvesDispute: true } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setSaved(
        resolving
          ? "Review penyelesaian dispute tersimpan. Verifier masih perlu menandatangani transaksi pembukaan hold."
          : "Keputusan review tersimpan. Persetujuan berikutnya harus menggunakan versi terbaru.",
      );
      setReason("");
      setEvidenceIds([]);
      setAttestations([]);
      await refresh();
    },
  });
  const dispute = useMutation({
    mutationFn: async () => {
      let evidenceId = disputeEvidence;
      if (disputeFile) {
        const uploaded = await api.uploadDocument(
          claim.id,
          disputeFile,
          claim.version,
          crypto.randomUUID(),
          "DISPUTE",
        );
        evidenceId = uploaded.documentId;
        setDisputeEvidence(evidenceId);
        setDisputeFile(null);
        if (disputeFileInput.current) disputeFileInput.current.value = "";
      }
      return api.dispute(
        claim.id,
        {
          expectedVersion: claim.version,
          reason: disputeReason,
          evidenceId,
        },
        crypto.randomUUID(),
      );
    },
    onSuccess: async () => {
      setSaved(
        "Dispute tercatat. Aksi agent akan diperiksa dan diproses; hold onchain belum dianggap selesai.",
      );
      setDisputeReason("");
      setDisputeEvidence("");
      await refresh();
    },
  });
  const reviewReady =
    ["READY_FOR_SIGNATURES", "NEEDS_REVIEW"].includes(claim.workflow) ||
    resolving;
  const consentReady =
    ["READY_FOR_SIGNATURES", "READY_FOR_REGISTRATION"].includes(
      claim.workflow,
    ) &&
    claim.evidence.humanReviewStatus === "ATTESTED" &&
    !claim.fundingHold &&
    !claim.hasDispute &&
    Math.min(
      claim.terms.fundingDeadline,
      claim.terms.reviewExpiry,
      claim.terms.consentExpiry,
    ) > checkedAt;
  const expired =
    Math.min(
      claim.terms.fundingDeadline,
      claim.terms.reviewExpiry,
      claim.terms.consentExpiry,
    ) <= checkedAt;
  const financing = useQuery({
    queryKey: ["financing", claim.id],
    queryFn: () => api.financing(claim.id),
    enabled: claim.workflow === "REGISTERED",
  });
  const blockingEvidence =
    evidence.data?.policy?.outcome === "REJECTED" ||
    evidence.data?.policy?.reasonCodes.includes("MATERIAL_EVIDENCE_CONFLICT");
  const currentConsents =
    evidence.data?.consents?.filter(
      (consent) =>
        consent.version === claim.version &&
        !consent.revoked &&
        !consent.onchainInvalidation &&
        consent.deadline > checkedAt,
    ) ?? [];
  const consentActorRole = roles.borrower
    ? "BORROWER"
    : roles.buyer
      ? "BUYER"
      : null;
  const needsConsent =
    evidence.isSuccess &&
    consentReady &&
    !!consentActorRole &&
    !currentConsents.some((consent) => consent.role === consentActorRole);
  return (
    <div className="space-y-7">
      {operations.feedback}
      {expired && !["REGISTERED", "CANCELLED"].includes(claim.workflow) && (
        <div className="danger-callout text-sm">
          <p className="font-semibold">Ketentuan kedaluwarsa</p>
          <p className="mt-1">
            Review, consent, atau pendanaan baru memerlukan versi ketentuan yang
            masih berlaku. Pemohon dapat memperbarui data sebelum registrasi,
            lalu menjalankan pemeriksaan ulang.
          </p>
        </div>
      )}
      {saved && (
        <div className="info-callout flex items-start gap-3" role="status">
          <Check size={17} className="mt-0.5 shrink-0" />
          <p className="text-sm">{saved}</p>
        </div>
      )}
      {roles.verifier && reviewReady ? (
        <div className="flex flex-col gap-2 rounded-lg bg-secondary p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">
            {resolving
              ? "Dispute memerlukan keputusan verifier."
              : "Bukti siap untuk keputusan verifier."}
          </p>
          <a
            href="#verifier-review"
            className="shrink-0 text-sm font-semibold text-primary hover:underline"
          >
            Buka keputusan
          </a>
        </div>
      ) : needsConsent ? (
        <div className="flex flex-col gap-2 rounded-lg bg-secondary p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">
            Ketentuan versi ini siap ditinjau dan ditandatangani.
          </p>
          <a
            href="#claim-consent"
            className="shrink-0 text-sm font-semibold text-primary hover:underline"
          >
            Buka persetujuan
          </a>
        </div>
      ) : null}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_350px]">
        <section className="surface p-6 sm:p-7">
          <SectionTitle
            title="Ketentuan pembiayaan"
            description={`Versi ${claim.version}. Persetujuan mengikat nominal, penerima, chain, dan batas waktu berikut.`}
          />
          <DetailFacts
            items={[
              {
                label: "Outstanding diakui buyer",
                value: money(claim.terms.acceptedOutstanding),
              },
              { label: "Principal", value: money(claim.terms.principal) },
              { label: "Biaya flat", value: money(claim.terms.fee) },
              {
                label: "Hak lender",
                value: money(
                  (
                    BigInt(claim.terms.principal) + BigInt(claim.terms.fee)
                  ).toString(),
                ),
              },
              {
                label: "Jatuh tempo invoice",
                value: formatDate(claim.terms.invoiceDueAt),
              },
            ]}
          />
          <details className="mt-5 border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium text-primary">
              Batas waktu & wallet kontrak
            </summary>
            <div className="mt-4">
              <DetailFacts
                items={[
                  {
                    label: "Batas pendanaan",
                    value: `${formatDate(claim.terms.fundingDeadline, true)} WIB`,
                  },
                  {
                    label: "Batas review",
                    value: `${formatDate(claim.terms.reviewExpiry, true)} WIB`,
                  },
                  {
                    label: "Batas persetujuan",
                    value: `${formatDate(claim.terms.consentExpiry, true)} WIB`,
                  },
                  {
                    label: "Penerima pencairan",
                    value: (
                      <span className="break-all">{claim.terms.borrower}</span>
                    ),
                  },
                  {
                    label: "Buyer pembayar",
                    value: (
                      <span className="break-all">{claim.terms.buyer}</span>
                    ),
                  },
                ]}
              />
            </div>
          </details>
          <div className="mt-5">
            <SyntheticNote />
          </div>
        </section>
        <aside className="space-y-6">
          <section className="surface scroll-mt-6 p-6" id="claim-consent">
            <SectionTitle
              title="Persetujuan"
              description="Login wallet berbeda dari persetujuan pembiayaan."
            />
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Review verifier</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Terpisah dari pihak invoice
                  </p>
                </div>
                <StatusBadge
                  status={claim.evidence.humanReviewStatus ?? "MISSING"}
                />
              </div>
              {evidence.data?.review && (
                <details className="rounded-md bg-background p-3 text-xs">
                  <summary className="cursor-pointer font-medium">
                    Detail review terakhir
                  </summary>
                  <p className="mt-3 leading-relaxed">
                    {evidence.data.review.reason}
                  </p>
                  <p className="mt-2 text-muted-foreground">
                    Versi {evidence.data.review.version} ·{" "}
                    {formatDate(evidence.data.review.createdAt, true)} WIB
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Berlaku hingga{" "}
                    {formatDate(evidence.data.review.expiresAt, true)} WIB
                  </p>
                </details>
              )}
              {(["BORROWER", "BUYER"] as const).map((role) => {
                const recorded = currentConsents.find(
                  (consent) => consent.role === role,
                );
                const invalidated = evidence.data?.consents.find(
                  (consent) =>
                    consent.role === role &&
                    consent.version === claim.version &&
                    consent.onchainInvalidation,
                );
                const invalidationLink = invalidated?.onchainInvalidation
                  ? explorerUrl(
                      config?.chainId,
                      "tx",
                      invalidated.onchainInvalidation.txHash,
                    )
                  : undefined;
                return (
                  <div key={role} className="border-t border-border pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          {role === "BORROWER"
                            ? "Persetujuan borrower"
                            : "Pengakuan buyer"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {recorded
                            ? `Tersimpan · v${recorded.version}`
                            : "Belum ada persetujuan tersimpan untuk versi ini"}
                        </p>
                      </div>
                      {recorded && <Check size={17} className="text-primary" />}
                    </div>
                    {invalidated?.onchainInvalidation && (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        Nonce {invalidated.nonce} dicabut pada block{" "}
                        {invalidated.onchainInvalidation.blockNumber}.
                        {invalidationLink && (
                          <a
                            href={invalidationLink}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 text-primary underline underline-offset-4"
                          >
                            Lihat transaksi
                          </a>
                        )}
                      </p>
                    )}
                    {(role === "BORROWER" ? roles.borrower : roles.buyer) &&
                      consentReady && (
                        <Button
                          className="mt-3 w-full"
                          variant={recorded ? "outline" : "default"}
                          disabled={operations.busy}
                          onClick={() =>
                            operations.prepare({ kind: "consent", role })
                          }
                        >
                          <FileSignature size={15} />
                          {recorded
                            ? "Tinjau persetujuan baru"
                            : "Tinjau & tanda tangani"}
                        </Button>
                      )}
                  </div>
                );
              })}
            </div>
            <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
              Status ini menunjukkan catatan persetujuan aplikasi. Nonce dapat
              dicabut onchain; validitas nonce dan batas waktu diperiksa kembali
              saat registrasi. Gunakan persetujuan baru jika nonce sebelumnya
              sudah dicabut.
            </p>
            {!consentReady &&
              [
                "DRAFT",
                "EXTRACTING",
                "NEEDS_REVIEW",
                "READY_FOR_SIGNATURES",
              ].includes(claim.workflow) && (
                <p className="mt-4 rounded-md bg-background p-3 text-xs leading-relaxed text-muted-foreground">
                  Lengkapi review manusia dan selesaikan temuan sebelum tanda
                  tangan ketentuan.
                </p>
              )}
          </section>
          {roles.verifier && (
            <section className="surface p-6">
              <SectionTitle
                title="Registrasi onchain"
                description="Verifier menandatangani transaksi registrasi dari wallet sendiri."
              />
              {claim.workflow === "READY_FOR_REGISTRATION" && !expired ? (
                <Button
                  className="w-full"
                  onClick={() =>
                    operations.prepare({
                      kind: "transaction",
                      action: "REGISTER",
                    })
                  }
                  disabled={operations.busy}
                >
                  <ShieldCheck size={15} />
                  Tinjau registrasi
                </Button>
              ) : (
                <StatusBadge
                  status={
                    claim.workflow === "REGISTERED"
                      ? "REGISTERED"
                      : claim.workflow === "REGISTRATION_PENDING"
                        ? "SUBMITTED"
                        : "PENDING"
                  }
                />
              )}
              {claim.fundingHold && !claim.hasDispute && (
                <div>
                  <Button
                    variant="outline"
                    className="mt-4 w-full"
                    onClick={() =>
                      operations.prepare({
                        kind: "transaction",
                        action: "CLEAR_HOLD",
                      })
                    }
                    disabled={operations.busy || expired}
                  >
                    Tinjau pembukaan hold
                  </Button>
                  {expired && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Hold tidak dapat membuka kembali ketentuan yang sudah
                      expired.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
      {roles.verifier && reviewReady && (
        <section
          className="surface scroll-mt-6 p-6 sm:p-7"
          id="verifier-review"
        >
          <SectionTitle
            title={
              resolving ? "Review penyelesaian dispute" : "Keputusan verifier"
            }
            description="Pilih bukti yang telah dibaca dan berikan alasan yang dapat diaudit."
          />
          {blockingEvidence && !resolving && (
            <div className="danger-callout mb-5 text-sm">
              Ada konflik bukti material atau penolakan kebijakan. Perbaiki
              bukti dan jalankan analisis ulang sebelum menyetujui.
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              review.mutate();
            }}
            className="grid gap-6 lg:grid-cols-2"
          >
            <fieldset>
              <legend className="mb-3 text-sm font-medium">
                Bukti yang ditinjau
              </legend>
              {!reviewDocuments.length ? (
                <p className="text-sm text-muted-foreground">
                  Dokumen belum tersedia.
                </p>
              ) : (
                <div className="space-y-3">
                  {reviewDocuments.map((doc) => (
                    <label
                      key={doc.id}
                      className="flex cursor-pointer items-start gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={evidenceIds.includes(doc.id)}
                        onChange={(event) =>
                          setEvidenceIds((current) =>
                            event.target.checked
                              ? [...current, doc.id]
                              : current.filter((id) => id !== doc.id),
                          )
                        }
                      />
                      <span className="break-all">{doc.name}</span>
                    </label>
                  ))}
                </div>
              )}
              {decision === "APPROVE" && !resolving && (
                <fieldset className="mt-6 border-t border-border pt-5">
                  <legend className="text-sm font-medium">
                    Pernyataan hasil pemeriksaan manusia
                  </legend>
                  <p className="mb-4 mt-2 text-xs leading-relaxed text-muted-foreground">
                    Opsional. Centang hanya hal yang benar-benar Anda periksa
                    pada dokumen terpilih. Pernyataan ini dicatat atas identitas
                    verifier; tidak menggantikan bukti atau menghapus konflik
                    material.
                  </p>
                  {(
                    [
                      [
                        "extractionStatus",
                        "Saya telah memeriksa nilai hasil ekstraksi terhadap dokumen",
                      ],
                      [
                        "deliveryEvidenceStatus",
                        "Saya telah meninjau bukti penyerahan barang",
                      ],
                      [
                        "buyerAcknowledgementStatus",
                        "Saya telah meninjau bukti pengakuan buyer",
                      ],
                    ] as const
                  ).map(([kind, label]) => (
                    <label
                      key={kind}
                      className="mt-3 flex items-start gap-3 text-sm leading-relaxed"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={attestations.includes(kind)}
                        onChange={(event) =>
                          setAttestations((current) =>
                            event.target.checked
                              ? [...current, kind]
                              : current.filter((item) => item !== kind),
                          )
                        }
                      />
                      <span>
                        {label}
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Status saat ini:{" "}
                          <StatusBadge status={claim.evidence[kind]} />
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
            </fieldset>
            <div className="space-y-4">
              <div className="field-group">
                <Label htmlFor="review-decision">Keputusan</Label>
                <Select
                  id="review-decision"
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as "APPROVE" | "REJECT")
                  }
                >
                  <option value="APPROVE">
                    {resolving
                      ? "Setujui penyelesaian dispute"
                      : "Setujui ketentuan"}
                  </option>
                  {!resolving && (
                    <option value="REJECT">Tolak pengajuan</option>
                  )}
                </Select>
              </div>
              <div className="field-group">
                <Label htmlFor="review-reason">Alasan keputusan</Label>
                <Textarea
                  id="review-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  minLength={5}
                  maxLength={2000}
                  required
                  placeholder="Catat dasar keputusan dan bukti yang mendukung."
                />
              </div>
              <Button
                type="submit"
                disabled={
                  review.isPending ||
                  expired ||
                  reason.trim().length < 5 ||
                  !evidenceIds.length ||
                  (decision === "APPROVE" &&
                    Boolean(blockingEvidence) &&
                    !resolving)
                }
              >
                {review.isPending ? "Menyimpan keputusan…" : "Simpan keputusan"}
              </Button>
            </div>
          </form>
          <div className="mt-4">
            <InlineError
              error={review.error || evidence.error}
              onRefresh={() => void refresh()}
            />
          </div>
        </section>
      )}
      {(roles.borrower || roles.buyer || roles.verifier) &&
        !["CANCELLED", "REJECTED"].includes(claim.workflow) && (
          <details className="surface p-6">
            <summary className="cursor-pointer text-sm font-semibold">
              Laporkan dispute atau kelola otorisasi
            </summary>
            <div className="mt-6 grid gap-8 lg:grid-cols-2">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  dispute.mutate();
                }}
                className="space-y-4"
              >
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <AlertCircle size={16} />
                    Laporkan dispute
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Dispute harus merujuk bukti. Hold menghentikan pendanaan
                    baru; uang yang sudah dicairkan tidak ditarik kembali.
                  </p>
                </div>
                <div className="field-group">
                  <Label htmlFor="dispute-evidence">Bukti terkait</Label>
                  <Select
                    id="dispute-evidence"
                    value={disputeEvidence}
                    onChange={(event) => {
                      setDisputeEvidence(event.target.value);
                      if (event.target.value) {
                        setDisputeFile(null);
                        if (disputeFileInput.current)
                          disputeFileInput.current.value = "";
                      }
                    }}
                  >
                    <option value="">Pilih dokumen</option>
                    {evidence.data?.documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.purpose === "DISPUTE"
                          ? "Bukti sengketa · "
                          : "Dokumen Deal · "}
                        {doc.name}
                      </option>
                    ))}
                  </Select>
                </div>
                {buyerCanAttachDisputeEvidence && (
                  <div className="field-group">
                    <Label htmlFor="dispute-file">
                      Atau lampirkan bukti baru
                    </Label>
                    <Input
                      id="dispute-file"
                      ref={disputeFileInput}
                      type="file"
                      accept=".pdf,.txt,.json"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setDisputeFileError(null);
                        if (file && file.size > 10 * 1024 * 1024) {
                          setDisputeFile(null);
                          setDisputeFileError(
                            "Ukuran dokumen maksimal 10 MiB.",
                          );
                          return;
                        }
                        setDisputeFile(file);
                        if (file) setDisputeEvidence("");
                      }}
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      PDF teks, TXT, atau JSON. Lampiran sengketa disimpan
                      terpisah dari bukti Deal yang sudah disetujui.
                    </p>
                    {disputeFileError && (
                      <p className="text-xs text-destructive" role="alert">
                        {disputeFileError}
                      </p>
                    )}
                  </div>
                )}
                <div className="field-group">
                  <Label htmlFor="dispute-reason">Alasan dispute</Label>
                  <Textarea
                    id="dispute-reason"
                    value={disputeReason}
                    onChange={(event) => setDisputeReason(event.target.value)}
                    minLength={5}
                    maxLength={2000}
                    required
                  />
                </div>
                <Button
                  variant="outline"
                  type="submit"
                  disabled={
                    (!disputeEvidence && !disputeFile) ||
                    disputeReason.trim().length < 5 ||
                    dispute.isPending ||
                    claim.hasDispute
                  }
                >
                  {dispute.isPending
                    ? "Mencatat dispute…"
                    : claim.hasDispute
                      ? "Dispute sedang aktif"
                      : "Catat dispute"}
                </Button>
                <InlineError
                  error={dispute.error}
                  onRefresh={() => void refresh()}
                />
              </form>
              <div className="space-y-5">
                {(roles.borrower || roles.buyer) && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">
                      Cabut persetujuan lama
                    </h3>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Sebelum Deal direvisi, persetujuan lama yang masih berlaku
                      harus dicabut oleh wallet penandatangan. Pilih nomor
                      persetujuan atau masukkan nonce yang ditampilkan saat
                      revisi tertahan. Pencabutan berlaku setelah transaksi
                      jaringan terkonfirmasi.
                    </p>
                    {evidence.data?.consents.some(
                      (consent) =>
                        consent.signer.toLowerCase() ===
                          user?.wallet.toLowerCase() &&
                        !consent.revoked &&
                        !consent.onchainInvalidation,
                    ) && (
                      <Select
                        aria-label="Persetujuan tersimpan yang akan dicabut"
                        value={revokeNonce}
                        onChange={(event) => setRevokeNonce(event.target.value)}
                      >
                        <option value="">Pilih nonce tersimpan</option>
                        {evidence.data.consents
                          .filter(
                            (consent) =>
                              consent.signer.toLowerCase() ===
                                user?.wallet.toLowerCase() &&
                              !consent.revoked &&
                              !consent.onchainInvalidation,
                          )
                          .map((consent) => (
                            <option
                              key={`${consent.role}-${consent.nonce}`}
                              value={consent.nonce}
                            >
                              v{consent.version} · {consent.role} · nonce{" "}
                              {consent.nonce}
                            </option>
                          ))}
                      </Select>
                    )}
                    <Input
                      aria-label="Nonce persetujuan"
                      inputMode="numeric"
                      value={revokeNonce}
                      onChange={(event) => setRevokeNonce(event.target.value)}
                      placeholder="Nonce dari payload persetujuan"
                    />
                    <Button
                      variant="outline"
                      disabled={
                        operations.busy ||
                        !/^(0|[1-9]\d{0,77})$/.test(revokeNonce) ||
                        BigInt(revokeNonce) >= 2n ** 256n
                      }
                      onClick={() =>
                        operations.prepare({
                          kind: "transaction",
                          action: "REVOKE_CONSENT",
                          nonce: revokeNonce,
                        })
                      }
                    >
                      Tinjau pencabutan
                    </Button>
                  </div>
                )}
                {claim.workflow === "REGISTERED" &&
                  financing.data?.financingStatus === "UNFUNDED" && (
                    <div className="border-t border-border pt-5">
                      <h3 className="text-sm font-semibold">
                        Pembatalan sebelum pendanaan
                      </h3>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        Pembatalan bersifat final dan hanya dapat dilakukan jika
                        claim belum didanai. Registry memeriksa kondisi ini saat
                        simulasi dan transaksi.
                      </p>
                      <Button
                        className="mt-3"
                        variant="outline"
                        disabled={operations.busy}
                        onClick={() =>
                          operations.prepare({
                            kind: "transaction",
                            action: "CANCEL",
                          })
                        }
                      >
                        Tinjau pembatalan
                      </Button>
                    </div>
                  )}
              </div>
            </div>
          </details>
        )}
      {operations.dialog}
    </div>
  );
}
