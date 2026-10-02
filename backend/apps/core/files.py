"""Contrôle et traitement des fichiers envoyés (§4.5, §11 bis.7, §23 « Fichiers »)."""
import hashlib
import io
import uuid

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from PIL import Image, ImageOps, UnidentifiedImageError

from .exceptions import BusinessError

try:  # Conversion HEIC/HEIF (smartphones)
    import pillow_heif

    pillow_heif.register_heif_opener()
except Exception:  # pragma: no cover
    pass

MAX_BYTES = 10 * 1024 * 1024
IMAGE_FORMATS = {"JPEG", "PNG", "WEBP", "HEIF", "HEIC", "MPO"}
THUMB_SIZES = (64, 200, 600, 1200)


def read_upload(upload, allow_pdf=False):
    if upload is None:
        raise BusinessError("Aucun fichier reçu.", code="FILE_MISSING", status_code=400)
    if upload.size > MAX_BYTES:
        raise BusinessError("Fichier trop volumineux (maximum 10 Mo).", code="FILE_TOO_LARGE", status_code=400)
    data = upload.read()
    sha = hashlib.sha256(data).hexdigest()
    if allow_pdf and data[:5] == b"%PDF-":
        return data, "application/pdf", sha
    try:
        img = Image.open(io.BytesIO(data))
        fmt = (img.format or "").upper()
        img.verify()
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise BusinessError(
            "Type de fichier refusé : seules les images JPEG, PNG, WebP, HEIC" + (" et les PDF" if allow_pdf else "") + " sont acceptées.",
            code="FILE_TYPE_REJECTED",
            status_code=400,
        )
    if fmt not in IMAGE_FORMATS:
        raise BusinessError(f"Format d'image non supporté ({fmt}).", code="FILE_TYPE_REJECTED", status_code=400)
    return data, "image/" + ("jpeg" if fmt in ("JPEG", "MPO") else fmt.lower()), sha


def _square(img, size):
    return ImageOps.fit(img, (size, size), Image.Resampling.LANCZOS)


def _fit(img, size):
    copy = img.copy()
    copy.thumbnail((size, size), Image.Resampling.LANCZOS)
    return copy


def _webp(img, quality=82):
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=4)
    return buf.getvalue()


def process_image(data: bytes, base_path: str):
    """Corrige l'orientation, supprime EXIF/GPS (ré-encodage), convertit en WebP et génère les miniatures."""
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    main = _fit(img, 2000)
    key = uuid.uuid4().hex
    main_path = default_storage.save(f"{base_path}/{key}.webp", ContentFile(_webp(main, 85)))
    thumbs = {}
    for size in THUMB_SIZES:
        t = _square(img, size) if size <= 200 else _fit(img, size)
        thumbs[str(size)] = default_storage.save(f"{base_path}/{key}_{size}.webp", ContentFile(_webp(t)))
    return main_path, thumbs, main.size


def store_raw(data: bytes, path: str, ext: str):
    return default_storage.save(f"{path}/{uuid.uuid4().hex}.{ext}", ContentFile(data))
