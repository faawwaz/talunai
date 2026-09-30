# Batas MVP TALUNAI

Diperbarui 29 September 2026. Bukti transaksi testnet lengkap tercatat di [TESTNET_FLOW_RECEIPTS.md](TESTNET_FLOW_RECEIPTS.md); perubahan kontrak keamanan terbaru pada kode sumber memerlukan deployment baru dan belum mengubah kontrak lama secara otomatis.

TALUNAI merupakan demonstrasi teknis dengan identitas fiktif, dokumen sintetis, dan MockIDR tanpa nilai. Token tidak dapat ditebus, tidak mempunyai cadangan, dan bukan stablecoin Rupiah produksi. Ini bukan penerbitan RWA yang sah, layanan pembiayaan berizin, kredit terkalibrasi, atau kontrak yang telah diaudit.

## Kepercayaan dan hukum

- Verifier manusia dan administrator role onchain adalah pihak terpusat yang dipercaya. Pemisahan wallet tidak membuktikan pemisahan pemilik manfaat. Seed CLI hanya membuat organisasi sintetis.
- Tidak ada KYB, KYC, beneficial-owner, registri warehouse/resi gudang, pemeriksaan hak jaminan, bank, pembayaran fiat, atau pencairan Rupiah nyata. Status eksternal tetap `NOT_INTEGRATED`.
- Deduplication hanya mencakup database dan deployment TALUNAI yang sama. Piutang dapat telah dibiayai pihak lain; dokumen, buyer, borrower dan verifier dapat berbohong atau berkolusi.
- Consent mengikat ketentuan teknis dan signer. SIWE membuktikan akses EOA untuk login; keduanya bukan bukti kewenangan perusahaan atau legal title atas barang yang mendasari invoice.
- Persiapan persetujuan baru mencatat setiap nonce/hash yang diterbitkan sebelum payload tanda tangan dikirim ke wallet. Perubahan terms sebelum registrasi diblokir sampai seluruh persetujuan yang pernah diterbitkan untuk Deal telah kedaluwarsa atau nonce-nya benar-benar invalid secara canonical di chain. Ini mencakup signature yang mungkin dibuat di wallet tetapi tidak sempat dikirim ke API. Persetujuan historis tetap tersimpan. Kontrak testnet lama tetap mempercayai verifier yang memanggil registrasi; registry tidak mengetahui organisasi atau versi draft aplikasi di luar signed terms.
- Kebijakan advance 80%, fee flat 1,5% dan cap 100 juta adalah angka simulasi. Tidak ada PD, rating kredit, APR, jaminan yield, asuransi, atau model underwriting tervalidasi.

## Asumsi keuangan

- Satu Deal memiliki satu lender yang membayar seluruh principal satu kali. Satu token uji immutable, decimals 0, hanya chain 31337/97. `LiquidityPoolA` sudah ada pada BSC Testnet dan dapat menjadi lender satu Deal dengan modal gabungan investor; pool bukan AMM/DEX. Tidak ada refinancing, secondary market, proxy upgrade, FX, bridge, atau liquidation berbasis harga barang.
- Pool lama memakai share 0 desimal, aset buku nominal, dan mengunci seluruh redemption ketika masih ada hak lender yang belum kembali. Pembayaran buyer yang gagal atau terlambat belum mempunyai mekanisme write-down/recovery; aset buku bukan kas yang pasti dapat ditarik. Perbaikan precision/donation pada kode sumber baru memerlukan pool deployment baru; posisi investor lama tetap berada pada kontrak lama.
- Aplikasi menampilkan pool lama hanya untuk posisi, transaksi, harvest, dan redeem; deposit, grant investor baru, dan alokasi baru disembunyikan/ditolak melalui UI Talunai. Kontrak lama immutable dan izin onchain yang sudah ada tetap dapat digunakan di luar aplikasi sampai operator mengatur role/pause onchain.
- Asset type terbatas pada piutang B2B fixed amount yang sudah diakui buyer setelah penyerahan barang. Demo utama memakai kakao; contoh kemasan dan tekstil memakai gate bukti/piutang yang sama. Kategori `OTHER` adalah metadata deskriptif, bukan penolakan sektor otomatis. Metadata barang yang tidak lengkap dan rekonsiliasi beberapa line item tetap memerlukan review. Ini belum membuktikan underwriting lintas sektor telah dikalibrasi. PO saja, panen masa depan, persediaan, properti, dan emas tidak menjadi jenis aset pembiayaan tambahan.
- Hanya buyer immutable dapat melakukan `collectBuyerPayment`. Borrower prepayment, pembayaran pihak ketiga, refund, credit-note setelah registrasi, rebate, write-off, recovery/eksekusi hukum, dan klaim jaminan fisik belum didukung.
- Hold/pause hanya menghentikan funding baru; uang yang sudah dicairkan tidak ditarik kembali. Collection dan saldo withdrawal yang sudah terbentuk tetap dapat diakses.
- Sengketa ketika registrasi masih pending dijadwalkan ulang menjadi hold setelah `ClaimRegistered` terindeks canonical. Sampai hold onchain terkonfirmasi, registry lama masih mempunyai jendela bagi lender yang mengirim transaksi langsung ke kontrak; API aplikasi menolak pendanaan yang disengketakan. Penutupan atomik jendela ini memerlukan protokol/kontrak baru.
- Transfer token langsung ke vault tidak menjadi collection invoice. Donasi tetap tidak teralokasi dan tidak mempunyai jalur admin sweep pada P0. Saldo tersebut dapat tertahan selamanya.
- `REPAID`, `FULLY_COLLECTED`, dan withdrawal merupakan peristiwa berbeda. Default atau keterlambatan mempertahankan nominal outstanding yang sebenarnya.

