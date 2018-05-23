#!/bin/bash

# This is a 3 step process
#   1. First we need to figure out whether to use wget or curl for fetching remote files
#   2. Next we need to figure out whether to use unzip or tar for downloading releases
#   3. We need to actually install the stuff

set -e
set -u

###############################
#                             #
#         http_get            #
# boilerplate for curl / wget #
#                             #
###############################

# See https://git.coolaj86.com/coolaj86/snippets/blob/master/bash/http-get.sh

_my_http_get=""
_my_http_opts=""
_my_http_out=""

detect_http_get()
{
  set +e
  if type -p curl >/dev/null 2>&1; then
    _my_http_get="curl"
    _my_http_opts="-fsSL"
    _my_http_out="-o"
  elif type -p wget >/dev/null 2>&1; then
    _my_http_get="wget"
    _my_http_opts="--quiet"
    _my_http_out="-O"
  else
    echo "Aborted, could not find curl or wget"
    return 7
  fi
  set -e
}

http_get()
{
  $_my_http_get $_my_http_opts $_my_http_out "$2" "$1"
  touch "$2"
}

http_bash()
{
  _http_url=$1
  my_args=${2:-}
  rm -rf my-tmp-runner.sh
  $_my_http_get $_my_http_opts $_my_http_out my-tmp-runner.sh "$_http_url"; bash my-tmp-runner.sh $my_args; rm my-tmp-runner.sh
}

detect_http_get

###############################
##       END HTTP_GET        ##
###############################

echo ""
echo ""
echo ""

my_app="telebitd"
my_bin="telebitd.js"
my_name="Telebit Relay"
my_repo="telebitd.js"

if [ -z "${TELEBITD_PATH:-}" ]; then
  echo 'TELEBITD_PATH="'${TELEBITD_PATH:-}'"'
  TELEBITD_PATH=/opt/$my_app
fi

echo "Installing $my_name to '$TELEBITD_PATH'"
echo ""

echo "sudo mkdir -p '$TELEBITD_PATH'"
sudo mkdir -p "$TELEBITD_PATH"
echo "sudo chown -R $(whoami) '$TELEBITD_PATH'"
sudo chown -R $(whoami) "$TELEBITD_PATH"

echo "Installing node.js dependencies into $TELEBITD_PATH"
# until node v10.x gets fix for ursa we have no advantage to switching from 8.x
export NODEJS_VER=v8.11.1
export NODE_PATH="$TELEBITD_PATH/lib/node_modules"
export NPM_CONFIG_PREFIX="$TELEBITD_PATH"
export PATH="$TELEBITD_PATH/bin:$PATH"
sleep 1
http_bash https://git.coolaj86.com/coolaj86/node-installer.sh/raw/branch/master/install.sh --no-dev-deps >/dev/null 2>/dev/null

my_tree="master"
my_node="$TELEBITD_PATH/bin/node"
my_npm="$my_node $TELEBITD_PATH/bin/npm"
my_tmp="$TELEBITD_PATH/tmp"
mkdir -p $my_tmp

echo "Installing $my_name into $TELEBITD_PATH"
set +e
my_unzip=$(type -p unzip)
my_tar=$(type -p tar)
if [ -n "$my_unzip" ]; then
  rm -f $my_tmp/$my_app-$my_tree.zip
  http_get https://git.coolaj86.com/coolaj86/$my_repo/archive/$my_tree.zip $my_tmp/$my_app-$my_tree.zip
  # -o means overwrite, and there is no option to strip
  $my_unzip -o $my_tmp/$my_app-$my_tree.zip -d $TELEBITD_PATH/ > /dev/null
  cp -ar  $TELEBITD_PATH/$my_repo/* $TELEBITD_PATH/ > /dev/null
  rm -rf $TELEBITD_PATH/$my_bin
elif [ -n "$my_tar" ]; then
  rm -f $my_tmp/$my_app-$my_tree.tar.gz
  http_get https://git.coolaj86.com/coolaj86/$my_repo/archive/$my_tree.tar.gz $my_tmp/$my_app-$my_tree.tar.gz
  ls -lah $my_tmp/$my_app-$my_tree.tar.gz
  $my_tar -xzf $my_tmp/$my_app-$my_tree.tar.gz --strip 1 -C $TELEBITD_PATH/
else
  echo "Neither tar nor unzip found. Abort."
  exit 13
fi
set -e

pushd $TELEBITD_PATH >/dev/null
  $my_npm install >/dev/null 2>/dev/null
popd >/dev/null

cat << EOF > $TELEBITD_PATH/bin/$my_app
#!/bin/bash
$my_node $TELEBITD_PATH/bin/$my_bin
EOF
chmod a+x $TELEBITD_PATH/bin/$my_app
echo "Creating link to '$my_app' in /usr/local/bin"
ln -sf $TELEBITD_PATH/bin/$my_app /usr/local/bin/$my_app

echo ""
echo ""
echo "Installed successfully. Try it out:"
echo ""
echo "  $my_app --help"
echo ""
echo ""

#sudo setcap cap_net_bind_service=+ep $TELEBITD_PATH/bin/node

#https://git.coolaj86.com/coolaj86/telebitd.js.git
#https://git.coolaj86.com/coolaj86/telebitd.js/archive/:tree:.tar.gz
#https://git.coolaj86.com/coolaj86/telebitd.js/archive/:tree:.zip
