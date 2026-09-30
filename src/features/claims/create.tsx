"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileCheck2,
  Plus,
  Trash2,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { useWorkspaceNavigation } from "@/features/workspace/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDate, money } from "@/lib/format";
import { quote } from "../../../packages/domain/finance";
import type {
  CreateClaim,
  GoodsCategory,
  GoodsMetadata,
} from "../../../packages/client";
import {
  ClaimSessionGate,
  DetailFacts,
  InlineError,
  SectionTitle,
  SyntheticNote,
} from "./shared";

const steps = ["Invoice & barang", "Nominal & waktu", "Tinjau pengajuan"];
type Values = {
  organizationId: string;
  buyerOrganizationId: string;
  lenderOrganizationId: string;
  invoiceNamespace: string;
  invoiceNumber: string;
  acceptedOutstanding: string;
  requestedPrincipal: string;
  invoiceDueDate: string;
  goodsCategory: GoodsCategory | "";
  goodsDescription: string;
  lineItems: GoodsMetadata["lineItems"];
};

function validateStage(stage: number, value: Values) {
  const errors: Record<string, string> = {};
  if (stage === 0 || stage === 2) {
    if (!value.goodsCategory)
      errors.goodsCategory = "Pilih kategori barang yang diserahkan.";
    if (
      !value.goodsDescription.trim() ||
      value.goodsDescription.trim().length > 500
    )
      errors.goodsDescription =
        "Jelaskan barang yang mendasari invoice, maksimal 500 karakter.";
    value.lineItems.forEach((item, index) => {
      if (!item.description.trim() || item.description.trim().length > 500)
        errors[`lineItems.${index}.description`] =
          "Isi nama barang, maksimal 500 karakter.";
      if (
        !/^(?:0|[1-9]\d{0,29})(?:\.\d{1,6})?$/.test(item.quantity) ||
        !/[1-9]/.test(item.quantity)
      )
        errors[`lineItems.${index}.quantity`] =
          "Masukkan jumlah positif. Gunakan titik untuk desimal, maksimal 6 angka.";
      if (!item.unit.trim() || item.unit.trim().length > 32)
        errors[`lineItems.${index}.unit`] =
          "Isi satuan yang sama dengan invoice, maksimal 32 karakter.";
    });
    if (!value.organizationId)
      errors.organizationId = "Pilih organisasi penerbit.";
    if (!value.buyerOrganizationId)
      errors.buyerOrganizationId = "Pilih buyer yang terdaftar.";
    if (!/^[A-Za-z0-9/_-]{1,60}$/.test(value.invoiceNamespace))
      errors.invoiceNamespace =
        "Isi seri atau tahun penomoran invoice, misalnya 2026.";
    if (!/^[A-Za-z0-9/._ -]{1,100}$/.test(value.invoiceNumber))
      errors.invoiceNumber = "Gunakan nomor yang sama dengan dokumen invoice.";
  }
  if (stage === 1 || stage === 2) {
    for (const key of ["acceptedOutstanding", "requestedPrincipal"] as const)
      if (
        !/^[1-9]\d{0,77}$/.test(value[key]) ||
        BigInt(value[key] || "0") >= 2n ** 256n
      )
        errors[key] = "Masukkan bilangan bulat positif tanpa pemisah ribuan.";
    if (!errors.acceptedOutstanding && !errors.requestedPrincipal) {
      const offer = quote(value.acceptedOutstanding, value.requestedPrincipal);
      if (BigInt(value.requestedPrincipal) > BigInt(offer.advanceCap))
        errors.requestedPrincipal = `Melebihi batas uang muka ${money(offer.advanceCap)}. Ubah nominal secara eksplisit.`;
      if (BigInt(value.requestedPrincipal) > 100000000n)
        errors.requestedPrincipal =
          "Principal maksimal 100.000.000 IDRT uji per invoice.";
    }
    const due = new Date(`${value.invoiceDueDate}T23:59:00+07:00`).getTime();
    if (
      !value.invoiceDueDate ||
      !Number.isFinite(due) ||
      due <= Date.now() + 86400000
    )
      errors.invoiceDueDate =
        "Pilih jatuh tempo setelah jendela pendanaan 24 jam.";
  }
  return errors;
}

export function CreateClaimPage() {
  return (
    <ClaimSessionGate>
      <CreateClaimForm />
    </ClaimSessionGate>
  );
}

