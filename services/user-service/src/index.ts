import { app } from "./app.js";
import { logger } from "./logger.js";
import { connectDb, disconnectDb } from "./db.js";
import { authorizationStore } from "./security/authorization-state.js";
import { startCreditProvisioningWorker } from "./services/credit-provisioning.service.js";
import { startCognitoConfirmationWorker } from "./services/cognito-confirmation.queue.js";

const port = Number(process.env.PORT ?? 3001);

async function main(): Promise<void> {
    await connectDb();
    await authorizationStore.connect();
    await authorizationStore.bootstrap();
    const stopCreditProvisioningWorker = startCreditProvisioningWorker();
    const stopCognitoConfirmationWorker = startCognitoConfirmationWorker();

    const server = app.listen(port, "0.0.0.0", () => {
        logger.info({ port }, "User service listening");
    });

    const shutdown = async () => {
        server.close(async () => {
            await stopCreditProvisioningWorker();
            await stopCognitoConfirmationWorker();
            await disconnectDb();
            await authorizationStore.close();
            process.exitCode = 0;
        });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

main().catch(async (error) => {
    logger.error({ err: error }, "User Service failed to start");
    await disconnectDb();
    await authorizationStore.close();
    process.exitCode = 1;
});
