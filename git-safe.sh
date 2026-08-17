#!/bin/bash
# Always run git from the theme repo root
cd "$(dirname "$0")"
git "$@"
