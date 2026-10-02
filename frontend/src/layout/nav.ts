import {
  ArrowLeftRight, BarChart3, Boxes, ClipboardCheck, ClipboardList, FileText, HandCoins, History, LayoutDashboard,
  Package, Receipt, RefreshCw, ScanLine, Settings, ShieldCheck, ShoppingCart, SlidersHorizontal, Store, Tags, Truck, Undo2,
  UserCog, Users, Wallet, Warehouse, type LucideIcon,
} from 'lucide-react'

export type NavItem = { to: string; label: string; icon: LucideIcon; perm?: string | string[]; badge?: string }
export type NavGroup = { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    label: 'Pilotage',
    items: [{ to: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard }],
  },
  {
    label: 'Vente',
    items: [
      { to: '/pos', label: 'Point de vente', icon: ScanLine, perm: 'sales.create' },
      { to: '/sales', label: 'Ventes & factures', icon: Receipt, perm: ['sales.view', 'sales.create'] },
      { to: '/quotes', label: 'Devis', icon: FileText, perm: 'sales.create' },
      { to: '/credit-notes', label: 'Avoirs & retours', icon: Undo2, perm: 'sales.view' },
      { to: '/customers', label: 'Clients', icon: Users, perm: ['sales.view', 'sales.create'] },
      { to: '/sync', label: 'Synchronisation', icon: RefreshCw, perm: 'sales.create' },
    ],
  },
  {
    label: 'Achats',
    items: [
      { to: '/purchases/orders', label: 'Commandes', icon: ShoppingCart, perm: 'purchase.view' },
      { to: '/purchases/invoices', label: 'Factures fournisseurs', icon: ClipboardList, perm: 'purchase.view' },
      { to: '/suppliers', label: 'Fournisseurs', icon: Truck, perm: 'purchase.view' },
    ],
  },
  {
    label: 'Stock',
    items: [
      { to: '/products', label: 'Produits', icon: Package, perm: 'catalog.view' },
      { to: '/catalog', label: 'Catégories & marques', icon: Tags, perm: 'catalog.view' },
      { to: '/stock', label: 'Niveaux de stock', icon: Boxes, perm: 'stock.view' },
      { to: '/stock/movements', label: 'Mouvements', icon: History, perm: 'stock.view' },
      { to: '/stock/adjustments', label: 'Ajustements', icon: SlidersHorizontal, perm: 'stock.view' },
      { to: '/inventories', label: 'Inventaires', icon: ClipboardCheck, perm: 'stock.inventory.count' },
      { to: '/transfers', label: 'Transferts', icon: ArrowLeftRight, perm: 'stock.view' },
    ],
  },
  {
    label: 'Finances',
    items: [
      { to: '/cash', label: 'Caisse', icon: Store, perm: ['cash.session', 'cash.view'] },
      { to: '/payments', label: 'Paiements', icon: HandCoins, perm: ['cash.view', 'sales.payment'] },
      { to: '/expenses', label: 'Dépenses', icon: Wallet, perm: ['expense.view', 'expense.create'] },
      { to: '/treasury', label: 'Trésorerie', icon: Warehouse, perm: 'cash.view' },
    ],
  },
  {
    label: 'Analyse',
    items: [{ to: '/reports', label: 'Rapports', icon: BarChart3, perm: ['reports.view', 'reports.finance', 'audit.view'] }],
  },
  {
    label: 'Administration',
    items: [
      { to: '/admin/users', label: 'Utilisateurs & rôles', icon: UserCog, perm: 'users.manage' },
      { to: '/admin/settings', label: 'Paramètres', icon: Settings, perm: ['settings.manage', 'warehouses.manage'] },
      { to: '/admin/audit', label: "Journal d'audit", icon: ShieldCheck, perm: 'audit.view' },
    ],
  },
]
