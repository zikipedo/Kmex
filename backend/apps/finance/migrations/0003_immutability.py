from django.db import migrations

FUNCTION = """
CREATE OR REPLACE FUNCTION stockpro_forbid_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Table % en ajout seul : % interdit (immuabilité, cahier des charges §20.11)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
"""

TABLES = ["core_auditlog", "inventory_stockmovement", "finance_cashmovement"]


def triggers(op):
    sql = []
    for t in TABLES:
        if op == "create":
            sql.append(
                f"CREATE TRIGGER {t}_immutable BEFORE UPDATE OR DELETE ON {t} "
                f"FOR EACH ROW EXECUTE FUNCTION stockpro_forbid_change();"
            )
        else:
            sql.append(f"DROP TRIGGER IF EXISTS {t}_immutable ON {t};")
    return "\n".join(sql)


class Migration(migrations.Migration):
    """Mouvements de stock, de trésorerie et journal d'audit : UPDATE/DELETE bloqués (T-SEC-04)."""

    dependencies = [
        ("core", "0002_extensions"),
        ("inventory", "0001_initial"),
        ("catalog", "0002_initial"),
        ("finance", "0002_initial"),
    ]

    operations = [
        migrations.RunSQL(FUNCTION, "DROP FUNCTION IF EXISTS stockpro_forbid_change() CASCADE;"),
        migrations.RunSQL(triggers("create"), triggers("drop")),
        migrations.RunSQL(
            "CREATE INDEX IF NOT EXISTS catalog_product_name_trgm ON catalog_product USING gin (name gin_trgm_ops);",
            "DROP INDEX IF EXISTS catalog_product_name_trgm;",
        ),
    ]
