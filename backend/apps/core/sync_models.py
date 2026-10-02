"""Hors-ligne : appareils enregistrés et opérations rejouées (§24, SYNC-001/002)."""
from django.conf import settings
from django.db import models

from .models import Company, uuid7


class SyncDevice(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="+")
    device_id = models.CharField(max_length=64)
    name = models.CharField(max_length=120, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="sync_devices")
    user_agent = models.CharField(max_length=300, blank=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_sync_at"]
        constraints = [models.UniqueConstraint(fields=["company", "device_id"], name="uq_sync_device")]


class SyncOperation(models.Model):
    STATUSES = [("done", "Synchronisée"), ("conflict", "Conflit à traiter"), ("rejected", "Rejetée")]
    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="+")
    device = models.ForeignKey(SyncDevice, on_delete=models.CASCADE, related_name="operations")
    op_id = models.CharField(max_length=64)
    type = models.CharField(max_length=30)
    payload = models.JSONField()
    status = models.CharField(max_length=10, choices=STATUSES)
    result = models.JSONField(default=dict, blank=True)
    conflict_reason = models.CharField(max_length=300, blank=True)
    warnings = models.JSONField(default=list, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at_local = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    attempts = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["-received_at"]
        constraints = [models.UniqueConstraint(fields=["device", "op_id"], name="uq_sync_op")]
