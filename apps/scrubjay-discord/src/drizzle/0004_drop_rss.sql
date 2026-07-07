DROP TABLE "channel_rss_subscriptions" CASCADE;--> statement-breakpoint
DROP TABLE "rss_items" CASCADE;--> statement-breakpoint
DROP TABLE "rss_sources" CASCADE;
--> statement-breakpoint
DELETE FROM "deliveries" WHERE "alert_kind" = 'rss';