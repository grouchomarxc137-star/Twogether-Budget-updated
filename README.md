# Twogether Budget

A shared budgeting website for trips and individual monthly finances.

## What it tracks

- Shared trip budgets and actual expenses
- Individual trip contributions and matching
- Monthly trip summaries and comparison scenarios
- Personal monthly finances for Principessa and Principe
- Savings, bank balances, loans/paybacks, investments and purchase test scenarios

## Run locally

Install both the website and database dependencies once:

```sh
npm install
npm --prefix server install
```

Then start the complete local app with one command:

```sh
npm run dev
```

This starts both the website and its database server. Open `http://localhost:5180`, and press `Ctrl+C` when you want to stop both. The SQLite database is created automatically at `server/data/twogether.db` and starts empty.

## Project structure

- `src/` contains the website features.
- `api.js` is the browser connection to the local database server.
- `server/` contains the Node.js API and SQLite database code.
- `config.js` contains the local server address.
