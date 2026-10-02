from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.exceptions import BusinessError
from apps.core.models import Warehouse
from apps.core.permissions import CompanyViewSet, HasPerm
from apps.core.services import _client_ip, audit, notify, users_with_perm

from .models import LoginHistory, Permission, Role, User
from .serializers import LoginHistorySerializer, PermissionSerializer, RoleSerializer, UserSerializer

MAX_FAILED = 5
LOCK_MINUTES = 15


class LoginThrottle(SimpleRateThrottle):
    """Limitation de fréquence par IP + identifiant (§23.1)."""

    scope = "login"

    def get_cache_key(self, request, view):
        ident = (request.data.get("identifier") or "").lower()
        return f"throttle_login_{self.get_ident(request)}_{ident}"


def _set_refresh_cookie(response, refresh):
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME,
        str(refresh),
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=True,
        secure=settings.REFRESH_COOKIE_SECURE,
        samesite="Strict",
        path="/api/v1/auth/",
    )


def me_payload(user):
    from apps.core.serializers import CompanySerializer
    from apps.finance.models import RegisterSession

    session = RegisterSession.objects.filter(opened_by=user, status="open").select_related("register").first()
    return {
        "user": UserSerializer(user).data,
        "permissions": sorted(user.permission_codes),
        "max_discount_pct": str(user.max_discount_pct),
        "company": CompanySerializer(user.company).data,
        "warehouses": [
            {"id": str(w.id), "code": w.code, "name": w.name}
            for w in Warehouse.objects.filter(id__in=user.allowed_warehouse_ids(), is_active=True)
        ],
        "open_session": (
            {"id": str(session.id), "register": session.register.name, "register_id": str(session.register_id), "warehouse_id": str(session.register.warehouse_id)}
            if session
            else None
        ),
    }


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login(request):
    """Connexion email/téléphone + mot de passe, verrouillage progressif (AUTH-001/002)."""
    identifier = (request.data.get("identifier") or "").strip()
    password = request.data.get("password") or ""
    ip = _client_ip(request)
    ua = request.META.get("HTTP_USER_AGENT", "")[:300]
    generic = BusinessError("Identifiants incorrects.", code="INVALID_CREDENTIALS", status_code=401)

    user = User.objects.filter(Q(email__iexact=identifier) | Q(phone=identifier)).select_related("company").first()
    if not user:
        LoginHistory.objects.create(identifier=identifier, success=False, ip=ip, user_agent=ua, failure_reason="unknown")
        raise generic
    if user.is_locked:
        LoginHistory.objects.create(company=user.company, user=user, identifier=identifier, success=False, ip=ip, user_agent=ua, failure_reason="locked")
        raise BusinessError(
            "Compte temporairement verrouillé suite à plusieurs échecs. Réessayez dans quelques minutes.",
            code="ACCOUNT_LOCKED",
            status_code=423,
        )
    if not user.check_password(password) or not user.is_active:
        reason = "inactive" if user.is_active is False else "bad_password"
        user.failed_attempts += 1
        if user.failed_attempts >= MAX_FAILED:
            user.locked_until = timezone.now() + timedelta(minutes=LOCK_MINUTES)
            audit(user.company, None, "LOCKOUT", "user", user, label=user.full_name, reason=f"{user.failed_attempts} échecs")
            if user.failed_attempts >= 10:
                notify(user.company, users_with_perm(user.company, "users.manage"), "security", "Tentatives de connexion suspectes",
                       f"{user.failed_attempts} échecs sur le compte {user.email}.", "/admin/users", "danger", f"lock:{user.pk}")
        user.save(update_fields=["failed_attempts", "locked_until"])
        LoginHistory.objects.create(company=user.company, user=user, identifier=identifier, success=False, ip=ip, user_agent=ua, failure_reason=reason)
        raise generic

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login = timezone.now()
    user.save(update_fields=["failed_attempts", "locked_until", "last_login"])
    LoginHistory.objects.create(company=user.company, user=user, identifier=identifier, success=True, ip=ip, user_agent=ua)
    audit(user.company, user, "LOGIN", "user", user, label=user.full_name)

    refresh = RefreshToken.for_user(user)
    response = Response({"access": str(refresh.access_token), **me_payload(user)})
    _set_refresh_cookie(response, refresh)
    return response


@api_view(["POST"])
@permission_classes([AllowAny])
def refresh(request):
    token = request.COOKIES.get(settings.REFRESH_COOKIE_NAME) or request.data.get("refresh")
    if not token:
        raise BusinessError("Session expirée.", code="NO_SESSION", status_code=401)
    try:
        old = RefreshToken(token)
        user = User.objects.get(pk=old["user_id"])
        if not user.is_active:
            raise TokenError("inactive")
        old.blacklist()
        new = RefreshToken.for_user(user)
    except (TokenError, User.DoesNotExist):
        raise BusinessError("Session expirée.", code="NO_SESSION", status_code=401)
    response = Response({"access": str(new.access_token)})
    _set_refresh_cookie(response, new)
    return response


