from django.conf import settings
from rest_framework import serializers

from .models import DEFAULT_SETTINGS, AuditLog, Company, Notification, Warehouse


class CompanySerializer(serializers.ModelSerializer):
    settings = serializers.SerializerMethodField()
    logo_url = serializers.SerializerMethodField()

    class Meta:
        model = Company
        fields = [
            "id", "name", "legal_name", "address", "city", "country", "phone", "email", "website", "legal_ids",
            "currency", "currency_symbol", "currency_decimals", "timezone", "locale", "logo_url", "settings",
        ]

    def get_settings(self, obj):
        return obj.merged_settings()

    def get_logo_url(self, obj):
        return f"{settings.MEDIA_URL}{obj.logo.name}" if obj.logo else None


class CompanyUpdateSerializer(serializers.ModelSerializer):
    settings = serializers.JSONField(required=False)

    class Meta:
        model = Company
        fields = [
            "name", "legal_name", "address", "city", "country", "phone", "email", "website", "legal_ids",
            "currency", "currency_symbol", "currency_decimals", "timezone", "settings",
        ]

    def validate_settings(self, value):
        unknown = set(value) - set(DEFAULT_SETTINGS)
        if unknown:
            raise serializers.ValidationError(f"Paramètres inconnus : {', '.join(sorted(unknown))}")
        return value

    def update(self, instance, validated):
        new_settings = validated.pop("settings", None)
        for k, v in validated.items():
            setattr(instance, k, v)
        if new_settings is not None:
            instance.settings = {**(instance.settings or {}), **new_settings}
        instance.save()
        return instance


class WarehouseSerializer(serializers.ModelSerializer):
    manager_name = serializers.CharField(source="manager.full_name", read_only=True, default=None)
    registers = serializers.SerializerMethodField()

    class Meta:
        model = Warehouse
        fields = ["id", "code", "name", "type", "address", "phone", "manager", "manager_name", "is_active", "allow_negative_stock", "registers"]

    def get_registers(self, obj):
        return [{"id": str(r.id), "name": r.name} for r in obj.registers.all()]


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "type", "title", "body", "link", "level", "read_at", "created_at"]


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = [
            "id", "user", "user_name", "user_roles", "action", "entity_type", "entity_id", "entity_label",
            "old_values", "new_values", "reason", "ip", "user_agent", "request_id", "hash", "created_at",
        ]
