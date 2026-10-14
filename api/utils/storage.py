"""S3 / Cloudflare R2 upload helper.

Env vars:
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION          — default: us-east-1 (R2 ignora la región, usa "auto")
  S3_BUCKET           — bucket name
  S3_ENDPOINT_URL     — endpoint S3-compat. Para R2:
                        https://<account_id>.r2.cloudflarestorage.com
                        Vacío → AWS S3 normal.
  S3_PUBLIC_URL       — base URL pública/CDN (e.g. https://cdn.medellin.social
                        o https://<hash>.r2.dev). Falls back a
                        https://{bucket}.s3.amazonaws.com

R2 no soporta ACL por objeto (el acceso público se configura a nivel bucket),
por eso NO se envía ACL="public-read"; en S3 el acceso se da con bucket policy.

If S3_BUCKET is unset, uploads are skipped and a placeholder URL is returned
so the feature doesn't break in dev without credentials.
"""
from __future__ import annotations

import asyncio
import mimetypes
import os
import uuid
from pathlib import PurePosixPath

import boto3
from botocore.exceptions import BotoCoreError, ClientError

# Acepta los nombres S3_* (originales) y los AWS_* que usa el .env de R2.
_BUCKET       = os.getenv("S3_BUCKET")       or os.getenv("AWS_BUCKET", "")
_REGION       = os.getenv("AWS_REGION")      or os.getenv("AWS_DEFAULT_REGION", "auto")
_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL") or os.getenv("AWS_ENDPOINT", "")
_PUBLIC_URL   = os.getenv("S3_PUBLIC_URL")   or os.getenv("AWS_URL", "")


def _client():
    return boto3.client(
        "s3",
        region_name=_REGION,
        endpoint_url=_ENDPOINT_URL or None,   # R2 usa endpoint propio; S3 = None
    )


def _public_url(key: str) -> str:
    base = _PUBLIC_URL or f"https://{_BUCKET}.s3.amazonaws.com"
    return f"{base}/{key}"


def _upload_sync(file_bytes: bytes, key: str, content_type: str) -> str:
    if not _BUCKET:
        print(f"[S3 STUB] would upload {key} ({len(file_bytes)} bytes)")
        return f"https://placeholder.s3.amazonaws.com/{key}"

    c = _client()
    c.put_object(
        Bucket=_BUCKET,
        Key=key,
        Body=file_bytes,
        ContentType=content_type,
    )
    return _public_url(key)


MAX_UPLOAD_BYTES = 10 * 1024 * 1024
_IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                ".webp": "image/webp", ".gif": "image/gif"}


def _sniff_image_ext(b: bytes) -> str | None:
    """Real type from magic bytes (the client-supplied filename/content-type is untrusted)."""
    if b[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return ".webp"
    if b[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    return None


async def read_upload_bounded(upload, limit: int = MAX_UPLOAD_BYTES) -> bytes:
    """Read an UploadFile in chunks, aborting with 413 as soon as `limit` is
    exceeded (never buffers an oversized body in full)."""
    from fastapi import HTTPException
    declared = getattr(upload, "size", None)
    if declared is not None and declared > limit:
        raise HTTPException(status_code=413, detail="archivo demasiado grande (max 10 MB)")
    buf = bytearray()
    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        buf += chunk
        if len(buf) > limit:
            raise HTTPException(status_code=413, detail="archivo demasiado grande (max 10 MB)")
    return bytes(buf)


def validate_image_upload(file_bytes: bytes) -> str:
    """Return the sniffed extension or raise HTTP 413/415. Rejects SVG/HTML/exe
    masquerading as images (stored XSS on the public bucket)."""
    from fastapi import HTTPException
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="archivo demasiado grande (max 10 MB)")
    ext = _sniff_image_ext(file_bytes)
    if ext is None:
        raise HTTPException(status_code=415, detail="solo imágenes JPG, PNG, WEBP o GIF")
    return ext


async def upload_file(
    file_bytes: bytes,
    filename: str,
    folder: str = "agentes",
) -> str:
    ext = validate_image_upload(file_bytes)
    content_type = _IMAGE_TYPES[ext]
    key = f"{folder}/{uuid.uuid4().hex}{ext}"
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _upload_sync, file_bytes, key, content_type)


def _exists(key: str) -> bool:
    """True si el objeto ya está en el bucket. R2/S3 HeadObject → 404 si no."""
    if not _BUCKET:
        return False
    try:
        _client().head_object(Bucket=_BUCKET, Key=key)
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def upload_if_absent(file_bytes: bytes, key: str, content_type: str = "image/webp") -> str:
    """Sube solo si la key no existe (dedup content-addressable).

    Uso: key = f"listings/{media_uid}/{sha256}.webp". Misma foto = mismo hash =
    misma key → HeadObject dice que ya está → no re-sube. Devuelve la URL pública
    igual exista o no. Síncrono: pensado para el script/DAG de espejo, no FastAPI.
    """
    if not _BUCKET:
        print(f"[S3 STUB] would upload {key} ({len(file_bytes)} bytes)")
        return _public_url(key)
    if not _exists(key):
        _client().put_object(
            Bucket=_BUCKET, Key=key, Body=file_bytes, ContentType=content_type,
        )
    return _public_url(key)
