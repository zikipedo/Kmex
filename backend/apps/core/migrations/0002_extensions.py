from django.contrib.postgres.operations import TrigramExtension, UnaccentExtension
from django.db import migrations


class Migration(migrations.Migration):
    """Recherche insensible aux accents et tolérante aux fautes (§15.2)."""

    dependencies = [("core", "0001_initial")]

    operations = [UnaccentExtension(), TrigramExtension()]
