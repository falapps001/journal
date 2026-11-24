# Daybook

A compact personal journal with categories, templates, keyword and date search, and a life calendar
with milestones. Works on Android, iPhone and laptop as an installable web app (PWA), works offline,
and syncs between devices. Everything runs on free tiers.

- **App:** Vite + plain JavaScript, no framework
- **Data on the device:** IndexedDB (works offline; drafts are saved while you type)
- **Sync + sign-in:** Firebase Authentication (Google) + Cloud Firestore, free Spark plan
- **Hosting:** Firebase Hosting, free Spark plan, published automatically from GitHub

Firebase project: `journal-836d7` (already filled in `src/firebase-config.js` and `.firebaserc`).
After setup the app lives at **https://journal-836d7.web.app**.

---

## Panduan setup (sekali saja, ±15 menit)

### 1. Upload ke GitHub
1. Buat repository baru di <https://github.com/new>, misalnya `daybook`. Boleh **Private**.
2. Ekstrak zip ini, lalu upload **semua isinya** (bukan folder luarnya) lewat **Add file → Upload files**.
3. Pastikan folder **`.github`** ikut ter-upload. Folder yang namanya diawali titik kadang tersembunyi
   di Finder/Explorer. Kalau tidak ikut, buat manual: **Add file → Create new file**, beri nama
   `.github/workflows/deploy.yml`, lalu salin isi file tersebut dari zip.

### 2. Siapkan Firebase (di <https://console.firebase.google.com>, project `journal-836d7`)
1. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save.**
2. **Build → Firestore Database → Create database.** Pilih lokasi `asia-southeast2 (Jakarta)` dan
   **Start in production mode**.
3. Masih di Firestore, buka tab **Rules**, hapus isinya, tempel isi file `firestore.rules`, lalu klik
   **Publish**. Aturan ini membuat setiap akun hanya bisa membaca dan menulis jurnalnya sendiri.

### 3. Sambungkan GitHub ke Firebase Hosting (supaya publish otomatis)
1. Firebase console → ⚙️ **Project settings → Service accounts → Generate new private key**.
   Sebuah file `.json` akan terunduh. Simpan baik-baik, jangan dibagikan atau di-upload ke repository.
2. Di GitHub, buka repository → **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: tempel **seluruh isi** file `.json` tadi
3. Buka tab **Actions** di repository, pilih **Deploy to Firebase Hosting → Run workflow**
   (atau cukup push/upload perubahan apa saja ke branch `main`).
4. Setelah centang hijau (±2 menit), buka **https://journal-836d7.web.app**.

Mulai sekarang, setiap perubahan yang di-upload ke branch `main` otomatis dites, di-build, dan
dipublikasikan.

### 4. Pasang di perangkat
- **Android (Chrome):** buka link, ketuk menu ⋮, lalu **Install app**.
- **iPhone (Safari):** buka link, ketuk **Share**, lalu **Add to Home Screen**. Selalu buka aplikasi
  dari ikon itu. Data di tab Safari biasa bisa dihapus otomatis oleh iOS kalau lama tidak dibuka.
- **Laptop (Chrome/Edge):** klik ikon install di ujung kanan address bar.

Lalu buka **Settings (ikon kanan atas) → Sign in with Google** di setiap perangkat, dengan akun Google
yang sama.

---

## Cara kerja sync
- Setiap perubahan langsung tersimpan di perangkat, dan aplikasi tetap bisa dipakai tanpa internet.
- Sync berjalan otomatis saat aplikasi dibuka, sesaat setelah setiap perubahan, saat koneksi internet
  kembali, dan saat aplikasi dibuka lagi setelah lebih dari 2 menit. Tombol **Sync** di kanan atas
  untuk sync manual.
- Setiap jurnal, kategori, dan milestone punya waktu perubahan sendiri. Kalau dua perangkat mengubah
  jurnal yang berbeda, keduanya tetap tersimpan. Kalau mengubah jurnal yang sama, perubahan terakhir
  yang dipakai.
- Draft yang belum disimpan hanya ada di perangkat tempat Anda menulisnya.
- **Remove** di daftar Devices menghapus perangkat dari daftar dan membuatnya otomatis sign out saat
  perangkat itu membuka Daybook lagi.
- Struktur data di Firestore (`users/{uid}/…`): `entries/{id}`, `cats/{id}`, `milestones/{id}`,
  `meta/profile` (tanggal lahir dan life expectancy), `meta/revoked`, dan `devices/{id}`.

### Kuota gratis
Satu kali sync biasanya hanya beberapa baca dan tulis, karena yang diunduh hanya data yang berubah.
Kuota gratis Firestore adalah 50.000 baca dan 20.000 tulis per hari, plus 1 GB penyimpanan.
Menulis 3 jurnal sehari selama 10 tahun kira-kira hanya 10–20 MB.

## Backup
**Settings → Backup (JSON)** menyimpan file berisi semua jurnal, kategori, template, dan milestone.
Simpan file itu di Google Drive setiap bulan. **Restore from backup** memulihkannya: jurnal di backup
ditambahkan (atau diperbarui kalau sudah ada), dan tidak ada yang dihapus. File backup dari prototipe
juga bisa dipakai.

## Development
Butuh Node.js 20 atau lebih baru.

```bash
npm install
npm run dev      # dev server di http://localhost:5173
npm test         # tes logika sync (tanpa Firebase)
npm run build    # hasil build di folder dist/
```

Tes integrasi dengan Firebase Emulator, termasuk aturan keamanan (perlu Java dan firebase-tools):

```bash
npx firebase-tools emulators:exec --only auth,firestore --project demo-daybook "node test/emulator.mjs"
```

Deploy manual dari laptop (alternatif dari GitHub Actions, sekaligus mengirim `firestore.rules`):

```bash
npm install -g firebase-tools
firebase login
npm run deploy
```

Nilai di `src/firebase-config.js` memang dimuat di aplikasi dan aman ada di repository. Data Anda
dilindungi oleh `firestore.rules`, bukan oleh kerahasiaan nilai tersebut.
