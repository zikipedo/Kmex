from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.core.models import Warehouse

from .models import LoginHistory, Permission, Role, User


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["code", "module", "label"]


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.SlugRelatedField(slug_field="code", many=True, queryset=Permission.objects.all())
    users_count = serializers.IntegerField(source="users.count", read_only=True)

    class Meta:
        model = Role
        fields = [
            "id", "name", "description", "is_system", "permissions", "max_discount_pct",
            "expense_approval_limit", "users_count",
        ]
        read_only_fields = ["is_system"]

    def validate_permissions(self, perms):
        # Anti-escalade (§3.3, USER-003) : on ne peut attribuer que ce que l'on possède.
        actor = self.context["request"].user
        missing = [p.code for p in perms if p.code not in actor.permission_codes]
        if missing:
            raise serializers.ValidationError(
                f"Vous ne pouvez pas attribuer des permissions que vous ne possédez pas : {', '.join(missing)}"
            )
        return perms


class WarehouseMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ["id", "code", "name"]


class UserSerializer(serializers.ModelSerializer):
    roles = serializers.PrimaryKeyRelatedField(many=True, queryset=Role.objects.all())
    role_names = serializers.SerializerMethodField()
    warehouses = serializers.PrimaryKeyRelatedField(many=True, queryset=Warehouse.objects.all(), required=False)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    pin = serializers.CharField(write_only=True, required=False, allow_blank=True)
    has_pin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "email", "phone", "full_name", "job_title", "is_active", "is_owner", "roles", "role_names",
            "warehouses", "default_warehouse", "password", "pin", "has_pin", "last_login", "created_at",
            "must_change_password", "locked_until",
        ]
        read_only_fields = ["is_owner", "last_login", "created_at", "locked_until"]

    def get_role_names(self, obj):
        return ["Administrateur principal"] if obj.is_owner else [r.name for r in obj.roles.all()]

    def get_has_pin(self, obj):
        return bool(obj.pin_hash)

    def validate_pin(self, value):
        if value and (not value.isdigit() or not 4 <= len(value) <= 6):
            raise serializers.ValidationError("Le PIN doit contenir 4 à 6 chiffres.")
        return value

    def validate(self, attrs):
        if not self.instance and not attrs.get("password"):
            raise serializers.ValidationError({"password": "Mot de passe requis à la création."})
        if attrs.get("password"):
            validate_password(attrs["password"])
        actor = self.context["request"].user
        for role in attrs.get("roles", []):
            if role.company_id != actor.company_id:
                raise serializers.ValidationError({"roles": "Rôle invalide."})
            extra = set(role.permissions.values_list("code", flat=True)) - actor.permission_codes
            if extra:
                raise serializers.ValidationError({"roles": f"Anti-escalade : le rôle « {role.name} » dépasse vos droits."})
        return attrs

    def create(self, validated):
        roles = validated.pop("roles", [])
        warehouses = validated.pop("warehouses", [])
        password = validated.pop("password")
        pin = validated.pop("pin", "")
        user = User(**validated)
        user.set_password(password)
        user.must_change_password = True
        if pin:
            user.set_pin(pin)
        user.save()
        user.roles.set(roles)
        user.warehouses.set(warehouses)
        return user

    def update(self, instance, validated):
        roles = validated.pop("roles", None)
        warehouses = validated.pop("warehouses", None)
        password = validated.pop("password", "")
        pin = validated.pop("pin", "")
        for k, v in validated.items():
            setattr(instance, k, v)
        if password:
            instance.set_password(password)
            instance.must_change_password = True
        if pin:
            instance.set_pin(pin)
        instance.save()
        if roles is not None and not instance.is_owner:
            instance.roles.set(roles)
        if warehouses is not None:
            instance.warehouses.set(warehouses)
        return instance


class LoginHistorySerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.full_name", default="", read_only=True)

    class Meta:
        model = LoginHistory
        fields = ["id", "user", "user_name", "identifier", "success", "ip", "user_agent", "failure_reason", "created_at"]
