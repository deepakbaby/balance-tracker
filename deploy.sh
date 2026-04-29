#!/bin/bash
set -e

echo "Deploying deeper updates to Balance Tracker..."

cd /opt/apps/balance-tracker
git pull origin main

echo "Running standard automated database migrations..."
source .env
python3 api/migrate.py

echo "Restarting the API engine..."
sudo systemctl restart balance-api.service

echo "Done. The newest architecture is live on Lightsail."
