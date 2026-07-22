ALTER TABLE "users" ALTER COLUMN "device_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "first_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "apple_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_email_unique'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_google_id_unique'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_google_id_unique" UNIQUE("google_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_apple_id_unique'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_apple_id_unique" UNIQUE("apple_id");
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "otp_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "target" text NOT NULL,
  "type" text NOT NULL,
  "code" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
