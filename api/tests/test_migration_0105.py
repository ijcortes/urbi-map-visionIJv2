"""Static guard for migration 0105 downgrade (verified live on postgis:16 as well)."""
import importlib.util
import pathlib
import sys
import types

PATH = pathlib.Path(__file__).resolve().parents[2] / "alembic/versions/0105_apartaestudio_to_apartamento.py"


def _sql(fn):
    out = []
    fake = types.ModuleType("alembic")
    fake.op = types.SimpleNamespace(execute=out.append)
    saved = sys.modules.get("alembic")
    sys.modules["alembic"] = fake
    try:
        spec = importlib.util.spec_from_file_location("m0105", PATH)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        getattr(m, fn)()
    finally:
        if saved is not None:
            sys.modules["alembic"] = saved
        else:
            del sys.modules["alembic"]
    return "\n".join(out)


def test_downgrade_only_restores_rows_still_matching_migration_values():
    sql = _sql("downgrade")
    assert "lower(r.tipo_inmueble) = ''apartamento'' AND r.habitaciones = 0" in sql
    assert "RAISE WARNING" in sql          # conflicts are reported ...
    assert sql.count("DROP TABLE") == 1 and "IF n = 0" in sql   # ... and the backup is kept
