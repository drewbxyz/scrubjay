import type { Client } from "discord.js";
import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";
import { GuildsService } from "./guilds.service";

type FakeChannel = {
  id: string;
  name: string;
  type: ChannelType;
  permissionsFor: (member: unknown) => { has: (perms: bigint[]) => boolean };
};

function fakeChannel(
  id: string,
  name: string,
  opts: { sendable?: boolean; type?: ChannelType } = {},
): FakeChannel {
  return {
    id,
    name,
    permissionsFor: () => ({ has: () => opts.sendable ?? true }),
    type: opts.type ?? ChannelType.GuildText,
  };
}

function fakeClient(
  guilds: Array<{
    channels: FakeChannel[];
    id: string;
    name: string;
  }>,
): Client {
  return {
    guilds: {
      cache: new Map(
        guilds.map((g) => [
          g.id,
          {
            channels: {
              fetch: async () => new Map(g.channels.map((c) => [c.id, c])),
            },
            id: g.id,
            members: { me: {} },
            name: g.name,
          },
        ]),
      ),
    },
  } as unknown as Client;
}

describe("GuildsService", () => {
  it("lists text channels the bot can post in, sorted by name", async () => {
    const client = fakeClient([
      {
        channels: [
          fakeChannel("2", "zebra-birds"),
          fakeChannel("3", "alpha-birds"),
          fakeChannel("4", "no-perms", { sendable: false }),
          fakeChannel("5", "a-voice", { type: ChannelType.GuildVoice }),
        ],
        id: "1",
        name: "Guild",
      },
    ]);
    const result = await new GuildsService(client).listGuilds();
    expect(result.guilds[0]?.channels.map((c) => c.name)).toEqual([
      "alpha-birds",
      "zebra-birds",
    ]);
  });

  it("sorts guilds by name", async () => {
    const client = fakeClient([
      { channels: [], id: "1", name: "Zeta" },
      { channels: [], id: "2", name: "Alpha" },
    ]);
    const result = await new GuildsService(client).listGuilds();
    expect(result.guilds.map((g) => g.name)).toEqual(["Alpha", "Zeta"]);
  });
});
