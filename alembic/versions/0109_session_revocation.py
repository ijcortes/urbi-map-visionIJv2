"""usuarios.token_version: server-side JWT revocation

JWTs carry a `tv` claim that must equal usuarios.token_version. A password reset
or an account merge (Google / magic link proving ownership of a pre-registered,
unverified email) bumps the counter, which invalidates every token issued before.
Existing tokens carry no `tv` and are read as 0, which matches the default, so
nobody is logged out by this migration alone.

Revision ID: 0109
Revises: 0108
"""
from alembic import op

revision = "0109"
down_revision = "0108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE public.usuarios DROP COLUMN IF EXISTS token_version")
