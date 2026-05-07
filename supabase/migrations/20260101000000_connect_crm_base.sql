


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."claim_daily_send_budget"("p_date" "date", "p_max" integer, "p_requested" integer) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_current integer := 0;
  v_granted integer := 0;
BEGIN
  -- Ensure a row exists for today (no-op if already exists)
  INSERT INTO email_send_log (send_date, emails_sent, updated_at)
  VALUES (p_date, 0, now())
  ON CONFLICT (send_date) DO NOTHING;

  -- Lock the row, read current count (FOR UPDATE serializes concurrent calls)
  SELECT emails_sent INTO v_current
  FROM email_send_log
  WHERE send_date = p_date
  FOR UPDATE;

  -- Compute how many slots we can actually grant
  v_granted := LEAST(p_requested, GREATEST(0, p_max - v_current));

  -- Only write if we're granting something
  IF v_granted > 0 THEN
    UPDATE email_send_log
    SET emails_sent = v_current + v_granted,
        updated_at  = now()
    WHERE send_date = p_date;
  END IF;

  RETURN v_granted;
END;
$$;


ALTER FUNCTION "public"."claim_daily_send_budget"("p_date" "date", "p_max" integer, "p_requested" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'employee')
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_call_count"("lead_ids" "uuid"[], "amount" integer DEFAULT 1) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE leads SET call_count = call_count + amount WHERE id = ANY(lead_ids);
END;
$$;


ALTER FUNCTION "public"."increment_call_count"("lead_ids" "uuid"[], "amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_email_count"("lead_ids" "uuid"[], "amount" integer DEFAULT 1) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE leads SET email_count = email_count + amount WHERE id = ANY(lead_ids);
END;
$$;


ALTER FUNCTION "public"."increment_email_count"("lead_ids" "uuid"[], "amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$                                                                                                                      
  BEGIN                                                                                                                                  
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "activities_type_check" CHECK (("type" = ANY (ARRAY['call'::"text", 'email_sent'::"text", 'email_received'::"text", 'note'::"text", 'status_change'::"text", 'meeting'::"text"])))
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_suggestions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "suggestion" "text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "dismissed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_suggestions_priority_check" CHECK (("priority" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"])))
);


ALTER TABLE "public"."ai_suggestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "key_preview" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."apollo_usage" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "credits_used" integer DEFAULT 0 NOT NULL,
    "search_count" integer DEFAULT 0 NOT NULL,
    "enrichment_count" integer DEFAULT 0 NOT NULL,
    "results_returned" integer DEFAULT 0 NOT NULL,
    "prompt" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."apollo_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_enrollments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "lead_id" "uuid",
    "email" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "sent_at" timestamp with time zone,
    "next_send_at" timestamp with time zone,
    "current_step" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ab_variant" "text",
    CONSTRAINT "campaign_enrollments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'opened'::"text", 'replied'::"text", 'bounced'::"text", 'unsubscribed'::"text"])))
);


ALTER TABLE "public"."campaign_enrollments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_sequences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."campaign_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sequence_id" "uuid" NOT NULL,
    "step_order" integer DEFAULT 0 NOT NULL,
    "delay_days" integer DEFAULT 0 NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "variant_b_subject" "text",
    "variant_b_body" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."campaign_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."campaign_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "recipient_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "scheduled_at" timestamp with time zone,
    "drip_config" "jsonb",
    "variant_b_subject" "text",
    "variant_b_body" "text",
    "ab_test_enabled" boolean DEFAULT false NOT NULL,
    "sequence_id" "uuid",
    "smart_send" boolean DEFAULT false NOT NULL,
    "daily_send_limit" integer DEFAULT 20,
    "send_spacing" boolean DEFAULT false
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deals" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "value" numeric(12,2) DEFAULT 0 NOT NULL,
    "stage" "text" DEFAULT 'new'::"text" NOT NULL,
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "deals_stage_check" CHECK (("stage" = ANY (ARRAY['new'::"text", 'contacted'::"text", 'qualified'::"text", 'proposal'::"text", 'negotiation'::"text", 'closed_won'::"text", 'closed_lost'::"text"])))
);


