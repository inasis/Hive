import type { OpenCodeApiVersion } from "./api.js";
import type { OpenCodeHttpClient } from "./http-client.js";
import { parseOpenCodeCommands, parseOpenCodeSkills } from "./resource-catalog-mapper.js";
import type { OpenCodeCommand, OpenCodeSkill } from "./types.js";

/** Lists versioned OpenCode skill and slash command catalogs. */
export class OpenCodeResourceApi {
  constructor(
    private readonly http: OpenCodeHttpClient,
    private readonly apiVersion: OpenCodeApiVersion,
  ) {}

  async listSkills(directory?: string): Promise<OpenCodeSkill[]> {
    const value = await this.http.request(
      this.apiVersion === "v2" ? "/api/skill" : "/skill",
      directory ? (this.apiVersion === "v2" ? { locationDirectory: directory } : { directory }) : undefined,
    );
    return parseOpenCodeSkills(value, this.apiVersion);
  }

  async listCommands(directory?: string): Promise<OpenCodeCommand[]> {
    const value = await this.http.request(
      this.apiVersion === "v2" ? "/api/command" : "/command",
      directory ? (this.apiVersion === "v2" ? { locationDirectory: directory } : { directory }) : undefined,
    );
    return parseOpenCodeCommands(value, this.apiVersion);
  }
}
