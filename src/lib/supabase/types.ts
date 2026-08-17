export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/**
 * Credencial de Mercado Pago de una organización. Vive en `app_private`
 * (schema no expuesto), sólo la devuelven las RPC `mp_service_*` al backend.
 */
export type MpCredential = {
  organization_id: string
  mp_user_id: string
  access_token: string
  refresh_token: string
  public_key: string | null
  live_mode: boolean
  scopes: string | null
  expires_at: string
  connected_by: string | null
  connected_at: string
  updated_at: string
}

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      guests: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["membership_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["membership_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempt_count: number
          created_at: string
          delivery_status: string
          event_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          next_attempt_at: string | null
          organization_id: string
          payload: Json
          processing_started_at: string | null
          provider_message_id: string | null
          recipient_email: string | null
          reservation_id: string
          reservation_status:
            | Database["public"]["Enums"]["reservation_status"]
            | null
          sent_at: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          delivery_status?: string
          event_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          next_attempt_at?: string | null
          organization_id: string
          payload?: Json
          processing_started_at?: string | null
          provider_message_id?: string | null
          recipient_email?: string | null
          reservation_id: string
          reservation_status?:
            | Database["public"]["Enums"]["reservation_status"]
            | null
          sent_at?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          delivery_status?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          next_attempt_at?: string | null
          organization_id?: string
          payload?: Json
          processing_started_at?: string | null
          provider_message_id?: string | null
          recipient_email?: string | null
          reservation_id?: string
          reservation_status?:
            | Database["public"]["Enums"]["reservation_status"]
            | null
          sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          external_ref: string | null
          id: string
          kind: Database["public"]["Enums"]["payment_kind"]
          method: string | null
          mp_init_point: string | null
          mp_preference_id: string | null
          organization_id: string
          paid_at: string | null
          reservation_id: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          method?: string | null
          mp_init_point?: string | null
          mp_preference_id?: string | null
          organization_id: string
          paid_at?: string | null
          reservation_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          method?: string | null
          mp_init_point?: string | null
          mp_preference_id?: string | null
          organization_id?: string
          paid_at?: string | null
          reservation_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string | null
          checkin_time: string
          checkout_time: string
          city: string | null
          country: string | null
          created_at: string
          currency: string
          deposit_pct: number
          description: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          phone: string | null
          slug: string
          timezone: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          checkin_time?: string
          checkout_time?: string
          city?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          deposit_pct?: number
          description?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          phone?: string | null
          slug: string
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          checkin_time?: string
          checkout_time?: string
          city?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          deposit_pct?: number
          description?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          phone?: string | null
          slug?: string
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rates: {
        Row: {
          created_at: string
          currency: string
          end_date: string | null
          id: string
          kind: Database["public"]["Enums"]["rate_kind"]
          min_nights: number
          organization_id: string
          price_per_night: number
          priority: number
          property_id: string
          start_date: string | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          end_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["rate_kind"]
          min_nights?: number
          organization_id: string
          price_per_night: number
          priority?: number
          property_id: string
          start_date?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          end_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["rate_kind"]
          min_nights?: number
          organization_id?: string
          price_per_night?: number
          priority?: number
          property_id?: string
          start_date?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rates_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          check_in: string
          check_out: string
          code: string
          created_at: string
          created_by: string | null
          currency: string
          deposit_amount: number | null
          external_channel: string | null
          external_reference: string | null
          guest_id: string | null
          guests_count: number
          hold_expires_at: string | null
          id: string
          notes: string | null
          organization_id: string
          property_id: string
          source: Database["public"]["Enums"]["reservation_source"]
          status: Database["public"]["Enums"]["reservation_status"]
          total_amount: number | null
          unit_id: string
          updated_at: string
        }
        Insert: {
          check_in: string
          check_out: string
          code: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deposit_amount?: number | null
          external_channel?: string | null
          external_reference?: string | null
          guest_id?: string | null
          guests_count?: number
          hold_expires_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          property_id: string
          source?: Database["public"]["Enums"]["reservation_source"]
          status?: Database["public"]["Enums"]["reservation_status"]
          total_amount?: number | null
          unit_id: string
          updated_at?: string
        }
        Update: {
          check_in?: string
          check_out?: string
          code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deposit_amount?: number | null
          external_channel?: string | null
          external_reference?: string | null
          guest_id?: string | null
          guests_count?: number
          hold_expires_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          property_id?: string
          source?: Database["public"]["Enums"]["reservation_source"]
          status?: Database["public"]["Enums"]["reservation_status"]
          total_amount?: number | null
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_occupancy: {
        Row: {
          block_reason: string | null
          created_at: string
          created_by: string | null
          during: unknown
          id: string
          kind: Database["public"]["Enums"]["occupancy_kind"]
          organization_id: string
          reservation_id: string | null
          unit_id: string
        }
        Insert: {
          block_reason?: string | null
          created_at?: string
          created_by?: string | null
          during: unknown
          id?: string
          kind: Database["public"]["Enums"]["occupancy_kind"]
          organization_id: string
          reservation_id?: string | null
          unit_id: string
        }
        Update: {
          block_reason?: string | null
          created_at?: string
          created_by?: string | null
          during?: unknown
          id?: string
          kind?: Database["public"]["Enums"]["occupancy_kind"]
          organization_id?: string
          reservation_id?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_occupancy_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_occupancy_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_occupancy_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          capacity: number
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          position: number
          property_id: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          position?: number
          property_id: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          position?: number
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _book: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_created_by: string
          p_guest_id: string
          p_guests: number
          p_hold_minutes: number
          p_org: string
          p_property: string
          p_source: Database["public"]["Enums"]["reservation_source"]
          p_status: Database["public"]["Enums"]["reservation_status"]
          p_unit: string
        }
        Returns: {
          check_in: string
          check_out: string
          code: string
          created_at: string
          created_by: string | null
          currency: string
          deposit_amount: number | null
          external_channel: string | null
          external_reference: string | null
          guest_id: string | null
          guests_count: number
          hold_expires_at: string | null
          id: string
          notes: string | null
          organization_id: string
          property_id: string
          source: Database["public"]["Enums"]["reservation_source"]
          status: Database["public"]["Enums"]["reservation_status"]
          total_amount: number | null
          unit_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _can_transition: {
        Args: {
          p_from: Database["public"]["Enums"]["reservation_status"]
          p_to: Database["public"]["Enums"]["reservation_status"]
        }
        Returns: boolean
      }
      _mp_admin_org: { Args: never; Returns: string }
      _mp_member_org: { Args: never; Returns: string }
      _resolve_admin_email: {
        Args: { p_org: string; p_property_email: string }
        Returns: string
      }
      _resolve_property: {
        Args: { p_org_slug: string; p_property_slug: string | null }
        Returns: {
          address: string | null
          checkin_time: string
          checkout_time: string
          city: string | null
          country: string | null
          created_at: string
          currency: string
          deposit_pct: number
          description: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          phone: string | null
          slug: string
          timezone: string
          updated_at: string
          whatsapp: string | null
        }
        SetofOptions: {
          from: "*"
          to: "properties"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _unit_price: {
        Args: { p_check_in: string; p_check_out: string; p_unit: string }
        Returns: number
      }
      _upsert_guest: {
        Args: {
          p_email: string | null
          p_name: string
          p_org: string
          p_phone: string | null
        }
        Returns: string
      }
      claim_notification_batch: {
        Args: { p_limit?: number; p_worker_token: string }
        Returns: {
          event_type: string
          id: string
          idempotency_key: string
          payload: Json
          recipient_email: string
          reservation_status: Database["public"]["Enums"]["reservation_status"]
        }[]
      }
      complete_notification: {
        Args: {
          p_id: string
          p_provider_message_id: string
          p_worker_token: string
        }
        Returns: boolean
      }
      create_block: {
        Args: {
          p_end: string
          p_org: string
          p_reason: string | null
          p_start: string
          p_unit: string
        }
        Returns: {
          block_reason: string | null
          created_at: string
          created_by: string | null
          during: unknown
          id: string
          kind: Database["public"]["Enums"]["occupancy_kind"]
          organization_id: string
          reservation_id: string | null
          unit_id: string
        }
        SetofOptions: {
          from: "*"
          to: "unit_occupancy"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_manual_reservation: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_email: string | null
          p_full_name: string
          p_guests: number
          p_notes: string | null
          p_org: string
          p_phone: string | null
          p_property: string
          p_status: Database["public"]["Enums"]["reservation_status"]
          p_unit: string
        }
        Returns: {
          check_in: string
          check_out: string
          code: string
          created_at: string
          created_by: string | null
          currency: string
          deposit_amount: number | null
          external_channel: string | null
          external_reference: string | null
          guest_id: string | null
          guests_count: number
          hold_expires_at: string | null
          id: string
          notes: string | null
          organization_id: string
          property_id: string
          source: Database["public"]["Enums"]["reservation_source"]
          status: Database["public"]["Enums"]["reservation_status"]
          total_amount: number | null
          unit_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_public_reservation: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_email: string | null
          p_full_name: string
          p_guests: number
          p_notes: string | null
          p_org_slug: string
          p_phone: string | null
          p_property_slug: string | null
          p_unit_id: string
        }
        Returns: Json
      }
      expire_stale_holds: { Args: { p_limit?: number }; Returns: number }
      fail_notification: {
        Args: { p_error: string; p_id: string; p_worker_token: string }
        Returns: boolean
      }
      holds_inventory: {
        Args: { s: Database["public"]["Enums"]["reservation_status"] }
        Returns: boolean
      }
      is_member_of: { Args: { org: string }; Returns: boolean }
      is_notification_worker: { Args: { p_token: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      mp_connection_status: { Args: never; Returns: Json }
      mp_consume_oauth_state: {
        Args: { p_state: string }
        Returns: {
          code_verifier: string
          organization_id: string
        }[]
      }
      mp_disconnect: { Args: never; Returns: undefined }
      mp_public_status: { Args: { p_org_slug: string }; Returns: Json }
      public_ical_feed: { Args: { p_unit_id: string }; Returns: Json }
      mp_save_oauth_state: {
        Args: { p_code_verifier: string; p_state: string }
        Returns: string
      }
      mp_service_get_credential: {
        Args: { p_organization_id: string }
        Returns: unknown
        SetofOptions: {
          from: "*"
          to: "mp_credential"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mp_service_get_credential_by_mp_user: {
        Args: { p_mp_user_id: string }
        Returns: unknown
        SetofOptions: {
          from: "*"
          to: "mp_credential"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mp_service_update_tokens: {
        Args: {
          p_access_token: string
          p_expires_in: number
          p_organization_id: string
          p_refresh_token: string
        }
        Returns: undefined
      }
      mp_store_credential: {
        Args: {
          p_access_token: string
          p_expires_in: number
          p_live_mode: boolean
          p_mp_user_id: string
          p_organization_id: string
          p_public_key: string | null
          p_refresh_token: string
          p_scopes: string | null
        }
        Returns: undefined
      }
      public_availability: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_guests: number
          p_org_slug: string
          p_property_slug: string | null
        }
        Returns: {
          capacity: number
          currency: string
          description: string
          name: string
          price_per_night: number
          unit_id: string
        }[]
      }
      public_property: {
        Args: { p_org_slug: string; p_property_slug: string | null }
        Returns: Json
      }
      public_reservation_status: {
        Args: { p_code: string; p_org_slug: string }
        Returns: Json
      }
      shares_org: { Args: { target_user: string }; Returns: boolean }
      skip_notification: {
        Args: { p_id: string; p_reason: string; p_worker_token: string }
        Returns: boolean
      }
      transition_reservation: {
        Args: {
          p_reservation: string
          p_to: Database["public"]["Enums"]["reservation_status"]
        }
        Returns: Database["public"]["Enums"]["reservation_status"]
      }
      wake_notification_worker: { Args: never; Returns: number }
    }
    Enums: {
      membership_role: "owner" | "admin" | "staff"
      occupancy_kind: "reservation" | "block"
      payment_kind: "deposit" | "balance" | "refund" | "other"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      rate_kind: "base" | "seasonal" | "special"
      reservation_source:
        | "direct"
        | "manual"
        | "booking"
        | "airbnb"
        | "whatsapp"
        | "other"
      reservation_status:
        | "inquiry"
        | "pending"
        | "pending_payment"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "expired"
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
    Enums: {
      membership_role: ["owner", "admin", "staff"],
      occupancy_kind: ["reservation", "block"],
      payment_kind: ["deposit", "balance", "refund", "other"],
      payment_status: ["pending", "paid", "failed", "refunded"],
      rate_kind: ["base", "seasonal", "special"],
      reservation_source: [
        "direct",
        "manual",
        "booking",
        "airbnb",
        "whatsapp",
        "other",
      ],
      reservation_status: [
        "inquiry",
        "pending",
        "pending_payment",
        "confirmed",
        "completed",
        "cancelled",
        "expired",
      ],
    },
  },
} as const
