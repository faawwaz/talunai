# Referensi desain workspace TALUNAI

Ditinjau dan ditangkap pada 28 September 2026. Arah: **Warm Precision** dari brief pengguna. Fokus pengerjaan ini workspace; landing dan hero 3D ditunda.

| Sumber primer | Bukti visual lokal | Penerapan |
|---|---|---|
| [Mercury public demo](https://demo.mercury.com/home) | `references/mercury.png` (shell demo; area utama pada tangkapan masih loading) | Sidebar tenang, organisasi dan navigasi terpisah, ruang kerja terang. |
| [Mercury: managing invoices](https://support.mercury.com/hc/en-us/articles/29647851492884-Managing-invoices-and-payment-links) | `references/mercury-invoices.png`, screenshot produk yang diterbitkan Mercury | Tabel invoice dengan identitas, nominal, dan status yang mudah dipindai. Tidak menyalin angka, logo, atau klaim layanan. |
| [Ramp: bill pay approvals](https://support.ramp.com/bill-pay-approvals/) | `references/ramp.png` | Persetujuan sebagai pekerjaan nyata; langkah berikutnya dan pemeriksaan sebelum tindakan. |
| [Linear: Inbox](https://linear.app/docs/inbox) | `references/linear.png`, `references/linear-inbox.png` | Pembagian daftar/detail/aktivitas serta metadata yang tenang. Tidak mengambil dark mode. |

Screenshot referensi adalah bahan studi, tidak dimasukkan sebagai aset produk. Palet, brand TALUNAI, copy, dan komposisi aplikasi dibuat mengikuti konteks invoice B2B sintetis. Data workspace berasal dari endpoint terotorisasi, bukan angka yang diambil dari referensi.

## Sistem yang diterapkan

- Manrope, angka tabular, canvas ivory, permukaan putih, jade untuk tindakan dan sage untuk langkah berikutnya. Pistachio terbatas pada detail navigasi.
- Sidebar 232 px; topbar jaringan dan akun; ringkasan berfokus pada pekerjaan berikutnya, daftar invoice, tugas, dan aktivitas nyata.
- Detail pengajuan memisahkan Ringkasan, Bukti, Ketentuan, Pembayaran, dan Aktivitas melalui URL yang dapat dibuka langsung.
- Form pengajuan bertahap: pihak/invoice, barang, nominal, lalu tinjau. Tidak ada kategori kakao default.
- Dialog tindakan menampilkan nominal, jaringan, penerima, fee, dan calldata kontrak tepercaya. Penolakan wallet dapat dicoba ulang; broadcast yang belum dikonfirmasi tetap pending.
- Navigasi mobile memakai dialog dengan focus trap, Escape dan focus return. Reduced motion berlaku pada CSS dan MotionConfig.

## Pemeriksaan hasil

`npm run test:ui` membuat screenshot browser serta laporan pemeriksaan pada `.local/ui-smoke/`. Screenshot ini memakai backend aktif dengan data sintetis yang dibuat melalui API/form. Tidak menggunakan snapshot atau pembayaran palsu. Salinan hasil terpilih berada di `docs/design/results/` bila pemeriksaan selesai.

Automated accessibility checks dan screenshot adalah pemeriksaan awal. Tidak menyatakan hasil field Core Web Vitals atau kepatuhan aksesibilitas menyeluruh.


Hasil final terpilih: [ringkasan desktop](results/overview-desktop.png), [ringkasan mobile](results/overview-mobile.png), [detail invoice](results/claim-detail-desktop.png), [form kemasan](results/packaging-form-review.png), [review verifier](results/verifier-review-desktop.png), [persetujuan siap registrasi](results/consents-complete-desktop.png). Screenshot diambil dari development runtime nyata; overlay developer Next.js dapat terlihat dan tidak merupakan elemen brand produk.
