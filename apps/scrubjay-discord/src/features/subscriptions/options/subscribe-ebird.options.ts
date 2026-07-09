import { StringOption } from "necord";

export class SubscribeEBirdOptions {
  @StringOption({
    description: "The region code to subscribe to",
    name: "region",
    required: true,
  })
  region!: string;
}
