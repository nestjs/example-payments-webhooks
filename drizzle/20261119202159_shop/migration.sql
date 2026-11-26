CREATE TABLE "cart_items" (
	"user_id" uuid,
	"product_id" uuid,
	"quantity" integer NOT NULL,
	CONSTRAINT "cart_items_pkey" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"order_id" uuid,
	"product_id" uuid,
	"name" text NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "order_items_pkey" PRIMARY KEY("order_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"description" text NOT NULL,
	"price" integer NOT NULL,
	"stock" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_price_positive" CHECK ("price" > 0),
	CONSTRAINT "products_stock_not_negative" CHECK ("stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"family_expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"claims" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'customer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "orders_user_id_created_at_idx" ON "orders" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_expires_at_idx" ON "refresh_tokens" ("family_expires_at");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");