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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      apollo_usage: {
        Row: {
          id: string
          user_id: string
          action: string
          credits_used: number
          search_count: number
          enrichment_count: number
          results_returned: number
          prompt: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          action: string
          credits_used?: number
          search_count?: number
          enrichment_count?: number
          results_returned?: number
          prompt?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          action?: string
          credits_used?: number
          search_count?: number
          enrichment_count?: number
          results_returned?: number
          prompt?: string
          created_at?: string
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
          user_id: string
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
          user_id: string
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
          user_id?: string
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
      campaign_templates: {
        Row: {
          id: string
          name: string
          subject: string
          body: string
          created_by: string
          tags: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          subject: string
          body: string
          created_by: string
          tags?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          subject?: string
          body?: string
          created_by?: string
          tags?: string[]
          created_at?: string
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
      campaign_sequences: {
        Row: {
          id: string
          name: string
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sequences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_steps: {
        Row: {
          id: string
          sequence_id: string
          order: number
          subject: string
          body: string
          delay_days: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sequence_id: string
          order: number
          subject: string
          body: string
          delay_days?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sequence_id?: string
          order?: number
          subject?: string
          body?: string
          delay_days?: number
          created_at?: string
          updated_at?: string
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
      campaign_enrollments: {
        Row: {
          id: string
          campaign_id: string
          lead_id: string | null
          email: string
          status: string
          sent_at: string | null
          next_send_at: string | null
          current_step: number
          ab_variant: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          lead_id?: string | null
          email: string
          status?: string
          sent_at?: string | null
          next_send_at?: string | null
          current_step?: number
          ab_variant?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          lead_id?: string | null
          email?: string
          status?: string
          sent_at?: string | null
          next_send_at?: string | null
          current_step?: number
          ab_variant?: string | null
          created_at?: string
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
      campaigns: {
        Row: {
          ab_test_enabled: boolean
          body: string
          created_at: string
          deleted_at: string | null
          drip_config: Record<string, unknown> | null
          id: string
          name: string
          recipient_ids: string[]
          scheduled_at: string | null
          sent_at: string
          sent_by: string
          sequence_id: string | null
          smart_send: boolean
          daily_send_limit: number | null
          send_spacing: boolean | null
          status: string
          subject: string
          updated_at: string
          variant_b_body: string | null
          variant_b_subject: string | null
        }
        Insert: {
          ab_test_enabled?: boolean
          body: string
          created_at?: string
          deleted_at?: string | null
          drip_config?: Record<string, unknown> | null
          id?: string
          name: string
          recipient_ids?: string[]
          scheduled_at?: string | null
          sent_at?: string
          sent_by: string
          sequence_id?: string | null
          smart_send?: boolean
          daily_send_limit?: number | null
          send_spacing?: boolean | null
          status?: string
          subject: string
          updated_at?: string
          variant_b_body?: string | null
          variant_b_subject?: string | null
        }
        Update: {
          ab_test_enabled?: boolean
          body?: string
          created_at?: string
          deleted_at?: string | null
          drip_config?: Record<string, unknown> | null
          id?: string
          name?: string
          recipient_ids?: string[]
          scheduled_at?: string | null
          sent_at?: string
          sent_by?: string
          sequence_id?: string | null
          smart_send?: boolean
          daily_send_limit?: number | null
          send_spacing?: boolean | null
          status?: string
          subject?: string
          updated_at?: string
          variant_b_body?: string | null
          variant_b_subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      unsubscribes: {
        Row: {
          id: string
          lead_id: string | null
          email: string
          token: string
          unsubscribed_at: string
        }
        Insert: {
          id?: string
          lead_id?: string | null
          email: string
          token: string
          unsubscribed_at?: string
        }
        Update: {
          id?: string
          lead_id?: string | null
          email?: string
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
      deals: {
        Row: {
          assigned_to: string
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
          assigned_to: string
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
          assigned_to?: string
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
      email_sequences: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
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
          campaign_id: string | null
          created_at: string
          deleted_at: string | null
          direction: string
          from: string
          id: string
          lead_id: string | null
          read: boolean
          reply_to_id: string | null
          sent_at: string
          subject: string
          thread_id: string | null
          to: string
          updated_at: string
          provider_message_id: string | null
          opened_at: string | null
          clicked_at: string | null
          bounced_at: string | null
          user_id: string | null
        }
        Insert: {
          body?: string
          campaign_id?: string | null
          created_at?: string
          deleted_at?: string | null
          direction: string
          from: string
          id?: string
          lead_id?: string | null
          read?: boolean
          reply_to_id?: string | null
          sent_at?: string
          subject?: string
          thread_id?: string | null
          to: string
          updated_at?: string
          provider_message_id?: string | null
          opened_at?: string | null
          clicked_at?: string | null
          bounced_at?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string
          campaign_id?: string | null
          created_at?: string
          deleted_at?: string | null
          direction?: string
          from?: string
          id?: string
          lead_id?: string | null
          read?: boolean
          reply_to_id?: string | null
          sent_at?: string
          subject?: string
          thread_id?: string | null
          to?: string
          updated_at?: string
          provider_message_id?: string | null
          opened_at?: string | null
          clicked_at?: string | null
          bounced_at?: string | null
          user_id?: string | null
        }
        Relationships: [
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
          id: string
          email: string
          name: string
          role: string
          token: string
          expires_at: string
          used: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          name: string
          role?: string
          token: string
          expires_at: string
          used?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string
          role?: string
          token?: string
          expires_at?: string
          used?: boolean
          created_by?: string | null
          created_at?: string
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
      leads: {
        Row: {
          assigned_to: string
          company: string
          company_size: string
          created_at: string
          deleted_at: string | null
          email: string
          first_name: string
          id: string
          industry: string
          job_title: string
          last_contacted_at: string | null
          last_name: string
          linkedin_url: string | null
          email_status: string
          location: string
          timezone: string | null
          notes: string
          phone: string
          status: string
          tags: string[]
          updated_at: string
          apollo_id: string | null
          call_count: number
          email_count: number
        }
        Insert: {
          assigned_to: string
          company?: string
          company_size?: string
          created_at?: string
          deleted_at?: string | null
          email: string
          first_name: string
          id?: string
          industry?: string
          job_title?: string
          last_contacted_at?: string | null
          last_name: string
          linkedin_url?: string | null
          email_status?: string
          location?: string
          timezone?: string | null
          notes?: string
          phone?: string
          status?: string
          tags?: string[]
          updated_at?: string
          apollo_id?: string | null
          call_count?: number
          email_count?: number
        }
        Update: {
          assigned_to?: string
          company?: string
          company_size?: string
          created_at?: string
          deleted_at?: string | null
          email?: string
          first_name?: string
          id?: string
          industry?: string
          job_title?: string
          last_contacted_at?: string | null
          last_name?: string
          linkedin_url?: string | null
          email_status?: string
          location?: string
          timezone?: string | null
          notes?: string
          phone?: string
          status?: string
          tags?: string[]
          updated_at?: string
          apollo_id?: string | null
          call_count?: number
          email_count?: number
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
      lead_search_history: {
        Row: {
          id: string
          user_id: string
          prompt: string
          leads: unknown
          filters: unknown
          total_found: number
          credits_used: number
          imported: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          prompt: string
          leads?: unknown
          filters?: unknown
          total_found?: number
          credits_used?: number
          imported?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          prompt?: string
          leads?: unknown
          filters?: unknown
          total_found?: number
          credits_used?: number
          imported?: boolean
          created_at?: string
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
      profiles: {
        Row: {
          avatar: string | null
          created_at: string
          email: string
          id: string
          name: string
          role: string
          email_prefix: string | null
          updated_at: string
        }
        Insert: {
          avatar?: string | null
          created_at?: string
          email: string
          id: string
          name: string
          role?: string
          email_prefix?: string | null
          updated_at?: string
        }
        Update: {
          avatar?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: string
          email_prefix?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      phone_reveals: {
        Row: {
          apollo_id: string
          phone: string
          raw_data: Record<string, unknown> | null
          created_at: string
          updated_at: string
        }
        Insert: {
          apollo_id: string
          phone: string
          raw_data?: Record<string, unknown> | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          apollo_id?: string
          phone?: string
          raw_data?: Record<string, unknown> | null
          updated_at?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: { id: string; type: string; source: string; message: string; details: Record<string, unknown>; resolved: boolean; created_at: string }
        Insert: { id?: string; type: string; source: string; message: string; details?: Record<string, unknown>; resolved?: boolean; created_at?: string }
        Update: { type?: string; source?: string; message?: string; details?: Record<string, unknown>; resolved?: boolean }
        Relationships: []
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
      email_send_log: {
        Row: { send_date: string; emails_sent: number; updated_at: string }
        Insert: { send_date?: string; emails_sent?: number; updated_at?: string }
        Update: { send_date?: string; emails_sent?: number; updated_at?: string }
        Relationships: []
      }
      warmup_state: {
        Row: { id: string; first_email_at: string | null; reset_at: string | null; reset_by: string | null; created_at: string }
        Insert: { id?: string; first_email_at?: string | null; reset_at?: string | null; reset_by?: string | null; created_at?: string }
        Update: { id?: string; first_email_at?: string | null; reset_at?: string | null; reset_by?: string | null }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
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
