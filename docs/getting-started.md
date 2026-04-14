# Getting Started

OpenObs ships with two supported workflows:

## Source mode

Use this when you want to run the monorepo locally, develop features, or contribute changes.

```bash
git clone <repo-url> && cd openobs
npm install
cp .env.example .env
npm run build
npm run start
```

The web app starts on `http://localhost:5173` and the API starts on `http://localhost:3000`.

## Cluster mode

Use this when you want to install OpenObs into Kubernetes.

```bash
helm upgrade --install openobs ./helm/openobs \
  --namespace observability \
  --create-namespace \
  --set image.repository=ghcr.io/your-org/openobs \
  --set image.tag=latest \
  --set secretEnv.LLM_API_KEY='replace-with-your-provider-key'
```

## Docs workflow

Because docs live in this repository, the normal docs authoring flow is:

```bash
npm run docs:dev
```

Then open the local VitePress preview and edit files under `docs/`.
