# ErrandBoard CloudFront rollout and rollback

This records the parallel HTTPS entry point added on 10 November 2026 in AWS account `614099836367`. The existing public ALB and its self-signed certificate are retained as a rollback path. The application remains on the same ECS services and data host.

## Traffic path

Viewer HTTPS → CloudFront default `cloudfront.net` hostname → CloudFront VPC origin → internal ALB HTTP:80 → frontend ECS task HTTP:80 → Nginx `/api/...` proxies → backend ECS services. The CloudFront-to-ALB leg is HTTP inside the VPC. The old path remains viewer HTTPS → public ALB `errandboard` → the same frontend task.

## Resources and behavior

- Existing public ALB: `errandboard`, with target group `errandboard-frontend`. Its listeners, self-signed certificate, and target group remain attached.
- Private ALB: `errandboard-cloudfront` in private subnets `subnet-03b454bca3b27e7d1` and `subnet-0ba162b50106575dc`; HTTP:80 listener forwards to IP target group `errandboard-cloudfront-frontend`, which checks `GET /`.
- The ECS `frontend` service attaches to **both** target groups. Its desired count remains zero when the website is down.
- Private ALB security group `sg-0f3270d5eef74cee0` accepts TCP:80 only from the CloudFront managed VPC-origin group `sg-0cab3ee32f14b63f8` and sends TCP:80 only to app group `sg-05271866f3007008f`. The app group permits TCP:80 from the private ALB group.
- VPC origin: `vo_7mbK9wlYKZPCDnrjkC6KSV`, HTTP-only, pointing to the private ALB.
- CloudFront distribution: `E37CN0CRW4KS9C`, URL `https://da843292oau9i.cloudfront.net`. Confirm that its status is `Deployed` and complete the live checks below before sharing the URL as the primary entry point.
- CloudFront redirects HTTP viewers to HTTPS and uses its default trusted certificate. `/api/*` and the default behavior disable caching and forward viewer headers, cookies, and query strings. `/assets/*` uses managed optimized caching for build assets. The managed security headers policy applies to all behaviors.
- WAF web ACL `errandboard-cloudfront-rate-limit` blocks an individual source IP after 2,000 requests in five minutes. It is attached only to CloudFront. If this affects legitimate shared-network users, adjust the threshold after reviewing WAF sampled requests.

## Start, stop, and verification

Use `./scripts/website.sh up` and `./scripts/website.sh down`, or the **Website controls** GitHub Actions workflow. These commands control ECS tasks and the database EC2 host; CloudFront, both ALBs, WAF, NAT, and storage remain provisioned and can incur charges while tasks are off.

After starting the site, check both frontend target groups are healthy. Test the CloudFront URL for the homepage and `/api/user/health`, `/api/supplier/health`, `/api/order/health`, `/api/credit/health`, and `/api/notification/health`; then check login, session refresh, an authenticated credit-balance event stream, and push subscription on a supported device. Test the old ALB URL as a separate rollback check. Browser cookies, storage, and push subscriptions are hostname-specific, so users must sign in and subscribe again at the new hostname.

## Rollback

Direct users to `https://errandboard-1396600328.ap-southeast-1.elb.amazonaws.com`. It still serves the same ECS frontend through its original target group, and browsers will again warn about its self-signed certificate. Do not remove the public ALB or original frontend target group during initial rollout. CloudFront may remain enabled but unused while investigating a problem. If a CloudFront confirmation link has been emailed, keep the distribution available until that link expires.

For a full configuration rollback, remove the second target-group attachment from the ECS frontend service after confirming the public target group remains, then disable/delete CloudFront and its VPC origin, WAF web ACL, private ALB, target group, and associated security-group rules in dependency order. This is unnecessary for an immediate traffic rollback.
