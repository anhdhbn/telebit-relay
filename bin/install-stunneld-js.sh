#!/bin/bash

rm -rf ./node-installer.sh
curl -fsSL bit.ly/node-installer -o ./node-installer.sh
bash ./node-installer.sh --dev-deps

git clone https://git.coolaj86.com/coolaj86/tunnel-server.js.git
pushd tunnel-server.js/
  npm install
  my_secret=$(node bin/generate-secret.js)
  echo "Your secret is:\n\n\t"$my_secret
  echo "node bin/server.js --servernames tunnel.example.com --secret $my_secret"
popd
