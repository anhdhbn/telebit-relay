systemctl disable telebit-relay
systemctl stop telebit-relay
rm -rf /opt/telebit-relay/ /etc/system/systemd/telebit-relay.service /usr/local/bin/telebit-relay /etc/telebit/
userdel -r telebit
groupdel telebit
