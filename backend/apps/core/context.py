import threading

_local = threading.local()


def set_request(request):
    _local.request = request


def get_request():
    return getattr(_local, "request", None)
