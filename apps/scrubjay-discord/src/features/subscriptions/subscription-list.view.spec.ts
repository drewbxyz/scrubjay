import type {
  APIButtonComponentWithCustomId,
  APIStringSelectComponent,
} from "discord.js";
import {
  buildSubscriptionListView,
  PAGE_SIZE,
  type SubscriptionRow,
} from "./subscription-list.view";

function countySub(countyCode: string): SubscriptionRow {
  const stateCode = countyCode.split("-").slice(0, 2).join("-");
  return { countyCode, stateCode };
}

function stateSub(stateCode: string): SubscriptionRow {
  return { countyCode: "*", stateCode };
}

function manyCountySubs(count: number): SubscriptionRow[] {
  return Array.from({ length: count }, (_, i) =>
    countySub(`US-MA-${String(i).padStart(3, "0")}`),
  );
}

type JSONEncodable<T> = { toJSON(): T };

function rowComponents(
  view: ReturnType<typeof buildSubscriptionListView>,
): Array<{ type: number }> {
  const rows = (view.components ?? []) as unknown as JSONEncodable<{
    components: Array<{ type: number }>;
  }>[];
  return rows.flatMap((row) => row.toJSON().components);
}

function selectMenu(
  view: ReturnType<typeof buildSubscriptionListView>,
): APIStringSelectComponent {
  const menu = rowComponents(view).find((c) => c.type === 3);
  if (!menu) throw new Error("no select menu in view");
  return menu as APIStringSelectComponent;
}

function buttons(
  view: ReturnType<typeof buildSubscriptionListView>,
): APIButtonComponentWithCustomId[] {
  return rowComponents(view).filter(
    (c) => c.type === 2,
  ) as APIButtonComponentWithCustomId[];
}

function embedDescription(
  view: ReturnType<typeof buildSubscriptionListView>,
): string {
  const embed = (view.embeds ?? [])[0] as unknown as JSONEncodable<{
    description?: string;
  }>;
  return embed.toJSON().description ?? "";
}

describe("buildSubscriptionListView", () => {
  it("renders an empty state with no components when there are no subscriptions", () => {
    const view = buildSubscriptionListView([], 0);

    expect(view.components).toEqual([]);
    expect(embedDescription(view)).toMatch(/no subscriptions/i);
  });

  it("shows every subscription and omits the nav buttons when they fit on one page", () => {
    const subs = manyCountySubs(PAGE_SIZE);

    const view = buildSubscriptionListView(subs, 0);

    expect(selectMenu(view).options).toHaveLength(PAGE_SIZE);
    // A single page needs no pagination — and rendering two clamped nav buttons
    // would give them a duplicate custom_id, which Discord rejects.
    expect(buttons(view)).toHaveLength(0);
  });

  it("slices to the requested page", () => {
    const subs = manyCountySubs(PAGE_SIZE * 2 + 3);

    const view = buildSubscriptionListView(subs, 1);

    const values = selectMenu(view).options.map((o) => o.value);
    expect(values).toHaveLength(PAGE_SIZE);
    expect(values[0]).toBe(subs[PAGE_SIZE].countyCode);
  });

  it("clamps a page past the end to the last valid page", () => {
    const subs = manyCountySubs(PAGE_SIZE + 3); // 2 pages

    const view = buildSubscriptionListView(subs, 99);

    // last page holds the remaining 3
    expect(selectMenu(view).options).toHaveLength(3);
    const [prev, next] = buttons(view);
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(true);
  });

  it("encodes state and county in the option value and carries the page in custom ids", () => {
    const subs = [countySub("US-MA-017"), stateSub("US-VT")];

    const view = buildSubscriptionListView(subs, 0);

    const menu = selectMenu(view);
    // county sub → county code; state-wide sub ('*') → state code
    expect(menu.options.map((o) => o.value)).toEqual(["US-MA-017", "US-VT"]);
    expect(menu.custom_id).toBe("subscription/list/remove/0");
  });

  it("enables both nav buttons on an interior page and points them at the neighbours", () => {
    const subs = manyCountySubs(PAGE_SIZE * 3);

    const view = buildSubscriptionListView(subs, 1);

    const [prev, next] = buttons(view);
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    expect(prev.custom_id).toBe("subscription/list/nav/0");
    expect(next.custom_id).toBe("subscription/list/nav/2");
    expect(selectMenu(view).custom_id).toBe("subscription/list/remove/1");
  });
});
