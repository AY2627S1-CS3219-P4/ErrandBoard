#!/usr/bin/env bash
set -euo pipefail

region=ap-southeast-1
cluster=ErrandBoard
account=614099836367
repository_prefix="${account}.dkr.ecr.${region}.amazonaws.com/ay2627-cs3219-p4/errandboard"
tag="${GITHUB_SHA:?This script must run from GitHub Actions}"

aws sts get-caller-identity --query Account --output text | grep -Fxq "$account"
aws ecr get-login-password --region "$region" |
  docker login --username AWS --password-stdin "${account}.dkr.ecr.${region}.amazonaws.com"

for service in user-service supplier-service order-service credit-service frontend; do
  context="services/$service"
  dockerfile="services/$service/Dockerfile"
  if [[ "$service" == user-service || "$service" == supplier-service ]]; then
    context=.
  elif [[ "$service" == frontend ]]; then
    context=frontend
    dockerfile=frontend/Dockerfile
  fi

  image="${repository_prefix}/${service}:${tag}"
  repository="ay2627-cs3219-p4/errandboard/${service}"
  if aws ecr describe-images --repository-name "$repository" \
    --image-ids "imageTag=$tag" --region "$region" >/dev/null 2>&1; then
    echo "Reusing existing immutable image $image"
  else
    docker build --platform linux/arm64 --pull -f "$dockerfile" -t "$image" "$context"
    [[ "$(docker image inspect --format '{{.Architecture}}' "$image")" == arm64 ]]
    docker push "$image"
  fi

  current_task_definition=$(aws ecs describe-services \
    --cluster "$cluster" --services "$service" --region "$region" \
    --query 'services[0].taskDefinition' --output text)
  [[ "$current_task_definition" == arn:aws:ecs:*:task-definition/${service}:* ]]

  aws ecs describe-task-definition \
    --task-definition "$current_task_definition" --region "$region" \
    --query taskDefinition --output json |
    jq --arg name "$service" --arg image "$image" '
      del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
          .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)
      | .containerDefinitions |= map(if .name == $name then .image = $image else . end)
    ' > task-definition.json

  [[ "$(jq --arg name "$service" --arg image "$image" \
    '[.containerDefinitions[] | select(.name == $name and .image == $image)] | length' \
    task-definition.json)" == 1 ]]

  new_task_definition=$(aws ecs register-task-definition \
    --cli-input-json file://task-definition.json --region "$region" \
    --query 'taskDefinition.taskDefinitionArn' --output text)
  aws ecs update-service \
    --cluster "$cluster" --service "$service" \
    --task-definition "$new_task_definition" --region "$region" >/dev/null
  aws ecs wait services-stable \
    --cluster "$cluster" --services "$service" --region "$region"
  echo "Updated $service to $new_task_definition"
done
