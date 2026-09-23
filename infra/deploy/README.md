# Zekra auto-deploy — install on the stack host (once)

```bash
sudo apt-get install -y webhook
sudo mkdir -p /home/fadymondy/services/zekra-deploy
git clone https://github.com/fadymondy/zekra.git /home/fadymondy/services/zekra-src
openssl rand -hex 32 | sudo tee /home/fadymondy/services/zekra-deploy/.webhook-secret
sudo chmod 600 /home/fadymondy/services/zekra-deploy/.webhook-secret
WHSECRET=$(sudo cat /home/fadymondy/services/zekra-deploy/.webhook-secret)
sudo sed "s|@@WEBHOOK_SECRET@@|$WHSECRET|" \
  /home/fadymondy/services/zekra-src/infra/deploy/hooks.yaml.template \
  > /home/fadymondy/services/zekra-deploy/hooks.yaml
sudo cp /home/fadymondy/services/zekra-src/infra/deploy/zekra-webhook.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now zekra-webhook
```

GitHub → repo Settings → Webhooks → Add webhook:
- URL: `https://deploy.fadymondy.com/hooks/zekra-deploy`
- Content type: `application/json`
- Secret: the value in `/home/fadymondy/services/zekra-deploy/.webhook-secret`
- Events: just the push event

On every push to `main`, `deploy.sh` runs: git pull → docker build → docker run.
