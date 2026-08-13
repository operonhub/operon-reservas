export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

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
        Row: { created_at: string; user_id: string }
        Insert: { created_at?: string; user_id: string }
        Update: { created_at?: string; user_id?: string }
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
      create_block: {
        Args: {
          p_end: string
          p_org: string
          p_reason: string | null
          p_start: string
          p_unit: string
        }
        Returns: Database["public"]["Tables"]["unit_occupancy"]["Row"]
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
        Returns: Database["public"]["Tables"]["reservations"]["Row"]
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
      holds_inventory: {
        Args: { s: Database["public"]["Enums"]["reservation_status"] }
        Returns: boolean
      }
      is_member_of: { Args: { org: string }; Returns: boolean }
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
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
      shares_org: { Args: { target_user: string }; Returns: boolean }
      transition_reservation: {
        Args: {
          p_reservation: string
          p_to: Database["public"]["Enums"]["reservation_status"]
        }
        Returns: Database["public"]["Enums"]["reservation_status"]
      }
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
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]
