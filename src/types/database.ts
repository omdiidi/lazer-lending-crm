export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          lead_id: string
          metadata: Json | null
          timestamp: string
          type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          lead_id: string
          metadata?: Json | null
          timestamp?: string
          type: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          lead_id?: string
          metadata?: Json | null
          timestamp?: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_suggestions: {
        Row: {
          created_at: string
          dismissed: boolean
          id: string
          lead_id: string
          priority: string
          suggestion: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dismissed?: boolean
          id?: string
          lead_id: string
          priority?: string
          suggestion: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dismissed?: boolean
          id?: string
          lead_id?: string
          priority?: string
          suggestion?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_suggestions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          key_hash: string
          key_preview: string
          last_used_at: string | null
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_preview: string
          last_used_at?: string | null
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_preview?: string
          last_used_at?: string | null
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      apollo_usage: {
        Row: {
          action: string
          created_at: string
          credits_used: number
          enrichment_count: number
          id: string
          prompt: string | null
          results_returned: number
          search_count: number
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          credits_used?: number
          enrichment_count?: number
          id?: string
          prompt?: string | null
          results_returned?: number
          search_count?: number
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          credits_used?: number
          enrichment_count?: number
          id?: string
          prompt?: string | null
          results_returned?: number
          search_count?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "apollo_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_enrollments: {
        Row: {
          ab_variant: string | null
          campaign_id: string
          created_at: string
          current_step: number
          email: string
          id: string
          lead_id: string | null
          next_send_at: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ab_variant?: string | null
          campaign_id: string
          created_at?: string
          current_step?: number
          email: string
          id?: string
          lead_id?: string | null
          next_send_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ab_variant?: string | null
          campaign_id?: string
          created_at?: string
          current_step?: number
          email?: string
          id?: string
          lead_id?: string | null
          next_send_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_enrollments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_enrollments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_sequences: {
        Row: {
          active: boolean
          campaign_id: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          campaign_id: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          campaign_id?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sequences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_steps: {
        Row: {
          body: string
          created_at: string
          delay_days: number
          id: string
          sequence_id: string
          step_order: number
          subject: string
          updated_at: string
          variant_b_body: string | null
          variant_b_subject: string | null
        }
        Insert: {
          body?: string
          created_at?: string
          delay_days?: number
          id?: string
          sequence_id: string
          step_order?: number
          subject?: string
          updated_at?: string
          variant_b_body?: string | null
          variant_b_subject?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          delay_days?: number
          id?: string
          sequence_id?: string
          step_order?: number
          subject?: string
          updated_at?: string
          variant_b_body?: string | null
          variant_b_subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "campaign_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          subject: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          subject?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          subject?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ab_test_enabled: boolean
          body: string
          created_at: string
          daily_send_limit: number | null
          deleted_at: string | null
          drip_config: Json | null
          id: string
          name: string
          provider: string
          recipient_ids: string[]
          scheduled_at: string | null
          seed_inbox_set_id: string | null
          send_spacing: boolean | null
          sending_pool_id: string | null
          sent_at: string
          sent_by: string | null
          sequence_id: string | null
          smart_send: boolean
          smartlead_campaign_id: string | null
          status: string
          subject: string
          team_email: string | null
          updated_at: string
          variant_b_body: string | null
          variant_b_subject: string | null
        }
        Insert: {
          ab_test_enabled?: boolean
          body: string
          created_at?: string
          daily_send_limit?: number | null
          deleted_at?: string | null
          drip_config?: Json | null
          id?: string
          name?: string
          provider?: string
          recipient_ids?: string[]
          scheduled_at?: string | null
          seed_inbox_set_id?: string | null
          send_spacing?: boolean | null
          sending_pool_id?: string | null
          sent_at?: string
          sent_by?: string | null
          sequence_id?: string | null
          smart_send?: boolean
          smartlead_campaign_id?: string | null
          status?: string
          subject: string
          team_email?: string | null
          updated_at?: string
          variant_b_body?: string | null
          variant_b_subject?: string | null
        }
        Update: {
          ab_test_enabled?: boolean
          body?: string
          created_at?: string
          daily_send_limit?: number | null
          deleted_at?: string | null
          drip_config?: Json | null
          id?: string
          name?: string
          provider?: string
          recipient_ids?: string[]
          scheduled_at?: string | null
          seed_inbox_set_id?: string | null
          send_spacing?: boolean | null
          sending_pool_id?: string | null
          sent_at?: string
          sent_by?: string | null
          sequence_id?: string | null
          smart_send?: boolean
          smartlead_campaign_id?: string | null
          status?: string
          subject?: string
          team_email?: string | null
          updated_at?: string
          variant_b_body?: string | null
          variant_b_subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_sending_pool_id_fkey"
            columns: ["sending_pool_id"]
            isOneToOne: false
            referencedRelation: "sending_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      classifier_circuit: {
        Row: {
          failure_count: number
          id: string
          last_failure_at: string | null
          open_at: string | null
        }
        Insert: {
          failure_count?: number
          id?: string
          last_failure_at?: string | null
          open_at?: string | null
        }
        Update: {
          failure_count?: number
          id?: string
          last_failure_at?: string | null
          open_at?: string | null
        }
        Relationships: []
      }
      deals: {
        Row: {
          assigned_to: string | null
          created_at: string
          deleted_at: string | null
          id: string
          lead_id: string
          stage: string
          title: string
          updated_at: string
          value: number
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          lead_id: string
          stage?: string
          title: string
          updated_at?: string
          value?: number
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          lead_id?: string
          stage?: string
          title?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "deals_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          cooldown_until: string | null
          created_at: string
          dmarc_policy: string
          dmarc_rua: string | null
          dns_dkim_ok: boolean
          dns_dmarc_ok: boolean
          dns_spf_ok: boolean
          hostname: string
          id: string
          owner_entity: string | null
          provider: string
          registered_at: string | null
          registrar: string | null
          retired_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cooldown_until?: string | null
          created_at?: string
          dmarc_policy?: string
          dmarc_rua?: string | null
          dns_dkim_ok?: boolean
          dns_dmarc_ok?: boolean
          dns_spf_ok?: boolean
          hostname: string
          id?: string
          owner_entity?: string | null
          provider: string
          registered_at?: string | null
          registrar?: string | null
          retired_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cooldown_until?: string | null
          created_at?: string
          dmarc_policy?: string
          dmarc_rua?: string | null
          dns_dkim_ok?: boolean
          dns_dmarc_ok?: boolean
          dns_spf_ok?: boolean
          hostname?: string
          id?: string
          owner_entity?: string | null
          provider?: string
          registered_at?: string | null
          registrar?: string | null
          retired_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_attachments: {
        Row: {
          content_type: string
          created_at: string
          email_id: string
          file_size: number
          filename: string
          id: string
          storage_path: string
        }
        Insert: {
          content_type: string
          created_at?: string
          email_id: string
          file_size: number
          filename: string
          id?: string
          storage_path: string
        }
        Update: {
          content_type?: string
          created_at?: string
          email_id?: string
          file_size?: number
          filename?: string
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_attachments_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          emails_sent: number
          mailbox_id: string | null
          send_date: string
          updated_at: string | null
        }
        Insert: {
          emails_sent?: number
          mailbox_id?: string | null
          send_date?: string
          updated_at?: string | null
        }
        Update: {
          emails_sent?: number
          mailbox_id?: string | null
          send_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_send_log_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequences: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sequences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      emails: {
        Row: {
          body: string
          bounced_at: string | null
          campaign_id: string | null
          clicked_at: string | null
          created_at: string
          deleted_at: string | null
          direction: string
          from: string
          id: string
          lead_id: string | null
          opened_at: string | null
          provider_message_id: string | null
          read: boolean
          reply_to_id: string | null
          sent_at: string
          subject: string
          thread_id: string | null
          to: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          body?: string
          bounced_at?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          created_at?: string
          deleted_at?: string | null
          direction: string
          from: string
          id?: string
          lead_id?: string | null
          opened_at?: string | null
          provider_message_id?: string | null
          read?: boolean
          reply_to_id?: string | null
          sent_at?: string
          subject?: string
          thread_id?: string | null
          to: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          body?: string
          bounced_at?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          created_at?: string
          deleted_at?: string | null
          direction?: string
          from?: string
          id?: string
          lead_id?: string | null
          opened_at?: string | null
          provider_message_id?: string | null
          read?: boolean
          reply_to_id?: string | null
          sent_at?: string
          subject?: string
          thread_id?: string | null
          to?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emails_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          name: string
          role: string
          token: string
          used: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          name: string
          role?: string
          token: string
          used?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          name?: string
          role?: string
          token?: string
          used?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_search_history: {
        Row: {
          created_at: string
          credits_used: number
          filters: Json | null
          id: string
          imported: boolean
          leads: Json
          prompt: string
          total_found: number
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_used?: number
          filters?: Json | null
          id?: string
          imported?: boolean
          leads?: Json
          prompt: string
          total_found?: number
          user_id: string
        }
        Update: {
          created_at?: string
          credits_used?: number
          filters?: Json | null
          id?: string
          imported?: boolean
          leads?: Json
          prompt?: string
          total_found?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_search_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          active_in_days: number | null
          apollo_id: string | null
          assigned_to: string | null
          call_count: number
          company: string
          company_size: string
          created_at: string
          deleted_at: string | null
          email: string
          email_count: number
          email_normalized: string | null
          email_status: string
          first_name: string
          fub_id: string | null
          fub_pushed_at: string | null
          id: string
          industry: string
          job_title: string
          last_contacted_at: string | null
          last_name: string
          last_validated_at: string | null
          linkedin_url: string | null
          location: string
          notes: string
          phone: string
          status: string
          tags: string[]
          timezone: string | null
          unsubscribed_at: string | null
          updated_at: string
          zerobounce_score: number | null
          zerobounce_substatus: string | null
        }
        Insert: {
          active_in_days?: number | null
          apollo_id?: string | null
          assigned_to?: string | null
          call_count?: number
          company?: string
          company_size?: string
          created_at?: string
          deleted_at?: string | null
          email: string
          email_count?: number
          email_normalized?: string | null
          email_status?: string
          first_name: string
          fub_id?: string | null
          fub_pushed_at?: string | null
          id?: string
          industry?: string
          job_title?: string
          last_contacted_at?: string | null
          last_name: string
          last_validated_at?: string | null
          linkedin_url?: string | null
          location?: string
          notes?: string
          phone?: string
          status?: string
          tags?: string[]
          timezone?: string | null
          unsubscribed_at?: string | null
          updated_at?: string
          zerobounce_score?: number | null
          zerobounce_substatus?: string | null
        }
        Update: {
          active_in_days?: number | null
          apollo_id?: string | null
          assigned_to?: string | null
          call_count?: number
          company?: string
          company_size?: string
          created_at?: string
          deleted_at?: string | null
          email?: string
          email_count?: number
          email_normalized?: string | null
          email_status?: string
          first_name?: string
          fub_id?: string | null
          fub_pushed_at?: string | null
          id?: string
          industry?: string
          job_title?: string
          last_contacted_at?: string | null
          last_name?: string
          last_validated_at?: string | null
          linkedin_url?: string | null
          location?: string
          notes?: string
          phone?: string
          status?: string
          tags?: string[]
          timezone?: string | null
          unsubscribed_at?: string | null
          updated_at?: string
          zerobounce_score?: number | null
          zerobounce_substatus?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mailboxes: {
        Row: {
          address: string
          connection_status: string
          created_at: string
          daily_cap: number
          domain_id: string
          id: string
          last_24h_bounce_rate: number
          last_24h_complaint_rate: number
          last_health_check_at: string | null
          last_reset_at: string | null
          live_started_at: string | null
          paused_reason: string | null
          smartlead_account_id: string | null
          timezone: string
          today_enrolled_count: number
          today_sent_count: number
          updated_at: string
          warmup_state: string
        }
        Insert: {
          address: string
          connection_status?: string
          created_at?: string
          daily_cap?: number
          domain_id: string
          id?: string
          last_24h_bounce_rate?: number
          last_24h_complaint_rate?: number
          last_health_check_at?: string | null
          last_reset_at?: string | null
          live_started_at?: string | null
          paused_reason?: string | null
          smartlead_account_id?: string | null
          timezone?: string
          today_enrolled_count?: number
          today_sent_count?: number
          updated_at?: string
          warmup_state?: string
        }
        Update: {
          address?: string
          connection_status?: string
          created_at?: string
          daily_cap?: number
          domain_id?: string
          id?: string
          last_24h_bounce_rate?: number
          last_24h_complaint_rate?: number
          last_health_check_at?: string | null
          last_reset_at?: string | null
          live_started_at?: string | null
          paused_reason?: string | null
          smartlead_account_id?: string | null
          timezone?: string
          today_enrolled_count?: number
          today_sent_count?: number
          updated_at?: string
          warmup_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailboxes_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_reveals: {
        Row: {
          apollo_id: string
          created_at: string | null
          phone: string
          raw_data: Json | null
          updated_at: string | null
        }
        Insert: {
          apollo_id: string
          created_at?: string | null
          phone: string
          raw_data?: Json | null
          updated_at?: string | null
        }
        Update: {
          apollo_id?: string
          created_at?: string | null
          phone?: string
          raw_data?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pool_memberships: {
        Row: {
          mailbox_id: string
          pool_id: string
        }
        Insert: {
          mailbox_id: string
          pool_id: string
        }
        Update: {
          mailbox_id?: string
          pool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pool_memberships_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mailboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_memberships_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "sending_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar: string | null
          created_at: string
          email: string
          email_prefix: string | null
          id: string
          name: string
          role: string
          updated_at: string
        }
        Insert: {
          avatar?: string | null
          created_at?: string
          email: string
          email_prefix?: string | null
          id: string
          name: string
          role?: string
          updated_at?: string
        }
        Update: {
          avatar?: string | null
          created_at?: string
          email?: string
          email_prefix?: string | null
          id?: string
          name?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          goal: string | null
          id: string
          notes: string | null
          outcomes: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          goal?: string | null
          id?: string
          notes?: string | null
          outcomes?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          goal?: string | null
          id?: string
          notes?: string | null
          outcomes?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      replies: {
        Row: {
          body_text: string
          campaign_id: string
          classification: string | null
          classifier_confidence: number | null
          classifier_error: string | null
          classifier_rationale: string | null
          created_at: string
          fub_event_id: string | null
          fub_pushed_at: string | null
          id: string
          in_reply_to_send_id: string | null
          language: string | null
          lead_id: string
          mailbox_id: string
          notified_at: string | null
          notified_to: string | null
          raw_message_id: string
          received_at: string
          redacted_body_text: string
          requires_human_review: boolean
          smartlead_thread_id: string | null
          updated_at: string
        }
        Insert: {
          body_text?: string
          campaign_id: string
          classification?: string | null
          classifier_confidence?: number | null
          classifier_error?: string | null
          classifier_rationale?: string | null
          created_at?: string
          fub_event_id?: string | null
          fub_pushed_at?: string | null
          id?: string
          in_reply_to_send_id?: string | null
          language?: string | null
          lead_id: string
          mailbox_id: string
          notified_at?: string | null
          notified_to?: string | null
          raw_message_id: string
          received_at: string
          redacted_body_text?: string
          requires_human_review?: boolean
          smartlead_thread_id?: string | null
          updated_at?: string
        }
        Update: {
          body_text?: string
          campaign_id?: string
          classification?: string | null
          classifier_confidence?: number | null
          classifier_error?: string | null
          classifier_rationale?: string | null
          created_at?: string
          fub_event_id?: string | null
          fub_pushed_at?: string | null
          id?: string
          in_reply_to_send_id?: string | null
          language?: string | null
          lead_id?: string
          mailbox_id?: string
          notified_at?: string | null
          notified_to?: string | null
          raw_message_id?: string
          received_at?: string
          redacted_body_text?: string
          requires_human_review?: boolean
          smartlead_thread_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "replies_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replies_in_reply_to_send_id_fkey"
            columns: ["in_reply_to_send_id"]
            isOneToOne: false
            referencedRelation: "sends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replies_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replies_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      seed_inbox_checks: {
        Row: {
          campaign_id: string
          checked_at_10min: string | null
          checked_at_30min: string | null
          created_at: string
          id: string
          placement_summary: string | null
          results: Json
        }
        Insert: {
          campaign_id: string
          checked_at_10min?: string | null
          checked_at_30min?: string | null
          created_at?: string
          id?: string
          placement_summary?: string | null
          results?: Json
        }
        Update: {
          campaign_id?: string
          checked_at_10min?: string | null
          checked_at_30min?: string | null
          created_at?: string
          id?: string
          placement_summary?: string | null
          results?: Json
        }
        Relationships: [
          {
            foreignKeyName: "seed_inbox_checks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      seed_inbox_set: {
        Row: {
          created_at: string
          id: string
          label: string
          provider: string
          vault_secret_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          provider: string
          vault_secret_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          provider?: string
          vault_secret_id?: string
        }
        Relationships: []
      }
      sending_pools: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sends: {
        Row: {
          bounce_type: string | null
          campaign_id: string
          campaign_step_id: string | null
          claimed_mailbox_id: string
          complaint_at: string | null
          created_at: string
          delivered_at: string | null
          error_reason: string | null
          id: string
          lead_id: string
          mailbox_id: string | null
          sent_at: string | null
          smartlead_lead_id: string | null
          smartlead_message_id: string | null
          smartlead_thread_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          bounce_type?: string | null
          campaign_id: string
          campaign_step_id?: string | null
          claimed_mailbox_id: string
          complaint_at?: string | null
          created_at?: string
          delivered_at?: string | null
          error_reason?: string | null
          id?: string
          lead_id: string
          mailbox_id?: string | null
          sent_at?: string | null
          smartlead_lead_id?: string | null
          smartlead_message_id?: string | null
          smartlead_thread_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          bounce_type?: string | null
          campaign_id?: string
          campaign_step_id?: string | null
          claimed_mailbox_id?: string
          complaint_at?: string | null
          created_at?: string
          delivered_at?: string | null
          error_reason?: string | null
          id?: string
          lead_id?: string
          mailbox_id?: string | null
          sent_at?: string | null
          smartlead_lead_id?: string | null
          smartlead_message_id?: string | null
          smartlead_thread_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sends_campaign_step_id_fkey"
            columns: ["campaign_step_id"]
            isOneToOne: false
            referencedRelation: "campaign_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sends_claimed_mailbox_id_fkey"
            columns: ["claimed_mailbox_id"]
            isOneToOne: false
            referencedRelation: "mailboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sends_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          body: string
          created_at: string
          delay_days: number
          id: string
          order: number
          sequence_id: string
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          delay_days?: number
          id?: string
          order: number
          sequence_id: string
          subject?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          delay_days?: number
          id?: string
          order?: number
          sequence_id?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      system_alerts: {
        Row: {
          created_at: string | null
          details: Json | null
          id: string
          message: string
          resolved: boolean | null
          source: string
          type: string
        }
        Insert: {
          created_at?: string | null
          details?: Json | null
          id?: string
          message: string
          resolved?: boolean | null
          source: string
          type: string
        }
        Update: {
          created_at?: string | null
          details?: Json | null
          id?: string
          message?: string
          resolved?: boolean | null
          source?: string
          type?: string
        }
        Relationships: []
      }
      todo_activity: {
        Row: {
          action_type: string
          actor_id: string
          created_at: string
          details: Json | null
          id: string
          todo_id: string
        }
        Insert: {
          action_type: string
          actor_id: string
          created_at?: string
          details?: Json | null
          id?: string
          todo_id: string
        }
        Update: {
          action_type?: string
          actor_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          todo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "todo_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_activity_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_columns: {
        Row: {
          created_at: string
          id: string
          position: number
          profile_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          profile_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          profile_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "todo_columns_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_columns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          todo_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          todo_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          todo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "todo_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_comments_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      todos: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          details: string | null
          due_date: string | null
          id: string
          is_pinned: boolean
          is_recurring: boolean
          parent_todo_id: string | null
          position: number
          priority: string
          project_id: string | null
          recurrence_pattern: string | null
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          details?: string | null
          due_date?: string | null
          id?: string
          is_pinned?: boolean
          is_recurring?: boolean
          parent_todo_id?: string | null
          position?: number
          priority?: string
          project_id?: string | null
          recurrence_pattern?: string | null
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          details?: string | null
          due_date?: string | null
          id?: string
          is_pinned?: boolean
          is_recurring?: boolean
          parent_todo_id?: string | null
          position?: number
          priority?: string
          project_id?: string | null
          recurrence_pattern?: string | null
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "todos_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_parent_todo_id_fkey"
            columns: ["parent_todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      unsubscribes: {
        Row: {
          email: string
          email_normalized: string | null
          id: string
          lead_id: string | null
          reason: string
          source_event_id: string | null
          token: string
          unsubscribed_at: string
        }
        Insert: {
          email: string
          email_normalized?: string | null
          id?: string
          lead_id?: string | null
          reason?: string
          source_event_id?: string | null
          token: string
          unsubscribed_at?: string
        }
        Update: {
          email?: string
          email_normalized?: string | null
          id?: string
          lead_id?: string | null
          reason?: string
          source_event_id?: string | null
          token?: string
          unsubscribed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unsubscribes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      warmup_state: {
        Row: {
          created_at: string | null
          first_email_at: string | null
          id: string
          mailbox_id: string | null
          reset_at: string | null
          reset_by: string | null
        }
        Insert: {
          created_at?: string | null
          first_email_at?: string | null
          id?: string
          mailbox_id?: string | null
          reset_at?: string | null
          reset_by?: string | null
        }
        Update: {
          created_at?: string | null
          first_email_at?: string | null
          id?: string
          mailbox_id?: string | null
          reset_at?: string | null
          reset_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warmup_state_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          event_type: string
          external_event_id: string
          id: string
          last_error: string | null
          payload_hash: string
          payload_raw: Json
          processed_at: string | null
          provider: string
          received_at: string
        }
        Insert: {
          event_type: string
          external_event_id: string
          id?: string
          last_error?: string | null
          payload_hash: string
          payload_raw: Json
          processed_at?: string | null
          provider: string
          received_at?: string
        }
        Update: {
          event_type?: string
          external_event_id?: string
          id?: string
          last_error?: string | null
          payload_hash?: string
          payload_raw?: Json
          processed_at?: string | null
          provider?: string
          received_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_daily_send_budget:
        | {
            Args: { p_date: string; p_max: number; p_requested: number }
            Returns: number
          }
        | {
            Args: {
              p_date: string
              p_mailbox_id?: string
              p_max: number
              p_requested: number
            }
            Returns: number
          }
      claim_due_drip_enrollments: {
        Args: { p_limit?: number }
        Returns: {
          ab_variant: string | null
          campaign_id: string
          created_at: string
          current_step: number
          email: string
          id: string
          lead_id: string | null
          next_send_at: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "campaign_enrollments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_mailbox_enrollment_slot: {
        Args: { p_pool_id: string }
        Returns: {
          address: string
          connection_status: string
          created_at: string
          daily_cap: number
          domain_id: string
          id: string
          last_24h_bounce_rate: number
          last_24h_complaint_rate: number
          last_health_check_at: string | null
          last_reset_at: string | null
          live_started_at: string | null
          paused_reason: string | null
          smartlead_account_id: string | null
          timezone: string
          today_enrolled_count: number
          today_sent_count: number
          updated_at: string
          warmup_state: string
        }
        SetofOptions: {
          from: "*"
          to: "mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_pending_enrollments: {
        Args: { p_campaign_id: string; p_limit?: number }
        Returns: {
          ab_variant: string | null
          campaign_id: string
          created_at: string
          current_step: number
          email: string
          id: string
          lead_id: string | null
          next_send_at: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "campaign_enrollments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      increment_call_count: {
        Args: { amount?: number; lead_ids: string[] }
        Returns: undefined
      }
      increment_email_count: {
        Args: { amount?: number; lead_ids: string[] }
        Returns: undefined
      }
      increment_mailbox_sent_count_if_same_day: {
        Args: { p_message_id: string; p_smartlead_account_id: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      release_mailbox_enrollment_slot: {
        Args: { p_mailbox_id: string }
        Returns: undefined
      }
      reset_mailbox_daily_counts: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
<claude-code-hint v="1" type="plugin" value="supabase@claude-plugins-official" />
