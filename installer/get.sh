#!/bin/bash
#<pre><code>

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

my_email=${1:-}
my_servername=${2:-}
my_secret=""
my_user="telebit"
my_app="telebit-relay"
my_bin="telebit-relay.js"
my_name="Telebit Relay"
my_repo="telebit-relay.js"

if [ -z "${my_email}" ]; then
  echo ""
  echo ""
  echo "Telebit uses Greenlock for free automated ssl through Let's Encrypt."
  echo ""
  echo "To accept the Terms of Service for Telebit, Greenlock and Let's Encrypt,"
  echo "please enter your email."
  echo ""
  read -p "email: " my_email
  echo ""
  # UX - just want a smooth transition
  sleep 0.5
fi

if [ -z "${my_servername}" ]; then
  echo "What is the domain of this server (for admin interface)?"
  echo ""
  read -p "domain (ex: telebit-relay.example.com): " my_servername
  echo ""
  # UX - just want a smooth transition
  sleep 0.5
fi

echo ""

if [ -z "${TELEBIT_RELAY_PATH:-}" ]; then
  echo 'TELEBIT_RELAY_PATH="'${TELEBIT_RELAY_PATH:-}'"'
  TELEBIT_RELAY_PATH=/opt/$my_app
fi

echo "Installing $my_name to '$TELEBIT_RELAY_PATH'"

echo "Installing node.js dependencies into $TELEBIT_RELAY_PATH"
# v10.2+ has much needed networking fixes, but breaks ursa. v9.x has severe networking bugs. v8.x has working ursa, but requires tls workarounds"
NODEJS_VER="${NODEJS_VER:-v10}"
export NODEJS_VER
export NODE_PATH="$TELEBIT_RELAY_PATH/lib/node_modules"
export NPM_CONFIG_PREFIX="$TELEBIT_RELAY_PATH"
export PATH="$TELEBIT_RELAY_PATH/bin:$PATH"
sleep 1
http_bash https://git.coolaj86.com/coolaj86/node-installer.sh/raw/branch/master/install.sh --no-dev-deps >/dev/null 2>/dev/null

my_tree="master"
my_node="$TELEBIT_RELAY_PATH/bin/node"
my_secret=$($my_node -e "console.info(crypto.randomBytes(16).toString('hex'))")
my_npm="$my_node $TELEBIT_RELAY_PATH/bin/npm"
my_tmp="$TELEBIT_RELAY_PATH/tmp"
mkdir -p $my_tmp

echo "sudo mkdir -p '$TELEBIT_RELAY_PATH'"
sudo mkdir -p "$TELEBIT_RELAY_PATH"
echo "sudo mkdir -p '/opt/$my_app/etc'"
sudo mkdir -p "/opt/$my_app/etc/"

