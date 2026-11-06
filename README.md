# Manga-scan

Lecteur de manga web qui récupère automatiquement catalogue, chapitres et pages depuis l'**API publique MangaDex** (https://api.mangadex.org). Aucune dépendance npm.

## Lancer

```bash
npm start          # http://localhost:3000
npm test           # test hors-ligne (API MangaDex simulée)
```

Node.js ≥ 18 requis. Port configurable : `PORT=8080 npm start`.

## Fonctions

- Catalogue : populaires, récemment mis à jour, mieux notés ; recherche par titre.
- Choix de la langue des chapitres (FR par défaut, EN, ES, PT, IT, DE).
- Fiche manga : description, tags, liste des chapitres (dédoublonnés), favoris.
- Lecteur : défilement vertical (webtoon) ou page par page (clic/flèches), préchargement, chapitre suivant/précédent.
- Reprise automatique : « Continuer la lecture » mémorise chapitre et page (stockage local du navigateur).
- Installable sur mobile (manifest PWA).

## Architecture

- `server.js` : serveur HTTP Node qui relaie l'API MangaDex (User-Agent, cache mémoire) et sert de proxy d'images restreint aux hôtes MangaDex.
- `public/` : interface en JavaScript natif.

## Limites

- Seuls les chapitres hébergés sur MangaDex sont lisibles ; les chapitres d'éditeurs officiels (liens externes) sont masqués. Beaucoup de licences connues n'ont donc pas de chapitres disponibles.
- MangaDex limite le débit (~5 requêtes/s) ; le cache serveur atténue ce point.
- Le contenu provient de MangaDex et de ses groupes de traduction : respectez leurs conditions d'utilisation et le droit d'auteur de votre pays.

## APK Android

L'APK est compilé automatiquement par GitHub Actions (`.github/workflows/android.yml`) à chaque push touchant l'app, puis publié dans les **Releases** du dépôt (fichier `Manga-scan.apk`).

Dans l'APK, l'app appelle MangaDex directement (HTTP natif de Capacitor) : aucun serveur n'est nécessaire.

Installation : téléchargez `Manga-scan.apk` depuis le téléphone → ouvrez-le → autorisez « Installer des applications inconnues » pour le navigateur → Installer.

Compilation locale (Android SDK + JDK 21 requis) : `npm ci && npm run android:build` → `android/app/build/outputs/apk/debug/app-debug.apk`.
