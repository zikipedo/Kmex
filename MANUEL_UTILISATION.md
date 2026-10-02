# StockPro — Manuel d'utilisation

Ce manuel explique, étape par étape, comment utiliser StockPro au quotidien.
Il est écrit pour tous les profils : propriétaire, gérant, caissier, magasinier, comptable.

---

## 1. Démarrer l'application

Sur l'ordinateur qui héberge StockPro, ouvrez un terminal dans le dossier du projet et lancez :

```bash
docker compose up -d
```

Ouvrez ensuite votre navigateur (Chrome recommandé) à l'adresse : **http://localhost:8080**

Pour arrêter : `docker compose stop` · Pour tout réinitialiser avec des données neuves : `docker compose down -v && docker compose up -d --build`

> Sur une tablette ou un téléphone du même réseau Wi-Fi, remplacez `localhost` par l'adresse IP de l'ordinateur (ex. `http://192.168.1.20:8080`).

---

## 2. Les comptes de démonstration

**Mot de passe commun à tous les comptes : `Demo@2026!`**

| Profil | Email | PIN | Ce qu'il peut faire |
|---|---|---|---|
| **Propriétaire** (accès total) | admin@stockpro.ml | 0000 | Tout, y compris utilisateurs, paramètres, audit |
| **Gérante** | gerant@stockpro.ml | 1234 | Ventes, achats, stock, validations, rapports, bénéfices |
| **Responsable de stock** | stock@stockpro.ml | — | Produits, achats, réceptions, inventaires, ajustements |
| **Magasinier** | magasinier@stockpro.ml | — | Réceptions, comptages, entrées/sorties (sans prix d'achat) |
| **Caissière** | caissier@stockpro.ml | 1111 | Point de vente, sa caisse, petites dépenses |
| **Caissier 2** | caissier2@stockpro.ml | 2222 | Idem caissière |
| **Vendeur** | vendeur@stockpro.ml | — | Devis, ventes, ses clients |
| **Comptable** | comptable@stockpro.ml | — | Paiements, dépenses, trésorerie, rapports financiers |

**À quoi sert le PIN ?** Au point de vente, si une caissière veut accorder une remise plus grande que son
plafond (5 %) ou vendre à crédit au-delà de la limite d'un client, l'application demande le **PIN d'un gérant**
(ex. `1234`). La décision est enregistrée dans le journal d'audit.

> Astuce : sur l'écran de connexion, les boutons « Comptes de démonstration » connectent en un clic.
> **Avant une utilisation réelle**, changez tous les mots de passe et PIN (Administration → Utilisateurs).

---

## 3. Se repérer dans l'écran

- **Menu à gauche** : les modules auxquels votre profil a droit (les autres sont masqués). Le bouton « Réduire le menu » le replie.
- **Barre du haut** :
  - la recherche globale (**Ctrl + K**) : produit, code-barres, client, n° de facture…
  - le **dépôt** actif (si vous en avez plusieurs) ;
  - la **pastille réseau** : 🟢 *En ligne* · 🔴 *Hors ligne* · 🔵 *ventes en attente* · 🟠 *conflits* ;
  - le thème clair / sombre, les **notifications** 🔔, votre profil et la déconnexion.
- La caissière arrive directement sur le **Point de vente** après connexion ; les autres profils sur le **Tableau de bord**.

---

## 4. Vendre au comptoir (Point de vente)

1. **Ouvrir la caisse** : au premier passage, choisissez votre caisse et comptez votre fond de caisse (ex. 25 000).
2. **Ajouter des produits** :
   - scannez le code-barres (le champ de recherche est toujours prêt, touche **F2**) ;
   - ou touchez la vignette du produit (onglets *Favoris*, *Tout*, ou par catégorie).
   Un 2ᵉ scan du même produit augmente la quantité.
3. **Ajuster** : boutons **– / +** pour la quantité, icône % pour une remise sur la ligne, « Remise » en bas pour une remise globale.
4. **Client** (facultatif) : touchez « Client comptoir » pour choisir ou créer un client. Le *client comptoir* doit payer en totalité.
5. **Encaisser** (bouton ou touche **F4**) :
   - choisissez un ou plusieurs moyens : Espèces, Orange Money, Wave, Moov, Carte… ;
   - pour le Mobile Money, saisissez la **référence de transaction** (obligatoire) ;
   - en espèces, les boutons de montants rapides calculent la **monnaie à rendre**.
6. **Valider la vente** : imprimez le **ticket 80 mm** ou la **facture A4**, puis « Nouvelle vente ».

Autres fonctions utiles :
- **Mettre en attente** (touche **F8**) un client qui hésite, puis le reprendre via « En attente ».
- En cas de coupure de courant, le panier est conservé à la réouverture.
- Un produit en rupture apparaît grisé ; la vente au-delà du stock est refusée.

---

## 5. Fermer la caisse (clôture Z)

1. Dans le POS cliquez **Clôturer** (ou menu *Caisse* → votre caisse → « Voir / clôturer »).
2. Comptez vos espèces **par coupure** (10 000, 5 000, 2 000…) : le total se calcule seul.
3. Vérifiez les montants Mobile Money / carte.
4. L'**écart** s'affiche ; au-delà de la tolérance (500 F), une justification est obligatoire.
5. **Clôturer la caisse** : le rapport Z est généré. Le gérant le **valide** ensuite (menu *Caisse* → « À valider »).

---

## 6. Factures, devis, retours

- **Nouvelle facture** (Ventes & factures → « Nouvelle facture ») : client obligatoire, paiement total, partiel
  ou **à crédit** (dans la limite du client).
- **Encaisser une facture** : ouvrez-la → « Encaisser » → montant (le statut passe *Partielle* puis *Payée*).
- **Devis** : Devis → « Nouveau devis » ; le jour où le client accepte → **Convertir** en facture.
- **Retour / avoir** : ouvrez la facture → « Retour / avoir » → quantités, état (réintégrable / défectueux) et motif.
  Le stock est remis à jour et le client remboursé ou crédité.
- **Annuler une facture** : « Annuler » → un avoir total est créé ; la facture garde son numéro, marquée « annulée ».
- **PDF** : boutons *Ticket* et *PDF A4* sur chaque vente (une réimpression porte la mention DUPLICATA).

---

## 7. Clients

- **Clients** → fiche client : coordonnées, **limite de crédit**, encours, ancienneté des dettes (0-30, 31-60… jours).
- **Relevé de compte** : toutes les factures, paiements et avoirs avec le solde.
- **Encaisser un règlement** : le paiement s'impute automatiquement sur les factures les plus anciennes.
- **Relance WhatsApp** : un clic prépare un message avec le solde dû.
- Un client **bloqué** ne peut plus acheter à crédit.

---

## 8. Produits et stock

- **Produits** → « Nouveau produit » : nom, catégorie, unité, prix de vente, code-barres, stock minimum.
  Le stock ne se saisit jamais ici : il bouge uniquement par des mouvements tracés.
- **Photos** : sur la fiche produit, ajoutez des photos (ordinateur ou appareil photo du téléphone). L'étoile ⭐ désigne la photo principale.
- **Entrée / Sortie de stock** : bouton sur la fiche produit ou *Niveaux de stock* (motif obligatoire : casse, perte, stock initial…).
- **Ajustements** : corrections de stock ; au-delà de 100 000 F de valeur, un **autre responsable** doit approuver.
- **Inventaire** : *Inventaires* → « Lancer un inventaire » → scannez chaque article (chaque scan = +1) ou saisissez la quantité
  → « Valider l'inventaire ». Les écarts deviennent des ajustements et l'inventaire est verrouillé.
- **Transferts** entre dépôts : demande → **Expédier** (sort du dépôt A) → **Réceptionner** (entre au dépôt B).
- **Mouvements** : l'historique complet (qui, quand, pourquoi, avant/après).

---

## 9. Achats et fournisseurs

- **Achat direct** (le plus simple pour une boutique) : Commandes → « Achat direct » → fournisseur, produits, coûts
  → le stock entre, la facture fournisseur est créée, et vous pouvez payer tout de suite.
- **Commande classique** : « Nouvelle commande » → « Valider & envoyer » → à la livraison **Réceptionner**
  (réception partielle possible) → « Saisir la facture » → **Payer**.
- Le bouton **Suggestions de réappro** propose les produits passés sous le stock minimum.
- **Fournisseurs** : dettes, factures échues, relevé de compte, paiement groupé.

---

## 10. Dépenses

1. **Dépenses** → « Nouvelle dépense » : catégorie, montant, motif, **photo du reçu**.
2. Choisissez « Enregistrer & payer » (espèces de votre caisse, Mobile Money…) ou « Soumettre sans payer ».
3. Au-delà de votre plafond (ex. 20 000 F pour une caissière), la dépense part **en approbation** chez le gérant,
   qui reçoit une notification ; il l'**approuve** puis la **paie**.
4. Au-dessus de 25 000 F, le **justificatif est obligatoire**. Un même reçu utilisé deux fois déclenche une alerte.
5. Une dépense payée ne se supprime jamais : on l'**annule** (extourne) avec un motif, l'argent revient en caisse.

Les barres de budget en haut de page montrent la consommation du mois par catégorie.

---

## 11. Trésorerie, paiements, rapports

- **Trésorerie** : soldes des caisses, banque, Orange Money, Wave… et tous les mouvements.
  « Transfert / dépôt banque » pour verser la recette en banque. « Recette diverse » pour un apport ou une commission.
- **Paiements** : tous les encaissements et décaissements ; un gérant peut **extourner** un paiement erroné.
- **Tableau de bord** : chiffre d'affaires, ventes, panier moyen, marge, **bénéfice net**, stock, créances, graphiques.
  Changez la période en haut (Aujourd'hui, Semaine, Mois, 30 j, Année). Chaque carte est cliquable.
- **Rapports** : 19 rapports (ventes par produit / vendeur / client, valeur du stock, ruptures, créances, dettes,
  dépenses, écarts de caisse, taxes, résultat de gestion…) exportables en **Excel** et **CSV**.

---

## 12. Mode hors-ligne (coupure Internet)

**Quand la connexion tombe**, la pastille passe au rouge « Hors ligne » et une bannière bleue apparaît.
Seul le **Point de vente** reste utilisable :

- les ventes sont enregistrées **sur l'appareil** avec un numéro provisoire (ex. `OFF-14D8-0001`) ;
- on peut imprimer un **ticket provisoire** ;
- paiement **espèces ou Mobile Money** uniquement, **sans crédit** ;
- pas de clôture de caisse tant que les ventes ne sont pas envoyées ;
- au-delà de **72 h** sans connexion, la caisse se bloque par sécurité.

**Quand la connexion revient**, tout est automatique (en 15 secondes au plus) : les ventes sont envoyées au serveur,
reçoivent leur **numéro définitif** (ex. `TCK-2026-000608`), et le stock et la caisse se mettent à jour.
Une même vente n'est **jamais enregistrée deux fois**.

Suivi : menu **Vente → Synchronisation** (ventes en attente, envoyées, conflits).
En cas de **conflit** (ex. caisse fermée entre-temps), rouvrez la caisse puis cliquez **Relancer**.
L'administrateur peut **révoquer** un appareil perdu ou volé dans l'onglet « Appareils ».

> Ne vous déconnectez pas pendant une coupure : la session gardée sur l'appareil permet de continuer à vendre.

---

## 13. Administration (propriétaire / administrateur)

- **Utilisateurs & rôles** : créer un compte (mot de passe temporaire, PIN), lui donner un ou plusieurs rôles et
  ses dépôts. Un compte = une personne. « Désactiver » coupe l'accès immédiatement sans effacer l'historique.
  L'onglet *Rôles & permissions* permet de créer un rôle sur mesure (cases à cocher).
- **Paramètres** : identité de l'entreprise et logo (imprimés sur les factures), NIF/RCCM, devise, règles
  (prix TTC, tolérance de caisse, seuil de validation…), dépôts et caisses, moyens de paiement.
- **Journal d'audit** : toutes les actions sensibles (connexions, annulations, remises, prix modifiés…).
  « Vérifier l'intégrité » prouve que rien n'a été modifié.
- Après **5 mots de passe erronés**, un compte est bloqué 15 minutes.

---

## 14. Raccourcis clavier

| Touche | Action |
|---|---|
| **Ctrl + K** | Recherche globale |
| **F2** | (POS) Aller au champ de scan / recherche |
| **F4** | (POS) Encaisser |
| **F8** | (POS) Mettre le ticket en attente |
| **Entrée** | (POS) Ajouter le produit trouvé / valider |
| **Échap** | Fermer une fenêtre |

---

## 15. Questions fréquentes

- **« Stock insuffisant »** : le stock du dépôt ne suffit pas. Réduisez la quantité, faites une entrée de stock ou un transfert.
- **« Ouvrez votre caisse »** : une caisse doit être ouverte avant de vendre ou de payer en espèces.
- **« Remise supérieure à votre plafond »** : faites saisir le PIN d'un gérant.
- **« Limite de crédit dépassée »** : le client doit d'abord payer une partie de sa dette, ou un gérant donne son PIN.
- **Je ne vois pas un menu** : votre rôle n'y donne pas accès ; demandez à l'administrateur.
- **Mot de passe oublié** : l'administrateur vous en donne un nouveau (Utilisateurs → votre fiche).
