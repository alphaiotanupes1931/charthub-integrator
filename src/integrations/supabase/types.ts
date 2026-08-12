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
      academy_progress: {
        Row: {
          completed: Json
          last_lesson: string | null
          last_module: number | null
          quiz_scores: Json
          tour_done: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: Json
          last_lesson?: string | null
          last_module?: number | null
          quiz_scores?: Json
          tour_done?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: Json
          last_lesson?: string | null
          last_module?: number | null
          quiz_scores?: Json
          tour_done?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_cost_log: {
        Row: {
          cache_write_tokens: number
          cached_input_tokens: number
          cost_usd: number
          created_at: string
          id: number
          input_tokens: number
          kind: string
          model: string
          output_tokens: number
          user_id: string | null
        }
        Insert: {
          cache_write_tokens?: number
          cached_input_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: number
          input_tokens?: number
          kind: string
          model: string
          output_tokens?: number
          user_id?: string | null
        }
        Update: {
          cache_write_tokens?: number
          cached_input_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: number
          input_tokens?: number
          kind?: string
          model?: string
          output_tokens?: number
          user_id?: string | null
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          count: number
          day: string
          updated_at: string
          user_id: string
        }
        Insert: {
          count?: number
          day?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          count?: number
          day?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      autopilot_events: {
        Row: {
          created_at: string
          id: string
          kind: string
          message: string
          meta: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          message: string
          meta?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message?: string
          meta?: Json
          user_id?: string
        }
        Relationships: []
      }
      autopilot_proposals: {
        Row: {
          account_target: string
          broker_order_id: string | null
          confidence: number | null
          created_at: string
          decided_at: string | null
          entry: number
          expires_at: string
          grade: string | null
          id: string
          order_type: string
          realized_r: number | null
          reasoning: string | null
          rejection_reason: string | null
          risk_pct: number | null
          side: string
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          timeframe: string | null
          units: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_target?: string
          broker_order_id?: string | null
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          entry: number
          expires_at?: string
          grade?: string | null
          id?: string
          order_type?: string
          realized_r?: number | null
          reasoning?: string | null
          rejection_reason?: string | null
          risk_pct?: number | null
          side: string
          status?: string
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
          timeframe?: string | null
          units?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_target?: string
          broker_order_id?: string | null
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          entry?: number
          expires_at?: string
          grade?: string | null
          id?: string
          order_type?: string
          realized_r?: number | null
          reasoning?: string | null
          rejection_reason?: string | null
          risk_pct?: number | null
          side?: string
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
          timeframe?: string | null
          units?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      autopilot_settings: {
        Row: {
          account_target: string
          allowed_symbols: string[]
          created_at: string
          live_acknowledged_at: string | null
          max_daily_loss_pct: number
          max_open_positions: number
          min_grade: string
          mode: string
          paused_reason: string | null
          risk_pct: number
          session_windows: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_target?: string
          allowed_symbols?: string[]
          created_at?: string
          live_acknowledged_at?: string | null
          max_daily_loss_pct?: number
          max_open_positions?: number
          min_grade?: string
          mode?: string
          paused_reason?: string | null
          risk_pct?: number
          session_windows?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_target?: string
          allowed_symbols?: string[]
          created_at?: string
          live_acknowledged_at?: string | null
          max_daily_loss_pct?: number
          max_open_positions?: number
          min_grade?: string
          mode?: string
          paused_reason?: string | null
          risk_pct?: number
          session_windows?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bridge_orders: {
        Row: {
          account_id: string | null
          broker_order_id: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          order_type: string
          price: number | null
          quantity: number
          side: string
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          updated_at: string
          user_id: string
          venue: string
        }
        Insert: {
          account_id?: string | null
          broker_order_id?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          order_type?: string
          price?: number | null
          quantity: number
          side: string
          status?: string
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
          updated_at?: string
          user_id: string
          venue: string
        }
        Update: {
          account_id?: string | null
          broker_order_id?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          order_type?: string
          price?: number | null
          quantity?: number
          side?: string
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
          updated_at?: string
          user_id?: string
          venue?: string
        }
        Relationships: []
      }
      bridge_tokens: {
        Row: {
          created_at: string
          last_seen_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_seen_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_seen_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      briefing_prefs: {
        Row: {
          created_at: string
          discord_webhook_url: string | null
          evening_enabled: boolean
          evening_hour: number
          last_evening_at: string | null
          last_morning_at: string | null
          morning_enabled: boolean
          morning_hour: number
          telegram_chat_id: number | null
          telegram_link_code: string | null
          timezone: string
          updated_at: string
          user_id: string
          watchlist: string[]
        }
        Insert: {
          created_at?: string
          discord_webhook_url?: string | null
          evening_enabled?: boolean
          evening_hour?: number
          last_evening_at?: string | null
          last_morning_at?: string | null
          morning_enabled?: boolean
          morning_hour?: number
          telegram_chat_id?: number | null
          telegram_link_code?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
          watchlist?: string[]
        }
        Update: {
          created_at?: string
          discord_webhook_url?: string | null
          evening_enabled?: boolean
          evening_hour?: number
          last_evening_at?: string | null
          last_morning_at?: string | null
          morning_enabled?: boolean
          morning_hour?: number
          telegram_chat_id?: number | null
          telegram_link_code?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
          watchlist?: string[]
        }
        Relationships: []
      }
      briefings: {
        Row: {
          body: string
          delivered_discord: boolean
          delivered_telegram: boolean
          id: string
          kind: string
          sent_at: string
          title: string
          user_id: string
        }
        Insert: {
          body: string
          delivered_discord?: boolean
          delivered_telegram?: boolean
          id?: string
          kind: string
          sent_at?: string
          title: string
          user_id: string
        }
        Update: {
          body?: string
          delivered_discord?: boolean
          delivered_telegram?: boolean
          id?: string
          kind?: string
          sent_at?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          client_id: string
          created_at: string
          id: string
          parts: Json
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          parts: Json
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          parts?: Json
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          client_id: string
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      hermes_feedback: {
        Row: {
          coach: string | null
          context: Json
          created_at: string
          id: string
          interval: string | null
          kind: string
          lens: string | null
          note: string | null
          rating: number
          ticker: string | null
          user_id: string
        }
        Insert: {
          coach?: string | null
          context?: Json
          created_at?: string
          id?: string
          interval?: string | null
          kind: string
          lens?: string | null
          note?: string | null
          rating: number
          ticker?: string | null
          user_id: string
        }
        Update: {
          coach?: string | null
          context?: Json
          created_at?: string
          id?: string
          interval?: string | null
          kind?: string
          lens?: string | null
          note?: string | null
          rating?: number
          ticker?: string | null
          user_id?: string
        }
        Relationships: []
      }
      hermes_lessons: {
        Row: {
          created_at: string
          id: string
          lesson: string
          scope: string
          source_feedback_id: string | null
          topic: string
          updated_at: string
          user_id: string | null
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          lesson: string
          scope: string
          source_feedback_id?: string | null
          topic: string
          updated_at?: string
          user_id?: string | null
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          lesson?: string
          scope?: string
          source_feedback_id?: string | null
          topic?: string
          updated_at?: string
          user_id?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "hermes_lessons_source_feedback_id_fkey"
            columns: ["source_feedback_id"]
            isOneToOne: false
            referencedRelation: "hermes_feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_reviews: {
        Row: {
          correlations: Json
          created_at: string
          id: string
          mistakes: Json
          strengths: Json
          summary: string
          trade_count: number
          user_id: string
        }
        Insert: {
          correlations?: Json
          created_at?: string
          id?: string
          mistakes?: Json
          strengths?: Json
          summary: string
          trade_count?: number
          user_id: string
        }
        Update: {
          correlations?: Json
          created_at?: string
          id?: string
          mistakes?: Json
          strengths?: Json
          summary?: string
          trade_count?: number
          user_id?: string
        }
        Relationships: []
      }
      leaderboard_opt_in: {
        Row: {
          created_at: string
          handle: string
          opted_in: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          handle: string
          opted_in?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          handle?: string
          opted_in?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          meta: Json
          read_at: string | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          meta?: Json
          read_at?: string | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          meta?: Json
          read_at?: string | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      paper_accounts: {
        Row: {
          balance: number
          created_at: string
          paused_reason: string | null
          peak_equity: number
          starting_balance: number
          status: string
          testing_mode: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          paused_reason?: string | null
          peak_equity?: number
          starting_balance?: number
          status?: string
          testing_mode?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          paused_reason?: string | null
          peak_equity?: number
          starting_balance?: number
          status?: string
          testing_mode?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      paper_equity_snapshots: {
        Row: {
          equity: number
          id: number
          taken_at: string
          user_id: string
        }
        Insert: {
          equity: number
          id?: number
          taken_at?: string
          user_id: string
        }
        Update: {
          equity?: number
          id?: number
          taken_at?: string
          user_id?: string
        }
        Relationships: []
      }
      paper_positions: {
        Row: {
          entry: number
          grade: string | null
          id: string
          meta: Json | null
          opened_at: string
          side: string
          size: number
          stop: number | null
          symbol: string
          take_profit: number | null
          user_id: string
        }
        Insert: {
          entry: number
          grade?: string | null
          id?: string
          meta?: Json | null
          opened_at?: string
          side: string
          size: number
          stop?: number | null
          symbol: string
          take_profit?: number | null
          user_id: string
        }
        Update: {
          entry?: number
          grade?: string | null
          id?: string
          meta?: Json | null
          opened_at?: string
          side?: string
          size?: number
          stop?: number | null
          symbol?: string
          take_profit?: number | null
          user_id?: string
        }
        Relationships: []
      }
      paper_trades: {
        Row: {
          closed_at: string
          entry: number
          exit: number
          grade: string | null
          id: string
          opened_at: string
          pnl: number
          reason: string
          side: string
          size: number
          stop: number | null
          symbol: string
          take_profit: number | null
          user_id: string
        }
        Insert: {
          closed_at?: string
          entry: number
          exit: number
          grade?: string | null
          id?: string
          opened_at: string
          pnl: number
          reason: string
          side: string
          size: number
          stop?: number | null
          symbol: string
          take_profit?: number | null
          user_id: string
        }
        Update: {
          closed_at?: string
          entry?: number
          exit?: number
          grade?: string | null
          id?: string
          opened_at?: string
          pnl?: number
          reason?: string
          side?: string
          size?: number
          stop?: number | null
          symbol?: string
          take_profit?: number | null
          user_id?: string
        }
        Relationships: []
      }
      platform_status: {
        Row: {
          id: boolean
          level: string
          message: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          level?: string
          message?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          level?: string
          message?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      price_alerts: {
        Row: {
          active: boolean
          auto_delete: boolean
          created_at: string
          id: string
          last_checked_at: string | null
          last_checked_price: number | null
          note: string | null
          price: number
          side: string
          symbol: string
          triggered_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          auto_delete?: boolean
          created_at?: string
          id?: string
          last_checked_at?: string | null
          last_checked_price?: number | null
          note?: string | null
          price: number
          side: string
          symbol: string
          triggered_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          auto_delete?: boolean
          created_at?: string
          id?: string
          last_checked_at?: string | null
          last_checked_price?: number | null
          note?: string | null
          price?: number
          side?: string
          symbol?: string
          triggered_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          banned: boolean
          broker_account_type: string | null
          broker_connected: boolean
          broker_name: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          losses: number
          onboarded: boolean
          recovery_code_hash: string | null
          referral_source: string | null
          updated_at: string
          voice_enabled: boolean
          voice_id_override: string | null
          wins: number
        }
        Insert: {
          banned?: boolean
          broker_account_type?: string | null
          broker_connected?: boolean
          broker_name?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          losses?: number
          onboarded?: boolean
          recovery_code_hash?: string | null
          referral_source?: string | null
          updated_at?: string
          voice_enabled?: boolean
          voice_id_override?: string | null
          wins?: number
        }
        Update: {
          banned?: boolean
          broker_account_type?: string | null
          broker_connected?: boolean
          broker_name?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          losses?: number
          onboarded?: boolean
          recovery_code_hash?: string | null
          referral_source?: string | null
          updated_at?: string
          voice_enabled?: boolean
          voice_id_override?: string | null
          wins?: number
        }
        Relationships: []
      }
      signal_feed: {
        Row: {
          action: string
          bias: string
          confidence: number | null
          created_at: string
          entry: number | null
          grade: string
          id: string
          notes: string | null
          rr: number | null
          stop: number | null
          symbol: string
          tp1: number | null
        }
        Insert: {
          action: string
          bias: string
          confidence?: number | null
          created_at?: string
          entry?: number | null
          grade: string
          id?: string
          notes?: string | null
          rr?: number | null
          stop?: number | null
          symbol: string
          tp1?: number | null
        }
        Update: {
          action?: string
          bias?: string
          confidence?: number | null
          created_at?: string
          entry?: number | null
          grade?: string
          id?: string
          notes?: string | null
          rr?: number | null
          stop?: number | null
          symbol?: string
          tp1?: number | null
        }
        Relationships: []
      }
      signal_scores: {
        Row: {
          bias: string
          confidence: number | null
          created_at: string
          entry: number
          grade: string
          id: string
          planned_r: number | null
          realized_r: number | null
          resolved_at: string | null
          status: string
          stop: number
          strategy_id: string | null
          symbol: string
          taken: boolean
          timeframe: string
          tp1: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bias: string
          confidence?: number | null
          created_at?: string
          entry: number
          grade: string
          id?: string
          planned_r?: number | null
          realized_r?: number | null
          resolved_at?: string | null
          status?: string
          stop: number
          strategy_id?: string | null
          symbol: string
          taken?: boolean
          timeframe?: string
          tp1: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bias?: string
          confidence?: number | null
          created_at?: string
          entry?: number
          grade?: string
          id?: string
          planned_r?: number | null
          realized_r?: number | null
          resolved_at?: string | null
          status?: string
          stop?: number
          strategy_id?: string | null
          symbol?: string
          taken?: boolean
          timeframe?: string
          tp1?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      strategy_performance: {
        Row: {
          created_at: string
          expectancy_r: number
          id: string
          max_drawdown_pct: number
          net_r: number
          source: string
          strategy_id: string
          symbol: string
          timeframe: string
          trades: number
          updated_at: string
          user_id: string
          win_rate: number
        }
        Insert: {
          created_at?: string
          expectancy_r?: number
          id?: string
          max_drawdown_pct?: number
          net_r?: number
          source?: string
          strategy_id: string
          symbol: string
          timeframe: string
          trades?: number
          updated_at?: string
          user_id: string
          win_rate?: number
        }
        Update: {
          created_at?: string
          expectancy_r?: number
          id?: string
          max_drawdown_pct?: number
          net_r?: number
          source?: string
          strategy_id?: string
          symbol?: string
          timeframe?: string
          trades?: number
          updated_at?: string
          user_id?: string
          win_rate?: number
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: string | null
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trader_connections: {
        Row: {
          created_at: string
          id: string
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          id?: string
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      trader_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          code: string
          created_at: string
          id: string
          inviter_id: string
          note: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          code: string
          created_at?: string
          id?: string
          inviter_id: string
          note?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          code?: string
          created_at?: string
          id?: string
          inviter_id?: string
          note?: string | null
        }
        Relationships: []
      }
      user_broker_credentials: {
        Row: {
          account_id: string | null
          api_key_ciphertext: string
          broker: string
          created_at: string
          env: string
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          api_key_ciphertext: string
          broker?: string
          created_at?: string
          env?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          api_key_ciphertext?: string
          broker?: string
          created_at?: string
          env?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_reports: {
        Row: {
          created_at: string
          id: string
          lesson: string
          metrics_json: Json
          user_id: string
          week_ending: string
        }
        Insert: {
          created_at?: string
          id?: string
          lesson?: string
          metrics_json?: Json
          user_id: string
          week_ending: string
        }
        Update: {
          created_at?: string
          id?: string
          lesson?: string
          metrics_json?: Json
          user_id?: string
          week_ending?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_ai_cost_per_user: {
        Args: { _days?: number; _limit?: number }
        Returns: {
          calls: number
          cost_per_setup: number
          cost_usd: number
          email: string
          graded_setups: number
          user_id: string
        }[]
      }
      admin_ai_cost_summary: {
        Args: { _days?: number }
        Returns: {
          cached_input_tokens: number
          calls: number
          cost_usd: number
          input_tokens: number
          kind: string
          model: string
          output_tokens: number
        }[]
      }
      admin_referral_stats: {
        Args: never
        Returns: {
          count: number
          source: string
        }[]
      }
      admin_set_platform_status: {
        Args: { _level: string; _message: string }
        Returns: {
          id: boolean
          level: string
          message: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "platform_status"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_users_overview: {
        Args: never
        Returns: {
          banned: boolean
          broker_account_type: string
          broker_connected: boolean
          broker_name: string
          created_at: string
          display_name: string
          email: string
          id: string
          onboarded: boolean
          referral_source: string
        }[]
      }
      bump_ai_usage: {
        Args: { _cap: number; _user_id: string }
        Returns: number
      }
      get_public_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          equity: number
          handle: string
          pnl_pct: number
          starting_balance: number
          trades: number
          updated_at: string
          win_rate: number
          wins: number
        }[]
      }
      has_active_subscription: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      redeem_invite: {
        Args: { _code: string; _user_id: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
