/** Local replay only. These checkpoints describe archived product states, not new API actions. */
export const steps = [
  {
    id: "pengajuan",
    label: "Pengajuan",
    title: "Invoice siap. Modal masih menunggu.",
    role: "Supplier",
    explanation: "Supplier mengajukan invoice dari barang yang sudah dikirim.",
  },
  {
    id: "konfirmasi",
    label: "Konfirmasi buyer",
    title: "Pembeli mengakui tagihannya.",
    role: "Buyer",
    explanation: "Pengakuan buyer mendukung nilai dan jatuh tempo invoice.",
  },
  {
    id: "pemeriksaan",
    label: "Pemeriksaan",
    title: "Bukti diperiksa, satu per satu.",
    role: "Agent Talunai",
    explanation:
      "Agent membaca dokumen, mencocokkan informasi, dan meneruskan hasil ke verifikator.",
  },
  {
    id: "review",
    label: "Review",
    title: "Manusia memegang keputusan.",
    role: "Verifier",
    explanation:
      "Verifikator meninjau bukti. Para pihak menyetujui ketentuan sebelum deal dicatat.",
  },
  {
    id: "pendanaan",
    label: "Pendanaan",
    title: "Modal bergerak lebih awal.",
    role: "Pendana",
    explanation:
      "Pendana membiayai sebagian invoice. Dana masuk langsung ke pemasok.",
  },
  {
    id: "pembayaran",
    label: "Pembayaran",
    title: "Buyer melunasi invoice.",
    role: "Buyer",
    explanation:
      "Pembayaran masuk ke kontrak dan dialokasikan sesuai ketentuan deal.",
  },
  {
    id: "settlement",
    label: "Settlement",
    title: "Setiap pihak menerima haknya.",
    role: "Pendana & supplier",
    explanation:
      "Pendana menarik pokok dan biaya tetap. Pemasok menarik sisa nilai invoice.",
  },
] as const;
export const beats = [
  { step: 0, phase: 0, duration: 5000, workflow: "DRAFT" },
  { step: 1, phase: 0, duration: 2800, workflow: "DRAFT" },
  { step: 1, phase: 1, duration: 2400, workflow: "DRAFT" },
  { step: 2, phase: 0, duration: 1000, workflow: "EXTRACTING" },
  { step: 2, phase: 1, duration: 1000, workflow: "EXTRACTING" },
  { step: 2, phase: 2, duration: 1000, workflow: "EXTRACTING" },
  { step: 2, phase: 3, duration: 1000, workflow: "EXTRACTING" },
  { step: 2, phase: 4, duration: 2000, workflow: "READY_FOR_SIGNATURES" },
  { step: 3, phase: 0, duration: 3000, workflow: "READY_FOR_SIGNATURES" },
  { step: 3, phase: 1, duration: 2800, workflow: "REGISTERED" },
  { step: 4, phase: 0, duration: 2600, workflow: "REGISTERED" },
  { step: 4, phase: 1, duration: 1200, workflow: "REGISTERED" },
  { step: 4, phase: 2, duration: 2200, workflow: "REGISTERED" },
  { step: 5, phase: 0, duration: 2600, workflow: "REGISTERED" },
  { step: 5, phase: 1, duration: 1200, workflow: "REGISTERED" },
  { step: 5, phase: 2, duration: 2200, workflow: "REGISTERED" },
  { step: 6, phase: 0, duration: 2500, workflow: "REGISTERED" },
  { step: 6, phase: 1, duration: 1500, workflow: "REGISTERED" },
  { step: 6, phase: 2, duration: 2000, workflow: "REGISTERED" },
] as const;
export type ReplayState = {
  cursor: number;
  playing: boolean;
  performing: boolean;
};
export const initialReplay: ReplayState = {
  cursor: 0,
  playing: false,
  performing: false,
};
export type ReplayEvent =
  | { type: "goto"; step: number }
  | { type: "restore"; cursor: number }
  | {
      type:
        "next" | "previous" | "play" | "pause" | "restart" | "action" | "tick";
    };
export function replayReducer(
  state: ReplayState,
  event: ReplayEvent,
): ReplayState {
  const current = beats[state.cursor];
  const go = (step: number): ReplayState => ({
    cursor: Math.max(
      0,
      beats.findIndex((b) => b.step === Math.max(0, Math.min(6, step))),
    ),
    playing: false,
    performing: step === 2,
  });
  switch (event.type) {
    case "goto":
      return go(event.step);
    case "restore":
      return {
        ...initialReplay,
        cursor:
          Number.isInteger(event.cursor) && beats[event.cursor]
            ? event.cursor
            : 0,
      };
    case "next":
      return go(current.step + 1);
    case "previous":
      return go(current.step - 1);
    case "restart":
      return initialReplay;
    case "pause":
      return { ...state, playing: false, performing: false };
    case "play":
      return {
        cursor: state.cursor === beats.length - 1 ? 0 : state.cursor,
        playing: true,
        performing: false,
      };
    case "action": {
      const cursor = Math.min(state.cursor + 1, beats.length - 1);
      const next = beats[cursor];
      return {
        cursor,
        playing: false,
        performing:
          (next.step === 2 && next.phase < 4) ||
          ([4, 5].includes(next.step) && next.phase === 1),
      };
    }
    case "tick": {
      if (!state.playing && !state.performing) return state;
      const cursor = Math.min(state.cursor + 1, beats.length - 1);
      if (cursor === beats.length - 1)
        return { cursor, playing: false, performing: false };
      if (state.performing && beats[cursor].step !== current.step)
        return { ...state, performing: false };
      return {
        ...state,
        cursor,
        performing:
          state.performing &&
          ((beats[cursor].step === 2 && beats[cursor].phase < 4) ||
            ([4, 5].includes(beats[cursor].step) && beats[cursor].phase === 1)),
      };
    }
  }
}
export function replayHash(cursor: number) {
  const b = beats[cursor];
  return `#${steps[b.step].id}/${b.phase}`;
}
export function cursorFromHash(hash: string) {
  return Math.max(
    0,
    beats.findIndex((_, i) => replayHash(i) === hash),
  );
}
export function replayFacts(cursor: number) {
  const b = beats[cursor];
  return {
    buyerAcknowledged: cursor >= 2,
    checksCompleted: cursor >= 7,
    reviewed: cursor >= 9,
    signed: cursor >= 9,
    registered: cursor >= 9,
    funded: cursor >= 12,
    paid: cursor >= 15,
    lenderWithdrawn: cursor >= 17,
    supplierWithdrawn: cursor >= 18,
    pending: [4, 5].includes(b.step) && b.phase === 1,
    completed: cursor === 18,
  };
}
