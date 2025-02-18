#!/bin/bash

# ANSI colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Create backup directory if it doesn't exist
BACKUP_ROOT="backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/src_backup_${TIMESTAMP}"

echo -e "${YELLOW}Creating backup of src directory...${NC}"

# Create backup directory structure
mkdir -p "${BACKUP_DIR}"

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to create backup directory${NC}"
    exit 1
fi

# Copy all files from src to backup directory
cp -R ../src/* "${BACKUP_DIR}/"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backup created successfully at: ${BACKUP_DIR}${NC}"
    
    # Create a manifest file
    echo "Backup created on: $(date)" > "${BACKUP_DIR}/MANIFEST.txt"
    echo "Source directory: src" >> "${BACKUP_DIR}/MANIFEST.txt"
    echo "Files:" >> "${BACKUP_DIR}/MANIFEST.txt"
    find "${BACKUP_DIR}" -type f -not -name "MANIFEST.txt" | sed "s|${BACKUP_DIR}/||" >> "${BACKUP_DIR}/MANIFEST.txt"
    
    # Create a tar archive
    tar -czf "${BACKUP_DIR}.tar.gz" -C "${BACKUP_ROOT}" "src_backup_${TIMESTAMP}"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Compressed backup created: ${BACKUP_DIR}.tar.gz${NC}"
        # Remove the uncompressed backup directory
        rm -rf "${BACKUP_DIR}"
    else
        echo -e "${YELLOW}⚠ Failed to create compressed backup, but uncompressed backup is available${NC}"
    fi
else
    echo -e "${RED}✗ Backup failed${NC}"
    exit 1
fi

# List the backup contents
echo -e "\n${YELLOW}Backup contents:${NC}"
tar -tvf "${BACKUP_DIR}.tar.gz" | sed 's/^/  /'

echo -e "\n${GREEN}Backup process completed successfully!${NC}" 