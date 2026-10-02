"""Catalogue des permissions atomiques et matrice par défaut (§3.4, §3.5, §11 bis.9)."""

PERMISSIONS = {
    # Catalogue
    "catalog.view": ("Catalogue", "Voir le catalogue"),
    "catalog.manage": ("Catalogue", "Créer / modifier les produits et référentiels"),
    "catalog.archive": ("Catalogue", "Archiver des produits"),
    "catalog.price.edit": ("Catalogue", "Modifier les prix de vente"),
    "catalog.cost.view": ("Catalogue", "Voir les prix d'achat et CMUP"),
    "catalog.image.upload": ("Catalogue", "Ajouter des photos produits"),
    "catalog.image.delete": ("Catalogue", "Supprimer des photos produits"),
    # Stock
    "stock.view": ("Stock", "Voir les niveaux et mouvements de stock"),
    "stock.move": ("Stock", "Entrées / sorties de stock manuelles"),
    "stock.adjust": ("Stock", "Créer des ajustements"),
    "stock.adjust.approve": ("Stock", "Approuver ajustements / valider inventaires"),
    "stock.inventory.count": ("Stock", "Compter (inventaire)"),
    "stock.transfer.request": ("Stock", "Demander un transfert"),
    "stock.transfer.manage": ("Stock", "Valider / expédier / recevoir un transfert"),
    "stock.negative.allow": ("Stock", "Autoriser le stock négatif"),
    # Achats
    "purchase.view": ("Achats", "Voir les achats"),
    "purchase.order": ("Achats", "Créer / envoyer des commandes fournisseurs"),
    "purchase.receive": ("Achats", "Réceptionner"),
    "purchase.invoice": ("Achats", "Saisir les factures fournisseurs"),
    "purchase.pay": ("Achats", "Payer un fournisseur"),
    "supplier.manage": ("Achats", "Gérer les fournisseurs"),
    # Ventes
    "sales.view": ("Ventes", "Voir les ventes"),
    "sales.create": ("Ventes", "Créer vente / facture / devis"),
    "sales.validate": ("Ventes", "Valider une facture"),
    "sales.cancel": ("Ventes", "Annuler une facture / émettre un avoir"),
    "sales.discount.override": ("Ventes", "Remise au-delà du plafond"),
    "sales.credit": ("Ventes", "Vente à crédit"),
    "sales.credit.override": ("Ventes", "Dépasser la limite de crédit"),
    "sales.payment": ("Ventes", "Encaisser un paiement client"),
    "customer.manage": ("Ventes", "Gérer les clients"),
    # Caisse & finances
    "cash.session": ("Caisse", "Ouvrir / fermer sa caisse"),
    "cash.session.validate": ("Caisse", "Valider la clôture / corriger la caisse"),
    "cash.view": ("Caisse", "Voir caisses, paiements, trésorerie"),
    "income.manage": ("Caisse", "Recettes diverses"),
    # Dépenses
    "expense.view": ("Dépenses", "Voir les dépenses"),
    "expense.create": ("Dépenses", "Saisir une dépense"),
    "expense.edit": ("Dépenses", "Modifier un brouillon"),
    "expense.approve": ("Dépenses", "Approuver / rejeter"),
    "expense.pay": ("Dépenses", "Payer (décaisser)"),
    "expense.cancel": ("Dépenses", "Annuler (extourner)"),
    "expense.category.manage": ("Dépenses", "Gérer catégories et budgets"),
    "expense.sensitive.view": ("Dépenses", "Voir salaires et dépenses confidentielles"),
    "expense.export": ("Dépenses", "Exporter les dépenses"),
    # Rapports
    "reports.view": ("Rapports", "Voir les rapports"),
    "reports.finance": ("Rapports", "Rapports financiers"),
    "profit.view": ("Rapports", "Voir bénéfices et marges"),
    "export": ("Rapports", "Exporter"),
    # Administration
    "users.manage": ("Administration", "Gérer utilisateurs et rôles"),
    "settings.manage": ("Administration", "Gérer les paramètres"),
    "warehouses.manage": ("Administration", "Gérer dépôts et caisses"),
    "audit.view": ("Administration", "Consulter le journal d'audit"),
}

ALL = set(PERMISSIONS)

_MANAGER = ALL - {"users.manage", "settings.manage", "warehouses.manage", "catalog.archive"}

DEFAULT_ROLES = {
    "Administrateur": {
        "description": "Gestion complète sauf actions réservées au propriétaire.",
        "perms": ALL,
        "max_discount_pct": 100,
        "expense_approval_limit": None,
    },
    "Gérant": {
        "description": "Supervise ses magasins : valide ajustements, remises, annulations, clôtures.",
        "perms": _MANAGER,
        "max_discount_pct": 20,
        "expense_approval_limit": 500000,
    },
    "Responsable de stock": {
        "description": "Catalogue, achats, réceptions, transferts, inventaires, ajustements.",
        "perms": {
            "catalog.view", "catalog.manage", "catalog.archive", "catalog.cost.view", "catalog.image.upload",
            "catalog.image.delete", "stock.view", "stock.move", "stock.adjust", "stock.adjust.approve",
            "stock.inventory.count", "stock.transfer.request", "stock.transfer.manage", "purchase.view",
            "purchase.order", "purchase.receive", "supplier.manage", "reports.view", "export", "expense.create",
            "expense.view",
        },
        "max_discount_pct": 0,
        "expense_approval_limit": 0,
    },
    "Magasinier": {
        "description": "Réceptions, sorties, comptages, demandes de transfert. Pas de prix d'achat.",
        "perms": {
            "catalog.view", "catalog.image.upload", "stock.view", "stock.move", "stock.inventory.count",
            "stock.transfer.request", "purchase.view", "purchase.receive",
        },
        "max_discount_pct": 0,
        "expense_approval_limit": 0,
    },
    "Caissier": {
        "description": "Vente rapide, encaissements, ouverture / clôture de sa caisse.",
        "perms": {
            "catalog.view", "stock.view", "sales.view", "sales.create", "sales.validate", "sales.credit",
            "sales.payment", "cash.session", "expense.create", "expense.view", "expense.pay", "income.manage",
            "customer.manage",
        },
        "max_discount_pct": 5,
        "expense_approval_limit": 20000,
    },
    "Vendeur": {
        "description": "Devis, ventes, gestion de ses clients. Remise plafonnée.",
        "perms": {
            "catalog.view", "stock.view", "sales.view", "sales.create", "sales.credit", "sales.payment",
            "customer.manage", "stock.transfer.request", "reports.view",
        },
        "max_discount_pct": 5,
        "expense_approval_limit": 0,
    },
    "Comptable": {
        "description": "Lecture ventes/achats, paiements, dépenses, exports ; validation financière.",
        "perms": {
            "catalog.view", "catalog.cost.view", "stock.view", "purchase.view", "purchase.invoice", "purchase.pay",
            "sales.view", "sales.payment", "cash.view", "cash.session.validate", "income.manage", "expense.view",
            "expense.create", "expense.approve", "expense.pay", "expense.category.manage", "expense.sensitive.view",
            "expense.export", "reports.view", "reports.finance", "profit.view", "export", "audit.view",
        },
        "max_discount_pct": 0,
        "expense_approval_limit": 200000,
    },
}
