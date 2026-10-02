import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Aurora } from './components/aurora'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Spinner } from './components/ui'
import { AppLayout, Logo } from './layout/AppLayout'
import { get, refreshAccess } from './lib/api'
import { cachedMe, cacheMe, loadQueue, refreshReferenceData, serverReachable, startOfflineEngine, useSync } from './lib/offline'
import { homeFor, useAuth, type Me } from './store/auth'

/* Chaque écran est un module chargé à la demande ; tous sont préchargés en arrière-plan après la connexion
   pour que la navigation soit instantanée (aucun écran de chargement entre les pages). */
const loaders = {
  Login: () => import('./pages/Login'),
  Dashboard: () => import('./pages/Dashboard'),
  POS: () => import('./pages/pos/POS'),
  Sales: () => import('./pages/sales/Sales'),
  SaleDetail: () => import('./pages/sales/SaleDetail'),
  SaleForm: () => import('./pages/sales/SaleForm'),
  Quotes: () => import('./pages/sales/Quotes'),
  CreditNotes: () => import('./pages/sales/CreditNotes'),
  Customers: () => import('./pages/sales/Customers'),
  CustomerDetail: () => import('./pages/sales/CustomerDetail'),
  Products: () => import('./pages/catalog/Products'),
  ProductDetail: () => import('./pages/catalog/ProductDetail'),
  CatalogRefs: () => import('./pages/catalog/CatalogRefs'),
  StockLevels: () => import('./pages/stock/StockLevels'),
  Movements: () => import('./pages/stock/Movements'),
  Adjustments: () => import('./pages/stock/Adjustments'),
  Inventories: () => import('./pages/stock/Inventories'),
  InventoryCount: () => import('./pages/stock/InventoryCount'),
  Transfers: () => import('./pages/stock/Transfers'),
  PurchaseOrders: () => import('./pages/purchases/PurchaseOrders'),
  PurchaseOrderDetail: () => import('./pages/purchases/PurchaseOrderDetail'),
  PurchaseOrderForm: () => import('./pages/purchases/PurchaseOrderForm'),
  PurchaseInvoices: () => import('./pages/purchases/PurchaseInvoices'),
  Suppliers: () => import('./pages/purchases/Suppliers'),
  SupplierDetail: () => import('./pages/purchases/SupplierDetail'),
  Cash: () => import('./pages/finance/Cash'),
  SessionDetail: () => import('./pages/finance/SessionDetail'),
  Payments: () => import('./pages/finance/Payments'),
  Expenses: () => import('./pages/finance/Expenses'),
  ExpenseDetail: () => import('./pages/finance/ExpenseDetail'),
  Treasury: () => import('./pages/finance/Treasury'),
  Reports: () => import('./pages/Reports'),
  Users: () => import('./pages/admin/Users'),
  Settings: () => import('./pages/admin/Settings'),
  Audit: () => import('./pages/admin/Audit'),
  Profile: () => import('./pages/Profile'),
  Sync: () => import('./pages/Sync'),
}

function prefetchAllPages() {
  const run = () => Object.values(loaders).forEach((load) => load().catch(() => null))
  if ('requestIdleCallback' in window) (window as any).requestIdleCallback(run, { timeout: 2500 })
  else setTimeout(run, 800)
}

const Login = lazy(loaders.Login)
const Dashboard = lazy(loaders.Dashboard)
const POS = lazy(loaders.POS)
const Sales = lazy(loaders.Sales)
const SaleDetail = lazy(loaders.SaleDetail)
const SaleForm = lazy(loaders.SaleForm)
const Quotes = lazy(loaders.Quotes)
const CreditNotes = lazy(loaders.CreditNotes)
const Customers = lazy(loaders.Customers)
const CustomerDetail = lazy(loaders.CustomerDetail)
const Products = lazy(loaders.Products)
const ProductDetail = lazy(loaders.ProductDetail)
const CatalogRefs = lazy(loaders.CatalogRefs)
const StockLevels = lazy(loaders.StockLevels)
const Movements = lazy(loaders.Movements)
const Adjustments = lazy(loaders.Adjustments)
const Inventories = lazy(loaders.Inventories)
const InventoryCount = lazy(loaders.InventoryCount)
const Transfers = lazy(loaders.Transfers)
const PurchaseOrders = lazy(loaders.PurchaseOrders)
const PurchaseOrderDetail = lazy(loaders.PurchaseOrderDetail)
const PurchaseOrderForm = lazy(loaders.PurchaseOrderForm)
const PurchaseInvoices = lazy(loaders.PurchaseInvoices)
const Suppliers = lazy(loaders.Suppliers)
const SupplierDetail = lazy(loaders.SupplierDetail)
const Cash = lazy(loaders.Cash)
const SessionDetail = lazy(loaders.SessionDetail)
const Payments = lazy(loaders.Payments)
const Expenses = lazy(loaders.Expenses)
const ExpenseDetail = lazy(loaders.ExpenseDetail)
const Treasury = lazy(loaders.Treasury)
const Reports = lazy(loaders.Reports)
const Users = lazy(loaders.Users)
const Settings = lazy(loaders.Settings)
const Audit = lazy(loaders.Audit)
const Profile = lazy(loaders.Profile)
const Sync = lazy(loaders.Sync)