set +e
#https://git.coolaj86.com/coolaj86/telebit-relay.js.git
#https://git.coolaj86.com/coolaj86/telebit-relay.js/archive/:tree:.tar.gz
#https://git.coolaj86.com/coolaj86/telebit-relay.js/archive/:tree:.zip
my_unzip=$(type -p unzip)
my_tar=$(type -p tar)
if [ -n "$my_unzip" ]; then
  rm -f $my_tmp/$my_app-$my_tree.zip
  http_get https://git.coolaj86.com/coolaj86/$my_repo/archive/$my_tree.zip $my_tmp/$my_app-$my_tree.zip
  # -o means overwrite, and there is no option to strip
  $my_unzip -o $my_tmp/$my_app-$my_tree.zip -d $TELEBIT_RELAY_PATH/ > /dev/null 2>&1
  cp -ar  $TELEBIT_RELAY_PATH/$my_repo/* $TELEBIT_RELAY_PATH/ > /dev/null
  rm -rf $TELEBIT_RELAY_PATH/$my_bin
elif [ -n "$my_tar" ]; then
  rm -f $my_tmp/$my_app-$my_tree.tar.gz
  http_get https://git.coolaj86.com/coolaj86/$my_repo/archive/$my_tree.tar.gz $my_tmp/$my_app-$my_tree.tar.gz
  ls -lah $my_tmp/$my_app-$my_tree.tar.gz
  $my_tar -xzf $my_tmp/$my_app-$my_tree.tar.gz --strip 1 -C $TELEBIT_RELAY_PATH/
else
  echo "Neither tar nor unzip found. Abort."
  exit 13
fi
set -e

pushd $TELEBIT_RELAY_PATH >/dev/null
  $my_npm install >/dev/null 2>/dev/null
popd >/dev/null

cat << EOF > $TELEBIT_RELAY_PATH/bin/$my_app
#!/bin/bash
$my_node $TELEBIT_RELAY_PATH/bin/$my_bin
EOF
chmod a+x $TELEBIT_RELAY_PATH/bin/$my_app
echo "sudo ln -sf $TELEBIT_RELAY_PATH/bin/$my_app /usr/local/bin/$my_app"
sudo ln -sf $TELEBIT_RELAY_PATH/bin/$my_app /usr/local/bin/$my_app

set +e
if type -p setcap >/dev/null 2>&1; then
  #echo "Setting permissions to allow $my_app to run on port 80 and port 443 without sudo or root"
  echo "sudo setcap cap_net_bind_service=+ep $TELEBIT_RELAY_PATH/bin/node"
  sudo setcap cap_net_bind_service=+ep $TELEBIT_RELAY_PATH/bin/node
fi
set -e

if [ -z "$(cat /etc/passwd | grep $my_user)" ]; then
  echo "sudo adduser --home $TELEBIT_RELAY_PATH --gecos '' --disabled-password $my_user"
  sudo adduser --home $TELEBIT_RELAY_PATH --gecos '' --disabled-password $my_user >/dev/null 2>&1
fi

if [ ! -f "/opt/$my_app/etc/$my_app.yml" ]; then
  echo "### Creating config file from template. sudo may be required"
  #echo "sudo rsync -a examples/$my_app.yml /opt/$my_app/etc/$my_app.yml"
  sudo bash -c "echo 'email: $my_email' >> /opt/$my_app/etc/$my_app.yml"
  sudo bash -c "echo 'secret: $my_secret' >> /opt/$my_app/etc/$my_app.yml"
  sudo bash -c "echo 'servernames: [ $my_servername ]' >> /opt/$my_app/etc/$my_app.yml"
  sudo bash -c "cat examples/$my_app.yml.tpl >> /opt/$my_app/etc/$my_app.yml"
fi

echo "sudo chown -R $my_user '$TELEBIT_RELAY_PATH' '/opt/$my_app/etc'"
sudo chown -R $my_user "$TELEBIT_RELAY_PATH" "/opt/$my_app/etc"

echo "### Adding $my_app is a system service"
echo "sudo rsync -a $TELEBIT_RELAY_PATH/dist/etc/systemd/system/$my_app.service /etc/systemd/system/$my_app.service"
sudo rsync -a $TELEBIT_RELAY_PATH/dist/etc/systemd/system/$my_app.service /etc/systemd/system/$my_app.service
sudo systemctl daemon-reload
echo "sudo systemctl enable $my_app"
sudo systemctl enable $my_app
echo "sudo systemctl start $my_app"
sudo systemctl restart $my_app

sleep 1
echo ""
echo ""
echo ""
echo "=============================================="
echo "  Privacy Settings in Config"
echo "=============================================="
echo ""
echo "The example config file /opt/$my_app/etc/$my_app.yml opts-in to"
echo "contributing telemetrics and receiving infrequent relevant updates"
echo "(probably once per quarter or less) such as important notes on"
echo "a new release, an important API change, etc. No spam."
echo ""
echo "Please edit the config file to meet your needs before starting."
echo ""
sleep 2

echo ""
echo ""
echo "=============================================="
echo "Installed successfully. Last steps:"
echo "=============================================="
echo ""
echo "Edit the config and restart, if desired:"
echo ""
echo "    sudo vim /opt/$my_app/etc/$my_app.yml"
echo "    sudo systemctl restart $my_app"
echo ""
echo "Or disabled the service and start manually:"
echo ""
echo "    sudo systemctl stop $my_app"
echo "    sudo systemctl disable $my_app"
echo "    $my_app --config /opt/$my_app/etc/$my_app.yml"
echo ""
sleep 1
