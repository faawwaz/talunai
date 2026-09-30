# TALUNAI — teks submission siap pakai

Sumber syarat: [FAQ resmi Indonesia Web3 Hackathon 2026](https://indonesiaweb3hack.xyz/en/faq). Pilih **Finance & Commerce**. Jangan pilih AI Agents hanya karena ada AI: deskripsi track itu menekankan agent yang bertindak otonom di chain, sedangkan keputusan kredit TALUNAI masih dipegang manusia.

## Isian utama

**Project name:** TALUNAI

**One-line pitch:** Pendanaan invoice di BNB Chain dengan pemeriksaan bukti oleh agent, persetujuan manusia, dan arus pembayaran yang transparan bagi lender.

**Problem statement:** Supplier B2B dapat memiliki invoice yang sudah diterbitkan tetapi baru akan dibayar buyer kemudian. Agar invoice itu dapat didanai, lender perlu menilai bukti transaksi, memastikan pihak yang berutang mengakui terms, dan memahami ke mana pembayaran akan mengalir. Proses yang tersebar membuat keputusan dan hasil sulit diperiksa.

**Solution:** TALUNAI menghubungkan dokumen invoice, analisis risiko agent, keputusan verifier independen, tanda tangan borrower dan buyer, serta kontrak pendanaan. Pool hanya dapat mendanai klaim yang terdaftar dan berada dalam batas eksposur. Ketika buyer membayar, vault membagikan pokok ke lender, fee kontraktual, lalu sisa kepada borrower. Investor bisa memeriksa likuiditas, invoice, dan transaksi langsung dari BNB Chain.

**Project detail:** Borrower mengajukan invoice dan bukti. Agent mengekstrak fakta, menunjukkan sumber, dan menandai konflik untuk reviewer. Verifier manusia menyetujui atau menolak; borrower dan buyer kemudian menandatangani terms versi yang sama. Setelah registrasi onchain, lender langsung atau pool dapat mendanai. Buyer membayar ke vault, lalu waterfall kontrak membagi pembayaran. MVP di BSC Testnet telah menyelesaikan satu siklus: 70.000.000 MockIDR didanai terhadap invoice 100.000.000; 1.050.000 fee lender diterima setelah buyer membayar; 28.950.000 tersisa untuk borrower. Pool bermula dari deposit 1.000.000.000 MockIDR dan kini memiliki aset buku 1.001.050.000. Semua token adalah aset uji tanpa nilai rupiah. Agent OpenRouter live belum boleh diklaim sebelum API key terpasang dan smoke test lolos.

**Onchain contract:** [Pool TALUNAI di BscScan](https://testnet.bscscan.com/address/0x7858c6418eb818da50f57bc9c9bbfd9257b96ba1) — `0x7858c6418eb818da50f57bc9c9bbfd9257b96ba1` (BSC Testnet).

**Technical stack:** Solidity/Foundry, BNB Smart Chain Testnet, Next.js, TypeScript, viem, PostgreSQL, worker agent, OpenRouter integration. Agent menghasilkan rekomendasi dan alasan; verifier manusia mengambil keputusan.

**Risk disclosure:** Buyer dapat terlambat atau gagal membayar. Penarikan share pool terkunci ketika hak lender invoice aktif belum dipenuhi; nilai buku tidak otomatis mencerminkan kerugian. Batas kontrak saat ini 10% aset buku per invoice dan 80% utilisasi pokok aktif. Tidak ada APY tetap, penjamin, pasar sekunder, atau write-off final pada MVP.

## Yang masih harus diisi pemilik tim

| Bidang portal | Status |
| --- | --- |
| Tim terdaftar pada Luma | Periksa pada akun penyelenggara; tidak bisa ditebak dari repo. |
| Nama dan detail anggota tim | Isi dengan data tim yang sebenarnya. |
| Repo GitHub publik | Belum tersedia; harus berisi source dan README yang bisa dibuka juri. |
| Video demo YouTube | Belum tersedia; FAQ menyarankan maksimal 5 menit. |
| Kontak tim dan supporting links | Isi saat submit. Simpan edit code setelah submit pertama. |

## Alur video singkat (sekitar 2 menit)

1. **0–15 detik:** Sebut masalah invoice, bukti, dan kepercayaan lender.
2. **15–45 detik:** Buka Explore publik. Tunjukkan aset buku, invoice lunas, fee diterima, dan blok sumber. Jangan habiskan waktu pada pendaftaran wallet.
3. **45–75 detik:** Buka satu hasil agent; tunjukkan alasan dan sumbernya, lalu keputusan verifier dan dua persetujuan wallet. Sebut mode provider yang benar saat perekaman.
4. **75–105 detik:** Buka receipt pendanaan dan harvest di BscScan. Jelaskan waterfall 70 juta pokok + 1,05 juta fee + 28,95 juta sisa borrower.
5. **105–120 detik:** Tunjukkan kontrol risiko dan sebut batas MVP. Akhiri dengan hipotesis yang diuji, bukan janji APY.

Sebelum merekam, siapkan wallet tiap role, saldo gas testnet, klaim yang sudah diproses, dan tab BscScan. Rekam tindakan atau data yang benar-benar ada; jangan memakai angka atau hasil agent yang dibuat untuk video.