function CreateClaimForm() {
  const navigation = useWorkspaceNavigation();
  const { api, user } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const issuers = user?.memberships.filter((m) => m.role === "BORROWER") ?? [];
  const create = useMutation({
    mutationFn: (input: CreateClaim) =>
      api.createClaim(input, crypto.randomUUID()),
    onSuccess: async (claim) => {
      await queryClient.invalidateQueries({ queryKey: ["claims"] });
      router.push(navigation.claimHref(claim.id, "evidence"));
    },
  });
  const form = useForm({
    defaultValues: {
      organizationId: issuers[0]?.organizationId ?? "",
      buyerOrganizationId: "",
      lenderOrganizationId: "",
      invoiceNamespace: "",
      invoiceNumber: "",
      acceptedOutstanding: "",
      requestedPrincipal: "",
      invoiceDueDate: "",
      goodsCategory: "",
      goodsDescription: "",
      lineItems: [{ description: "", quantity: "", unit: "" }],
    } as Values,
    onSubmit: async ({ value }) => {
      const found = validateStage(2, value);
      setErrors(found);
      if (Object.keys(found).length || !accepted) return;
      await create.mutateAsync({
        organizationId: value.organizationId,
        buyerOrganizationId: value.buyerOrganizationId,
        ...(value.lenderOrganizationId
          ? { lenderOrganizationId: value.lenderOrganizationId }
          : {}),
        invoiceNamespace: value.invoiceNamespace,
        invoiceNumber: value.invoiceNumber,
        acceptedOutstanding: value.acceptedOutstanding,
        requestedPrincipal: value.requestedPrincipal,
        invoiceDueAt: Math.floor(
          new Date(`${value.invoiceDueDate}T23:59:00+07:00`).getTime() / 1000,
        ),
        fundingWindowSeconds: 86400,
        goods: {
          category: value.goodsCategory as GoodsCategory,
          description: value.goodsDescription.trim(),
          lineItems: value.lineItems.map((item) => ({
            ...item,
            description: item.description.trim(),
            unit: item.unit.trim(),
          })),
        },
      });
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const counterparties = useQuery({
    queryKey: ["organizations", values.organizationId],
    queryFn: () =>
      api.organizations({
        issuerOrganizationId: values.organizationId,
        limit: 100,
      }),
    enabled: Boolean(values.organizationId),
  });
  const buyerOptions =
    counterparties.data?.items.filter((org) => org.kind === "BUYER") ?? [];
  const lenderOptions =
    counterparties.data?.items.filter((org) => org.kind === "LENDER") ?? [];
  let preview: ReturnType<typeof quote> | null = null;
  try {
    if (
      /^[1-9]\d{0,77}$/.test(values.acceptedOutstanding) &&
      /^[1-9]\d{0,77}$/.test(values.requestedPrincipal)
    )
      preview = quote(values.acceptedOutstanding, values.requestedPrincipal);
  } catch {
    /* Inline validation keeps invalid input out of the request. */
  }
  const next = () => {
    const found = validateStage(stage, values);
    setErrors(found);
    if (!Object.keys(found).length) {
      setStage((value) => Math.min(2, value + 1));
    } else document.getElementById(Object.keys(found)[0])?.focus();
  };
  if (!issuers.length)
    return (
      <EmptyState
        icon={FileCheck2}
        title="Akses borrower diperlukan"
        description="Pengajuan tersedia untuk organisasi penerbit yang sudah disetujui. Hubungi pengelola untuk mengaktifkan akses testnet."
        action={
          <Button asChild variant="outline">
            <Link href={navigation.href("/claims")}>Kembali ke piutang</Link>
          </Button>
        }
      />
    );
  return (
    <div className="page-stack">
      <Link
        href={navigation.href("/claims")}
        className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft size={15} />
        Semua piutang
      </Link>
      <PageHeader
        eyebrow="PENGAJUAN BARU"
        title="Mulai dari invoice yang diakui"
        description="Simpan detail piutang, lalu lengkapi bukti untuk peninjauan."
      />
      <ol
        className="flex flex-wrap gap-x-8 gap-y-3 border-b border-border pb-6"
        aria-label="Tahap pengajuan"
      >
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={stage === index ? "step" : undefined}
            className={`flex items-center gap-3 text-sm ${stage === index ? "font-semibold text-foreground" : "text-muted-foreground"}`}
          >
            <span
              className={`flex size-7 items-center justify-center rounded-full text-xs ${index <= stage ? "bg-primary text-white" : "border border-border bg-card"}`}
            >
              {index < stage ? <Check size={14} /> : index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (stage < 2) next();
          else void form.handleSubmit().catch(() => {});
        }}
        className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"
      >
        <section className="surface p-6 sm:p-8">
          {stage === 0 && (
            <>
              <SectionTitle
                title="Pihak yang terlibat"
                description="Identitas dan wallet penerima berasal dari organisasi yang disetujui."
              />
              <div className="space-y-5">
                <form.Field name="organizationId">
                  {(field) => (
                    <div className="field-group">
                      <Label htmlFor="organizationId">
                        Organisasi penerbit
                      </Label>
                      <Select
                        id="organizationId"
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                          form.setFieldValue("buyerOrganizationId", "");
                          form.setFieldValue("lenderOrganizationId", "");
                        }}
                      >
                        {issuers.map((org) => (
                          <option
                            key={org.organizationId}
                            value={org.organizationId}
                          >
                            {org.organizationName ?? org.organizationId}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </form.Field>
                <form.Field name="buyerOrganizationId">
                  {(field) => (
                    <div className="field-group">
                      <Label htmlFor="buyerOrganizationId">Buyer</Label>
                      <Select
                        id="buyerOrganizationId"
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        aria-invalid={Boolean(errors.buyerOrganizationId)}
                      >
                        <option value="">
                          {counterparties.isPending
                            ? "Memuat organisasi…"
                            : "Pilih buyer terdaftar"}
                        </option>
                        {buyerOptions.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name}
                          </option>
                        ))}
                      </Select>
                      {errors.buyerOrganizationId && (
                        <p className="text-xs text-red-700" role="alert">
                          {errors.buyerOrganizationId}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>
                <form.Field name="lenderOrganizationId">
                  {(field) => (
                    <div className="field-group">
                      <Label htmlFor="lenderOrganizationId">
                        Akses lender{" "}
                        <span className="font-normal text-muted-foreground">
                          · opsional
                        </span>
                      </Label>
                      <Select
                        id="lenderOrganizationId"
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      >
                        <option value="">Belum ditentukan</option>
                        {lenderOptions.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name}
                          </option>
                        ))}
                      </Select>
                      <p className="field-hint">
                        Lender terpilih dapat mengakses piutang ini. Pendanaan
                        tetap membutuhkan transaksi lender sendiri.
                      </p>
                    </div>
                  )}
                </form.Field>
                <InlineError
                  error={counterparties.error}
                  onRefresh={() => void counterparties.refetch()}
                />
                <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-[1fr_2fr]">
                  {[
                    {
                      name: "invoiceNamespace",
                      label: "Seri / tahun invoice",
                      placeholder: "Contoh: 2026",
                    },
                    {
                      name: "invoiceNumber",
                      label: "Nomor invoice",
                      placeholder: "Sesuai dokumen asli",
                    },
                  ].map(({ name, label, placeholder }) => (
                    <form.Field
                      key={name}
                      name={name as "invoiceNamespace" | "invoiceNumber"}
                    >
                      {(field) => (
                        <div className="field-group">
                          <Label htmlFor={name}>{label}</Label>
                          <Input
                            id={name}
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                            placeholder={placeholder}
                            aria-invalid={Boolean(errors[name])}
                            autoComplete="off"
                          />
                          {errors[name] && (
                            <p role="alert" className="text-xs text-red-700">
                              {errors[name]}
                            </p>
                          )}
                        </div>
                      )}
                    </form.Field>
                  ))}
                </div>
                <div className="border-t border-border pt-6">
                  <SectionTitle
                    title="Barang yang diserahkan"
                    description="Rincian barang memberi konteks pada piutang B2B. Nominal invoice tetap menjadi dasar pembiayaan."
                  />
                  <div className="space-y-5">
                    <form.Field name="goodsCategory">
                      {(field) => (
                        <div className="field-group">
                          <Label htmlFor="goodsCategory">Kategori barang</Label>
                          <Select
                            id="goodsCategory"
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(
                                event.target.value as GoodsCategory | "",
                              )
                            }
                            aria-invalid={Boolean(errors.goodsCategory)}
                          >
                            <option value="">Pilih kategori</option>
                            <option value="COCOA">Kakao</option>
                            <option value="PACKAGING">Kemasan</option>
                            <option value="OTHER">Barang lainnya</option>
                          </Select>
                          {errors.goodsCategory && (
                            <p role="alert" className="text-xs text-red-700">
                              {errors.goodsCategory}
                            </p>
                          )}
                          {field.state.value === "OTHER" && (
                            <p className="field-hint">
                              Kategori lainnya memerlukan peninjauan manual
                              sebelum dapat dilanjutkan.
                            </p>
                          )}
                        </div>
                      )}
                    </form.Field>
                    <form.Field name="goodsDescription">
                      {(field) => (
                        <div className="field-group">
                          <Label htmlFor="goodsDescription">
                            Deskripsi barang
                          </Label>
                          <Textarea
                            id="goodsDescription"
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                            maxLength={500}
                            placeholder="Jelaskan barang yang telah diserahkan kepada buyer"
                            aria-invalid={Boolean(errors.goodsDescription)}
                          />
                          {errors.goodsDescription && (
                            <p role="alert" className="text-xs text-red-700">
                              {errors.goodsDescription}
                            </p>
                          )}
                        </div>
                      )}
                    </form.Field>
                    <form.Field name="lineItems" mode="array">
                      {(array) => (
                        <div className="space-y-4">
                          {array.state.value.map((_, index) => (
                            <fieldset
                              key={index}
                              className="rounded-md border border-border p-4"
                            >
                              <legend className="px-1 text-xs font-semibold">
                                Rincian {index + 1}
                              </legend>
                              <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                                {(
                                  ["description", "quantity", "unit"] as const
                                ).map((key) => (
                                  <form.Field
                                    key={key}
                                    name={`lineItems[${index}].${key}`}
                                  >
                                    {(field) => (
                                      <div className="field-group">
                                        <Label
                                          htmlFor={`lineItems.${index}.${key}`}
                                        >
                                          {key === "description"
                                            ? "Item"
                                            : key === "quantity"
                                              ? "Jumlah"
                                              : "Satuan"}{" "}
                                          {index + 1}
                                        </Label>
                                        <Input
                                          id={`lineItems.${index}.${key}`}
                                          value={field.state.value}
                                          onChange={(event) =>
                                            field.handleChange(
                                              event.target.value,
                                            )
                                          }
                                          inputMode={
                                            key === "quantity"
                                              ? "decimal"
                                              : undefined
                                          }
                                          maxLength={
                                            key === "description"
                                              ? 500
                                              : key === "unit"
                                                ? 32
                                                : 37
                                          }
                                          placeholder={
                                            key === "unit"
                                              ? "kg, ton, pcs…"
                                              : undefined
                                          }
                                          aria-invalid={Boolean(
                                            errors[`lineItems.${index}.${key}`],
                                          )}
                                        />
                                        {errors[
                                          `lineItems.${index}.${key}`
                                        ] && (
                                          <p
                                            role="alert"
                                            className="text-xs text-red-700"
                                          >
                                            {
                                              errors[
                                                `lineItems.${index}.${key}`
                                              ]
                                            }
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </form.Field>
                                ))}
                              </div>
                              {array.state.value.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => array.removeValue(index)}
                                  className="mt-3 text-muted-foreground"
                                >
                                  <Trash2 size={14} />
                                  Hapus rincian {index + 1}
                                </Button>
                              )}
                            </fieldset>
                          ))}
                          <p className="field-hint">
                            Jumlah menggunakan titik untuk desimal tanpa pemisah
                            ribuan. Satuan mengikuti invoice.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={array.state.value.length >= 30}
                            onClick={() =>
                              array.pushValue({
                                description: "",
                                quantity: "",
                                unit: "",
                              })
                            }
                          >
                            <Plus size={14} />
                            Tambah rincian
                          </Button>
                        </div>
                      )}
                    </form.Field>
                  </div>
                </div>
              </div>
            </>
          )}
          {stage === 1 && (
            <>
              <SectionTitle
                title="Nominal yang diajukan"
                description="Gunakan outstanding bersih yang diakui buyer setelah pembayaran atau penyesuaian sebelumnya."
              />
              <div className="space-y-6">
                {[
                  {
                    name: "acceptedOutstanding",
                    label: "Outstanding invoice",
                    hint: "Nilai tetap yang belum dibayar buyer.",
                  },
                  {
                    name: "requestedPrincipal",
                    label: "Principal yang diminta",
                    hint: "Maksimal 80% outstanding dan 100 juta IDRT uji.",
                  },
                ].map(({ name, label, hint }) => (
                  <form.Field
                    key={name}
                    name={name as "acceptedOutstanding" | "requestedPrincipal"}
                  >
                    {(field) => (
                      <div className="field-group">
                        <Label htmlFor={name}>{label}</Label>
                        <div className="relative">
                          <Input
                            id={name}
                            inputMode="numeric"
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                            placeholder="Nominal utuh, tanpa titik atau koma"
                            className="pr-24 tabular-nums"
                            aria-invalid={Boolean(errors[name])}
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                            IDRT uji
                          </span>
                        </div>
                        <p className="field-hint">
                          {errors[name] ? (
                            <span className="text-red-700" role="alert">
                              {errors[name]}
                            </span>
                          ) : (
                            hint
                          )}
                        </p>
                      </div>
                    )}
                  </form.Field>
                ))}
                <form.Field name="invoiceDueDate">
                  {(field) => (
                    <div className="field-group">
                      <Label htmlFor="invoiceDueDate">
                        Jatuh tempo invoice
                      </Label>
                      <Input
                        id="invoiceDueDate"
                        type="date"
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        aria-invalid={Boolean(errors.invoiceDueDate)}
                      />
                      <p className="field-hint">
                        {errors.invoiceDueDate ? (
                          <span role="alert" className="text-red-700">
                            {errors.invoiceDueDate}
                          </span>
                        ) : (
                          "Tanggal dicatat pukul 23.59 WIB. Jendela pendanaan dibatasi 24 jam sejak draft dibuat."
                        )}
                      </p>
                    </div>
                  )}
                </form.Field>
              </div>
            </>
          )}
          {stage === 2 && (
            <>
              <SectionTitle
                title="Tinjau sebelum menyimpan"
                description="Pengajuan ini akan menjadi draft. Persetujuan dan transaksi dilakukan pada tahap berikutnya."
              />
              <DetailFacts
                items={[
                  {
                    label: "Penerbit",
                    value:
                      issuers.find(
                        (org) => org.organizationId === values.organizationId,
                      )?.organizationName ?? values.organizationId,
                  },
                  {
                    label: "Buyer",
                    value:
                      buyerOptions.find(
                        (org) => org.id === values.buyerOrganizationId,
                      )?.name ?? values.buyerOrganizationId,
                  },
                  {
                    label: "Invoice",
                    value: `${values.invoiceNamespace} · ${values.invoiceNumber}`,
                  },
                  {
                    label: "Kategori barang",
                    value:
                      values.goodsCategory === "COCOA"
                        ? "Kakao"
                        : values.goodsCategory === "PACKAGING"
                          ? "Kemasan"
                          : "Barang lainnya · perlu review",
                  },
                  { label: "Barang", value: values.goodsDescription },
                  {
                    label: "Rincian",
                    value: values.lineItems
                      .map(
                        (item) =>
                          `${item.description} · ${item.quantity} ${item.unit}`,
                      )
                      .join("; "),
                  },
                  {
                    label: "Outstanding diakui",
                    value: money(values.acceptedOutstanding),
                  },
                  {
                    label: "Principal diminta",
                    value: money(values.requestedPrincipal),
                  },
                  {
                    label: "Jatuh tempo",
                    value: formatDate(
                      `${values.invoiceDueDate}T23:59:00+07:00`,
                    ),
                  },
                ]}
              />
              <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-md bg-background p-4 text-sm leading-relaxed">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  className="mt-1 size-4 accent-primary"
                />
                <span>
                  Saya memahami bahwa ini simulasi dengan identitas, dokumen,
                  dan token uji. Barang pada invoice telah diserahkan dan
                  piutang membutuhkan pengakuan buyer.
                </span>
              </label>
              {Object.keys(errors).length > 0 && (
                <p role="alert" className="mt-3 text-sm text-red-700">
                  Periksa detail pengajuan pada tahap sebelumnya.
                </p>
              )}
            </>
          )}
          <div className="mt-8">
            <InlineError error={create.error} />
          </div>
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-6">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStage((value) => Math.max(0, value - 1))}
              disabled={stage === 0 || create.isPending}
            >
              <ArrowLeft size={15} />
              Kembali
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || (stage === 2 && !accepted)}
            >
              {create.isPending
                ? "Menyimpan draft…"
                : stage === 2
                  ? "Simpan & lengkapi bukti"
                  : "Lanjutkan"}
              <ArrowRight size={15} />
            </Button>
          </div>
        </section>
        <aside className="h-fit lg:sticky lg:top-8">
          <p className="text-kicker mb-4">RINGKASAN SIMULASI</p>
          <div className="border-y border-border py-2">
            <DetailFacts
              items={[
                {
                  label: "Principal",
                  value: preview ? money(preview.principal) : "—",
                },
                {
                  label: "Biaya flat 1,5%",
                  value: preview ? money(preview.fixedFee) : "—",
                },
                {
                  label: "Hak lender",
                  value: preview ? money(preview.lenderEntitlement) : "—",
                },
                {
                  label: "Batas uang muka",
                  value: preview ? money(preview.advanceCap) : "—",
                },
              ]}
            />
          </div>
          <div className="mt-5 space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              Biaya flat berlaku satu kali; bukan APR. Nominal yang melebihi
              batas harus direvisi secara eksplisit.
            </p>
            <SyntheticNote />
          </div>
        </aside>
      </form>
    </div>
  );
}