## Integrasi, data dan operasional

- Mode default `LLM_MODE=mock` merupakan parser deterministik untuk teks berlabel sintetis. Adapter live memakai OpenRouter, dengan default `qwen/qwen3.5-flash-02-23`, schema/provenance tervalidasi, batas output dan reasoning dimatikan. Tanpa key, live gagal eksplisit. Pemanggilan inference live belum diuji pada sesi pembangunan ini.
- Text-PDF benar-benar diparse dalam subprocess worker dengan batas resource. Scan tanpa teks menghasilkan `NEEDS_MANUAL_ENTRY`. OCR/vision belum tersedia; manual-entry berarti manusia menyediakan bukti teks/JSON sintetis yang dapat diparse dan ditinjau ulang, bukan hasil OCR yang diarang.
- EOA konvensional didukung. ERC-1271/contract wallet ditolak eksplisit; tidak ada klaim dukungan account abstraction.
- Penyimpanan file privat lokal dengan salt terpisah belum merupakan layanan object storage produksi. File yatim berumur lebih satu jam dibersihkan; waktu retensi tersimpan pada metadata, sementara penghapusan bukti yang masih direferensikan memerlukan prosedur operasi tersendiri.
- Semua endpoint transaksi mengembalikan template, bukan mengirim transaksi peserta. Participant keys hanya ada di CLI aktor lokal/testnet; web tidak memegang key agent/provider, dan worker tidak memegang key peserta.
- Konfirmasi chain adalah kebijakan aplikasi, bukan jaminan finality protokol. Reorg dalam jendela direplay; reorg lebih dalam membuat degraded yang memerlukan investigasi/operator rebuild. Polling, query event dan rekonsiliasi dirancang untuk volume demo, belum di-load-test sebagai sistem produksi.
- Broadcast unknown memakai bytes/hash yang sudah dipersist. Gateway tidak melakukan automatic fee-bump. Replacement peserta harus diamati dengan nonce, sender, dan payload yang sama. Rekonsiliasi menggunakan batch bergiliran, bukan jaminan waktu penyelesaian jaringan.
- Audit append-only di boundary aplikasi tidak mencegah administrator database mengubah riwayat. Tidak menyimpan hidden chain-of-thought.
- PostgreSQL demo memakai credential lokal yang sengaja publik dan akses localhost/internal Compose. Belum ada backup/restore teruji, HA, rotasi role produksi, secret manager, alerting/SLO, penanganan insiden lengkap atau audit independen.
- Docker Compose tervalidasi secara konfigurasi; build/run Docker belum diuji karena akses daemon ditolak. Jalur native PostgreSQL + Anvil benar-benar dijalankan.
- Lima kontrak termasuk `LiquidityPoolA` telah dideploy pada BSC Testnet 97. Satu siklus sintetis lengkap—deposit pool 1 miliar MockIDR, pendanaan invoice 70 juta, pembayaran buyer 100 juta, pembagian 71,05 juta kepada lender dan 28,95 juta kepada supplier, redemption, lalu redeposit—telah dibuktikan dengan receipt canonical. Siklus cepat itu tidak membuktikan APY yang bermakna, keberhasilan lintas sektor tanpa review, atau kesiapan layanan finansial produksi. Lihat [receipt](TESTNET_FLOW_RECEIPTS.md).
- Runtime testnet lokal memakai HTTPS dengan sertifikat self-signed; browser perlu mempercayainya secara lokal. Ini belum deployment API publik dengan sertifikat CA publik.

Lihat `TEST_REPORT.md` dan `TEST_MATRIX.md` untuk membedakan bukti executable, transport mock, dan prasyarat eksternal yang belum tersedia.
