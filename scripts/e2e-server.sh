#!/usr/bin/env bash
# Fresh database + production server for the Playwright suite.
set -euo pipefail
cd "$(dirname "$0")/.."
fuser -k 3000/tcp 2>/dev/null || true
node -e "const {MongoClient}=require('mongodb');MongoClient.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017').then(async c=>{await c.db('jobpilot_e2e').dropDatabase();await c.close()})"
rm -rf storage/resumes test-results
MONGODB_DB=jobpilot_e2e DISABLE_SCHEDULER=true setsid nohup npx next start -p 3000 > /tmp/next.log 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:3000/api/auth/me >/dev/null && break; sleep 1; done
echo "server ready"
