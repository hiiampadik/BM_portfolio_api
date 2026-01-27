# BM Portfolio API Gateway

Serverless API gateway pro ISR on-demand revalidaci. Přijímá webhooky ze Sanity a přeposílá revalidační požadavky na hlavní web.

## Architektura

```
Sanity Webhook → api.bronislavmusil.com → bronislavmusil.com/api/revalidate
                 (tento projekt)           (hlavní web)
```

## Environment Variables

| Proměnná | Popis | Příklad |
|----------|-------|---------|
| `API_GATEWAY_SECRET` | Secret pro autentizaci příchozích webhooků | `your-gateway-secret-here` |
| `MAIN_SITE_URL` | URL hlavního webu | `https://bronislavmusil.com` |
| `MAIN_REVALIDATE_ENDPOINT` | Path k revalidate endpointu | `/api/revalidate` |
| `MAIN_REVALIDATE_SECRET` | Secret pro autentizaci vůči hlavnímu webu | `your-main-site-secret` |

### Nastavení ve Vercel

1. Otevři projekt ve Vercel Dashboard
2. Settings → Environment Variables
3. Přidej všechny 4 proměnné pro Production environment

## Podporované typy dokumentů

| `_type` | Revalidované cesty |
|---------|-------------------|
| `exhibitions` | `/exhibition/<slug>`, `/cs/exhibition/<slug>`, `/en/exhibition/<slug>`, `/cs/exhibitions`, `/en/exhibitions`, `/cs`, `/en` |
| `pages` | `/<slug>`, `/cs/<slug>`, `/en/<slug>`, `/cs`, `/en` |
| `home` | `/`, `/cs`, `/en` |
| `settings` | `/`, `/cs`, `/en` |
| `about` | `/about`, `/cs/about`, `/en/about`, `/cs`, `/en` |
| `contact` | `/contact`, `/cs/contact`, `/en/contact`, `/cs`, `/en` |

## API Reference

### POST /api/revalidate

Spustí revalidaci na hlavním webu.

**Headers:**
- `Authorization: Bearer <API_GATEWAY_SECRET>` (povinné)
- `Content-Type: application/json` (povinné)
- `X-Request-Timestamp: <unix_ms>` (volitelné, anti-replay ±5 min)

**Body:**
```json
{
  "_type": "exhibitions",
  "slug": {
    "current": "my-exhibition"
  }
}
```

**Responses:**
- `200` - Všechny cesty úspěšně revalidovány
- `207` - Částečné selhání (některé cesty selhaly)
- `400` - Neplatný payload nebo timestamp
- `401` - Neautorizováno
- `405` - Nepodporovaná metoda
- `415` - Nepodporovaný Content-Type
- `500` - Interní chyba serveru

## Příklady curl

### Základní revalidace výstavy

```bash
curl -X POST https://api.bronislavmusil.com/api/revalidate \
  -H "Authorization: Bearer YOUR_API_GATEWAY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"_type": "exhibitions", "slug": {"current": "my-exhibition"}}'
```

### S anti-replay timestamp

```bash
curl -X POST https://api.bronislavmusil.com/api/revalidate \
  -H "Authorization: Bearer YOUR_API_GATEWAY_SECRET" \
  -H "Content-Type: application/json" \
  -H "X-Request-Timestamp: $(date +%s000)" \
  -d '{"_type": "exhibitions", "slug": {"current": "my-exhibition"}}'
```

### Revalidace homepage/settings

```bash
curl -X POST https://api.bronislavmusil.com/api/revalidate \
  -H "Authorization: Bearer YOUR_API_GATEWAY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"_type": "home"}'
```

### Lokální testování

```bash
curl -X POST http://localhost:3000/api/revalidate \
  -H "Authorization: Bearer YOUR_API_GATEWAY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"_type": "exhibitions", "slug": {"current": "test-exhibition"}}'
```

## Sanity Webhook Setup

1. V Sanity Studio otevři **Settings → API → Webhooks**
2. Vytvoř nový webhook:
   - **Name:** ISR Revalidation
   - **URL:** `https://api.bronislavmusil.com/api/revalidate`
   - **Trigger on:** Create, Update, Delete
   - **Filter:** `_type in ["exhibitions", "pages", "home", "settings", "about", "contact"]`
   - **Projection:** `{_type, slug}`
   - **HTTP Headers:** `Authorization: Bearer YOUR_API_GATEWAY_SECRET`
   - **HTTP Method:** POST

## Development

```bash
# Install dependencies
npm install

# Create .env.local
cat > .env.local << EOF
API_GATEWAY_SECRET=dev-gateway-secret
MAIN_SITE_URL=http://localhost:3001
MAIN_REVALIDATE_ENDPOINT=/api/revalidate
MAIN_REVALIDATE_SECRET=dev-main-secret
EOF

# Run development server
npm run dev
```

## Deployment

Projekt je automaticky deployován na Vercel při push do main/master branch.
