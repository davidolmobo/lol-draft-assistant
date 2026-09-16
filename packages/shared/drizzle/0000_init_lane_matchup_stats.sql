CREATE TABLE IF NOT EXISTS "lane_matchup_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"patch" varchar(16) NOT NULL,
	"lane" varchar(16) NOT NULL,
	"champion_id" integer NOT NULL,
	"opponent_champion_id" integer NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lane_matchup_stats_patch_lane_champion_id_opponent_champion_id_unique" UNIQUE("patch","lane","champion_id","opponent_champion_id")
);
