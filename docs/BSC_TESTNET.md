# BSC testnet aktif — 28 September 2026

Empat kontrak benar-benar dideploy pada **BSC testnet97**, EVM Paris, bukan Anvil yang diberi label testnet. Manifest receipt: [`deployments/bsc-testnet.json`](../deployments/bsc-testnet.json). Pemeriksaan read-only chain/config/roles/receipt: [`bsc-testnet.verification.json`](../deployments/bsc-testnet.verification.json).

| Kontrak | Alamat nyata |
| --- | --- |
| MockIDR | `0x96125aaad931266f1d7bacfa54e1915993ca8c4d` |
| RWARegistry | `0xec653cdf649f0de749ffcf9bf3368ff6bce710d5` |
| FinancingVault | `0x47738dc96cb3de00da06cad6e5b16187af3c4c32` |
| AgentExecutor | `0x333584518018c6529902cf2f83376128509201bc` |

Agent pengguna: `0x954Da57Aeec71b02c0A9369c0C3ED6D21F460aDd`.
Deployer/admin test-only terpisah: `0x1BA82a555423625Ae5acd470cA1E306B483dd176`.
Verifier, borrower, buyer dan lender juga memakai key uji berbeda yang tersimpan hanya pada `.env.testnet` privat. Key agent berada hanya pada env worker. Agent terbukti memiliki `AGENT_ROLE`; tidak memiliki default-admin, verifier, lender atau demo-minter.

Delapan transaksi deployment/bootstrap sukses dan memenuhi kebijakan tiga konfirmasi saat pemeriksaan. Ini bukan jaminan finality protokol. Explorer: [registry](https://testnet.bscscan.com/address/0xec653cdf649f0de749ffcf9bf3368ff6bce710d5), [vault](https://testnet.bscscan.com/address/0x47738dc96cb3de00da06cad6e5b16187af3c4c32), [executor](https://testnet.bscscan.com/address/0x333584518018c6529902cf2f83376128509201bc), [token](https://testnet.bscscan.com/address/0x96125aaad931266f1d7bacfa54e1915993ca8c4d). Source-code verification pada explorer belum dilakukan.

## Anggaran dan hasil gas

- Saldo awal agent setelah faucet: **0,3 tBNB**.
- Anggaran konservatif **0,0024 tBNB** dikirim ke wallet deployer. Hash nyata: `0x8a1e63f767d578101c33230fe17e223f658c0b3b9a20b3d893f45dc615082b6a`.
- Biaya transfer gas: **0,0000021 tBNB**.
- Biaya delapan transaksi deployment/bootstrap: **0,0005443856 tBNB**, dihitung dari `gasUsed × effectiveGasPrice` receipt.
- Saldo setelah deployment: agent **0,2975979 tBNB**, deployer **0,0018556144 tBNB**. Saldo merupakan snapshot saat verifikasi, bukan saldo yang dijamin tetap.
- Tidak ada pengiriman dana mainnet. MockIDR yang dimint untuk buyer/lender hanyalah token sintetis tanpa nilai.

## Runtime

`.env.local` dan `.env.worker` kini mengarah ke chain97, alamat kontrak sebenarnya, dan database testnet baru. Database Anvil lama tidak dihapus atau diproyeksikan sebagai transaksi BSC. Cadangan env ada pada path di [`bsc-testnet.activation.json`](../deployments/bsc-testnet.activation.json), dengan permission privat.

API lokal: **https://localhost:3000**. Sertifikat demo lokal adalah self-signed, belum otomatis dipercaya browser; bukan sertifikat publik. `dev:https` memakai fitur HTTPS bawaan Next, tanpa server API tambahan.

```bash
# Terminal web
npm run dev:https
# Terminal worker terpisah
npm run start:worker
# Terminal pemeriksaan; TLS tetap diverifikasi
curl --cacert .local/testnet-tls/localhost.pem https://localhost:3000/health/ready
curl --cacert .local/testnet-tls/localhost.pem https://localhost:3000/v1/config
npm run testnet:smoke
```

RPC utama `https://bsc-testnet-rpc.publicnode.com` benar-benar diperiksa chain97 dan berhasil membaca tujuh log bootstrap pada rentang deployment. RPC data-seed awal dapat menyiarkan/membaca receipt tetapi mengembalikan `-32005` untuk `eth_getLogs` bahkan pada satu blok dalam sesi ini. Data-seed tetap menjadi pembanding block hash; query log memakai PublicNode. Keduanya endpoint publik, dapat membatasi traffic atau berubah ketersediaan.

Mode dokumen tetap **mock**. Public-testnet full financing/collection/withdrawal belum dijalankan; hasil tujuh demo sebelumnya berasal dari Anvil. Key aktor testnet tersedia untuk CLI khusus, tetapi borrower/buyer/lender/verifier belum diberi gas. Jangan menjalankan script time-travel/reorg/Anvil pada chain97.

## Script setup dan pemulihan

- `testnet:prepare`: menurunkan alamat agent dari env worker, membuat key aktor test-only berbeda bila belum ada, dan memisahkan env deployment/web/worker. Menolak menimpa deployment testnet yang sudah ada.
- `testnet:check`: membaca chain, wallet, saldo dan anggaran. Tidak menyiarkan transaksi. Anggaran adalah batas konservatif, bukan `eth_estimateGas` atau biaya aktual.
- `testnet:fund-deployer`: hanya chain97, transfer kekurangan anggaran dari agent ke deployer tepercaya pada konfigurasi. Raw transaction/hash/nonce dipersist sebelum broadcast. Pengulangan memakai journal yang sama, tidak otomatis membuat transfer tambahan.
- `deploy:testnet`: menolak mismatch agent/key/chain, actor bertumpuk, saldo kurang, serta deployment lama/tertunda yang belum direkonsiliasi. Receipt sebenarnya mengisi alamat pada env staged. Tidak mengarang alamat bila gagal.
- `testnet:smoke`: memeriksa bytecode/config immutable, canonical receipt dan role agent. Hasilnya tidak berarti source explorer verified atau kontrak diaudit.
- `testnet:activate`: memerlukan manifest dan smoke report cocok/baru; membuat database terpisah, migrasi/seed sintetis, menyimpan env lama dan mengaktifkan env testnet. Proses web/worker harus direstart setelah perubahan env.

`bsc-testnet.pending.json` adalah journal deployment dan kini berstatus DEPLOYED. Bila statusnya belum selesai, rekonsiliasi hash/receipt sebelum membuat deployment berikutnya; jangan menghapus journal agar retry tampak berhasil. Skrip tidak otomatis melakukan fee replacement. Sertifikat localhost perlu diperbarui setelah masa berlaku demo 30 hari.

Pemisahan role, one-time funding, consent, precision dan aturan uang tidak berubah pada migrasi ini. Tidak ada klaim produksi atau legal title.
