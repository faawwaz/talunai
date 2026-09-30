"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/features/session/provider";
import { useWorkspaceNavigation } from "@/features/workspace/navigation";
import type { Claim } from "../../../packages/client";

export function WorkflowTrail({ claim }: { claim: Claim }) {
  const { api } = useSession();
  const navigation = useWorkspaceNavigation();
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const evidence = useQuery({
    queryKey: ["evidence", claim.id],
    queryFn: () => api.evidence(claim.id),
  });
  const financing = useQuery({
    queryKey: ["financing", claim.id],
    queryFn: () => api.financing(claim.id),
  });
  const projected =
    financing.data?.stateConfidence === "CONFIRMED_PROJECTION" ||
    financing.data?.stateConfidence === "DEGRADED_LAST_CONFIRMED_PROJECTION";
  const registered = claim.workflow === "REGISTERED";
  const signed = ["BORROWER", "BUYER"].every((role) =>
    evidence.data?.consents.some(
      (consent) =>
        consent.role === role &&
        consent.version === claim.version &&
        !consent.revoked &&
        !consent.onchainInvalidation &&
        consent.deadline > now,
    ),
  );
  const funded = Boolean(
    projected && financing.data?.financingStatus !== "UNFUNDED",
  );
  const collected = Boolean(
    projected && financing.data?.collectionStatus === "FULLY_COLLECTED",
  );
  const steps = [
    {
      label: "Invoice",
      done: Boolean(evidence.data?.documents.length),
      tab: "evidence",
    },
    {
      label: "Review",
      done: claim.evidence.humanReviewStatus === "ATTESTED",
      tab: "terms",
    },
    { label: "Persetujuan", done: registered || signed, tab: "terms" },
    { label: "Registrasi", done: registered, tab: "terms" },
    { label: "Pendanaan", done: funded, tab: "payments" },
    { label: "Collection penuh", done: collected, tab: "payments" },
  ];
  return (
    <nav
      aria-label="Tahap pembiayaan invoice"
      className="relative min-w-0 max-w-full overflow-x-auto rounded-lg border border-border bg-card px-4 py-4 sm:px-5"
    >
      <ol className="flex min-w-max items-center gap-3">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-center gap-3">
            <Link
              href={navigation.claimHref(claim.id, step.tab)}
              className={`inline-flex items-center gap-2 text-xs font-medium ${step.done ? "text-primary" : "text-muted-foreground"}`}
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full text-[10px] ${step.done ? "bg-secondary" : "border border-border"}`}
              >
                {step.done ? <Check size={12} aria-hidden="true" /> : index + 1}
              </span>
              {step.label}
              <span className="sr-only">
                : {step.done ? "tercatat selesai" : "belum tercatat selesai"}
              </span>
            </Link>
            {index < steps.length - 1 && (
              <ArrowRight
                size={12}
                className="text-muted-foreground/40"
                aria-hidden="true"
              />
            )}
          </li>
        ))}
      </ol>
      {financing.data?.stateConfidence ===
        "DEGRADED_LAST_CONFIRMED_PROJECTION" && (
        <p className="mt-3 text-xs text-muted-foreground">
          Tahap finansial memakai konfirmasi terakhir; sinkronisasi perlu
          dipulihkan.
        </p>
      )}
    </nav>
  );
}