ALTER TABLE "public"."deals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email_id" "uuid" NOT NULL,
    "filename" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "storage_path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_send_log" (
    "send_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "emails_sent" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."email_send_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_sequences" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."emails" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "lead_id" "uuid",
    "from" "text" NOT NULL,
    "to" "text" NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read" boolean DEFAULT false NOT NULL,
    "direction" "text" NOT NULL,
    "thread_id" "text",
    "reply_to_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "provider_message_id" "text",
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "bounced_at" timestamp with time zone,
    "campaign_id" "uuid",
    "user_id" "uuid",
    CONSTRAINT "emails_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"])))
);


ALTER TABLE "public"."emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" DEFAULT 'employee'::"text" NOT NULL,
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invites_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'employee'::"text"])))
);


ALTER TABLE "public"."invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_search_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "prompt" "text" NOT NULL,
    "leads" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "filters" "jsonb",
    "total_found" integer DEFAULT 0 NOT NULL,
    "credits_used" integer DEFAULT 0 NOT NULL,
    "imported" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_search_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text" DEFAULT ''::"text" NOT NULL,
    "job_title" "text" DEFAULT ''::"text" NOT NULL,
    "company" "text" DEFAULT ''::"text" NOT NULL,
    "company_size" "text" DEFAULT ''::"text" NOT NULL,
    "industry" "text" DEFAULT ''::"text" NOT NULL,
    "location" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'cold'::"text" NOT NULL,
    "assigned_to" "uuid",
    "last_contacted_at" timestamp with time zone,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "linkedin_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "email_status" "text" DEFAULT 'unverified'::"text" NOT NULL,
    "timezone" "text",
    "apollo_id" "text",
    "call_count" integer DEFAULT 0 NOT NULL,
    "email_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "leads_status_check" CHECK (("status" = ANY (ARRAY['cold'::"text", 'lukewarm'::"text", 'warm'::"text", 'dead'::"text"])))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phone_reveals" (
    "apollo_id" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "raw_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."phone_reveals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'employee'::"text" NOT NULL,
    "avatar" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email_prefix" "text",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'employee'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "goal" "text",
    "outcomes" "text",
    "notes" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sequence_steps" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "sequence_id" "uuid" NOT NULL,
    "order" integer NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "delay_days" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sequence_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "source" "text" NOT NULL,
    "message" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "system_alerts_type_check" CHECK (("type" = ANY (ARRAY['error'::"text", 'warning'::"text"])))
);


ALTER TABLE "public"."system_alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."todo_activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "todo_id" "uuid" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "todo_activity_action_type_check" CHECK (("action_type" = ANY (ARRAY['created'::"text", 'assigned'::"text", 'reassigned'::"text", 'completed'::"text", 'reopened'::"text", 'commented'::"text", 'pinned'::"text", 'unpinned'::"text", 'priority_changed'::"text", 'edited'::"text"])))
);


