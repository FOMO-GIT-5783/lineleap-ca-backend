#!/bin/bash

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Starting pre-deployment checks...${NC}"

# 1. Validate script syntax
echo -e "\n${YELLOW}1. Validating script syntax...${NC}"
SYNTAX_ERRORS=0

for script in scripts/*.sh; do
    if bash -n "$script"; then
        echo -e "${GREEN}✓ $script syntax OK${NC}"
    else
        echo -e "${RED}✗ $script has syntax errors${NC}"
        SYNTAX_ERRORS=$((SYNTAX_ERRORS + 1))
    fi
done

if [ $SYNTAX_ERRORS -gt 0 ]; then
    echo -e "\n${RED}Found $SYNTAX_ERRORS script(s) with syntax errors. Aborting deployment.${NC}"
    exit 1
fi

# 2. Create restore point
echo -e "\n${YELLOW}2. Creating restore point...${NC}"
TAG_NAME="deployment-$(date +%Y%m%d-%H%M%S)"

if git rev-parse --git-dir > /dev/null 2>&1; then
    if git tag "$TAG_NAME"; then
        echo -e "${GREEN}✓ Created git tag: $TAG_NAME${NC}"
    else
        echo -e "${RED}✗ Failed to create git tag${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ Not a git repository, skipping git tag${NC}"
fi

# 3. Create Docker snapshot
echo -e "\n${YELLOW}3. Creating Docker snapshot...${NC}"
CONTAINERS=$(docker ps -q)

if [ -n "$CONTAINERS" ]; then
    for container in $CONTAINERS; do
        NAME=$(docker inspect --format='{{.Name}}' "$container" | sed 's/\///')
        if docker commit "$container" "lineleap-pre-deployment-$NAME"; then
            echo -e "${GREEN}✓ Created snapshot of container: $NAME${NC}"
        else
            echo -e "${RED}✗ Failed to create snapshot of container: $NAME${NC}"
            exit 1
        fi
    done
else
    echo -e "${YELLOW}⚠ No running containers found${NC}"
fi

echo -e "\n${GREEN}Pre-deployment checks completed successfully!${NC}"
exit 0 