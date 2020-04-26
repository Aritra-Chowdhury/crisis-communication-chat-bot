#!/bin/bash

# Create properties file
# Environment variables
echo "ASSISTANT_ID=${ASSISTANT_ID}" >> .env
echo "ASSISTANT_URL=${ASSISTANT_URL}" >> .env
echo "ASSISTANT_IAM_APIKEY=${ASSISTANT_IAM_APIKEY}" >> .env
echo "ASSISTANT_IAM_URL=${ASSISTANT_IAM_URL}" >> .env

echo "CLOUDANT_USERNAME=${CLOUDANT_USERNAME}" >> .env
echo "CLOUDANT_PASSWORD=${CLOUDANT_PASSWORD}" >> .env
echo "CLOUDANT_URL=${CLOUDANT_URL}" >> .env
echo "CLOUDANT_DB_NAME=${CLOUDANT_DB_NAME}" >> .env
cat .env

# Push app
if ! cf app "$CF_APP"; then  
  cf push "$CF_APP"
else
  OLD_CF_APP="${CF_APP}-OLD-$(date +"%s")"
  rollback() {
    set +e  
    if cf app "$OLD_CF_APP"; then
      cf logs "$CF_APP" --recent
      cf delete "$CF_APP" -f
      cf rename "$OLD_CF_APP" "$CF_APP"
    fi
    exit 1
  }
  set -e
  trap rollback ERR
  cf rename "$CF_APP" "$OLD_CF_APP"
  cf push "$CF_APP"
  cf delete "$OLD_CF_APP" -f
fi
# Export app name and URL for use in later Pipeline jobs
export CF_APP_NAME="$CF_APP"
export APP_URL=http://$(cf app $CF_APP_NAME | grep -e urls: -e routes: | awk '{print $2}')
# View logs
#cf logs "${CF_APP}" --recent
