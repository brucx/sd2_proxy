CREATE TABLE "balance_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"description" varchar(500) DEFAULT '' NOT NULL,
	"operator_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_whitelist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"ip_address" varchar(45) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"api_key" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "keys_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"key_id" integer NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"method" varchar(10) DEFAULT 'POST' NOT NULL,
	"request_body" text,
	"response_body" text,
	"response_status" integer,
	"duration_ms" integer,
	"ip_address" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"key_id" integer NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"task_id" varchar(255),
	"completion_tokens" integer DEFAULT 0,
	"has_video_input" boolean DEFAULT false NOT NULL,
	"cost_yuan" text DEFAULT '0' NOT NULL,
	"status" varchar(50) DEFAULT 'pending',
	"result_data" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(50) DEFAULT 'tenant' NOT NULL,
	"concurrency_limit" integer DEFAULT 3 NOT NULL,
	"balance" numeric(20, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "balance_audit" ADD CONSTRAINT "balance_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_audit" ADD CONSTRAINT "balance_audit_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_whitelist" ADD CONSTRAINT "ip_whitelist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keys" ADD CONSTRAINT "keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_audit_user_id_idx" ON "balance_audit" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ip_whitelist_user_id_idx" ON "ip_whitelist" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "keys_user_id_idx" ON "keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "request_logs_user_id_idx" ON "request_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "request_logs_created_at_idx" ON "request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_user_id_idx" ON "usage_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_logs_status_idx" ON "usage_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usage_logs_task_id_idx" ON "usage_logs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "usage_logs_created_at_idx" ON "usage_logs" USING btree ("created_at");