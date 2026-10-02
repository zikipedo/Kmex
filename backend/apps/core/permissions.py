from rest_framework import viewsets
from rest_framework.permissions import BasePermission


class HasPerm(BasePermission):
    """Vérifie côté serveur la permission atomique requise par l'action (§3.1)."""

    message = "Vous n'avez pas la permission d'effectuer cette action."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated or not user.is_active:
            return False
        required = getattr(view, "required_perms", {})
        action = getattr(view, "action", None) or request.method.lower()
        code = required.get(action, required.get("*"))
        if code is None:
            return True
        codes = code if isinstance(code, (list, tuple)) else [code]
        return any(user.has_code(c) for c in codes)


def require(user, code, message=None):
    from rest_framework.exceptions import PermissionDenied

    if not user.has_code(code):
        raise PermissionDenied(message or "Vous n'avez pas la permission d'effectuer cette action.")


class CompanyViewSet(viewsets.ModelViewSet):
    """Isolation multi-tenant : toutes les requêtes sont filtrées par company (anti-IDOR, §23)."""

    permission_classes = [HasPerm]
    required_perms: dict = {}
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().filter(company=self.request.user.company)

    def perform_create(self, serializer):
        serializer.save(company=self.request.user.company, created_by=self.request.user)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["company"] = self.request.user.company if self.request.user.is_authenticated else None
        return ctx