@api_view(["POST"])
@permission_classes([AllowAny])
def logout(request):
    token = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
    if token:
        try:
            RefreshToken(token).blacklist()
        except TokenError:
            pass
    response = Response(status=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(settings.REFRESH_COOKIE_NAME, path="/api/v1/auth/")
    return response


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def me(request):
    user = request.user
    if request.method == "PATCH":
        prefs = request.data.get("preferences")
        if isinstance(prefs, dict):
            user.preferences = {**user.preferences, **prefs}
        for f in ("full_name", "phone"):
            if f in request.data:
                setattr(user, f, request.data[f])
        if "default_warehouse" in request.data:
            user.default_warehouse_id = request.data["default_warehouse"] or None
        user.save()
    return Response(me_payload(user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    user = request.user
    if not user.check_password(request.data.get("current_password") or ""):
        raise ValidationError({"current_password": "Mot de passe actuel incorrect."})
    new = request.data.get("new_password") or ""
    try:
        validate_password(new, user)
    except Exception as e:  # noqa: BLE001
        raise ValidationError({"new_password": list(getattr(e, "messages", [str(e)]))})
    user.set_password(new)
    user.must_change_password = False
    user.save()
    # Invalidation des autres sessions
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    for t in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=t)
    audit(user.company, user, "PASSWORD_CHANGE", "user", user, label=user.full_name)
    refresh_token = RefreshToken.for_user(user)
    response = Response({"access": str(refresh_token.access_token)})
    _set_refresh_cookie(response, refresh_token)
    return response


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def set_pin(request):
    pin = str(request.data.get("pin") or "")
    if not pin.isdigit() or not 4 <= len(pin) <= 6:
        raise ValidationError({"pin": "Le PIN doit contenir 4 à 6 chiffres."})
    request.user.set_pin(pin)
    request.user.save(update_fields=["pin_hash"])
    return Response({"ok": True})


class UserViewSet(CompanyViewSet):
    queryset = User.objects.prefetch_related("roles", "warehouses").all()
    serializer_class = UserSerializer
    required_perms = {"*": "users.manage"}
    search_fields = ["full_name", "email", "phone"]
    filterset_fields = ["is_active"]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def perform_create(self, serializer):
        user = serializer.save(company=self.request.user.company)
        audit(user.company, self.request.user, "CREATE", "user", user, label=user.full_name,
              new={"email": user.email, "roles": [r.name for r in user.roles.all()]})

    def perform_update(self, serializer):
        before = {"roles": [r.name for r in serializer.instance.roles.all()], "is_active": serializer.instance.is_active}
        if serializer.instance.is_owner and serializer.validated_data.get("is_active") is False:
            raise BusinessError("Le propriétaire ne peut pas être désactivé.", code="OWNER_PROTECTED")
        user = serializer.save()
        after = {"roles": [r.name for r in user.roles.all()], "is_active": user.is_active}
        audit(user.company, self.request.user, "PERMISSION_CHANGE" if before != after else "UPDATE", "user", user,
              label=user.full_name, old=before, new=after)

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        user = self.get_object()
        if user.is_owner:
            raise BusinessError("Le propriétaire ne peut pas être désactivé.", code="OWNER_PROTECTED")
        if user == request.user:
            raise BusinessError("Vous ne pouvez pas vous désactiver vous-même.", code="SELF_DEACTIVATE")
        user.is_active = False
        user.save(update_fields=["is_active"])
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

        for t in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=t)
        audit(user.company, request.user, "DEACTIVATE", "user", user, label=user.full_name, reason=request.data.get("reason", ""))
        return Response(UserSerializer(user).data)

    @action(detail=True, methods=["post"])
    def reactivate(self, request, pk=None):
        user = self.get_object()
        user.is_active = True
        user.failed_attempts = 0
        user.locked_until = None
        user.save(update_fields=["is_active", "failed_attempts", "locked_until"])
        audit(user.company, request.user, "REACTIVATE", "user", user, label=user.full_name)
        return Response(UserSerializer(user).data)

    @action(detail=True, methods=["get"], url_path="login-history")
    def login_history(self, request, pk=None):
        qs = LoginHistory.objects.filter(user=self.get_object())[:50]
        return Response(LoginHistorySerializer(qs, many=True).data)


class RoleViewSet(CompanyViewSet):
    queryset = Role.objects.prefetch_related("permissions", "users").all()
    serializer_class = RoleSerializer
    required_perms = {"list": ["users.manage", "settings.manage"], "retrieve": "users.manage", "*": "users.manage"}
    pagination_class = None

    def perform_create(self, serializer):
        role = serializer.save(company=self.request.user.company)
        audit(role.company, self.request.user, "CREATE", "role", role, label=role.name,
              new={"permissions": sorted(p.code for p in role.permissions.all())})

    def perform_update(self, serializer):
        before = sorted(serializer.instance.permissions.values_list("code", flat=True))
        role = serializer.save()
        audit(role.company, self.request.user, "PERMISSION_CHANGE", "role", role, label=role.name,
              old={"permissions": before}, new={"permissions": sorted(p.code for p in role.permissions.all())})

    def perform_destroy(self, instance):
        if instance.is_system:
            raise BusinessError("Un rôle système ne peut pas être supprimé (dupliquez-le).", code="SYSTEM_ROLE")
        if instance.users.exists():
            raise BusinessError("Ce rôle est attribué à des utilisateurs.", code="ROLE_IN_USE")
        audit(instance.company, self.request.user, "DELETE", "role", instance, label=instance.name)
        instance.delete()


class PermissionViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [HasPerm]
    required_perms = {"*": "users.manage"}
    pagination_class = None


class LoginHistoryViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = LoginHistory.objects.select_related("user").all()
    serializer_class = LoginHistorySerializer
    permission_classes = [HasPerm]
    required_perms = {"*": "audit.view"}
    filterset_fields = ["success", "user"]
    search_fields = ["identifier", "ip"]

    def get_queryset(self):
        return super().get_queryset().filter(company=self.request.user.company)