ALTER TABLE "public"."todo_activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."todo_columns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."todo_columns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."todo_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "todo_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."todo_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."todos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text",
    "details" "text",
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "due_date" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "assigned_to" "uuid",
    "created_by" "uuid" NOT NULL,
    "project_id" "uuid",
    "is_pinned" boolean DEFAULT false NOT NULL,
    "is_recurring" boolean DEFAULT false NOT NULL,
    "recurrence_pattern" "text",
    "parent_todo_id" "uuid",
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "todos_priority_check" CHECK (("priority" = ANY (ARRAY['urgent'::"text", 'normal'::"text", 'low'::"text"]))),
    CONSTRAINT "todos_recurrence_pattern_check" CHECK (("recurrence_pattern" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'monthly'::"text"]))),
    CONSTRAINT "todos_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."todos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unsubscribes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid",
    "email" "text" NOT NULL,
    "token" "text" NOT NULL,
    "unsubscribed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."unsubscribes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."warmup_state" (
    "id" "text" DEFAULT 'default'::"text" NOT NULL,
    "first_email_at" timestamp with time zone,
    "reset_at" timestamp with time zone,
    "reset_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."warmup_state" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_suggestions"
    ADD CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_key_hash_key" UNIQUE ("key_hash");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."apollo_usage"
    ADD CONSTRAINT "apollo_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_enrollments"
    ADD CONSTRAINT "campaign_enrollments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_sequences"
    ADD CONSTRAINT "campaign_sequences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_steps"
    ADD CONSTRAINT "campaign_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_templates"
    ADD CONSTRAINT "campaign_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_attachments"
    ADD CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_send_log"
    ADD CONSTRAINT "email_send_log_pkey" PRIMARY KEY ("send_date");



ALTER TABLE ONLY "public"."email_sequences"
    ADD CONSTRAINT "email_sequences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."lead_search_history"
    ADD CONSTRAINT "lead_search_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phone_reveals"
    ADD CONSTRAINT "phone_reveals_pkey" PRIMARY KEY ("apollo_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sequence_steps"
    ADD CONSTRAINT "sequence_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_alerts"
    ADD CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."todo_activity"
    ADD CONSTRAINT "todo_activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."todo_columns"
    ADD CONSTRAINT "todo_columns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."todo_columns"
    ADD CONSTRAINT "todo_columns_user_id_profile_id_key" UNIQUE ("user_id", "profile_id");



ALTER TABLE ONLY "public"."todo_comments"
    ADD CONSTRAINT "todo_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unsubscribes"
    ADD CONSTRAINT "unsubscribes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unsubscribes"
    ADD CONSTRAINT "unsubscribes_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."warmup_state"
    ADD CONSTRAINT "warmup_state_pkey" PRIMARY KEY ("id");



CREATE INDEX "campaign_enrollments_campaign_id_idx" ON "public"."campaign_enrollments" USING "btree" ("campaign_id");



CREATE INDEX "campaign_enrollments_next_send_at_idx" ON "public"."campaign_enrollments" USING "btree" ("next_send_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "campaign_enrollments_status_idx" ON "public"."campaign_enrollments" USING "btree" ("status");



CREATE INDEX "idx_activities_lead_id" ON "public"."activities" USING "btree" ("lead_id");



CREATE INDEX "idx_activities_type" ON "public"."activities" USING "btree" ("type");



CREATE INDEX "idx_activities_user_id" ON "public"."activities" USING "btree" ("user_id");



CREATE INDEX "idx_ai_suggestions_dismissed" ON "public"."ai_suggestions" USING "btree" ("dismissed") WHERE ("dismissed" = false);



CREATE INDEX "idx_ai_suggestions_lead_id" ON "public"."ai_suggestions" USING "btree" ("lead_id");



CREATE INDEX "idx_apollo_usage_created_at" ON "public"."apollo_usage" USING "btree" ("created_at");



CREATE INDEX "idx_apollo_usage_user_created" ON "public"."apollo_usage" USING "btree" ("user_id", "created_at");



CREATE INDEX "idx_campaigns_deleted_at" ON "public"."campaigns" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_campaigns_sent_by" ON "public"."campaigns" USING "btree" ("sent_by");



CREATE INDEX "idx_deals_assigned_to" ON "public"."deals" USING "btree" ("assigned_to");



CREATE INDEX "idx_deals_deleted_at" ON "public"."deals" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_deals_lead_id" ON "public"."deals" USING "btree" ("lead_id");



CREATE INDEX "idx_deals_stage" ON "public"."deals" USING "btree" ("stage");



CREATE INDEX "idx_email_attachments_email_id" ON "public"."email_attachments" USING "btree" ("email_id");



CREATE INDEX "idx_emails_deleted_at" ON "public"."emails" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_emails_direction" ON "public"."emails" USING "btree" ("direction");



CREATE INDEX "idx_emails_lead_id" ON "public"."emails" USING "btree" ("lead_id");



CREATE INDEX "idx_emails_thread_id" ON "public"."emails" USING "btree" ("thread_id");



CREATE INDEX "idx_leads_assigned_to" ON "public"."leads" USING "btree" ("assigned_to");



CREATE INDEX "idx_leads_call_count" ON "public"."leads" USING "btree" ("call_count");



CREATE INDEX "idx_leads_deleted_at" ON "public"."leads" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_leads_email_count" ON "public"."leads" USING "btree" ("email_count");



CREATE INDEX "idx_leads_industry" ON "public"."leads" USING "btree" ("industry");



CREATE INDEX "idx_leads_status" ON "public"."leads" USING "btree" ("status");



CREATE INDEX "idx_sequence_steps_sequence_id" ON "public"."sequence_steps" USING "btree" ("sequence_id");



CREATE INDEX "idx_todo_activity_todo_id" ON "public"."todo_activity" USING "btree" ("todo_id");



CREATE INDEX "idx_todo_columns_user_id" ON "public"."todo_columns" USING "btree" ("user_id");



CREATE INDEX "idx_todo_comments_todo_id" ON "public"."todo_comments" USING "btree" ("todo_id");



CREATE INDEX "idx_todos_assigned_to" ON "public"."todos" USING "btree" ("assigned_to") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_todos_due_date" ON "public"."todos" USING "btree" ("due_date") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_todos_project_id" ON "public"."todos" USING "btree" ("project_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_todos_status" ON "public"."todos" USING "btree" ("status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "lead_search_history_user_id_idx" ON "public"."lead_search_history" USING "btree" ("user_id");



CREATE INDEX "leads_apollo_id_idx" ON "public"."leads" USING "btree" ("apollo_id") WHERE ("apollo_id" IS NOT NULL);



CREATE INDEX "system_alerts_dedup_idx" ON "public"."system_alerts" USING "btree" ("source", "message", "resolved", "created_at" DESC);



CREATE INDEX "unsubscribes_email_idx" ON "public"."unsubscribes" USING "btree" ("email");



CREATE INDEX "unsubscribes_lead_id_idx" ON "public"."unsubscribes" USING "btree" ("lead_id");



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."activities" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."ai_suggestions" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."deals" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."email_sequences" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."emails" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."sequence_steps" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_todos_updated_at" BEFORE UPDATE ON "public"."todos" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_suggestions"
    ADD CONSTRAINT "ai_suggestions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."apollo_usage"
    ADD CONSTRAINT "apollo_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaign_enrollments"
    ADD CONSTRAINT "campaign_enrollments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_enrollments"
    ADD CONSTRAINT "campaign_enrollments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaign_sequences"
    ADD CONSTRAINT "campaign_sequences_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_steps"
    ADD CONSTRAINT "campaign_steps_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "public"."campaign_sequences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_templates"
    ADD CONSTRAINT "campaign_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_attachments"
    ADD CONSTRAINT "email_attachments_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_sequences"
    ADD CONSTRAINT "email_sequences_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "public"."emails"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."emails"
    ADD CONSTRAINT "emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_search_history"
    ADD CONSTRAINT "lead_search_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sequence_steps"
    ADD CONSTRAINT "sequence_steps_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "public"."email_sequences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."todo_activity"
    ADD CONSTRAINT "todo_activity_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."todo_activity"
    ADD CONSTRAINT "todo_activity_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."todo_columns"
    ADD CONSTRAINT "todo_columns_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."todo_columns"
    ADD CONSTRAINT "todo_columns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."todo_comments"
    ADD CONSTRAINT "todo_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."todo_comments"
    ADD CONSTRAINT "todo_comments_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_parent_todo_id_fkey" FOREIGN KEY ("parent_todo_id") REFERENCES "public"."todos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."unsubscribes"
    ADD CONSTRAINT "unsubscribes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can manage invites" ON "public"."invites" USING ("public"."is_admin"());



CREATE POLICY "Authenticated users can manage enrollments" ON "public"."campaign_enrollments" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can manage projects" ON "public"."projects" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can manage sequences" ON "public"."campaign_sequences" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can manage steps" ON "public"."campaign_steps" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can manage templates" ON "public"."campaign_templates" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can manage todo_activity" ON "public"."todo_activity" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can manage todo_columns" ON "public"."todo_columns" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can manage todo_comments" ON "public"."todo_comments" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can manage todos" ON "public"."todos" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read email attachments" ON "public"."email_attachments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read unsubscribes" ON "public"."unsubscribes" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Users can insert own usage" ON "public"."apollo_usage" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can manage own search history" ON "public"."lead_search_history" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can read own usage" ON "public"."apollo_usage" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."activities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activities_insert" ON "public"."activities" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "activities_select" ON "public"."activities" FOR SELECT USING (("public"."is_admin"() OR ("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."leads"
  WHERE (("leads"."id" = "activities"."lead_id") AND ("leads"."assigned_to" = "auth"."uid"()))))));



ALTER TABLE "public"."ai_suggestions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "api_keys_delete" ON "public"."api_keys" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "api_keys_select" ON "public"."api_keys" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."apollo_usage" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "apollo_usage_insert" ON "public"."apollo_usage" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "apollo_usage_select" ON "public"."apollo_usage" FOR SELECT USING (("public"."is_admin"() OR ("user_id" = "auth"."uid"())));



CREATE POLICY "authenticated_insert" ON "public"."warmup_state" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "authenticated_read" ON "public"."email_send_log" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated_read" ON "public"."phone_reveals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated_read" ON "public"."system_alerts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated_read" ON "public"."warmup_state" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated_update" ON "public"."system_alerts" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "authenticated_update" ON "public"."warmup_state" FOR UPDATE TO "authenticated" USING (true);



ALTER TABLE "public"."campaign_enrollments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaign_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaign_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaign_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaigns_delete" ON "public"."campaigns" FOR DELETE USING (("public"."is_admin"() OR ("auth"."uid"() = "sent_by")));



CREATE POLICY "campaigns_insert" ON "public"."campaigns" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "campaigns_select" ON "public"."campaigns" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "campaigns_update" ON "public"."campaigns" FOR UPDATE USING (("public"."is_admin"() OR ("auth"."uid"() = "sent_by"))) WITH CHECK (("public"."is_admin"() OR ("auth"."uid"() = "sent_by")));



ALTER TABLE "public"."deals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deals_insert" ON "public"."deals" FOR INSERT WITH CHECK (("public"."is_admin"() OR ("assigned_to" = "auth"."uid"())));



CREATE POLICY "deals_select" ON "public"."deals" FOR SELECT USING (("public"."is_admin"() OR ("assigned_to" = "auth"."uid"())));



CREATE POLICY "deals_update" ON "public"."deals" FOR UPDATE USING (("public"."is_admin"() OR ("assigned_to" = "auth"."uid"())));



ALTER TABLE "public"."email_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_send_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."emails" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "emails_insert" ON "public"."emails" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "emails_select" ON "public"."emails" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "emails_update" ON "public"."emails" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_search_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leads_delete" ON "public"."leads" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "leads_insert" ON "public"."leads" FOR INSERT WITH CHECK (("public"."is_admin"() OR ("auth"."uid"() IS NOT NULL)));



CREATE POLICY "leads_select" ON "public"."leads" FOR SELECT USING (("public"."is_admin"() OR ("assigned_to" = "auth"."uid"()) OR ("assigned_to" IS NULL)));



CREATE POLICY "leads_update" ON "public"."leads" FOR UPDATE USING (("public"."is_admin"() OR ("assigned_to" = "auth"."uid"()) OR ("assigned_to" IS NULL))) WITH CHECK (("public"."is_admin"() OR ("assigned_to" = "auth"."uid"())));



ALTER TABLE "public"."phone_reveals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"())) WITH CHECK ((("id" = "auth"."uid"()) AND ("role" = ( SELECT "profiles_1"."role"
   FROM "public"."profiles" "profiles_1"
  WHERE ("profiles_1"."id" = "auth"."uid"())))));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sequence_steps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sequences_insert" ON "public"."email_sequences" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "sequences_select" ON "public"."email_sequences" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "steps_insert" ON "public"."sequence_steps" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "steps_select" ON "public"."sequence_steps" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "suggestions_select" ON "public"."ai_suggestions" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."leads"
  WHERE (("leads"."id" = "ai_suggestions"."lead_id") AND ("leads"."assigned_to" = "auth"."uid"()))))));



