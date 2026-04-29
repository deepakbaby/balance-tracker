#!/bin/bash
set -e

# Load exact production map to pull passwords and ports silently
source /opt/apps/balance-tracker/.env

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/opt/apps/balance-tracker/backups"
BACKUP_FILE="${BACKUP_DIR}/balance_db_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Cleanly dump the logical structures while compressing efficiently
echo "Extracting structured PostgreSQL Database..."
docker exec -i balance_tracker_pg pg_dump -U "$BALANCE_USER" balance_db | gzip > "$BACKUP_FILE"

echo "Dump acquired completely. Modifying Permissions to root-only..."
chmod 600 "$BACKUP_FILE"

# Auto-cleanup backups older than 30 days securely
echo "Rotating and discarding backups older than 30 days..."
find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +30 -exec rm {} \;

echo "Backup framework successfully completed snapshot ${BACKUP_FILE}."