function Splash() {
  return (
    <div className="relative grid min-h-screen place-items-center">
      <Aurora intense />
      <div className="relative z-10 flex flex-col items-center gap-5">
        <div className="scale-150">
          <Logo />
        </div>
        <Spinner />
      </div>
    </div>
  )
}

function Protected({ children }: { children: JSX.Element }) {
  const me = useAuth((s) => s.me)
  const loc = useLocation()
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return children
}

export default function App() {
  const { booting, me } = useAuth()

  useEffect(() => {
    startOfflineEngine()
    ;(async () => {
      try {
        // 1) Le serveur répond-il ? (3 s maximum) — sinon démarrage immédiat hors-ligne.
        if (!(await serverReachable())) {
          // Pas de réseau : reprise de la dernière session connue pour vendre au comptoir (§24.1).
          const cached = await cachedMe()
          if (cached) useAuth.getState().setMe(cached)
          useSync.getState().setOnline(false)
          return
        }
        // 2) En ligne : reprise de la session sécurisée.
        useSync.getState().setOnline(true)
        if (await refreshAccess()) useAuth.getState().setMe(await get<Me>('/me'))
      } catch {
        const cached = await cachedMe()
        if (cached) {
          useAuth.getState().setMe(cached)
          useSync.getState().setOnline(false)
        }
      } finally {
        useAuth.getState().setBooting(false)
      }
    })()
  }, [])

  // Session et données de référence gardées en cache pour un redémarrage sans réseau.
  useEffect(() => {
    if (!me) return
    prefetchAllPages()
    if (!useSync.getState().online) return
    void cacheMe(me)
    void loadQueue()
    void refreshReferenceData(useAuth.getState().warehouseId).catch(() => null)
  }, [me])

  if (booting) return <Splash />

  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/login" element={me ? <Navigate to={homeFor(me)} replace /> : <Login />} />
        <Route path="/pos" element={<Protected><ErrorBoundary><POS /></ErrorBoundary></Protected>} />
        <Route element={<Protected><AppLayout /></Protected>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/sales/new" element={<SaleForm />} />
          <Route path="/sales/:id" element={<SaleDetail />} />
          <Route path="/quotes" element={<Quotes />} />
          <Route path="/quotes/new" element={<SaleForm mode="quote" />} />
          <Route path="/credit-notes" element={<CreditNotes />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/catalog" element={<CatalogRefs />} />
          <Route path="/stock" element={<StockLevels />} />
          <Route path="/stock/movements" element={<Movements />} />
          <Route path="/stock/adjustments" element={<Adjustments />} />
          <Route path="/inventories" element={<Inventories />} />
          <Route path="/inventories/:id" element={<InventoryCount />} />
          <Route path="/transfers" element={<Transfers />} />
          <Route path="/stock/transfers" element={<Transfers />} />
          <Route path="/purchases/orders" element={<PurchaseOrders />} />
          <Route path="/purchases/orders/new" element={<PurchaseOrderForm />} />
          <Route path="/purchases/direct" element={<PurchaseOrderForm direct />} />
          <Route path="/purchases/orders/:id" element={<PurchaseOrderDetail />} />
          <Route path="/purchases/invoices" element={<PurchaseInvoices />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/suppliers/:id" element={<SupplierDetail />} />
          <Route path="/cash" element={<Cash />} />
          <Route path="/cash/sessions/:id" element={<SessionDetail />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/expenses/:id" element={<ExpenseDetail />} />
          <Route path="/treasury" element={<Treasury />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:name" element={<Reports />} />
          <Route path="/admin/users" element={<Users />} />
          <Route path="/admin/settings" element={<Settings />} />
          <Route path="/admin/audit" element={<Audit />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/sync" element={<Sync />} />
        </Route>
        <Route path="*" element={<Navigate to={homeFor(me)} replace />} />
      </Routes>
    </Suspense>
  )
}
