#!/usr/bin/env bash

set -e

cd test/e2e

if [ "${TRAVIS_PULL_REQUEST}" = "false" ]; then
  openssl aes-256-cbc -K $encrypted_e9782ba88cb0_key \
    -iv $encrypted_e9782ba88cb0_iv \
    -in ../../node-team-debug-test-dfc747dacb5b.json.enc \
    -out ../../node-team-debug-test-dfc747dacb5b.json -d
fi

echo -en "travis_fold:start:npm_install_test_e2e\\r" | tr / _
echo "npm install in test/e2e"
npm install
echo -en "travis_fold:end:npm_install_test_e2e\\r" | tr / _

for t in test-breakpoints.js test-log-throttling.js ; do
  echo "==== Running ${t} ===="
  node $t || exit
done

cd -
