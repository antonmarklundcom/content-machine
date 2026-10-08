CREATE TABLE "spend_reservation" (
	"id" integer PRIMARY KEY NOT NULL,
	"reserved_usd" numeric(10, 6) DEFAULT '0' NOT NULL
);
