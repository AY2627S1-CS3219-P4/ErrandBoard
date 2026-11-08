# ErrandBoard AWS deployment runbook

Region: `ap-southeast-1`. Cluster: `ErrandBoard`. Run commands in AWS CloudShell with the Singapore Region selected. This describes the deployed AWS resources as checked on 4 November 2026. For the architecture, decisions, and CI/CD behavior, see [AWS deployment architecture](aws-deployment-architecture.md).

## Current checkpoint

- ECS services `mongodb`, `redis`, `rabbitmq`, `user-service`, `supplier-service`, `order-service`, `credit-service`, and `frontend` all have desired, running, and pending task counts of zero.
- EC2 database host `i-0d9f56cf5a7a6b091` is stopped. Its EBS data volumes remain attached.
- The internet-facing ALB `errandboard` and its HTTP-to-HTTPS redirect remain configured. URL: `https://errandboard-1396600328.ap-southeast-1.elb.amazonaws.com`. Its imported certificate is self-signed; browsers will not trust it by default.
- NAT gateway, ALB, EBS volumes, Route 53 private hosted zone, and storage/logging can still incur charges with ECS tasks at zero.
- After correcting `RABBITMQ_URL`, a live run served `/` and all four `/api/<service>/health` routes with HTTP 200 over HTTPS. All eight ECS services were then scaled to zero and the EC2 host was stopped.

## RabbitMQ credential configuration

In **Secrets Manager → Secrets → `pre-prod_env` → Retrieve secret value**, `RABBITMQ_URL` now uses the values of `RABBITMQ_DEFAULT_USER` and `RABBITMQ_DEFAULT_PASS` from that same JSON secret for its username and password, with `rabbitmq.errandboard.internal:5672` as the host and port. Keep those fields synchronized if credentials are changed later. URL-encode special characters in the URL username or password. Do not post secret values in chat or commit them to Git.

The RabbitMQ container uses the separate default-user and default-password fields. Its connection was verified during the successful live run.

## Bring the deployment online

After this branch is merged into `main`, open **GitHub → Actions → Website controls → Run workflow** on `main` and choose `up`. Choose `status` to inspect AWS and `down` to stop the whole website. This workflow runs `scripts/website.sh` with a short-lived AWS role scoped to the eight ECS services and the database EC2 host. It does not seed data. The workflow is available from GitHub after merge, without opening CloudShell.

## Explicit destructive reset and seed

The separate **Reset and seed AWS database** workflow runs only when manually dispatched on `main` with `WIPE_ERRANDBOARD_AND_SEED` as its confirmation input. It requires the database host stopped and all eight ECS services at desired count zero. It starts MongoDB, Redis and RabbitMQ, deletes application records and cached/queued state, seeds suppliers and users from the CSV files baked into their current images, provisions seed users' credit accounts, and returns website compute to zero. This erases registered users, supplier edits, errands, credit balances, sessions, and outstanding work. Normal `up`, `down`, CD and `status` never seed or erase data.

Before the workflow can run, merge its code to `main`, let CD deploy the updated Order and User Service images, and update the live inline policy on `ErrandBoardGitHubOperateRole` from `infra/iam/github-operate-permissions.json`. The role needs ECS task run/registration permissions and `iam:PassRole`; committing the JSON file alone does not update IAM. Check the current inline policy name with `aws iam list-role-policies --role-name ErrandBoardGitHubOperateRole` and apply the updated file using that name. Do not run reset if the role has not been updated. A failed seed leaves the website stopped; inspect the stopped task logs before rerunning the operation.

From a terminal with this repository checked out and AWS CLI credentials, the same operations are `./scripts/website.sh up`, `./scripts/website.sh status`, and `./scripts/website.sh down`. In CloudShell, clone or pull this repository before running the script; CloudShell does not automatically contain local files. If using a named local CLI profile, prefix the command with `AWS_PROFILE=your-profile`.

The commands below show what the script performs. The backend services use Linux ARM64 Fargate task definitions; the database services use the EC2 host. Keep the ECS service desired count at one while the app is meant to be live.

