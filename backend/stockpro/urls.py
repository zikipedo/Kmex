from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.accounts import views as acc
from apps.catalog import views as cat
from apps.core import sync
from apps.core import views as core
from apps.finance import views as fin
from apps.inventory import views as inv
from apps.purchasing import views as pur
from apps.reports import views as rep
from apps.sales import views as sal

router = DefaultRouter(trailing_slash=False)
router.register("users", acc.UserViewSet, basename="users")
router.register("roles", acc.RoleViewSet, basename="roles")
router.register("permissions", acc.PermissionViewSet, basename="permissions")
router.register("login-history", acc.LoginHistoryViewSet, basename="login-history")
router.register("warehouses", core.WarehouseViewSet, basename="warehouses")
router.register("notifications", core.NotificationViewSet, basename="notifications")
router.register("audit-logs", core.AuditLogViewSet, basename="audit-logs")
router.register("taxes", cat.TaxViewSet, basename="taxes")
router.register("categories", cat.CategoryViewSet, basename="categories")
router.register("brands", cat.BrandViewSet, basename="brands")
router.register("units", cat.UnitViewSet, basename="units")
router.register("products", cat.ProductViewSet, basename="products")
router.register("stock/levels", inv.StockLevelViewSet, basename="stock-levels")
router.register("stock/movements", inv.StockMovementViewSet, basename="stock-movements")
router.register("stock/adjustments", inv.AdjustmentViewSet, basename="adjustments")
router.register("inventories", inv.InventoryViewSet, basename="inventories")
router.register("transfers", inv.TransferViewSet, basename="transfers")
router.register("suppliers", pur.SupplierViewSet, basename="suppliers")
router.register("purchase-orders", pur.PurchaseOrderViewSet, basename="purchase-orders")
router.register("purchase-receipts", pur.PurchaseReceiptViewSet, basename="purchase-receipts")
router.register("purchase-invoices", pur.PurchaseInvoiceViewSet, basename="purchase-invoices")
router.register("customers", sal.CustomerViewSet, basename="customers")
router.register("sales", sal.SaleViewSet, basename="sales")
router.register("credit-notes", sal.CreditNoteViewSet, basename="credit-notes")
router.register("quotes", sal.QuoteViewSet, basename="quotes")
router.register("treasury-accounts", fin.TreasuryAccountViewSet, basename="treasury-accounts")
router.register("payment-methods", fin.PaymentMethodViewSet, basename="payment-methods")
router.register("cash-registers", fin.CashRegisterViewSet, basename="cash-registers")
router.register("register-sessions", fin.RegisterSessionViewSet, basename="register-sessions")
router.register("payments", fin.PaymentViewSet, basename="payments")
router.register("cash-movements", fin.CashMovementViewSet, basename="cash-movements")
router.register("expense-categories", fin.ExpenseCategoryViewSet, basename="expense-categories")
router.register("expenses", fin.ExpenseViewSet, basename="expenses")
router.register("incomes", fin.IncomeViewSet, basename="incomes")

api = [
    path("health", core.health),
    path("auth/login", acc.login),
    path("auth/refresh", acc.refresh),
    path("auth/logout", acc.logout),
    path("auth/change-password", acc.change_password),
    path("auth/pin", acc.set_pin),
    path("me", acc.me),
    path("company", core.company),
    path("company/logo", core.company_logo),
    path("search", core.search),
    path("sync/push", sync.push),
    path("sync/pull", sync.pull),
    path("sync/operations", sync.operations),
    path("sync/operations/<int:pk>/retry", sync.retry),
    path("sync/devices", sync.devices),
    path("sync/devices/<uuid:pk>/revoke", sync.revoke_device),
    path("stock/entries", inv.manual_movement, {"direction": "entries"}),
    path("stock/exits", inv.manual_movement, {"direction": "exits"}),
    path("stock/integrity", inv.stock_integrity),
    path("stock/movement-types", inv.movement_types),
    path("sales-auth/verify-pin", sal.verify_pin),
    path("dashboard", rep.dashboard),
    path("reports", rep.report_list),
    path("reports/<str:name>", rep.report),
    path("schema", SpectacularAPIView.as_view(), name="schema"),
    path("docs", SpectacularSwaggerView.as_view(url_name="schema")),
    path("redoc", SpectacularRedocView.as_view(url_name="schema")),
    path("", include(router.urls)),
]

urlpatterns = [
    path("api/v1/", include(api)),
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
]
