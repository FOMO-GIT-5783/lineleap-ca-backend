#!/bin/bash
set -e

BACKUP_DIR="/tmp/lineleap-backups"
BACKUP_FILE="lineleap-backup-$(date +%Y%m%d-%H%M%S).gz"

echo "Starting secure backup process..."

# Create backup directory
mkdir -p "${BACKUP_DIR}"
cd "${BACKUP_DIR}"

# Create MongoDB backup
echo "Creating MongoDB backup..."
mongodump --uri="${MONGODB_URI}" --archive="${BACKUP_FILE}" --gzip

# Encrypt backup
echo "Encrypting backup..."
openssl enc -aes-256-cbc -salt -in "${BACKUP_FILE}" -out "${BACKUP_FILE}.enc"

# Cleanup
rm -f "${BACKUP_FILE}"

echo "Backup completed: ${BACKUP_DIR}/${BACKUP_FILE}.enc" 