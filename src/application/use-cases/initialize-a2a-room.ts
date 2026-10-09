import type { A2ARuntimeAdminPort } from "../ports/a2a-runtime.js";

type A2ARoomInitializationPort = Pick<A2ARuntimeAdminPort, "listRooms" | "createRoom" | "discoverSessions">;

/** Ensure the configured A2A room exists and discover its provider sessions at startup. */
export class InitializeA2ARoom {
  constructor(
    private readonly runtime: A2ARoomInitializationPort,
    private readonly runtimeReady: Promise<void>,
  ) {}

  async execute(roomId: string, roomName: string): Promise<void> {
    await this.runtimeReady;
    const exists = this.runtime.listRooms().some((room) => room.roomId === roomId);
    if (!exists) await this.runtime.createRoom(roomId, roomName);
    await this.runtime.discoverSessions(roomId);
  }
}
