FROM 614099836367.dkr.ecr.ap-southeast-1.amazonaws.com/ay2627-cs3219-p4/errandboard/mongodb@sha256:949d53a1e0f0f26c8545a9c589474b0ba3be4ca9209c89713c684078665d78d6

COPY config/db.js /docker-entrypoint-initdb.d/init.js
COPY config/migrations/ /migrations/
COPY config/mongodb/start.sh /mongodb/start.sh
COPY config/mongodb/init-replica-set.js /mongodb/init-replica-set.js

ENTRYPOINT ["/bin/sh", "/mongodb/start.sh"]
