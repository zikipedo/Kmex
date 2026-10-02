from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone

from apps.core.models import Company, Warehouse, uuid7


class Permission(models.Model):
    code = models.CharField(max_length=60, unique=True)
    module = models.CharField(max_length=40)
    label = models.CharField(max_length=200)

    class Meta:
        ordering = ["module", "code"]

    def __str__(self):
        return self.code


class Role(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="roles")
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=300, blank=True)
    is_system = models.BooleanField(default=False)
    permissions = models.ManyToManyField(Permission, blank=True, related_name="roles")
    max_discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    expense_approval_limit = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uq_role_name")]

    def __str__(self):
        return self.name


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="users")
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=40, blank=True)
    full_name = models.CharField(max_length=150)
    job_title = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)
    is_owner = models.BooleanField(default=False)
    roles = models.ManyToManyField(Role, blank=True, related_name="users")
    warehouses = models.ManyToManyField(Warehouse, blank=True, related_name="users")
    default_warehouse = models.ForeignKey(Warehouse, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    pin_hash = models.CharField(max_length=200, blank=True)
    failed_attempts = models.PositiveIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    must_change_password = models.BooleanField(default=False)
    preferences = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = UserManager()
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name

    # --- Permissions -------------------------------------------------------------------
    @property
    def permission_codes(self) -> set:
        if not hasattr(self, "_perm_cache"):
            if self.is_owner:
                from .catalog import ALL

                self._perm_cache = set(ALL)
            else:
                self._perm_cache = set(
                    Permission.objects.filter(roles__users=self).values_list("code", flat=True)
                )
        return self._perm_cache

    def has_code(self, code: str) -> bool:
        return self.is_active and code in self.permission_codes

    def can_access_warehouse(self, warehouse) -> bool:
        if self.is_owner or self.has_code("users.manage"):
            return True
        wid = getattr(warehouse, "pk", warehouse)
        return self.warehouses.filter(pk=wid).exists()

    def allowed_warehouse_ids(self):
        if self.is_owner or self.has_code("users.manage"):
            return list(Warehouse.objects.filter(company=self.company).values_list("id", flat=True))
        return list(self.warehouses.values_list("id", flat=True))

    @property
    def max_discount_pct(self):
        if self.is_owner:
            return 100
        values = list(self.roles.values_list("max_discount_pct", flat=True))
        return max(values) if values else 0

    @property
    def expense_approval_limit(self):
        """None = illimité ; 0 = aucune approbation automatique."""
        if self.is_owner:
            return None
        values = list(self.roles.values_list("expense_approval_limit", flat=True))
        if not values:
            return 0
        if any(v is None for v in values):
            return None
        return max(values)

    # --- PIN caissier / autorisation gérant -----------------------------------------------
    def set_pin(self, pin: str):
        self.pin_hash = make_password(pin)

    def check_pin(self, pin: str) -> bool:
        return bool(self.pin_hash) and check_password(pin, self.pin_hash)

    @property
    def is_locked(self):
        return self.locked_until is not None and self.locked_until > timezone.now()

    # Compatibilité contrib.auth
    @property
    def is_staff(self):
        return self.is_owner

    @property
    def is_superuser(self):
        return self.is_owner


class LoginHistory(models.Model):
    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey(Company, null=True, on_delete=models.CASCADE, related_name="+")
    user = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="login_history")
    identifier = models.CharField(max_length=200)
    success = models.BooleanField()
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    failure_reason = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "created_at"])]
