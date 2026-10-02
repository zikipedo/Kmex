#!/bin/sh
set -e

# Le volume médias peut avoir été créé par root : on rétablit les droits puis on abandonne les privilèges.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/media /app/static
  chown -R app:app /app/media /app/static
  exec setpriv --reuid=app --regid=app --init-groups "$0" "$@"
fi

echo "⏳ Attente de PostgreSQL..."
until python -c "import psycopg,os; psycopg.connect(host=os.environ.get('POSTGRES_HOST','db'), dbname=os.environ['POSTGRES_DB'], user=os.environ['POSTGRES_USER'], password=os.environ['POSTGRES_PASSWORD']).close()" 2>/dev/null; do
  sleep 1
done

python manage.py migrate --noinput
python manage.py collectstatic --noinput >/dev/null

if [ "${SEED_DEMO:-1}" = "1" ]; then
  python manage.py seed_demo
fi

exec "$@"
