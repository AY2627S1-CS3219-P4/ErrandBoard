#!/usr/bin/env bash
set -euo pipefail

region=ap-southeast-1
cluster=ErrandBoard
instance_id=i-0d9f56cf5a7a6b091
security_group=sg-05271866f3007008f
subnets=subnet-0ba162b50106575dc,subnet-03b454bca3b27e7d1
services=(mongodb redis rabbitmq credit-service user-service supplier-service order-service frontend)
aws_args=(--region "$region")
if [[ -n "${AWS_PROFILE:-}" ]]; then aws_args+=(--profile "$AWS_PROFILE"); fi
[[ "${1:-}" == WIPE_ERRANDBOARD_AND_SEED ]] || { echo 'Usage: reset-seed-aws.sh WIPE_ERRANDBOARD_AND_SEED' >&2; exit 2; }

tmpdir=$(mktemp -d)
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "${active_task:-}" ]]; then
    aws ecs stop-task --cluster "$cluster" --task "$active_task" "${aws_args[@]}" >/dev/null 2>&1 || true
    aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$active_task" "${aws_args[@]}" || true
  fi
  if [[ "${started:-false}" == true ]]; then bash scripts/website.sh down || echo 'Cleanup failed; run website.sh down manually' >&2; fi
  rm -rf "$tmpdir"
  exit "$result"
}
trap cleanup EXIT

state=$(aws ec2 describe-instances --instance-ids "$instance_id" "${aws_args[@]}" --query 'Reservations[0].Instances[0].State.Name' --output text)
[[ "$state" == stopped ]] || { echo 'Website host must be stopped before reset' >&2; exit 1; }
counts=$(aws ecs describe-services --cluster "$cluster" --services "${services[@]}" "${aws_args[@]}" --query 'services[].desiredCount' --output text)
[[ "${counts//[[:space:]0]/}" == '' ]] || { echo 'All website services must be at desired count zero' >&2; exit 1; }

task_definition() {
  aws ecs describe-services --cluster "$cluster" --services "$1" "${aws_args[@]}" --query 'services[0].taskDefinition' --output text
}
run_task() {
  local definition=$1 container=$2 command=$3 environment=$4 arn exit_code
  jq -n --arg name "$container" --argjson command "$command" --argjson environment "$environment" \
    '{containerOverrides:[{name:$name,command:$command,environment:$environment}]}' > "$tmpdir/override.json"
  arn=$(aws ecs run-task --cluster "$cluster" --launch-type FARGATE --task-definition "$definition" \
    --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=DISABLED}" \
    --overrides "file://$tmpdir/override.json" "${aws_args[@]}" --query 'tasks[0].taskArn' --output text)
  [[ "$arn" == arn:* ]] || { echo "Failed to start $container task" >&2; exit 1; }
  active_task=$arn
  aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$arn" "${aws_args[@]}"
  active_task=
  exit_code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$arn" "${aws_args[@]}" \
    --query "tasks[0].containers[?name=='$container'].exitCode | [0]" --output text)
  echo "$container task $arn exited with code $exit_code"
  [[ "$exit_code" == 0 ]] || exit 1
}

aws ec2 start-instances --instance-ids "$instance_id" "${aws_args[@]}" >/dev/null
started=true
aws ec2 wait instance-running --instance-ids "$instance_id" "${aws_args[@]}"
for service in mongodb redis rabbitmq; do
  aws ecs update-service --cluster "$cluster" --service "$service" --desired-count 1 "${aws_args[@]}" >/dev/null
done
aws ecs wait services-stable --cluster "$cluster" --services mongodb redis rabbitmq "${aws_args[@]}"

mongo_definition=$(task_definition mongodb)
root_secret=$(aws ecs describe-task-definition --task-definition "$mongo_definition" "${aws_args[@]}" \
  --query 'taskDefinition.containerDefinitions[0].secrets' --output json | jq -r '.[] | select(.name == "MONGO_ROOT_PASSWORD") | .valueFrom')
[[ -n "$root_secret" ]] || { echo 'MongoDB root secret reference missing' >&2; exit 1; }
order_definition=$(task_definition order-service)
aws ecs describe-task-definition --task-definition "$order_definition" "${aws_args[@]}" --query taskDefinition --output json |
  jq --arg root "$root_secret" '
    del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy,.deregisteredAt)
    | .family = "errandboard-reset-seed"
    | .containerDefinitions |= map(
        .command = ["node","dist/scripts/reset-seed-data.js"]
        | .secrets = ((.secrets // []) | map(select(.name != "MONGO_ROOT_PASSWORD")) + [{name:"MONGO_ROOT_PASSWORD",valueFrom:$root}])
        | del(.healthCheck,.portMappings)
      )' > "$tmpdir/reset-task.json"
reset_definition=$(aws ecs register-task-definition --cli-input-json "file://$tmpdir/reset-task.json" "${aws_args[@]}" \
  --query 'taskDefinition.taskDefinitionArn' --output text)
run_task "$reset_definition" order-service '["node","dist/scripts/reset-seed-data.js"]' '[{"name":"RESET_CONFIRM","value":"WIPE_ERRANDBOARD_AND_SEED"}]'

supplier_definition=$(task_definition supplier-service)
run_task "$supplier_definition" supplier-service '["npm","run","seed"]' '[{"name":"SEED_CSV_PATH","value":"/app/seed/supplier-seed-data.csv"}]'

aws ecs update-service --cluster "$cluster" --service credit-service --desired-count 1 "${aws_args[@]}" >/dev/null
aws ecs wait services-stable --cluster "$cluster" --services credit-service "${aws_args[@]}"
credit_task=$(aws ecs list-tasks --cluster "$cluster" --service-name credit-service "${aws_args[@]}" --query 'taskArns[0]' --output text)
credit_ip=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$credit_task" "${aws_args[@]}" --query 'tasks[0].attachments[0].details' --output json |
  jq -r '.[] | select(.name == "privateIPv4Address") | .value')
[[ -n "$credit_ip" ]] || { echo 'Credit Service private IP missing' >&2; exit 1; }
user_definition=$(task_definition user-service)
user_env=$(jq -n --arg url "http://$credit_ip:3004" '[{name:"SEED_CSV_PATH",value:"/app/seed/user-seed-data.csv"},{name:"CREDIT_SERVICE_URL",value:$url}]')
run_task "$user_definition" user-service '["npm","run","seed"]' "$user_env"
echo 'Reset and seed completed. Website compute will return to zero.'
