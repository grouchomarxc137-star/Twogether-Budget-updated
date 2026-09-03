# Google Apps Script shared backend setup

The website is already prepared to use this backend. You only need to deploy the Apps Script once and paste its Web App URL into `config.js`.

## 1. Create the Apps Script project

1. Open https://script.google.com/
2. Click **New project**.
3. Delete the example `myFunction()` code.
4. Copy everything from this repository's `backend/Code.gs` into the Apps Script editor.
5. Save the project. A name such as **Together Budget Backend** is fine.

## 2. Deploy it as a Web App

1. In Apps Script click **Deploy → New deployment**.
2. Click the gear icon and choose **Web app**.
3. **Execute as:** Me.
4. **Who has access:** Anyone.
5. Click **Deploy**.
6. Google may ask you to authorize the script. Approve it.
7. Copy the **Web app URL**. It should end in `/exec`.

## 3. Connect the website

Send the `/exec` URL to ChatGPT in the project conversation. It will be placed into `config.js` like this:

```js
window.TOGETHER_BUDGET_CONFIG = {
  appsScriptUrl: 'https://script.google.com/macros/s/.../exec'
};
```

After GitHub Pages redeploys, the website will use Apps Script instead of browser-local trip storage.

## What the backend stores

Apps Script `Script Properties` stores:

- all trips
- the shared Compare Options values
- who created or last edited a trip (`Principe` / `Principessa`)
- an activity/audit log with timestamps

The website polls the backend every ~3 seconds, so changes made on one device appear on the other shortly afterward.

## Identity popup vs authentication

The initial **Principe / Principessa** popup identifies who is making a change and writes that name to the activity log. It is intentionally simple and is **not a password-based authentication system**. Anyone who has access to the site and selects a name can act as that identity.

## Important

Do not put private Google credentials or API tokens in `config.js`. The Apps Script Web App URL itself is the only value the frontend needs.
