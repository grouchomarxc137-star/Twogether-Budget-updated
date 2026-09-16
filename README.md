# Twogether Budget

A shared budgeting website for trips and individual monthly finances. The deployed app is fully static: Firebase Authentication protects access and Cloud Firestore stores the shared state.

## Architecture

The UI continues to use `TwogetherAPI.state()`, `TwogetherAPI.remoteState()`, and `TwogetherAPI.post(action, payload, actor)`. `api.js` implements that contract with Firebase. Each action is applied by the existing centralized action engine inside a Firestore transaction, preventing Principessa and Principe from silently overwriting one another.

The shared state is stored in the `twogether/shared-state` Firestore document. The application identity (`Principessa` or `Principe`) remains separate from the authenticated Firebase account.

## Run locally

```sh
npm install
npm run dev
```

Open `http://localhost:5180`. The Node/Express server is not required. Add `localhost` to Firebase Authentication's authorized domains if it is not already present.

Run the local checks and production build with:

```sh
npm test
npm run build
npm run preview
```

## Firebase setup

1. Publish `firestore.rules` in Firebase Console → Firestore Database → Rules.
2. Keep Email/Password enabled in Firebase Console → Authentication → Sign-in method.
3. Add the GitHub Pages hostname (for example, `your-name.github.io`) in Authentication → Settings → Authorized domains.
4. In the GitHub repository, open Settings → Pages and select **GitHub Actions** as the source. The included workflow tests, builds, and deploys `dist/` after a push to `main`. Firebase Hosting is not used.

The Firebase web configuration in `config.js` is intentionally public. Do not add user passwords or service-account credentials to the repository.

## One-time SQLite data migration

The old backend remains isolated under `server/` only for verification and optional data migration. To copy `server/data/twogether.db` into an empty Firestore document, run:

```sh
npm --prefix server install
FIREBASE_EMAIL='your-account@example.com' FIREBASE_PASSWORD='your-password' npm run migrate:firestore
```

The migration refuses to overwrite Firestore when it already contains user data. `-- --force` enables intentional replacement and should be used with care.

## Project structure

- `src/` contains the website features and Firestore state adapter.
- `api.js` preserves the frontend API contract and handles Firebase Auth/Firestore.
- `config.js` contains the public Firebase web configuration.
- `firestore.rules` restricts the shared document to authenticated users.
- `server/` is the isolated legacy Express/SQLite implementation; it is not used at runtime.
