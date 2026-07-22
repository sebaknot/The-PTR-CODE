CREATE TABLE IF NOT EXISTS "porter_boxes" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "address" text NOT NULL,
  "lat" real NOT NULL,
  "lng" real NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "delivery_type" text DEFAULT 'standard' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "porter_box_id" text REFERENCES porter_boxes(id);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "pickup_code" text;
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "package_photo_url" text;
