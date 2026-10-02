"""Erreurs normalisées RFC 9457 « problem details » (§26.1)."""
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler


class BusinessError(exceptions.APIException):
    """Règle métier violée → 422 avec code stable."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_code = "BUSINESS_RULE"

    def __init__(self, detail, code="BUSINESS_RULE", status_code=None, title=None, errors=None, extra=None):
        super().__init__(detail=detail)
        self.code = code
        self.title = title
        self.errors = errors or []
        self.extra = extra or {}
        if status_code:
            self.status_code = status_code


TITLES = {
    400: "Requête invalide",
    401: "Non authentifié",
    403: "Action non autorisée",
    404: "Introuvable",
    405: "Méthode non autorisée",
    409: "Conflit",
    422: "Règle métier non respectée",
    429: "Trop de requêtes",
}


def _flatten(detail, prefix=""):
    out = []
    if isinstance(detail, dict):
        for k, v in detail.items():
            out += _flatten(v, f"{prefix}.{k}" if prefix else str(k))
    elif isinstance(detail, list):
        if all(not isinstance(i, (dict, list)) for i in detail):
            for i in detail:
                out.append({"field": prefix or "non_field_errors", "message": str(i)})
        else:
            for idx, i in enumerate(detail):
                out += _flatten(i, f"{prefix}[{idx}]")
    else:
        out.append({"field": prefix or "non_field_errors", "message": str(detail)})
    return out


def problem_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)
    elif isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, context)
    if response is None:
        return None

    request = context.get("request")
    request_id = getattr(request, "request_id", "") if request else ""
    code = getattr(exc, "code", None) or getattr(exc, "default_code", "error")
    body = {
        "type": f"https://stockpro.app/errors/{str(code).lower().replace('_', '-')}",
        "title": getattr(exc, "title", None) or TITLES.get(response.status_code, "Erreur"),
        "status": response.status_code,
        "code": str(code).upper(),
        "request_id": request_id,
    }
    if isinstance(exc, exceptions.ValidationError):
        errors = _flatten(exc.detail)
        body["errors"] = errors
        body["detail"] = errors[0]["message"] if errors else "Données invalides"
        body["code"] = "VALIDATION_ERROR"
    elif isinstance(exc, BusinessError):
        body["detail"] = str(exc.detail)
        body["errors"] = exc.errors
        body.update(exc.extra)
    else:
        detail = response.data.get("detail") if isinstance(response.data, dict) else response.data
        body["detail"] = str(detail) if detail else body["title"]
        if response.status_code == 401:
            body["detail"] = "Session expirée ou invalide. Veuillez vous reconnecter."
        if response.status_code == 403 and isinstance(exc, exceptions.PermissionDenied):
            body["detail"] = str(exc.detail) if str(exc.detail) != "You do not have permission to perform this action." else "Vous n'avez pas la permission d'effectuer cette action."
    return Response(body, status=response.status_code)