CREATE POLICY "suggestions_update" ON "public"."ai_suggestions" FOR UPDATE USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."leads"
  WHERE (("leads"."id" = "ai_suggestions"."lead_id") AND ("leads"."assigned_to" = "auth"."uid"()))))));



ALTER TABLE "public"."system_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."todo_activity" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."todo_columns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."todo_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."todos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unsubscribes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."warmup_state" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_daily_send_budget"("p_date" "date", "p_max" integer, "p_requested" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_daily_send_budget"("p_date" "date", "p_max" integer, "p_requested" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_daily_send_budget"("p_date" "date", "p_max" integer, "p_requested" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_call_count"("lead_ids" "uuid"[], "amount" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_call_count"("lead_ids" "uuid"[], "amount" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_call_count"("lead_ids" "uuid"[], "amount" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_email_count"("lead_ids" "uuid"[], "amount" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_email_count"("lead_ids" "uuid"[], "amount" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_email_count"("lead_ids" "uuid"[], "amount" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON TABLE "public"."ai_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."ai_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_suggestions" TO "service_role";



GRANT ALL ON TABLE "public"."api_keys" TO "anon";
GRANT ALL ON TABLE "public"."api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."apollo_usage" TO "anon";
GRANT ALL ON TABLE "public"."apollo_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."apollo_usage" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_enrollments" TO "anon";
GRANT ALL ON TABLE "public"."campaign_enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_enrollments" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_sequences" TO "anon";
GRANT ALL ON TABLE "public"."campaign_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_steps" TO "anon";
GRANT ALL ON TABLE "public"."campaign_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_steps" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_templates" TO "anon";
GRANT ALL ON TABLE "public"."campaign_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_templates" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."deals" TO "anon";
GRANT ALL ON TABLE "public"."deals" TO "authenticated";
GRANT ALL ON TABLE "public"."deals" TO "service_role";



GRANT ALL ON TABLE "public"."email_attachments" TO "anon";
GRANT ALL ON TABLE "public"."email_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."email_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."email_send_log" TO "anon";
GRANT ALL ON TABLE "public"."email_send_log" TO "authenticated";
GRANT ALL ON TABLE "public"."email_send_log" TO "service_role";



GRANT ALL ON TABLE "public"."email_sequences" TO "anon";
GRANT ALL ON TABLE "public"."email_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."email_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."emails" TO "anon";
GRANT ALL ON TABLE "public"."emails" TO "authenticated";
GRANT ALL ON TABLE "public"."emails" TO "service_role";



GRANT ALL ON TABLE "public"."invites" TO "anon";
GRANT ALL ON TABLE "public"."invites" TO "authenticated";
GRANT ALL ON TABLE "public"."invites" TO "service_role";



GRANT ALL ON TABLE "public"."lead_search_history" TO "anon";
GRANT ALL ON TABLE "public"."lead_search_history" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_search_history" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."phone_reveals" TO "anon";
GRANT ALL ON TABLE "public"."phone_reveals" TO "authenticated";
GRANT ALL ON TABLE "public"."phone_reveals" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."sequence_steps" TO "anon";
GRANT ALL ON TABLE "public"."sequence_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."sequence_steps" TO "service_role";



GRANT ALL ON TABLE "public"."system_alerts" TO "anon";
GRANT ALL ON TABLE "public"."system_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."system_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."todo_activity" TO "anon";
GRANT ALL ON TABLE "public"."todo_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."todo_activity" TO "service_role";



GRANT ALL ON TABLE "public"."todo_columns" TO "anon";
GRANT ALL ON TABLE "public"."todo_columns" TO "authenticated";
GRANT ALL ON TABLE "public"."todo_columns" TO "service_role";



GRANT ALL ON TABLE "public"."todo_comments" TO "anon";
GRANT ALL ON TABLE "public"."todo_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."todo_comments" TO "service_role";



GRANT ALL ON TABLE "public"."todos" TO "anon";
GRANT ALL ON TABLE "public"."todos" TO "authenticated";
GRANT ALL ON TABLE "public"."todos" TO "service_role";



GRANT ALL ON TABLE "public"."unsubscribes" TO "anon";
GRANT ALL ON TABLE "public"."unsubscribes" TO "authenticated";
GRANT ALL ON TABLE "public"."unsubscribes" TO "service_role";



GRANT ALL ON TABLE "public"."warmup_state" TO "anon";
GRANT ALL ON TABLE "public"."warmup_state" TO "authenticated";
GRANT ALL ON TABLE "public"."warmup_state" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







