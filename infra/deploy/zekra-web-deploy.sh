set -e
pct push 109 /root/zekra-web.tgz /tmp/zekra-web.tgz
pct push 109 /root/fixlinks.sh /tmp/fixlinks.sh
pct exec 109 -- bash -c 'set -e; . /tmp/fixlinks.sh; rm -rf /opt/zekra-web.new; mkdir -p /opt/zekra-web.new; tar --no-same-owner -xzf /tmp/zekra-web.tgz -C /opt/zekra-web.new; fix_links /opt/zekra-web.new; rm -rf /opt/zekra-web.prev; mv /opt/zekra-web /opt/zekra-web.prev; mv /opt/zekra-web.new /opt/zekra-web; systemctl restart zekra-web; for i in $(seq 1 20); do sleep 2; c=$(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3020/en/login); [ "$c" = 200 ] && break; done; echo login=$c'
