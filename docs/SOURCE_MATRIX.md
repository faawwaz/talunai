# Matriks sumber dan keputusan implementasi

Tanggal brief: **28 September 2026, Asia/Jakarta**. Angka advance 80%, fee flat 1,5%, cap 100 juta dan funding window 24 jam adalah **kebijakan simulasi dari brief**, bukan observasi harga pasar, APR, kalibrasi risiko, atau rekomendasi investasi.

Sumber hukum dan hackathon di bawah diterima sebagai konteks dalam brief pengguna. Implementasi tidak mengklaim sudah melakukan riset hukum konsolidasi, verifikasi perusahaan, registrasi Luma, pengajuan submission, atau integrasi registri. Status integrasi dan hasil command tersedia terpisah dalam TEST_REPORT dan LIMITATIONS.

| ID | Sumber primer | Konsekuensi implementasi | Batas bukti |
| --- | --- | --- | --- |
| S01 | [FAQ hackathon](https://indonesiaweb3hack.xyz/en/faq) | Output kontrak, repo dan demo dapat disiapkan untuk submission. | Tidak ada pengajuan otomatis; jangan menyatakan terdaftar. |
| S02 | [Jadwal resmi](https://indonesiaweb3hack.xyz/en/schedule) | Brief menetapkan batas konservatif 30 September 2026 23:59 WIB. | Tidak memvalidasi rumor perpanjangan. |
| S03 | [Homepage](https://indonesiaweb3hack.xyz/en) | Registrasi penyelenggara merupakan urusan terpisah dari source code. | Belum diintegrasikan. |
| S04 | [Luma](https://luma.com/pcc699dv) | Tidak menganggap deployment sebagai submission. | Belum diintegrasikan. |
| S05 | [Viem BSC testnet](https://raw.githubusercontent.com/wevm/viem/main/src/chains/definitions/bscTestnet.ts) | Chain ID 97; lokal 31337. Tolak mainnet. | Endpoint RPC diverifikasi runtime; definisi jaringan bukan bukti deployment. |
| S06 | [OJK RDKB Juli 2026](https://ojk.go.id/id/berita-dan-kegiatan/siaran-pers/Pages/RDKB-Juli-2026.aspx) | Konteks relevansi RWA komoditas. | Bukan izin OJK untuk TALUNAI. |
| S07 | [UU Sistem Resi Gudang](https://jdih.kemenkeu.go.id/api/download/FullText/2006/9TAHUN2006UU.htm) | Registry tidak dipresentasikan sebagai legal title atau resi gudang sah. | Registri eksternal `NOT_INTEGRATED`; tidak ada kajian hukum konsolidasi. |
| S08 | [BI 13 Januari 2018](https://www.bi.go.id/id/publikasi/ruang-media/news-release/Pages/sp_200418.aspx) | Token uji tanpa nilai; tidak ada fiat atau dana nyata. | Sumber historis; bukan kesimpulan hukum stablecoin terkini. |
| S09 | [UU PDP 27/2022](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022) | File privat, authorization objek, tanpa PII publik. | Semua identitas fiktif; kajian privasi produksi belum dilakukan. |
| S10 | [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) | Pesan SIWE lengkap, nonce terikat browser dan sekali pakai, domain/URI/expiry diperiksa. | Login tidak membuktikan KYB atau persetujuan pembiayaan. |
| S11 | [Viem verifySiweMessage](https://github.com/wevm/viem/blob/main/src/actions/siwe/verifySiweMessage.ts) | Gunakan primitives viem untuk login EOA; akun kontrak ditolak eksplisit. | ERC-1271 belum didukung P0. |
| S12 | [EIP-712](https://eips.ethereum.org/EIPS/eip-712) | Consent borrower dan buyer tipe terpisah, domain registry+chain, nonce/deadline/terms lengkap. | Replay protection diterapkan aplikasi/kontrak. |
| S13 | [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | Zod strict dan independent evidence validation. | Dokumentasi dibaca saat coding; endpoint OpenAI tidak digunakan setelah override OpenRouter. |
| S14 | [OWASP AI Agent Security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) | Workflow bertahap, batas langkah, typed allowlist, pemeriksaan gateway independen. | Bukan audit keamanan agent. |
| S15 | [OWASP Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) | Dokumen adalah data; tidak ada wallet/tool authority yang berasal dari model. | Detektor teks hanya sinyal tambahan; keamanan utama berasal dari batas kewenangan dan validasi. |
| S16 | [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | Signature/MIME/ext, UTF-8, PDF subprocess terbatas, nama file server, private storage. | OCR, antivirus dan object storage produksi belum diintegrasikan. |
| S17 | [Viem simulateContract](https://github.com/wevm/viem/blob/main/src/actions/public/simulateContract.ts) | Simulasi sender yang tepat sebelum template transaksi. | Simulasi bukan receipt sukses. |
| S18 | [Viem waitForTransactionReceipt](https://github.com/wevm/viem/blob/main/src/actions/public/waitForTransactionReceipt.ts) | Bedakan submitted/mined/confirmed/reverted/unknown. | Confirmation policy bukan jaminan finality protokol. |
| S19 | [OpenZeppelin Access Control](https://docs.openzeppelin.com/contracts/5.x/access-control) | Role verifier, lender, guardian dan demo mint terpisah. | Admin/verifier tetap pihak tepercaya. |
| S20 | [OpenZeppelin ERC-20/SafeERC20](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20) | Token immutable, safe transfer, cek balance delta. | Tidak menerima token bebas atau fee-on-transfer. |
| S21 | [OpenZeppelin Utilities](https://docs.openzeppelin.com/contracts/5.x/api/utils) | Reentrancy protection dan signature primitives. | Penggunaan library bukan audit logika keuangan. |
| S22 | [pg-boss](https://github.com/timgit/pg-boss) | Antrean PostgreSQL persisten, transactional outbox, efek idempotent. | Pengiriman job ulang tetap dimungkinkan. |
| S23 | [LangGraph Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) | State machine DB cukup untuk workflow ini. | LangGraph sengaja tidak menjadi dependensi. |
| S24 | [Node releases](https://nodejs.org/en/about/previous-releases) | Runtime Node 24. | Versi yang benar-benar diuji dicatat TEST_REPORT. |
| S25 | [World Bank Commodity Markets](https://www.worldbank.org/en/research/commodity-markets) | Piutang tetap tidak direvaluasi menurut spot kakao. | Tidak ada oracle harga atau liquidation. |
| S26 | [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | Role+organisasi+objek diperiksa pada read/write/tool. | Wallet berbeda tidak membuktikan beneficial owner berbeda. |
| S27 | [Fastify Validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) | Digantikan override pengguna: Next Route Handlers dengan modul domain terpisah. | Fastify tidak diinstal. |

## Override pengguna yang berlaku

- Next.js App Router dalam repository saat ini, backend dahulu, Route Handlers tipis; worker Node terpisah. Panduan `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` dibaca dari versi yang terpasang.
- npm dan `package-lock.json`, menggantikan pnpm pada brief awal.
- Provider live **OpenRouter** dahulu. Paket `openai` hanya transport API yang kompatibel; tidak menggunakan `OPENAI_API_KEY` atau endpoint OpenAI.

| Sumber implementasi tambahan | Temuan yang diperiksa ketika coding | Penerapan |
| --- | --- | --- |
| [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs) | `response_format.type=json_schema`; dukungan tergantung endpoint provider. `require_parameters: true` membatasi routing ke endpoint yang mendukung parameter. | Zod strict + `provider.require_parameters=true` + verifikasi provenance/raw value independen. Tidak menganggap JSON valid sebagai bukti kebenaran. |
| [Qwen3.5-Flash di OpenRouter](https://openrouter.ai/qwen/qwen3.5-flash-02-23) | Halaman menampilkan model `qwen/qwen3.5-flash-02-23` dengan harga $0,065/juta input token dan $0,26/juta output token saat diperiksa. Harga/ketersediaan dapat berubah. | Default konfigurasi model yang dapat diganti server; output maksimal 4096 token. Ini pemilihan biaya demo, bukan bukti akurasi model atau harga yang dijamin. |

`LLM_MODE=mock` menjalankan parser field berlabel atas teks dokumen yang benar-benar diparse. `LLM_MODE=live` memanggil OpenRouter dan gagal eksplisit pada key/model hilang, refusal, timeout, output tidak lengkap, schema tidak valid, atau bukti fiktif. Tidak ada fallback diam-diam. Pengujian mock, stub error, dan pemanggilan provider live harus dilaporkan secara terpisah.
