import { settings } from "../config/settings.js";
import { connectRabbit } from "./rabbit.publisher.js";
import type { EventPublisher } from "./types.js";

let current: EventPublisher | undefined;

export function getEventPublisher(): EventPublisher {
  if (!current) {
    current = connectRabbit(settings.rabbitmqUrl);
  }
  return current;
}
//prob no need for this since get already sets?
/*
export function setEventPublisher(publisher: EventPublisher | undefined): void {
  current = publisher;
}*/

export async function closeEventPublisher(): Promise<void> {
  const publisher = current;
  current = undefined;
  await publisher?.close();
}