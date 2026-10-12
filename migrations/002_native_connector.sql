CREATE TABLE plugin_paperclip_cost_estimates_5379273a75.valuations (
 source_id uuid PRIMARY KEY,
 company_id uuid NOT NULL,
 billing_code text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'prepared',
 cost_cents integer NOT NULL,
 payload jsonb NOT NULL,
 pricing_sha256 text NOT NULL,
 native_id uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
