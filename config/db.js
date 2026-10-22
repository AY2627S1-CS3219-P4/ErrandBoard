// Select database to initialise
db = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE);



/* Microservice role creation */
// User Service
db.createRole({
    role: "user_service_role",
    privileges: [
        { resource: { db: "errandboard", collection: "users" }, actions: ["find", "insert", "update", "remove", "createIndex"] },
        { resource: { db: "errandboard", collection: "sessions" }, actions: ["find", "insert", "update", "remove", "createIndex"] }
    ],
    roles: []
});

// Supplier Service
db.createRole({
    role: "supplier_service_role",
    privileges: [
        { resource: { db: "errandboard", collection: "suppliers" }, actions: ["find", "insert", "update", "remove"] },
        { resource: { db: "errandboard", collection: "items" }, actions: ["find", "insert", "update", "remove"] },
        { resource: { db: "errandboard", collection: "inventory" }, actions: ["find", "insert", "update", "remove"] }
    ],
    roles: []
});

// Order Service
db.createRole({
    role: "order_service_role",
        privileges: [
            { resource: { db: "errandboard", collection: "errands" }, actions: ["find", "insert", "update", "remove"] },
        ],
        roles: []
})
// Credit Service
db.createRole({
    role: "credit_service_role",
    privileges: [
        { resource: { db: "errandboard", collection: "UserCredits" }, actions: ["find", "insert", "update"] },
        { resource: { db: "errandboard", collection: "transactionLog" }, actions: ["find", "insert"] }
    ],
    roles: []
});



/* Microservice db account creation */
// User Service
db.createUser({
    user: "user_service",
    pwd: process.env.MONGO_USER_SERVICE_PASSWORD,
    roles: [
        {
            role: "user_service_role",
            db: process.env.MONGO_INITDB_DATABASE
        }
    ]
});

// Supplier Service
db.createUser({
    user: "supplier_service",
    pwd: process.env.MONGO_SUPPLIER_SERVICE_PASSWORD,
    roles: [
        {
            role: "supplier_service_role",
            db: process.env.MONGO_INITDB_DATABASE
        }
    ]
});

// Order Service
db.createUser({
    user: "order_service",
    pwd: process.env.MONGO_ORDER_SERVICE_PASSWORD,
    roles: [
        {
            role: "order_service_role",
            db: process.env.MONGO_INITDB_DATABASE
        }
    ]
});

// Credit Service
db.createUser({
    user: "credit_service",
    pwd: process.env.MONGO_CREDIT_SERVICE_PASSWORD,
    roles: [
        {
            role: "credit_service_role",
            db: process.env.MONGO_INITDB_DATABASE
        }
    ]
});

/* Collection creation */

// Supplier Service
db.createCollection("suppliers")
db.suppliers.createIndex( { name: 1, building: 1}, { unique: true })

// Order serivce
db.createCollection("errands");
db.errands.createIndex({ status: 1, expiresAt: 1});
db.errands.createIndex({ status: 1, confirmBy: 1});
db.errands.createIndex({ status: 1, deliverBy: 1});
db.errands.createIndex({ requesterId: 1, status: 1});
db.errands.createIndex({ courierId: 1, status: 1});
db.errands.createIndex({ createdAt: -1});
db.errands.createIndex({ eventPending: 1 }, { partialFilterExpression: { eventPending: true } });


// Credit Service
db.createCollection("UserCredits");
db.UserCredits.createIndex({ userId: 1 }, { unique: true });
db.createCollection("transactionLog");
db.transactionLog.createIndex({ orderId: 1, transactionType: 1 }, { unique: true });
