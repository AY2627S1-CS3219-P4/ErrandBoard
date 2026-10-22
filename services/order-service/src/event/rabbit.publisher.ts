import amqp, { ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel } from "amqplib";
import { EXCHANGE_NAME, type ErrandEvent, type EventPublisher } from "./types.js";

export class PublishError extends Error {}
export class UnroutableError extends PublishError {}

export class RabbitPublisher implements EventPublisher {
    constructor(
        private readonly channel: ChannelWrapper,
        private readonly connected: () => boolean,
        private readonly closeConnection: () => Promise<void>,

        // messageIds the broker handed back as unroutable
        private readonly returnMessages: Set<string> = new Set(),
    ) {} 

    isReady(): boolean {
        return this.connected();
    }

    async publish(event: ErrandEvent): Promise<void> {
        const { eventId, type } = event.value;
        this.returnMessages.delete(eventId); //clear stale state from previous attempts jic
        try {
            await this.channel.publish(EXCHANGE_NAME, type, Buffer.from(JSON.stringify(event)), {
                persistent: true,
                mandatory: true,
                messageId: eventId,
                contentType: "application/json",
                timeout: 5_000,
            });
        } catch(err) {
            this.returnMessages.delete(eventId);
            throw new PublishError(`publish of ${type} (${eventId}) failed`, { cause: err });
        }

        if (this.returnMessages.delete(eventId)) {
            throw new Error(`${type} (${eventId}) was unroutable: no queue bound`);
        }
    }

    async close(): Promise<void> {
        await this.closeConnection();
    }
}


export function connectRabbit(url: string): RabbitPublisher {
    console.log("starting publisher")
    const returnMessages = new Set<string>();
    const connection = amqp.connect([url]);

    connection.on("connect", () => console.log("RabbitMQ connected"));
    connection.on("connectFailed", ({ err }) => console.error("RabbitMQ connect failed:", err.message));
    connection.on("disconnect", ({ err }) => console.error("RabbitMQ disconnected:", err?.message));
    
    //setup function uses the ConfirmChannel interface to verify 
    const channel = connection.createChannel({
    json: false,
    setup: async (ch: ConfirmChannel) => {
            ch.on("return", (message) => {
                const id = message.properties.messageId;
                if (typeof id === "string") returnMessages.add(id);
            });
            await ch.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
        },
    });

    return new RabbitPublisher(
        channel,
        () => connection.isConnected(),
        async () => {
            await channel.close();
            await connection.close();
        },
        returnMessages,
    );
}
