import amqp, { ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel } from "amqplib";
import { EXCHANGE_NAME, type ErrandEvent, type EventPublisher } from "./types.js";


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
        await this.channel.publish(EXCHANGE_NAME, event.type, Buffer.from(JSON.stringify(event)), {
            persistent: true,
            mandatory: true,
            messageId: event.eventId,
            contentType: "application/json",
        });

        if (this.returnMessages.delete(event.eventId)) {
            throw new Error(`message for ${event.type} failed to deliver`);
        }
    }

    async close(): Promise<void> {
        await this.closeConnection();
    }
}


export function connectRabbit(url: string): RabbitPublisher {
    const returnMessages = new Set<string>();
    const connection = amqp.connect([url]);

    //on connection call the function specified in setup
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
