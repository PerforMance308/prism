# Kubernetes with Helm

OpenObs includes a first-party Helm chart in this repository at `helm/openobs`.

## Basic install

```bash
helm upgrade --install openobs ./helm/openobs \
  --namespace observability \
  --create-namespace \
  --set image.repository=ghcr.io/your-org/openobs \
  --set image.tag=latest \
  --set secretEnv.LLM_API_KEY='replace-with-your-provider-key'
```

## Common overrides

- `secretEnv.JWT_SECRET`: explicit JWT secret
- `secretEnv.DATABASE_URL`: use Postgres instead of local SQLite mode
- `secretEnv.REDIS_URL`: enable Redis-backed features
- `persistence.enabled`: keep local state on a PVC
- `ingress.enabled`: expose the app through an Ingress controller

## Ingress example

```bash
helm upgrade --install openobs ./helm/openobs \
  --namespace observability \
  --create-namespace \
  --set image.repository=ghcr.io/your-org/openobs \
  --set image.tag=latest \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.hosts[0].host=openobs.example.com \
  --set env.CORS_ORIGINS=https://openobs.example.com \
  --set secretEnv.LLM_API_KEY='replace-with-your-provider-key'
```
