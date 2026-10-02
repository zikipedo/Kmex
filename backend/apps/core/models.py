"""Socle : entreprise (tenant), dépôts, numérotation, audit, notifications."""
import os
import time
import uuid

from django.conf import settings
from django.db import models


def uuid7() -> uuid.UUID:
    """UUID v7 (triable par date) — §20.1 du cahier des charges."""
    ts_ms = int(time.time() * 1000)
    rand = int.from_bytes(os.urandom(10), "big")
    value = (ts_ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76
    value |= ((rand >> 62) & 0xFFF) << 64
    value |= 0b10 << 62
    value |= rand & ((1 << 62) - 1)
    return uuid.UUID(int=value)


DEFAULT_SETTINGS = {
    "prices_include_tax": True,
    "stock_exit_mode": "invoice",
    "adjustment_approval_threshold": "100000",
    "cash_tolerance": "500",
    "default_opening_float": "25000",
    "expense_simple_mode": True,
    "return_max_days": 30,
    "overdelivery_tolerance_pct": "0",
    "purchase_approval_threshold": "1000000",
    "dormant_days": 90,
    "allow_sale_below_cost": False,
    "receipt_footer": "Merci pour votre confiance !",
    "invoice_footer": "Paiement à réception. Pénalités de retard selon la réglementation en vigueur.",
    "mobile_money_info": "Orange Money : 77 00 00 00 · Wave : 77 00 00 00",
    "max_product_photos": 8,
}


class Company(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    name = models.CharField(max_length=200)
    legal_name = models.CharField(max_length=200, blank=True)
    address = models.CharField(max_length=300, blank=True)
    city = models.CharField(max_length=120, blank=True)
    country = models.CharField(max_length=120, blank=True, default="Mali")
    phone = models.CharField(max_length=60, blank=True)
    email = models.EmailField(blank=True)
    website = models.CharField(max_length=200, blank=True)
    legal_ids = models.JSONField(default=dict, blank=True)  # NIF, RCCM, IFU…
    currency = models.CharField(max_length=3, default="XOF")
    currency_symbol = models.CharField(max_length=10, default="F CFA")
    currency_decimals = models.PositiveSmallIntegerField(default=0)
    timezone = models.CharField(max_length=64, default="Africa/Bamako")
    locale = models.CharField(max_length=10, default="fr")
    logo = models.ImageField(upload_to="logos/", null=True, blank=True)
    settings = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "companies"

    def __str__(self):
        return self.name

    def setting(self, key):
        return self.settings.get(key, DEFAULT_SETTINGS.get(key))

    def merged_settings(self):
        return {**DEFAULT_SETTINGS, **(self.settings or {})}


class BaseModel(models.Model):
    """Champs communs à toutes les tables métier (§20.1)."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    version = models.PositiveIntegerField(default=1)

    class Meta:
        abstract = True
        ordering = ["-created_at"]


class Warehouse(BaseModel):
    TYPES = [("store", "Magasin"), ("warehouse", "Entrepôt"), ("agency", "Agence"), ("pos", "Point de vente")]
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=120)
    type = models.CharField(max_length=20, choices=TYPES, default="store")
    address = models.CharField(max_length=300, blank=True)
    phone = models.CharField(max_length=60, blank=True)
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="managed_warehouses"
    )
    is_active = models.BooleanField(default=True)
    allow_negative_stock = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "code"], name="uq_warehouse_code")]

    def __str__(self):
        return self.name


class DocumentSequence(models.Model):
    """Compteurs de numérotation, verrouillés en transaction (sans trou ni doublon)."""

    company = models.ForeignKey(Company, on_delete=models.CASCADE)
    doc_type = models.CharField(max_length=30)
    year = models.PositiveIntegerField()
    prefix = models.CharField(max_length=10)
    next_value = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["company", "doc_type", "year"], name="uq_doc_sequence")]


class AuditLog(models.Model):
    """Journal append-only chaîné par hachage (§22). UPDATE/DELETE bloqués par trigger."""

    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="+")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    user_name = models.CharField(max_length=200, blank=True)
    user_roles = models.CharField(max_length=300, blank=True)
    action = models.CharField(max_length=40)
    entity_type = models.CharField(max_length=60)
    entity_id = models.CharField(max_length=64, blank=True)
    entity_label = models.CharField(max_length=200, blank=True)
    old_values = models.JSONField(null=True, blank=True)
    new_values = models.JSONField(null=True, blank=True)
    reason = models.TextField(blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    request_id = models.CharField(max_length=64, blank=True)
    hash_prev = models.CharField(max_length=64, blank=True)
    hash = models.CharField(max_length=64)
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["user", "created_at"]),
        ]


class Notification(models.Model):
    LEVELS = [("info", "Info"), ("success", "Succès"), ("warning", "Alerte"), ("danger", "Critique")]
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="+")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=40)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    link = models.CharField(max_length=300, blank=True)
    level = models.CharField(max_length=10, choices=LEVELS, default="info")
    dedupe_key = models.CharField(max_length=120, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "read_at"])]


from .sync_models import SyncDevice, SyncOperation  # noqa: E402,F401  (modèles hors-ligne)

