# StockPro — Gestion de stock, achats, ventes, facturation et caisse

Application professionnelle conforme au **cahier des charges StockPro v1.1** (périmètre **MVP / Phase 1**, §34.1),
réalisée en **React + Django + PostgreSQL**, entièrement dockerisée.

> Le CDC recommande NestJS (option A) mais valide explicitement l'option C « Django + React + PostgreSQL » (§30.1) :
> les règles métier et le modèle de données du document s'appliquent à l'identique.

---

## Démarrage (Docker)

```bash
docker compose up -d --build
```

| Service    | URL                               | Rôle                                   |
|------------|-----------------------------------|----------------------------------------|
| Application| http://localhost:8080             | React (Nginx) + proxy `/api` et `/media`|
| API docs   | http://localhost:8080/api/v1/docs | OpenAPI 3 / Swagger                    |
| PostgreSQL | `localhost:5433`                  | base `stockpro`                        |

Au premier démarrage, les migrations s'appliquent et une entreprise de démonstration (**Kmex Market**, Bamako)
est générée avec **60 jours d'activité réelle** produite par les services métier (ventes, achats, caisse, dépenses…).
Désactiver : `SEED_DEMO=0`. Réinitialiser : `docker compose down -v && docker compose up -d --build`.

### Comptes de démonstration (mot de passe : `Demo@2026!`)

| Rôle                   | Email                    | PIN  |
|------------------------|--------------------------|------|
| Propriétaire           | admin@stockpro.ml        | 0000 |
| Gérante                | gerant@stockpro.ml       | 1234 |
| Responsable de stock   | stock@stockpro.ml        | —    |
| Magasinier             | magasinier@stockpro.ml   | —    |
| Caissière              | caissier@stockpro.ml     | 1111 |
| Vendeur                | vendeur@stockpro.ml      | —    |
| Comptable              | comptable@stockpro.ml    | —    |

Le PIN gérant (1234) autorise au POS une remise au-delà du plafond ou un dépassement de crédit.

### Développement frontend (rechargement à chaud)

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

Vite démarre sur http://localhost:5180 et proxifie l'API vers la stack Docker (`API_TARGET` pour changer de cible).

### Tests de recette backend

```bash
docker compose run --rm -v "$PWD/backend:/app" --entrypoint pytest backend -q
```

36 scénarios du CDC (§33.2 / §38) exécutés sur une vraie base PostgreSQL, dont : concurrence de stock (T-STK-03),
CMUP et COGS figé (STOCK-007), numérotation sans trou sous concurrence (T-INV-02), idempotence (T-PAY-02),
limites de crédit + dérogation PIN (SALE-008), plafond de remise (T-PRM-01), clôture avec écart (CASH-002),
circuit des dépenses (T-EXP-01 à 05), IDOR inter-entreprise (T-SEC-02), verrouillage (T-SEC-03),
immuabilité SQL des mouvements et du journal d'audit (T-SEC-04).

---

## Architecture

```
frontend/  React 18 + TypeScript + Vite · Tailwind · Framer Motion · TanStack Query · Zustand · Recharts
backend/   Django 5 + DRF · SimpleJWT · PostgreSQL 16 · ReportLab (PDF) · Pillow/pillow-heif · openpyxl
           apps/core        entreprise, dépôts, numérotation, audit chaîné, notifications, erreurs RFC 9457
           apps/accounts    utilisateurs, 8 rôles + personnalisés, 50 permissions atomiques, verrouillage
           apps/catalog     produits, catégories, marques, unités, taxes, codes-barres, photos, historique des prix
           apps/inventory   moteur de mouvements immuables, CMUP, ajustements, inventaires, transferts
           apps/purchasing  fournisseurs, commandes, réceptions partielles, factures, achat direct
           apps/sales       clients, POS, factures, devis, avoirs/retours, moteur de calcul, PDF
           apps/finance     caisses, sessions/Z, paiements & affectations, trésorerie, dépenses, recettes
           apps/reports     tableau de bord + 19 rapports exportables (CSV/Excel)
```

### Principes du CDC appliqués

- **Stock dérivé des mouvements** (§2.3) : chaque variation crée un `StockMovement` (avant/après, utilisateur, motif,
  document) dans la même transaction ; verrous de ligne ordonnés (`SELECT … FOR UPDATE`) ; contrôle d'intégrité.
- **Immuabilité** (§20.11) : triggers PostgreSQL interdisant `UPDATE/DELETE` sur `stock_movements`,
  `cash_movements` et `audit_logs` ; corrections par avoir, extourne ou régularisation.
- **Audit chaîné** (§22) : `hash = SHA-256(hash_prev + contenu)`, vérification d'intégrité depuis l'interface.
- **Idempotence** (§2.3) : en-tête `Idempotency-Key` sur ventes, paiements et dépenses.
- **Numérotation légale** à la validation, sans trou ni doublon (`FAC-2026-000123`, `TCK-…`, `AVO-…`, `DEP-…`).
- **RBAC côté serveur** + périmètre par dépôt + **masquage des coûts/marges** (UI, API, exports).
- **Multi-tenant** : `company_id` sur toutes les tables, requêtes filtrées (anti-IDOR).
- **Contexte Afrique de l'Ouest** : XOF sans décimale, Mobile Money (Orange Money, Wave, Moov) avec référence
  obligatoire, crédit client, client comptoir, prix TTC, montant en lettres.
- **Photos produits** (§4.5) : compression navigateur, contrôle du type réel, HEIC → WebP, suppression EXIF/GPS,
  miniatures 64/200/600/1200, détection de doublon par empreinte.

### Hors périmètre de cette version (phases 2+ du CDC)

Mode hors-ligne complet avec synchronisation, variantes/lots/péremption, BL et commandes clients, notifications
externes (email/SMS/WhatsApp), 2FA TOTP, étiquettes, dépenses récurrentes et budgets avancés, impression ESC/POS,
applications mobiles natives. Le panier du POS est toutefois persisté localement (coupure réseau/électricité).
