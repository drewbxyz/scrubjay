import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { timezones } from "@/core/timezones";

export const locations = pgTable(
  "locations",
  {
    county: text("county").notNull(),
    countyCode: text("county_code").notNull(),
    id: text("id").primaryKey(),
    isPrivate: boolean("is_private").notNull(),
    lastUpdated: timestamp("last_updated")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    name: text("name").notNull(),
    state: text("state").notNull(),
    stateCode: text("state_code").notNull(),
  },
  (table) => [
    index("county_state_code_idx").on(table.countyCode, table.stateCode),
  ],
);

export const observations = pgTable(
  "observations",
  {
    audioCount: integer("audio_count").notNull().default(0),
    comName: text("common_name").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    hasComments: boolean("has_comments").notNull(),
    howMany: integer("how_many").notNull(),
    lastUpdated: timestamp("last_updated")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    locId: text("location_id")
      .references(() => locations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      })
      .notNull(),
    obsDt: timestamp("observation_date").notNull(),
    obsReviewed: boolean("observation_reviewed").notNull(),
    obsValid: boolean("observation_valid").notNull(),
    photoCount: integer("photo_count").notNull().default(0),
    presenceNoted: boolean("presence_noted").notNull(),
    sciName: text("scientific_name").notNull(),
    speciesCode: text("species_code").notNull(),
    subId: text("sub_id").notNull(),
    videoCount: integer("video_count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.speciesCode, t.subId] }),
    index("obs_created_at_idx").on(t.createdAt),
    index("obs_location_date_idx").on(t.locId, t.obsDt),
    index("obs_review_valid_date_idx").on(t.obsReviewed, t.obsValid, t.obsDt),
    index("obs_species_location_date_idx").on(t.speciesCode, t.locId, t.obsDt),
  ],
);

export const channelEBirdSubscriptions = pgTable(
  "channel_ebird_subscriptions",
  {
    active: boolean("active").notNull().default(true),
    channelId: text("channel_id").notNull(),
    countyCode: text("county_code").notNull(), // '*' means subscribe to all counties in state
    lastUpdated: timestamp("last_updated")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    stateCode: text("state_code").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.stateCode, t.countyCode] }),
    index("state_county_idx").on(t.stateCode, t.countyCode),
    index("active_state_county_idx").on(t.active, t.stateCode, t.countyCode),
  ],
);

export const filteredSpecies = pgTable(
  "filtered_species",
  {
    channelId: text("channel_id").notNull(),
    commonName: text("common_name").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.commonName, t.channelId] }),
    index("common_name_channel_id_idx").on(t.commonName, t.channelId),
  ],
);

export const countyTimezones = pgTable(
  "county_timezones",
  {
    countyCode: text("county_code").primaryKey(),
    timezone: text("timezone", { enum: timezones })
      .notNull()
      .default("America/Los_Angeles"),
  },
  (t) => [index("county_code_idx").on(t.countyCode)],
);

export const deliveryStatuses = [
  "sent",
  "failed",
  "expired",
  "suppressed",
] as const;
export type DeliveryStatus = (typeof deliveryStatuses)[number];

export const deliveries = pgTable(
  "deliveries",
  {
    alertId: text("alert_id").notNull(),
    channelId: text("channel_id").notNull(),
    // Discord error code/message for 'failed' rows; null otherwise.
    detail: text("detail"),
    id: serial("id").primaryKey(),
    kind: text("alert_kind").notNull(), // 'ebird' (rss existed historically; rows purged in 0004)
    sentAt: timestamp("sent_at").defaultNow(),
    status: text("status", { enum: deliveryStatuses })
      .notNull()
      .default("sent"),
  },
  (t) => [
    uniqueIndex("deliveries_unique_idx").on(t.kind, t.alertId, t.channelId),
    index("deliveries_channel_idx").on(t.channelId),
    check(
      "deliveries_status_check",
      sql`${t.status} in ('sent', 'failed', 'expired', 'suppressed')`,
    ),
  ],
);

export const locationsRelations = relations(locations, ({ many }) => ({
  observations: many(observations),
}));

export const observationsRelations = relations(observations, ({ one }) => ({
  location: one(locations, {
    fields: [observations.locId],
    references: [locations.id],
  }),
}));
