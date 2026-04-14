# Source Mode

Use source mode for local development, bug fixing, UI work, and feature contributions.

## Requirements

- Node.js 20+
- An LLM provider key
- A Prometheus-compatible backend if you want live metric discovery and investigations

## Install

```bash
git clone <repo-url> && cd openobs
npm install
cp .env.example .env
```

Set at least:

```bash
JWT_SECRET=replace-with-a-32-char-secret
LLM_API_KEY=replace-with-your-provider-key
```

## Run

```bash
npm run build
npm run start
```

The setup wizard will walk you through the rest.
