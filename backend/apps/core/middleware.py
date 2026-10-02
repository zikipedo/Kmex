import uuid

from .context import set_request


class RequestIdMiddleware:
    """Attribue un identifiant de requête (corrélation logs/audit/support)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
        set_request(request)
        try:
            response = self.get_response(request)
        finally:
            set_request(None)
        response["X-Request-Id"] = request.request_id
        return response
