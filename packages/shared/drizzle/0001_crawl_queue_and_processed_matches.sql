CREATE TABLE IF NOT EXISTS "crawl_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"puuid" varchar(100) NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "crawl_queue_puuid_unique" UNIQUE("puuid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_matches" (
	"match_id" varchar(32) PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_queue_pending_idx" ON "crawl_queue" USING btree ("processed_at");