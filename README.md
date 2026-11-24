# Daybook

A compact personal journal: categories, templates, keyword and date search, and a life calendar with
milestones. Works on Android, iPhone and laptop, works offline, and syncs between devices with your
Google account. No build step: upload these files to GitHub and turn on GitHub Pages.

## Setup (sekali saja)

### 1. Upload ke GitHub
1. Buat repository baru, misalnya `daybook` (harus **Public** untuk GitHub Pages gratis).
2. Upload **semua isi folder ini** (bukan folder luarnya). `index.html` harus ada di paling atas.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save.**
4. Tunggu ±1 menit. Aplikasi ada di `https://<username>.github.io/daybook/`.

Untuk update nanti: cukup upload file yang berubah. Tidak ada build, tidak ada perintah terminal.

### 2. Firebase (project `journal-836d7`, di <https://console.firebase.google.com>)
1. **Authentication → Sign-in method → Google → Enable → Save.**
2. **Authentication → Settings → Authorized domains → Add domain →** `<username>.github.io`
   (tanpa `https://` dan tanpa `/daybook`).
3. **Firestore Database → Create database →** lokasi `asia-southeast2 (Jakarta)`, **production mode**.
4. **Firestore Database → Rules →** hapus isinya, tempel isi file `firestore.rules`, lalu **Publish**.
   Dengan aturan ini setiap akun hanya bisa membaca dan menulis jurnalnya sendiri.

### 3. Pasang di perangkat
- **Android (Chrome):** buka link, menu ⋮ → **Install app**.
- **iPhone (Safari):** buka link, **Share → Add to Home Screen**, lalu selalu buka dari ikon itu.
- **Laptop (Chrome/Edge):** klik ikon install di ujung kanan address bar.

Lalu buka **Settings (ikon kanan atas) → Sign in with Google** di setiap perangkat, dengan akun yang sama.

## Catatan
- Jurnal tersimpan di perangkat dulu (bisa dipakai tanpa internet), lalu sync otomatis saat aplikasi
  dibuka, setelah setiap perubahan, dan saat internet kembali.
- **Backup (JSON)** di Settings: simpan filenya di Google Drive sebulan sekali.
- Nilai di `js/firebase-config.js` memang boleh terlihat publik. Jurnal Anda dilindungi oleh
  `firestore.rules` dan login Google, bukan oleh kerahasiaan nilai itu.
- Kuota gratis Firestore (50.000 baca dan 20.000 tulis per hari, 1 GB) jauh di atas kebutuhan jurnal
  pribadi.
