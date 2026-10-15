"""Helpers to keep personal data out of logs."""


def mask_email(email: str | None) -> str:
    """'juana.perez@gmail.com' -> 'j***@gmail.com' (enough to correlate, not to contact)."""
    if not email or "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"
