// Select database to initialise
db = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE);



/* Microservice role creation */
// User Service
db.createRole({
    role: "user_service_role",
    privileges: [
        { resource: { db: "errandboard", collection: "users" }, actions: ["find", "insert", "update", "remove"] },
        { resource: { db: "errandboard", collection: "sessions" }, actions: ["find", "insert", "update", "remove"] }
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

// Credit Service



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

// Credit Service