```bash
aws ec2 start-instances --instance-ids i-0d9f56cf5a7a6b091 --region ap-southeast-1
aws ec2 wait instance-running --instance-ids i-0d9f56cf5a7a6b091 --region ap-southeast-1

for service in mongodb redis rabbitmq; do
  aws ecs update-service --cluster ErrandBoard --service "$service" --desired-count 1 --region ap-southeast-1 >/dev/null
done
aws ecs wait services-stable --cluster ErrandBoard --services mongodb redis rabbitmq --region ap-southeast-1

for service in credit-service supplier-service user-service order-service; do
  aws ecs update-service --cluster ErrandBoard --service "$service" --desired-count 1 --region ap-southeast-1 >/dev/null
done
aws ecs wait services-stable --cluster ErrandBoard --services credit-service supplier-service user-service order-service --region ap-southeast-1

aws ecs update-service --cluster ErrandBoard --service frontend --desired-count 1 --region ap-southeast-1 >/dev/null
aws ecs wait services-stable --cluster ErrandBoard --services frontend --region ap-southeast-1
```

Check the ALB target group `errandboard-frontend` is healthy. Check the homepage and all four `/api/<service>/health` paths. The self-signed certificate requires an explicit trust decision in a browser; do not mistake a certificate warning for an ECS failure.

## Return to zero compute

Run this when the app is not in use. Wait for all tasks to stop before stopping the EC2 host.

```bash
for service in frontend user-service supplier-service order-service credit-service mongodb redis rabbitmq; do
  aws ecs update-service --cluster ErrandBoard --service "$service" --desired-count 0 --region ap-southeast-1 >/dev/null
done
aws ecs wait services-stable --cluster ErrandBoard --services frontend user-service supplier-service order-service credit-service mongodb redis rabbitmq --region ap-southeast-1
aws ec2 stop-instances --instance-ids i-0d9f56cf5a7a6b091 --region ap-southeast-1
aws ec2 wait instance-stopped --instance-ids i-0d9f56cf5a7a6b091 --region ap-southeast-1
```

## Continuous delivery checkpoint

AWS Organizations policy `p-evk2g3xk` explicitly denied `codeconnections:ListConnections`, so the planned CodePipeline GitHub source connection cannot be used with this account's current permissions. CD is prepared through the repository's existing GitHub Actions CI instead. AWS still hosts all application services and images.

The AWS IAM OIDC provider `token.actions.githubusercontent.com` and role `ErrandBoardGitHubDeployRole` have been created. The role trusts only GitHub Actions runs whose immutable subject is `repo:AY2627S1-CS3219-P4@328997165/ErrandBoard@1369491803:ref:refs/heads/main` and audience is `sts.amazonaws.com`. Its inline policy permits ECR pushes to the five app repositories, ECS task registrations in the five app families, and updates to the five app services. The trust and permission policy files are in `infra/iam/`.

The `deploy` job in `.github/workflows/ci.yml` runs after all six CI jobs pass on a push to `main`. It uses an ARM64 GitHub runner and `scripts/deploy-ecs.sh` to build or reuse each app image, push new images under full-commit-SHA tags to immutable ECR repositories, register new task definition revisions, update the corresponding ECS services, and wait for ECS stability. It does not change desired counts. While the services are parked at zero, this prepares the next live version without starting tasks.

**Activation still required:** Review the existing uncommitted deployment code, Dockerfiles, `.dockerignore`, workflow, script, and IAM files together. Merge them to `main` through the team's normal review process. The current remote `main` does not contain this CD setup or all the deployment code. Check **GitHub repository → Settings → Actions → General** permits GitHub Actions and the AWS action, and check the organization permits `ubuntu-24.04-arm` runners. The first merged push will run the CI and deploy job. Inspect its logs for the five new task definition ARNs. If GitHub organization rules prevent Actions or the ARM runner, an organization owner must enable them.

Do not put AWS access keys or application secrets in GitHub. The job obtains short-lived credentials with OIDC and never reads `pre-prod_env`. Deploying new task revisions at desired count zero is a preparation step; use **Bring the deployment online** above when the application is meant to serve users, then **Return to zero compute** when it is not in use.

AWS and GitHub references: [ECS Service Connect](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect.html), [ECS secrets](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html), [GitHub OIDC with AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws), [GitHub ARM runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [ECS update service](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_UpdateService.html).
