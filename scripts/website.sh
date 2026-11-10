#!/usr/bin/env bash
set -euo pipefail

region=ap-southeast-1
cluster=ErrandBoard
instance_id=i-0d9f56cf5a7a6b091
data_services=(mongodb redis rabbitmq)
app_services=(credit-service supplier-service user-service order-service notification-service)
all_services=(frontend user-service supplier-service order-service credit-service notification-service mongodb redis rabbitmq)

aws_args=(--region "$region")
if [[ -n "${AWS_PROFILE:-}" ]]; then aws_args+=(--profile "$AWS_PROFILE"); fi

usage() { echo "Usage: $0 {up|down|status}" >&2; }

instance_state() {
  aws ec2 describe-instances --instance-ids "$instance_id" "${aws_args[@]}" \
    --query 'Reservations[0].Instances[0].State.Name' --output text
}

set_services() {
  local desired="$1"; shift
  local service
  for service in "$@"; do
    echo "Setting $service desired count to $desired"
    aws ecs update-service --cluster "$cluster" --service "$service" \
      --desired-count "$desired" "${aws_args[@]}" >/dev/null
  done
}

wait_services() {
  echo "Waiting for: $*"
  aws ecs wait services-stable --cluster "$cluster" --services "$@" "${aws_args[@]}"
}

start_site() {
  local state
  state=$(instance_state)
  case "$state" in
    stopped)
      aws ec2 start-instances --instance-ids "$instance_id" "${aws_args[@]}" >/dev/null ;;
    stopping)
      aws ec2 wait instance-stopped --instance-ids "$instance_id" "${aws_args[@]}"
      aws ec2 start-instances --instance-ids "$instance_id" "${aws_args[@]}" >/dev/null ;;
    running) echo "Database host is already running" ;;
    pending) echo "Database host is already starting" ;;
    *) echo "Cannot start site while EC2 instance is in state: $state" >&2; exit 1 ;;
  esac
  aws ec2 wait instance-running --instance-ids "$instance_id" "${aws_args[@]}"

  # Wait for the EC2 host to re-register as ECS capacity before placing its tasks.
  local attempt active_instances
  for attempt in {1..40}; do
    active_instances=$(aws ecs list-container-instances --cluster "$cluster" \
      --status ACTIVE "${aws_args[@]}" --query 'length(containerInstanceArns)' --output text)
    if [[ "$active_instances" -gt 0 ]]; then break; fi
    if [[ "$attempt" -eq 40 ]]; then
      echo "EC2 is running but no active ECS container instance registered. Check ECS agent and host logs." >&2
      exit 1
    fi
    sleep 15
  done

  set_services 1 "${data_services[@]}"
  wait_services "${data_services[@]}"
  set_services 1 "${app_services[@]}"
  wait_services "${app_services[@]}"
  set_services 1 frontend
  wait_services frontend
  echo "Website is up: https://errandboard-1396600328.ap-southeast-1.elb.amazonaws.com"
  echo "The browser will warn because the configured certificate is self-signed."
}

stop_site() {
  set_services 0 "${all_services[@]}"
  wait_services "${all_services[@]}"
  local state
  state=$(instance_state)
  case "$state" in
    running)
      aws ec2 stop-instances --instance-ids "$instance_id" "${aws_args[@]}" >/dev/null
      aws ec2 wait instance-stopped --instance-ids "$instance_id" "${aws_args[@]}" ;;
    stopped) echo "Database host is already stopped" ;;
    stopping) aws ec2 wait instance-stopped --instance-ids "$instance_id" "${aws_args[@]}" ;;
    *) echo "All ECS services are at zero, but EC2 is in state '$state'; check the instance in the console." >&2; exit 1 ;;
  esac
  echo "Website compute is stopped. ALB, NAT gateway, and EBS charges may continue."
}

show_status() {
  echo "ECS services (desired/running/pending):"
  aws ecs describe-services --cluster "$cluster" --services "${all_services[@]}" \
    "${aws_args[@]}" \
    --query 'services[].{service:serviceName,desired:desiredCount,running:runningCount,pending:pendingCount}' \
    --output table
  echo "Database EC2 host: $(instance_state)"
}

case "${1:-}" in
  up) start_site ;;
  down) stop_site ;;
  status) show_status ;;
  *) usage; exit 2 ;;
esac
